// notifications-cron.js
// Run with: node notifications-cron.js
// Or add to your server startup, or deploy as a separate service

require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const pool = require('./database/db');

const CURRENT_APP_VERSION = '2.0.0'; // Update this when you release a new version
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ─── Message banks ─────────────────────────────────────────────────────────

const MARKETING_MESSAGES = [
  { title: 'Still using paper report cards? 📄', body: 'Why stay with stressful paper when Sabino Edu reduces the stress? Try it today.' },
  { title: 'Smart schools go digital 💡', body: 'More than one teacher can upload results at the same time on Sabino Edu.' },
  { title: 'Only $20 per term', body: 'That\'s 4 months of smarter result management. Students and parents check results anywhere.' },
  { title: 'Still calculating manually? ✏️', body: 'Why not go digital with Sabino Edu and reduce errors in your result management.' },
  { title: 'Give parents the "Wow" factor ✨', body: 'Most parents prefer checking results on their phones. Why not activate Sabino Edu today?' },
  { title: 'Reduce paperwork. Save time.', body: 'Fast result access for schools, teachers, students, and whoever you grant access.' },
  { title: 'Don\'t be left behind 🏫', body: 'Many schools are already moving digital. Sabino Edu makes the transition easy.' },
  { title: 'Stop losing money to paper 🖨️', body: 'Switch digital today for just $20 termly on Sabino Edu.' },
  { title: 'Your school deserves better 🏆', body: 'One platform. Easier uploads. Better result management. Why not subscribe now?' },
  { title: 'Parents coming in just for results? 🚗', body: 'Let them check from anywhere with Sabino Edu. Subscribe today.' },
  { title: 'Run a 21st-century school? 🌐', body: 'Prove your standard to parents by embracing educational technology with Sabino Edu.' },
  { title: 'Reduce 80% of result stress ✅', body: 'Sabino Edu handles result uploads faster and reduces administrative stress.' },
  { title: 'Digital report cards are smarter 📱', body: 'Faster than paper. Less errors. Better organization. Try Sabino Edu now.' },
  { title: 'Make your school look advanced 🎓', body: 'Uploading results digitally reduces unnecessary delays. Subscribe to Sabino Edu.' },
];

const RETENTION_MESSAGES = [
  { title: 'You\'re ahead of the pack! 🚀', body: 'Keep using Sabino Edu and stay ahead in result management this term.' },
  { title: 'Results are faster with you 💪', body: 'Your school is already saving time on result uploads. Keep it up!' },
  { title: 'Parents appreciate the access 👏', body: 'Students and parents can check results anywhere because of your smart choice.' },
  { title: 'Less stress, more efficiency ✅', body: 'Sabino Edu is working for your school. Renew early and keep the momentum.' },
  { title: 'Your subscription is active 🟢', body: 'You\'re getting the full benefit of digital result management this term.' },
  { title: 'Advance your school brand 🛡️', body: 'Result delays are a thing of the past for your school. Stay subscribed.' },
  { title: 'Smart schools stay smart 💡', body: 'Don\'t let next term catch you off guard. Plan your renewal early.' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function sendPushNotifications(messages) {
  // Expo recommends batches of max 100
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      await axios.post(EXPO_PUSH_URL, batch, {
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
      });
      console.log(`✅ Sent batch of ${batch.length} notifications`);
    } catch (err) {
      console.error('❌ Push send error:', err.message);
    }
  }
}

// ─── Marketing notifications (unsubscribed schools) ─────────────────────────

async function sendMarketingNotifications() {
  console.log('📣 Running marketing notifications...');
  try {
    // Schools with no subscription OR expired subscription
    const result = await pool.query(`
      SELECT dt.expo_token
      FROM device_tokens dt
      LEFT JOIN school_subscriptions ss ON ss.school_id = dt.school_id
      WHERE ss.school_id IS NULL
         OR ss.status != 'active'
         OR ss.end_date < NOW()
    `);

    if (result.rows.length === 0) return console.log('ℹ️ No unsubscribed schools to notify');

    const msg = pickRandom(MARKETING_MESSAGES);
    const messages = result.rows.map(row => ({
      to: row.expo_token,
      sound: 'default',
      title: msg.title,
      body: msg.body,
      data: { type: 'marketing' },
    }));

    await sendPushNotifications(messages);
    console.log(`📣 Sent marketing push to ${messages.length} schools`);
  } catch (err) {
    console.error('❌ Marketing notifications error:', err.message);
  }
}

// ─── Retention notifications (subscribed schools) ───────────────────────────

async function sendRetentionNotifications() {
  console.log('💚 Running retention notifications...');
  try {
    const result = await pool.query(`
      SELECT dt.expo_token, ss.end_date
      FROM device_tokens dt
      INNER JOIN school_subscriptions ss ON ss.school_id = dt.school_id
      WHERE ss.status = 'active' AND ss.end_date >= NOW()
    `);

    if (result.rows.length === 0) return console.log('ℹ️ No active subscribers to notify');

    const msg = pickRandom(RETENTION_MESSAGES);
    const messages = result.rows.map(row => ({
      to: row.expo_token,
      sound: 'default',
      title: msg.title,
      body: msg.body,
      data: { type: 'retention' },
    }));

    await sendPushNotifications(messages);
    console.log(`💚 Sent retention push to ${messages.length} schools`);
  } catch (err) {
    console.error('❌ Retention notifications error:', err.message);
  }
}

// ─── Version update notifications ───────────────────────────────────────────

async function sendVersionUpdateNotifications() {
  console.log('🔄 Running version update check...');
  try {
    // Only notify schools that haven't updated AND haven't been notified in the last 7 days
    const result = await pool.query(`
      SELECT dt.expo_token
      FROM device_tokens dt
      WHERE (dt.app_version IS NULL OR dt.app_version != $1)
        AND (dt.version_notified_at IS NULL OR dt.version_notified_at < NOW() - INTERVAL '7 days')
    `, [CURRENT_APP_VERSION]);

    if (result.rows.length === 0) return console.log('ℹ️ All schools are on the latest version');

    const messages = result.rows.map(row => ({
      to: row.expo_token,
      sound: 'default',
      title: '🆕 New Sabino Edu update available',
      body: 'A newer version of Sabino Edu is on the Play Store. Update now for the latest improvements.',
      data: { type: 'version_update' },
    }));

    await sendPushNotifications(messages);

    // Mark them as notified so they don't get spammed
    await pool.query(`
      UPDATE device_tokens SET version_notified_at = NOW()
      WHERE (app_version IS NULL OR app_version != $1)
    `, [CURRENT_APP_VERSION]);

    console.log(`🔄 Sent version update push to ${messages.length} schools`);
  } catch (err) {
    console.error('❌ Version update notifications error:', err.message);
  }
}

// ─── Schedule ───────────────────────────────────────────────────────────────

// Marketing: every day at 9am
cron.schedule('0 9 * * *', sendMarketingNotifications);

// Retention: every Monday at 9am
cron.schedule('0 9 * * 1', sendRetentionNotifications);

// Version check: every Wednesday at 10am
cron.schedule('0 10 * * 3', sendVersionUpdateNotifications);

console.log('✅ Notification cron jobs started');
