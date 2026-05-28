const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const ADMIN_SECRET = process.env.ADMIN_NOTIFICATION_SECRET;

// ─── Simple admin key check (no JWT needed) ────────────────────────────────
function adminAuth(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

// ─── Send to Expo in batches of 100 ───────────────────────────────────────
async function sendPushBatch(messages) {
    const results = { sent: 0, failed: 0 };
    for (let i = 0; i < messages.length; i += 100) {
        const batch = messages.slice(i, i + 100);
        try {
            await axios.post(EXPO_PUSH_URL, batch, {
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            });
            results.sent += batch.length;
        } catch (err) {
            console.error('❌ Batch send error:', err.message);
            results.failed += batch.length;
        }
    }
    return results;
}

// ─── Routes ───────────────────────────────────────────────────────────────

/**
 * @route   POST /api/admin/notifications/send-all
 * @desc    Send a notification to ALL devices (registered or not)
 * @header  x-admin-secret: your-secret
 * @body    { title, body }
 */
router.post('/send-all', adminAuth, async (req, res) => {
    const { title, body } = req.body;

    if (!title || !body) {
        return res.status(400).json({ success: false, error: 'title and body are required' });
    }

    try {
        const result = await pool.query('SELECT expo_token FROM device_tokens');

        if (result.rows.length === 0) {
            return res.json({ success: true, message: 'No registered devices found', sent: 0 });
        }

        const messages = result.rows.map(row => ({
            to: row.expo_token,
            sound: 'default',
            title,
            body,
        }));

        const { sent, failed } = await sendPushBatch(messages);

        res.json({ success: true, sent, failed, total: result.rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/admin/notifications/send-unsubscribed
 * @desc    Send a notification to schools with no active subscription (marketing)
 * @header  x-admin-secret: your-secret
 * @body    { title, body }
 */
router.post('/send-unsubscribed', adminAuth, async (req, res) => {
    const { title, body } = req.body;

    if (!title || !body) {
        return res.status(400).json({ success: false, error: 'title and body are required' });
    }

    try {
        const result = await pool.query(`
          SELECT dt.expo_token
          FROM device_tokens dt
          LEFT JOIN school_subscriptions ss ON ss.school_id = dt.school_id
          WHERE dt.school_id IS NOT NULL
            AND (ss.school_id IS NULL OR ss.status != 'active' OR ss.end_date < NOW())
        `);

        if (result.rows.length === 0) {
            return res.json({ success: true, message: 'No unsubscribed devices found', sent: 0 });
        }

        const messages = result.rows.map(row => ({
            to: row.expo_token,
            sound: 'default',
            title,
            body,
            data: { type: 'marketing' },
        }));

        const { sent, failed } = await sendPushBatch(messages);

        res.json({ success: true, sent, failed, total: result.rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/admin/notifications/send-subscribed
 * @desc    Send a notification to schools with an active subscription (retention)
 * @header  x-admin-secret: your-secret
 * @body    { title, body }
 */
router.post('/send-subscribed', adminAuth, async (req, res) => {
    const { title, body } = req.body;

    if (!title || !body) {
        return res.status(400).json({ success: false, error: 'title and body are required' });
    }

    try {
        const result = await pool.query(`
          SELECT dt.expo_token
          FROM device_tokens dt
          INNER JOIN school_subscriptions ss ON ss.school_id = dt.school_id
          WHERE ss.status = 'active' AND ss.end_date >= NOW()
        `);

        if (result.rows.length === 0) {
            return res.json({ success: true, message: 'No active subscribers found', sent: 0 });
        }

        const messages = result.rows.map(row => ({
            to: row.expo_token,
            sound: 'default',
            title,
            body,
            data: { type: 'retention' },
        }));

        const { sent, failed } = await sendPushBatch(messages);

        res.json({ success: true, sent, failed, total: result.rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/admin/notifications/send-one
 * @desc    Send a notification to a single school by school_id
 * @header  x-admin-secret: your-secret
 * @body    { school_id, title, body }
 */
router.post('/send-one', adminAuth, async (req, res) => {
    const { school_id, title, body } = req.body;

    if (!school_id || !title || !body) {
        return res.status(400).json({ success: false, error: 'school_id, title and body are required' });
    }

    try {
        const result = await pool.query(
            'SELECT expo_token FROM device_tokens WHERE school_id = $1',
            [school_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No push token found for this school' });
        }

        await axios.post(EXPO_PUSH_URL, {
            to: result.rows[0].expo_token,
            sound: 'default',
            title,
            body,
        });

        res.json({ success: true, message: `Notification sent to school ${school_id}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/admin/notifications/version-update
 * @desc    Notify all schools not on the current version to update
 * @header  x-admin-secret: your-secret
 * @body    { current_version }  e.g. { "current_version": "2.0.0" }
 */
router.post('/version-update', adminAuth, async (req, res) => {
    const { current_version } = req.body;

    if (!current_version) {
        return res.status(400).json({ success: false, error: 'current_version is required' });
    }

    try {
        const result = await pool.query(`
          SELECT expo_token FROM device_tokens
          WHERE (app_version IS NULL OR app_version != $1)
            AND (version_notified_at IS NULL OR version_notified_at < NOW() - INTERVAL '7 days')
        `, [current_version]);

        if (result.rows.length === 0) {
            return res.json({ success: true, message: 'All devices are on the latest version', sent: 0 });
        }

        const messages = result.rows.map(row => ({
            to: row.expo_token,
            sound: 'default',
            title: '🆕 New Sabino Edu update available',
            body: 'A newer version is on the Play Store. Update now for the latest improvements.',
            data: { type: 'version_update' },
        }));

        const { sent, failed } = await sendPushBatch(messages);

        // Mark notified so they don't get it again within 7 days
        await pool.query(`
          UPDATE device_tokens SET version_notified_at = NOW()
          WHERE (app_version IS NULL OR app_version != $1)
        `, [current_version]);

        res.json({ success: true, sent, failed, total: result.rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const MARKETING_MESSAGES = [
  { title: "Unlock your school's potential", body: "Register today and streamline your management!" },
  { title: "Special offer inside", body: "Don't miss out on our newest features. Login to get started." }
];
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * @route   POST /api/admin/notifications/send-anonymous
 * @desc    Send to users who allowed notifications but never logged in
 */
router.post('/send-anonymous', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT expo_token FROM device_tokens
      WHERE school_id IS NULL
    `);

    if (result.rows.length === 0) {
      return res.json({ success: true, message: 'No anonymous devices found', sent: 0 });
    }

    // Pick random marketing message
    const msg = pickRandom(MARKETING_MESSAGES);
    const messages = result.rows.map(row => ({
      to: row.expo_token,
      sound: 'default',
      title: msg.title,
      body: msg.body,
      data: { type: 'marketing' },
    }));

    const { sent, failed } = await sendPushBatch(messages);
    res.json({ success: true, sent, failed, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;