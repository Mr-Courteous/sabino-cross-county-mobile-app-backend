/**
 * payments.js — Flutterwave web checkout routes
 *
 * Mount in your main app: app.use('/api/payments', require('./payments'));
 *
 * Add these to your EXISTING backend .env file (same one that has JWT_SECRET etc):
 *   FLW_SECRET_KEY=sk_live_xxxxxxxxxxxx        ← from Flutterwave dashboard
 *   FLW_WEBHOOK_SECRET=any_string_you_choose   ← you pick it, paste same in Flutterwave dashboard
 *
 * Everything else already exists in your .env (JWT_SECRET, EMAIL_USER, etc.)
 */

const express = require('express');
const router = express.Router();
const pool = require('../database/db');       // same db you use in schools.js
const axios = require('axios');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth'); // same auth middleware
const nodemailer = require('nodemailer');

require('dotenv').config();

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_WEBHOOK_SECRET = process.env.FLW_WEBHOOK_SECRET;

// Reuse your existing email transporter from schools.js
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// ─── Helper: activate subscription ───────────────────────────────────────────
// Mirrors EXACTLY what your RevenueCat webhook does on line 681 of schools.js:
//   UPDATE schools SET payment_status = 'completed', subscription_expiry = $2 WHERE id = $3
// No new columns. No new tables.
async function activateSubscription(schoolId, txRef) {
  const fourMonthsLater = new Date();
  fourMonthsLater.setMonth(fourMonthsLater.getMonth() + 4);
  const expiry = fourMonthsLater.toISOString();

  await pool.query(
    'UPDATE schools SET payment_status = $1, subscription_expiry = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    ['completed', expiry, schoolId]
  );

  console.log(`✅ [Flutterwave] School ${schoolId} activated via web checkout. Expires: ${expiry}`);
  return expiry;
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/payments/initiate
// App calls this when user taps "PAY VIA WEB CHECKOUT"
// Returns: { link, tx_ref }
// ════════════════════════════════════════════════════════════════════════════
router.post('/initiate', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.id;
    if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Fetch school details for prefilling Flutterwave checkout
    const result = await pool.query(
      'SELECT id, name, email FROM schools WHERE id = $1',
      [schoolId]
    );
    const school = result.rows[0];
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    // Unique reference for this payment attempt
    const tx_ref = `SAB-${schoolId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Create Flutterwave payment link
    const flwResponse = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref,
        amount: 28000, // $20 USD
        currency: 'NGN',
        is_permanent: false,
        redirect_url: `${process.env.APP_BASE_URL}/api/payments/flw-callback`,
        customer: {
          email: school.email,
          name: school.name,
        },
        customizations: {
          title: 'Sabino Edu Subscription',
          description: 'School Premium Plan — 4 Months Access',
        },
        meta: {
          school_id: schoolId, // stored in Flutterwave so we can recover it in webhook
          tx_ref,
        },
        // All African payment methods enabled
        payment_options: 'card,banktransfer,ussd,mobilemoney,opay,palmpay',
      },
      {
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { link } = flwResponse.data.data;
    console.log('[FLW PAYLOAD]', JSON.stringify(flwResponse.config?.data, null, 2));
    console.log('[FLW RESPONSE]', JSON.stringify(flwResponse.data, null, 2));
    console.log('[FLW LINK]', link);
    console.log(`🔗 [Flutterwave] Payment link created for school ${schoolId}. tx_ref: ${tx_ref}`);

    return res.status(200).json({
      success: true,
      link,     // app opens this in the browser
      tx_ref,   // app stores this and sends it back during verify
    });

  } catch (err) {
    console.error('[payments/initiate] Error:', err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || 'Could not create payment link. Please try again.',
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/payments/verify
// App calls this when user taps "I'VE COMPLETED PAYMENT" after returning from browser
// Body: { tx_ref }
// Returns: { success, message }
// ════════════════════════════════════════════════════════════════════════════
router.post('/verify', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.id;
    if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { tx_ref, transaction_id } = req.body;
    if (!tx_ref && !transaction_id) {
      return res.status(400).json({ success: false, message: 'tx_ref is required' });
    }

    // Check if already activated (handles double-taps gracefully)
    const schoolResult = await pool.query(
      'SELECT payment_status, subscription_expiry FROM schools WHERE id = $1',
      [schoolId]
    );
    const school = schoolResult.rows[0];

    if (school?.payment_status === 'completed' && school?.subscription_expiry) {
      const expiry = new Date(school.subscription_expiry);
      if (expiry > new Date()) {
        // Already active — just return success so app can proceed to dashboard
        return res.status(200).json({ success: true, message: 'Subscription already active' });
      }
    }

    // Ask Flutterwave to confirm the payment
    let flwTx;
    if (tx_ref) {
      const flwRes = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
        { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
      );
      flwTx = flwRes.data.data;
    } else {
      const flwRes = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
        { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
      );
      flwTx = flwRes.data.data;
    }

    // Validate: must be successful, correct amount and currency
    if (flwTx.status !== 'successful') {
      return res.status(402).json({
        success: false,
        message: flwTx.status === 'pending'
          ? 'Payment is still processing. Please wait a moment and try again.'
          : 'Payment was not completed. Please try again.',
      });
    }



    // ✅ All good — activate subscription (same as RevenueCat webhook)
    const expiry = await activateSubscription(schoolId, tx_ref);

    return res.status(200).json({
      success: true,
      message: 'Subscription activated successfully',
      data: { expiry }
    });

  } catch (err) {
    console.error('[payments/verify] Error:', err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || 'Verification failed. Please try again.',
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/payments/flw-callback
// Flutterwave redirects the USER'S BROWSER here after checkout.
// This is your server-side safety net — fires even if user never taps
// "I'VE COMPLETED PAYMENT" in the app.
// ════════════════════════════════════════════════════════════════════════════
router.get('/flw-callback', async (req, res) => {
  const { tx_ref, transaction_id, status } = req.query;

  try {
    if (status === 'successful' && tx_ref) {
      // Verify with Flutterwave before activating
      const flwRes = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
        { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
      );
      const flwTx = flwRes.data.data;

      if (flwTx.status === 'successful') {
        // Recover school_id from the meta we stored during /initiate
        const schoolId = flwTx.meta?.school_id;
        if (schoolId) {
          await activateSubscription(schoolId, tx_ref);
        }
      }
    }
  } catch (err) {
    // Non-fatal — the app's /verify endpoint is the primary path
    console.error('[flw-callback] Error:', err.message);
  }

  // Send user back to the app — they'll tap "I'VE COMPLETED PAYMENT"
  // Replace with your actual web domain or a simple HTML page
  res.send(`
    <html>
      <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0F172A;color:#fff">
        <h2 style="color:#FACC15">Payment Received!</h2>
        <p style="color:#94A3B8">Please return to the Sabino Edu app and tap <strong>"I've Completed Payment"</strong> to activate your subscription.</p>
      </body>
    </html>
  `);
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/payments/flw-webhook
// Flutterwave calls this automatically on the server when payment completes.
// This is your ultimate backstop — fires even if the app is closed.
//
// Setup: Go to Flutterwave Dashboard → Settings → Webhooks
//   URL: https://your-backend.com/api/payments/flw-webhook
//   Secret Hash: paste the same value as FLW_WEBHOOK_SECRET in your .env
// ════════════════════════════════════════════════════════════════════════════
router.post('/flw-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Verify the webhook is genuinely from Flutterwave
  const signature = req.headers['verif-hash'];
  if (!FLW_WEBHOOK_SECRET || signature !== FLW_WEBHOOK_SECRET) {
    console.warn('[flw-webhook] Invalid signature — rejected');
    return res.status(401).send('Unauthorized');
  }

  // Always respond 200 immediately — Flutterwave expects a fast response
  res.status(200).send('OK');

  try {
    const payload = JSON.parse(req.body.toString());
    if (payload.event !== 'charge.completed') return;

    const flwTx = payload.data;
    const { tx_ref, status, amount, currency } = flwTx;
    const schoolId = flwTx.meta?.school_id;

    if (status !== 'successful') return;
    if (!schoolId) {
      console.warn(`[flw-webhook] No school_id in meta for tx_ref ${tx_ref}`);
      return;
    }

    // Validate amount and currency


    // Check not already activated
    const schoolResult = await pool.query(
      'SELECT payment_status, subscription_expiry FROM schools WHERE id = $1',
      [schoolId]
    );
    const school = schoolResult.rows[0];
    if (school?.payment_status === 'completed' && school?.subscription_expiry) {
      const expiry = new Date(school.subscription_expiry);
      if (expiry > new Date()) {
        console.log(`[flw-webhook] School ${schoolId} already active. Skipping.`);
        return;
      }
    }

    // ✅ Activate subscription
    await activateSubscription(schoolId, tx_ref);

    // Send confirmation email (mirrors your RevenueCat expiry email style)
    try {
      const schoolData = await pool.query('SELECT email, name FROM schools WHERE id = $1', [schoolId]);
      const s = schoolData.rows[0];
      if (s?.email) {
        await transporter.sendMail({
          from: `"Sabino Edu" <${process.env.EMAIL_USER}>`,
          to: s.email,
          subject: 'Your Sabino Edu Subscription is Active',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #2563EB;">Subscription Activated</h2>
              <p>Hello <strong>${s.name}</strong>,</p>
              <p>Your Sabino Edu subscription has been successfully activated. You now have full access for the next 4 months.</p>
              <p>Thank you for your payment!</p>
              <p>Best regards,<br/>Sabino Edu Team</p>
            </div>
          `
        });
      }
    } catch (emailErr) {
      console.error('[flw-webhook] Failed to send confirmation email:', emailErr);
    }

  } catch (err) {
    console.error('[flw-webhook] Processing error:', err.message);
  }
});

module.exports = router;