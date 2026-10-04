// ─────────────────────────────────────────────────────────────
// routes/superadmin/index.js  —  mount at /api/superadmin
//
//   app.use('/api/superadmin', require('./routes/superadmin'));
//
// Roles:  owner  = everything, incl. managing other admins
//         admin  = schools, payment status, students, audit log
//         viewer = read-only on schools / students / stats
// Every state change and every sign-in is written to superadmin_audit_logs.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { pool, ROLES, ensureSuperadminTables, writeAudit } = require('./db');
const { signToken, requireSuperadmin, requireRole } = require('./middleware');

const router = express.Router();

const PAYMENT_STATUSES = ['pending', 'completed', 'grace_period', 'expired'];
const MIN_PASSWORD = 10;
const GRACE_DAYS = 3; // a grace period always runs exactly this long from the moment it is set
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // equalises timing for unknown emails

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`❌ [superadmin] ${req.method} ${req.originalUrl}:`, err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Something went wrong. Try again.' });
  });

const fail = (res, status, error, code) => res.status(status).json({ success: false, error, ...(code && { code }) });
const actorOf = (admin) => ({ id: admin.id, email: admin.email, name: admin.name });
const tempPassword = () => crypto.randomBytes(11).toString('base64url'); // 15 chars
const publicAdmin = (a) => ({
  id: a.id, email: a.email, name: a.name, role: a.role, is_active: a.is_active,
  must_change_password: a.must_change_password, last_login_at: a.last_login_at, created_at: a.created_at,
});

function paging(q, defLimit = 25) {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}
const pageInfo = (page, limit, total) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

router.use(async (req, res, next) => {
  try { await ensureSuperadminTables(); next(); }
  catch (err) { console.error('[superadmin] table setup failed:', err.message); fail(res, 500, 'Superadmin tables are not ready.'); }
});

// ═════════════════════════ AUTH ═════════════════════════
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the limit
  message: { success: false, error: 'Too many sign-in attempts. Try again in 15 minutes.', code: 'RATE_LIMITED' },
});

router.post('/auth/login', loginLimiter, wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return fail(res, 400, 'Enter your email and password.');

  const { rows } = await pool.query('SELECT * FROM superadmins WHERE email = $1', [email]);
  const admin = rows[0];
  const match = await bcrypt.compare(password, admin?.password_hash || DUMMY_HASH);

  if (!admin || !match) {
    await writeAudit(pool, req, { id: admin?.id ?? null, email }, { action: 'auth.login_failed' });
    return fail(res, 401, 'Email or password is incorrect.');
  }
  if (!admin.is_active) {
    await writeAudit(pool, req, actorOf(admin), { action: 'auth.login_blocked', details: { reason: 'account deactivated' } });
    return fail(res, 401, 'Email or password is incorrect.');
  }
  if (!process.env.SUPERADMIN_JWT_SECRET) return fail(res, 500, 'Server configuration error.');

  await pool.query('UPDATE superadmins SET last_login_at = NOW() WHERE id = $1', [admin.id]);
  await writeAudit(pool, req, actorOf(admin), { action: 'auth.login' });
  res.json({ success: true, data: { token: signToken(admin), admin: publicAdmin(admin) } });
}));

router.use(requireSuperadmin);

router.get('/auth/me', (req, res) => res.json({ success: true, data: publicAdmin(req.admin) }));

router.post('/auth/change-password', wrap(async (req, res) => {
  const { currentPassword = '', newPassword = '' } = req.body || {};
  if (newPassword.length < MIN_PASSWORD) return fail(res, 400, `New password must be at least ${MIN_PASSWORD} characters.`);
  if (newPassword === currentPassword) return fail(res, 400, 'New password must be different from the current one.');

  const { rows } = await pool.query('SELECT password_hash FROM superadmins WHERE id = $1', [req.admin.id]);
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) return fail(res, 400, 'Current password is incorrect.');

  await pool.query(
    'UPDATE superadmins SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
    [await bcrypt.hash(newPassword, 12), req.admin.id]
  );
  await writeAudit(pool, req, actorOf(req.admin), { action: 'auth.password_changed' });
  res.json({ success: true, message: 'Password updated.' });
}));

