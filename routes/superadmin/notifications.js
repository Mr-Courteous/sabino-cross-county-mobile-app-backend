// ─────────────────────────────────────────────────────────────
// routes/superadmin/notifications.js  —  /api/superadmin/notifications
// The panel version of routes/adminNotifications.js: same Expo push
// delivery and the same audiences, but behind admin login + roles,
// with a confirmation count and every send written to the audit log.
// Reuses the `device_tokens` table and `axios` you already have.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const axios = require('axios');
const { pool, writeAudit } = require('./db');

const router = express.Router();
const EXPO_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const TITLE_MAX = 65;
const BODY_MAX = 240;

// "Active access" mirrors middleware/checkSubscription.js: a paid status AND a future expiry.
const ACTIVE = `(s.payment_status IN ('completed','grace_period') AND COALESCE(s.subscription_expiry, 'epoch'::timestamptz) > NOW())`;
const VALID_TOKEN = `dt.expo_token ~ '^Expo(nent)?PushToken\\['`;

const AUDIENCES = {
  all:          { label: 'Everyone with the app',               join: '',                                        where: 'TRUE',                    type: null },
  subscribed:   { label: 'Schools with active access',          join: 'JOIN schools s ON s.id = dt.school_id',   where: ACTIVE,                    type: 'retention' },
  unsubscribed: { label: 'Schools without active access',       join: 'JOIN schools s ON s.id = dt.school_id',   where: `NOT ${ACTIVE}`,           type: 'marketing' },
  anonymous:    { label: 'People who haven’t signed in yet',    join: '',                                        where: 'dt.school_id IS NULL',     type: 'marketing' },
  outdated:     { label: 'Devices on an older app version',     join: '',                                        where: '(dt.app_version IS NULL OR dt.app_version <> $1)', type: 'version_update', needs: 'version' },
  school:       { label: 'One school',                          join: '',                                        where: 'dt.school_id = $1',        type: null, needs: 'schoolId' },
};

const tokensSql = (a) => `SELECT DISTINCT dt.expo_token FROM device_tokens dt ${a.join} WHERE ${VALID_TOKEN} AND (${a.where})`;
const fail = (res, status, error) => res.status(status).json({ success: false, error });
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`❌ [superadmin/notifications] ${req.method} ${req.originalUrl}:`, err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Something went wrong. Try again.' });
  });

async function pushAll(tokens, { title, body, type }) {
  let sent = 0, failed = 0, unregistered = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100).map((to) => ({ to, sound: 'default', title, body, ...(type && { data: { type } }) }));
    try {
      const r = await axios.post(EXPO_URL, batch, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: 20000 });
      const tickets = Array.isArray(r.data?.data) ? r.data.data : [];
      if (!tickets.length) { sent += batch.length; continue; }
      tickets.forEach((t) => {
        if (t.status === 'ok') sent += 1;
        else { failed += 1; if (t.details?.error === 'DeviceNotRegistered') unregistered += 1; }
      });
    } catch (err) {
      console.error('❌ [notifications] batch failed:', err.message);
      failed += batch.length;
    }
  }
  return { sent, failed, unregistered };
}

// How many devices each audience would reach right now.
router.get('/audiences', wrap(async (req, res) => {
  const version = String(req.query.version || '').trim();
  const out = [];
  for (const [id, a] of Object.entries(AUDIENCES)) {
    let devices = null;
    if (!a.needs || (a.needs === 'version' && version)) {
      const params = a.needs === 'version' ? [version] : [];
      devices = await pool.query(tokensSql(a), params).then((r) => r.rowCount).catch(() => 0);
    }
    out.push({ id, label: a.label, devices, needs: a.needs ?? null });
  }
  res.json({ success: true, data: out });
}));

router.post('/send', wrap(async (req, res) => {
  const { audience, schoolId, version } = req.body || {};
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const a = AUDIENCES[audience];
  if (!a) return fail(res, 400, 'Choose who should receive this.');
  if (!title || !body) return fail(res, 400, 'Add a title and a message.');
  if (title.length > TITLE_MAX) return fail(res, 400, `Title can be at most ${TITLE_MAX} characters.`);
  if (body.length > BODY_MAX) return fail(res, 400, `Message can be at most ${BODY_MAX} characters.`);

  let param = null; let target = {};
  if (a.needs === 'version') {
    param = String(version || '').trim();
    if (!param) return fail(res, 400, 'Enter the current app version, for example 2.0.0.');
  }
  if (a.needs === 'schoolId') {
    param = parseInt(schoolId);
    if (!param) return fail(res, 400, 'Choose a school.');
    const school = (await pool.query('SELECT id, name FROM schools WHERE id = $1', [param])).rows[0];
    if (!school) return fail(res, 404, 'School not found.');
    target = { targetType: 'school', targetId: school.id, targetLabel: school.name };
  }

  // Guards against a double click or retry sending the same message twice.
  const dup = await pool.query(
    `SELECT 1 FROM superadmin_audit_logs WHERE admin_id = $1 AND action = 'notification.sent'
       AND details->>'title' = $2 AND details->>'body' = $3 AND created_at > NOW() - INTERVAL '60 seconds' LIMIT 1`,
    [req.admin.id, title, body]
  );
  if (dup.rowCount) return fail(res, 429, 'You just sent this exact message. Wait a minute before sending it again.');

  const tokens = (await pool.query(tokensSql(a), a.needs ? [param] : [])).rows.map((r) => r.expo_token);
  if (!tokens.length) return fail(res, 400, 'No devices match this audience right now.');

  let result = { sent: 0, failed: tokens.length, unregistered: 0 };
  try {
    result = await pushAll(tokens, { title, body, type: a.type });
  } finally {
    await writeAudit(pool, req, { id: req.admin.id, email: req.admin.email, name: req.admin.name }, {
      action: 'notification.sent', ...target,
      details: { audience, audienceLabel: a.label, title, body, recipients: tokens.length, ...result, ...(a.needs === 'version' && { version: param }) },
    }).catch((err) => console.error('⚠️ [notifications] audit write failed:', err.message));
  }
  res.json({ success: true, data: { recipients: tokens.length, ...result } });
}));

router.get('/history', wrap(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 15));
  const total = (await pool.query(`SELECT COUNT(*)::int AS count FROM superadmin_audit_logs WHERE action = 'notification.sent'`)).rows[0].count;
  const { rows } = await pool.query(
    `SELECT id, admin_email, admin_name, target_label, details, created_at FROM superadmin_audit_logs
     WHERE action = 'notification.sent' ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [limit, (page - 1) * limit]
  );
  res.json({ success: true, data: rows, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
}));

module.exports = router;
