const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const axios = require('axios');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const nodemailer = require('nodemailer');

require('dotenv').config();

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_WEBHOOK_SECRET = process.env.FLW_WEBHOOK_SECRET;

const PLAN_AMOUNT = 29500;
const PLAN_CURRENCY = 'NGN';
const PLAN_MONTHS = 4;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function activateSubscription(schoolId, txRef) {
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + PLAN_MONTHS);
  const expiryISO = expiry.toISOString();

  await pool.query(
    'UPDATE schools SET payment_status = $1, subscription_expiry = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    ['completed', expiryISO, schoolId]
  );

  console.log(`✅ [Flutterwave] School ${schoolId} activated. tx_ref: ${txRef}. Expires: ${expiryISO}`);
  return expiryISO;
}

// ── POST /api/payments/initiate ───────────────────────────────────────────────
router.post('/initiate', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.id;
    if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const result = await pool.query(
      'SELECT id, name, email FROM schools WHERE id = $1',
      [schoolId]
    );
    const school = result.rows[0];
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const tx_ref = `SAB-${schoolId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const flwResponse = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref,
        amount: PLAN_AMOUNT,
        currency: PLAN_CURRENCY,
        is_permanent: false,
        redirect_url: `${process.env.APP_BASE_URL}/api/payments/flw-callback`,
        customer: {
          email: school.email,
          name: school.name,
        },
        customizations: {
          title: 'Sabino Edu — School Billing Portal',
          description: 'Institutional School Plan — 4 Months Access',
          logo: 'https://www.image2url.com/r2/default/images/1780017119712-5f16f9fd-dc3a-4399-be26-74ae371c2e9b.jpeg', // add your logo URL
        },
        meta: {
          school_id: schoolId,
          tx_ref,
        },
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
    console.log(`🔗 [Flutterwave] Payment link created for school ${schoolId}. tx_ref: ${tx_ref}`);

    return res.status(200).json({ success: true, link, tx_ref });

  } catch (err) {
    console.error('[payments/initiate] Error:', err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: err?.response?.data?.message || 'Could not create payment link. Please try again.',
    });
  }
});

// ── POST /api/payments/verify ─────────────────────────────────────────────────
router.post('/verify', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId || req.user?.id;
    if (!schoolId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { tx_ref, transaction_id } = req.body;
    if (!tx_ref && !transaction_id) {
      return res.status(400).json({ success: false, message: 'tx_ref is required' });
    }

    // Check already active
    const schoolResult = await pool.query(
      'SELECT payment_status, subscription_expiry FROM schools WHERE id = $1',
      [schoolId]
    );
    const school = schoolResult.rows[0];
    if (school?.payment_status === 'completed' && school?.subscription_expiry) {
      if (new Date(school.subscription_expiry) > new Date()) {
        return res.status(200).json({ success: true, message: 'Subscription already active' });
      }
    }

    // Verify with Flutterwave
    let flwTx;
    try {
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
    } catch (flwErr) {
      console.error('[payments/verify] Flutterwave API error:', flwErr?.response?.data || flwErr.message);
      return res.status(502).json({
        success: false,
        message: 'Could not reach payment provider. Please try again in a moment.',
      });
    }

    // Status check
    if (flwTx.status !== 'successful') {
      return res.status(402).json({
        success: false,
        message: flwTx.status === 'pending'
          ? 'Payment is still processing. Please wait a moment and try again.'
          : 'Payment was not completed. Please try again.',
      });
    }

    // Amount check — prevent underpayment attacks
    if (flwTx.amount < PLAN_AMOUNT - 1 || flwTx.currency !== PLAN_CURRENCY) {
      console.warn(`[payments/verify] Amount mismatch: ${flwTx.amount} ${flwTx.currency} for school ${schoolId}`);
      return res.status(400).json({
        success: false,
        message: 'Payment amount does not match the subscription price. Please contact support.',
      });
    }

    // Ownership check — prevent one school verifying another's payment
    const metaSchoolId = flwTx.meta?.school_id;
    if (metaSchoolId && String(metaSchoolId) !== String(schoolId)) {
      console.warn(`[payments/verify] School ${schoolId} tried to claim tx_ref of school ${metaSchoolId}`);
      return res.status(403).json({
        success: false,
        message: 'Transaction does not belong to this account.',
      });
    }

    const expiry = await activateSubscription(schoolId, tx_ref);

    return res.status(200).json({
      success: true,
      message: 'Subscription activated successfully',
      data: { expiry },
    });

  } catch (err) {
    console.error('[payments/verify] Error:', err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.',
    });
  }
});

// ── GET /api/payments/flw-callback ───────────────────────────────────────────
router.get('/flw-callback', async (req, res) => {
  const { tx_ref, status } = req.query;

  try {
    if (status === 'successful' && tx_ref) {
      const flwRes = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx_ref}`,
        { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
      );
      const flwTx = flwRes.data.data;

      if (flwTx.status === 'successful') {
        const schoolId = flwTx.meta?.school_id;
        if (schoolId) {
          // Idempotency check before activating
          const existing = await pool.query(
            'SELECT payment_status, subscription_expiry FROM schools WHERE id = $1',
            [schoolId]
          );
          const s = existing.rows[0];
          const alreadyActive = s?.payment_status === 'completed' &&
            s?.subscription_expiry &&
            new Date(s.subscription_expiry) > new Date();

          if (!alreadyActive) {
            await activateSubscription(schoolId, tx_ref);
          }
        }
      }
    }
  } catch (err) {
    console.error('[flw-callback] Error:', err.message);
  }

  // Branded return page
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Sabino Edu — Payment Received</title>
      </head>
      <body style="font-family:sans-serif;text-align:center;padding:60px 20px;background:#0F172A;color:#fff;min-height:100vh">
        <div style="max-width:400px;margin:auto">
          <div style="font-size:48px;margin-bottom:16px">✅</div>
          <h2 style="color:#FACC15;margin-bottom:12px">Payment Received!</h2>
          <p style="color:#94A3B8;line-height:1.6">
            Please return to the <strong style="color:#fff">Sabino Edu app</strong> and tap 
            <strong style="color:#FACC15">"Confirm Institutional Payment"</strong> 
            to activate your school account.
          </p>
          <p style="color:#475569;font-size:12px;margin-top:32px">
            If you have any issues, contact us at support@sabinoEdu.com
          </p>
        </div>
      </body>
    </html>
  `);
});

// ── POST /api/payments/flw-webhook ────────────────────────────────────────────
router.post('/flw-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['verif-hash'];
  if (!FLW_WEBHOOK_SECRET || signature !== FLW_WEBHOOK_SECRET) {
    console.warn('[flw-webhook] Invalid signature — rejected');
    return res.status(401).send('Unauthorized');
  }

  // Respond immediately — Flutterwave needs a fast 200
  res.status(200).send('OK');

  try {
    const payload = JSON.parse(req.body.toString());
    if (payload.event !== 'charge.completed') return;

    const flwTx = payload.data;
    const { tx_ref, status, amount, currency } = flwTx;
    const schoolId = flwTx.meta?.school_id;

    if (status !== 'successful') return;

    // Amount validation
    if (amount < PLAN_AMOUNT - 1 || currency !== PLAN_CURRENCY) {
      console.warn(`[flw-webhook] Amount mismatch: ${amount} ${currency}. tx_ref: ${tx_ref}`);
      return;
    }

    if (!schoolId) {
      console.warn(`[flw-webhook] No school_id in meta for tx_ref: ${tx_ref}`);
      return;
    }

    // Idempotency check
    const schoolResult = await pool.query(
      'SELECT payment_status, subscription_expiry FROM schools WHERE id = $1',
      [schoolId]
    );
    const school = schoolResult.rows[0];
    if (school?.payment_status === 'completed' && school?.subscription_expiry) {
      if (new Date(school.subscription_expiry) > new Date()) {
        console.log(`[flw-webhook] School ${schoolId} already active. Skipping.`);
        return;
      }
    }

    await activateSubscription(schoolId, tx_ref);

    // Confirmation email
    try {
      const schoolData = await pool.query(
        'SELECT email, name FROM schools WHERE id = $1',
        [schoolId]
      );
      const s = schoolData.rows[0];
      if (s?.email) {
        await transporter.sendMail({
          from: `"Sabino Edu" <${process.env.EMAIL_USER}>`,
          to: s.email,
          subject: '✅ Your Sabino Edu School Subscription is Active',
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;border:1px solid #eee;border-radius:12px">
              <h2 style="color:#2563EB">Subscription Activated</h2>
              <p>Hello <strong>${s.name}</strong>,</p>
              <p>Your Sabino Edu institutional subscription has been successfully activated. 
                 You now have full access for the next <strong>4 months</strong>.</p>
              <p style="color:#64748B;font-size:13px">Transaction reference: ${tx_ref}</p>
              <p>Thank you for choosing Sabino Edu!</p>
              <p>Best regards,<br/>The Sabino Edu Team</p>
            </div>
          `,
        });
      }
    } catch (emailErr) {
      console.error('[flw-webhook] Email error:', emailErr.message);
    }

  } catch (err) {
    console.error('[flw-webhook] Processing error:', err.message);
  }
});

module.exports = router;