// ═════════════════════════ DASHBOARD ═════════════════════════
router.get('/stats', wrap(async (req, res) => {
  const count = (sql) => pool.query(sql).then((r) => r.rows[0].count).catch(() => 0);
  const [schools, students, devices] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE payment_status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE payment_status = 'grace_period')::int AS grace_period,
        COUNT(*) FILTER (WHERE payment_status = 'expired')::int AS expired,
        COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE payment_status = 'completed' AND subscription_expiry > NOW()
                           AND subscription_expiry <= NOW() + INTERVAL '7 days')::int AS expiring_soon,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d
      FROM schools`),
    count('SELECT COUNT(*)::int AS count FROM students'),
    count('SELECT COUNT(*)::int AS count FROM device_tokens'),
  ]);
  res.json({ success: true, data: { ...schools.rows[0], students, devices } });
}));

// ═════════════════════════ SCHOOLS ═════════════════════════
// created_at/updated_at are `timestamp` (no zone) in your schema; casting makes the instant unambiguous.
const SCHOOL_COLS = `id, name, email, phone, school_type, country, payment_status,
                     subscription_expiry, renewal_warning_sent_at,
                     created_at::timestamptz AS created_at, updated_at::timestamptz AS updated_at`;
// When the school most recently became (or renewed as) "completed" — from school_status_history.
const PAID_JOIN = `LEFT JOIN LATERAL (
    SELECT changed_at AS paid_at, estimated AS paid_estimated FROM school_status_history
    WHERE school_id = schools.id AND new_status = 'completed' ORDER BY changed_at DESC LIMIT 1
  ) p ON true`;

router.get('/schools', wrap(async (req, res) => {
  const { search = '', status = '', expiring = '', sort = 'newest' } = req.query;
  const { page, limit, offset } = paging(req.query);
  const where = [];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (search) {
    const p = add(`%${search}%`);
    where.push(`(name ILIKE ${p} OR email ILIKE ${p} OR phone ILIKE ${p})`);
  }
  if (PAYMENT_STATUSES.includes(status)) where.push(`payment_status = ${add(status)}`);
  if (expiring) {
    const days = Math.min(90, Math.max(1, parseInt(expiring) || 7));
    where.push(`payment_status = 'completed' AND subscription_expiry > NOW() AND subscription_expiry <= NOW() + (${add(days)} * INTERVAL '1 day')`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = { name: 'name ASC', expiry: 'subscription_expiry ASC NULLS LAST' }[sort] || 'created_at DESC';

  const total = (await pool.query(`SELECT COUNT(*)::int AS count FROM schools ${whereSql}`, params)).rows[0].count;
  const { rows } = await pool.query(
    `SELECT ${SCHOOL_COLS}, p.paid_at, p.paid_estimated FROM schools ${PAID_JOIN}
     ${whereSql} ORDER BY ${orderSql} LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    params
  );
  res.json({ success: true, data: rows, pagination: pageInfo(page, limit, total) });
}));

