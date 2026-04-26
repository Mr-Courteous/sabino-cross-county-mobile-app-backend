const pool = require('../database/db');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function sendRenewalWarnings() {
  try {
    console.log('🔍 [Cron] Checking for subscriptions expiring in 7 days...');

    // Problem Review Fix: Range-based query with "already sent" tracking
    const query = `
      SELECT id, name, email, subscription_expiry 
      FROM schools 
      WHERE payment_status = 'completed' 
        AND subscription_expiry::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')::date
        AND (renewal_warning_sent_at IS NULL 
             OR renewal_warning_sent_at < subscription_expiry - INTERVAL '7 days')
    `;

    const result = await pool.query(query);
    const schools = result.rows;

    if (schools.length === 0) {
      console.log('✅ [Cron] No schools found with 7-day warning window.');
      return;
    }

    console.log(`📢 [Cron] Found ${schools.length} schools to notify.`);

    for (const school of schools) {
      try {
        if (!school.email) continue;

        await transporter.sendMail({
          from: `"Sabino Academy" <${process.env.EMAIL_USER}>`,
          to: school.email,
          subject: 'Action Required: Your Subscription Ends in 7 Days',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #2563EB;">Renewal Reminder</h2>
              <p>Hello <strong>${school.name}</strong>,</p>
              <p>This is a friendly reminder that your premium access to Sabino Academy will end on <strong>${new Date(school.subscription_expiry).toLocaleDateString()}</strong> (in 7 days).</p>
              <div style="background: #F1F5F9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0;">To ensure uninterrupted access for your teachers and students, please renew your subscription today via the mobile app dashboard.</p>
              </div>
              <p>If you have any questions, our support team is here to help.</p>
              <p>Best regards,<br/>Sabino Academy Team</p>
            </div>
          `
        });

        // Mark as sent
        await pool.query(
          'UPDATE schools SET renewal_warning_sent_at = CURRENT_TIMESTAMP WHERE id = $1',
          [school.id]
        );

        console.log(`📧 [Cron] Renewal warning sent to ${school.email}`);
      } catch (err) {
        console.error(`❌ [Cron] Failed to notify ${school.email}:`, err.message);
      }
    }

  } catch (error) {
    console.error('❌ [Cron] Error in renewal warnings:', error);
  } finally {
    process.exit(0);
  }
}

sendRenewalWarnings();
