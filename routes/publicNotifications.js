const express = require('express');
const router = express.Router();
const pool = require('../database/db');

// Ensure the table exists when the module loads
pool.query(`
  CREATE TABLE IF NOT EXISTS device_tokens (
    id SERIAL PRIMARY KEY,
    expo_token TEXT NOT NULL UNIQUE,
    app_version TEXT,
    school_id INTEGER REFERENCES schools(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(err => console.error('Failed to create device_tokens table:', err.message));

// Called immediately when user taps Allow
// No JWT, no login, no registration needed
router.post('/register-token', async (req, res) => {
  const { token, appVersion } = req.body;

  if (!token || !token.startsWith('ExponentPushToken[')) {
    return res.status(400).json({ success: false, error: 'Invalid push token' });
  }

  try {
    await pool.query(
      `INSERT INTO device_tokens (expo_token, app_version, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (expo_token) DO UPDATE SET
         app_version = EXCLUDED.app_version,
         updated_at = NOW()`,
      [token, appVersion || null]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