router.get('/schools/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return fail(res, 400, 'Invalid school id.');
  const school = (await pool.query(`SELECT ${SCHOOL_COLS} FROM schools WHERE id = $1`, [id])).rows[0];
  if (!school) return fail(res, 404, 'School not found.');

  const safe = (sql, p) => pool.query(sql, p).then((r) => r.rows).catch(() => []);
  const [students, classes, transactions, activity, paid, history] = await Promise.all([
    safe('SELECT COUNT(*)::int AS count FROM students WHERE school_id = $1', [id]),
    safe('SELECT COUNT(*)::int AS count FROM classes WHERE school_id = $1', [id]),
    safe(`SELECT id, tx_ref, flutterwave_ref, status, amount, currency, created_at
          FROM payment_transactions WHERE school_id = $1 ORDER BY created_at DESC LIMIT 10`, [id]),
    safe(`SELECT id, admin_email, admin_name, action, details, created_at FROM superadmin_audit_logs
          WHERE target_type = 'school' AND target_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
    safe(`SELECT changed_at AS paid_at, estimated AS paid_estimated FROM school_status_history
          WHERE school_id = $1 AND new_status = 'completed' ORDER BY changed_at DESC LIMIT 1`, [id]),
    safe(`SELECT id, old_status, new_status, old_expiry, new_expiry, changed_at, estimated FROM school_status_history
          WHERE school_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 15`, [id]),
  ]);
  res.json({
    success: true,
    data: {
      ...school,
      students_count: students[0]?.count ?? 0,
      classes_count: classes[0]?.count ?? 0,
      transactions,
      // admin activity is audit-log data: owners/admins only (viewers can't open the audit log either)
      activity: ['owner', 'admin'].includes(req.admin.role) ? activity : [],
      paid_at: paid[0]?.paid_at ?? null,
      paid_estimated: paid[0]?.paid_estimated ?? false,
      status_history: history,
    },
  });
}));

router.patch('/schools/:id/payment-status', requireRole('owner', 'admin'), wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const { status, expiryDate, reason } = req.body || {};
  if (!id) return fail(res, 400, 'Invalid school id.');
  if (!PAYMENT_STATUSES.includes(status)) return fail(res, 400, `Status must be one of: ${PAYMENT_STATUSES.join(', ')}.`);
  const note = String(reason || '').trim();
  if (note.length < 3) return fail(res, 400, 'Add a reason so the audit log explains this change.');

  // Paid statuses need a future expiry — middleware/checkSubscription.js rejects a paid school with none.
  // Grace period is fixed at GRACE_DAYS from now and ignores any date sent by the client.
  let newExpiry = null;
  if (status === 'grace_period') {
    newExpiry = new Date(Date.now() + GRACE_DAYS * 86400000);
  } else if (status === 'completed') {
    newExpiry = expiryDate ? new Date(expiryDate) : new Date(Date.now() + 30 * 86400000);
    if (Number.isNaN(newExpiry.getTime()) || newExpiry <= new Date()) {
      return fail(res, 400, 'Choose an expiry date in the future.');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query(
      'SELECT id, name, payment_status, subscription_expiry FROM schools WHERE id = $1 FOR UPDATE', [id]
    )).rows[0];
    if (!before) { await client.query('ROLLBACK'); return fail(res, 404, 'School not found.'); }

    // Expiry behaviour is decided in JS and passed as its own typed parameter
    // (Postgres can't infer one type for a $1 used as both a value and a CASE operand).
    const expiryMode = newExpiry ? 'set' : status === 'pending' ? 'clear' : 'keep';
    const after = (await client.query(
      `UPDATE schools SET payment_status = $1::varchar,
         subscription_expiry = CASE $2::text WHEN 'set' THEN $3::timestamptz
                                             WHEN 'clear' THEN NULL
                                             ELSE subscription_expiry END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING ${SCHOOL_COLS}`,
      [status, expiryMode, newExpiry, id]
    )).rows[0];

    await writeAudit(client, req, actorOf(req.admin), {
      action: 'school.payment_status_changed', targetType: 'school', targetId: id, targetLabel: before.name,
      details: {
        reason: note,
        from: { status: before.payment_status, expiry: before.subscription_expiry },
        to: { status: after.payment_status, expiry: after.subscription_expiry },
      },
    });
    await client.query('COMMIT');
    res.json({ success: true, message: `${before.name} is now ${status.replace('_', ' ')}.`, data: after });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ═════════════════════════ STUDENTS (read-only) ═════════════════════════
router.get('/students', wrap(async (req, res) => {
  const { search = '', schoolId = '' } = req.query;
  const { page, limit, offset } = paging(req.query);
  const where = [];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  if (search) {
    const p = add(`%${search}%`);
    where.push(`(s.first_name ILIKE ${p} OR s.last_name ILIKE ${p} OR s.email ILIKE ${p})`);
  }
  if (parseInt(schoolId)) where.push(`s.school_id = ${add(parseInt(schoolId))}`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await pool.query(`SELECT COUNT(*)::int AS count FROM students s ${whereSql}`, params)).rows[0].count;
  const { rows } = await pool.query(
    `SELECT s.id, s.first_name, s.last_name, s.email, s.school_id, sc.name AS school_name, s.created_at
     FROM students s LEFT JOIN schools sc ON sc.id = s.school_id
     ${whereSql} ORDER BY s.created_at DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    params
  );
  res.json({ success: true, data: rows, pagination: pageInfo(page, limit, total) });
}));

// ═════════════════════════ AUDIT LOG ═════════════════════════
router.get('/audit-logs/filters', requireRole('owner', 'admin'), wrap(async (req, res) => {
  const [actions, actors] = await Promise.all([
    pool.query('SELECT DISTINCT action FROM superadmin_audit_logs ORDER BY action'),
    pool.query('SELECT DISTINCT admin_email FROM superadmin_audit_logs ORDER BY admin_email'),
  ]);
  res.json({ success: true, data: { actions: actions.rows.map((r) => r.action), actors: actors.rows.map((r) => r.admin_email) } });
}));

router.get('/audit-logs', requireRole('owner', 'admin'), wrap(async (req, res) => {
  const { adminEmail = '', action = '', targetType = '', targetId = '', search = '', from = '', to = '' } = req.query;
  const { page, limit, offset } = paging(req.query, 30);
  const where = [];
  const params = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (adminEmail) where.push(`admin_email = ${add(adminEmail)}`);
  if (action) where.push(`action = ${add(action)}`);
  if (targetType) where.push(`target_type = ${add(targetType)}`);
  if (parseInt(targetId)) where.push(`target_id = ${add(parseInt(targetId))}`);
  if (search) {
    const p = add(`%${search}%`);
    where.push(`(admin_email ILIKE ${p} OR target_label ILIKE ${p} OR action ILIKE ${p} OR details::text ILIKE ${p})`);
  }
  if (from && !Number.isNaN(Date.parse(from))) where.push(`created_at >= ${add(new Date(from))}`);
  if (to && !Number.isNaN(Date.parse(to))) where.push(`created_at <= ${add(new Date(to))}`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await pool.query(`SELECT COUNT(*)::int AS count FROM superadmin_audit_logs ${whereSql}`, params)).rows[0].count;
  const { rows } = await pool.query(
    `SELECT id, admin_id, admin_email, admin_name, action, target_type, target_id, target_label, details, ip, created_at
     FROM superadmin_audit_logs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    params
  );
  res.json({ success: true, data: rows, pagination: pageInfo(page, limit, total) });
}));

// ═════════════════════════ NOTIFICATIONS (owner + admin) ═════════════════════════
router.use('/notifications', requireRole('owner', 'admin'), require('./notifications'));

// ═════════════════════════ ADMIN MANAGEMENT (owner only) ═════════════════════════
router.use('/admins', requireRole('owner'));

router.get('/admins', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, name, role, is_active, must_change_password, last_login_at, created_at
     FROM superadmins ORDER BY is_active DESC, created_at ASC`
  );
  res.json({ success: true, data: rows });
}));

