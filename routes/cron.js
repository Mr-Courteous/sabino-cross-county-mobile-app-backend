/**
 * routes/cron.js
 *
 * Single HTTP endpoint called daily by an external cron service (e.g. cron-job.org).
 * Since this server runs on Vercel (serverless), node-cron doesn't work.
 *
 * URL to register on cron-job.org:
 *   GET https://sabino-cross-county-mobile-app-back.vercel.app/api/cron/backup
 *   Schedule: 0 0 * * *  (every day at midnight UTC)
 *
 * Security (optional): add header  x-cron-secret: <value>
 * and set CRON_SECRET in your Vercel environment variables.
 */

const express = require('express');
const router = express.Router();
const { runBackup } = require('../database/backup-db');
const pool = require('../database/db');

// ─── Optional secret check ──────────────────────────────────────────────────
function verifyCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return next(); // No secret set → allow all
  if (req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// ─── GET /api/cron/backup ───────────────────────────────────────────────────
// Called daily by cron-job.org
// 1. Marks expired subscriptions
// 2. Dumps DB → gzips → emails to EMAIL_USER
router.get('/backup', verifyCron, async (req, res) => {
  console.log(`⏰ [Cron] /backup triggered at ${new Date().toISOString()}`);
  const result = { expiredSchools: 0, backupTriggered: false };

  // 1. Proactive expiry check
  try {
    const expiry = await pool.query(`
      UPDATE schools
      SET payment_status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE payment_status = 'completed'
        AND subscription_expiry < CURRENT_TIMESTAMP
      RETURNING id, name
    `);
    result.expiredSchools = expiry.rowCount;
    if (expiry.rowCount > 0) {
      console.log(`✅ [Cron] Marked ${expiry.rowCount} school(s) as expired`);
    }
  } catch (err) {
    console.error('❌ [Cron] Expiry check failed:', err.message);
    result.expiryError = err.message;
  }

  // 2. Database backup — fire-and-forget so Vercel doesn't timeout waiting
  runBackup()
    .then(() => console.log('✅ [Cron] Backup completed'))
    .catch(err => console.error('❌ [Cron] Backup failed:', err.message));

  result.backupTriggered = true;

  res.json({ success: true, ...result });
});

module.exports = router;