router.post('/admins', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const role = req.body?.role || 'admin';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.');
  if (!name) return fail(res, 400, 'Enter the admin’s name.');
  if (!ROLES.includes(role)) return fail(res, 400, `Role must be one of: ${ROLES.join(', ')}.`);

  const temp = tempPassword();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO superadmins (email, name, password_hash, role, must_change_password, created_by)
       VALUES ($1,$2,$3,$4,true,$5)
       RETURNING id, email, name, role, is_active, must_change_password, last_login_at, created_at`,
      [email, name, await bcrypt.hash(temp, 12), role, req.admin.id]
    );
    await writeAudit(client, req, actorOf(req.admin), {
      action: 'admin.created', targetType: 'admin', targetId: rows[0].id, targetLabel: email, details: { role },
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { admin: rows[0], tempPassword: temp } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return fail(res, 409, 'An admin with that email already exists.');
    throw err;
  } finally {
    client.release();
  }
}));

router.patch('/admins/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, role, is_active } = req.body || {};
  if (!id) return fail(res, 400, 'Invalid admin id.');
  if (role !== undefined && !ROLES.includes(role)) return fail(res, 400, `Role must be one of: ${ROLES.join(', ')}.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = (await client.query('SELECT * FROM superadmins WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!target) { await client.query('ROLLBACK'); return fail(res, 404, 'Admin not found.'); }

    const roleChanging = role !== undefined && role !== target.role;
    const activeChanging = is_active !== undefined && Boolean(is_active) !== target.is_active;
    if (id === req.admin.id && (roleChanging || activeChanging)) {
      await client.query('ROLLBACK');
      return fail(res, 400, 'You can’t change your own role or deactivate yourself. Ask another owner.');
    }
    const losesOwner = target.role === 'owner' && target.is_active &&
      ((roleChanging && role !== 'owner') || (activeChanging && !is_active));
    if (losesOwner) {
      const others = (await client.query(
        `SELECT COUNT(*)::int AS count FROM superadmins WHERE role = 'owner' AND is_active AND id <> $1`, [id]
      )).rows[0].count;
      if (others < 1) { await client.query('ROLLBACK'); return fail(res, 400, 'There must always be at least one active owner.'); }
    }

    const updated = (await client.query(
      `UPDATE superadmins SET name = COALESCE($1, name), role = COALESCE($2, role),
         is_active = COALESCE($3, is_active), updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, name, role, is_active, must_change_password, last_login_at, created_at`,
      [name?.trim() || null, role ?? null, is_active === undefined ? null : Boolean(is_active), id]
    )).rows[0];

    const log = (action, details) => writeAudit(client, req, actorOf(req.admin), {
      action, targetType: 'admin', targetId: id, targetLabel: target.email, details,
    });
    if (roleChanging) await log('admin.role_changed', { from: target.role, to: role });
    if (activeChanging) await log(is_active ? 'admin.reactivated' : 'admin.deactivated');
    if (name && name.trim() !== target.name) await log('admin.renamed', { from: target.name, to: name.trim() });

    await client.query('COMMIT');
    res.json({ success: true, data: updated });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

router.post('/admins/:id/reset-password', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const target = (await pool.query('SELECT id, email FROM superadmins WHERE id = $1', [id])).rows[0];
  if (!target) return fail(res, 404, 'Admin not found.');
  if (id === req.admin.id) return fail(res, 400, 'Use Account → Change password for your own password.');

  const temp = tempPassword();
  await pool.query(
    'UPDATE superadmins SET password_hash = $1, must_change_password = true, updated_at = NOW() WHERE id = $2',
    [await bcrypt.hash(temp, 12), id]
  );
  await writeAudit(pool, req, actorOf(req.admin), {
    action: 'admin.password_reset', targetType: 'admin', targetId: id, targetLabel: target.email,
  });
  res.json({ success: true, data: { tempPassword: temp } });
}));

module.exports = router;
