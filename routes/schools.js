const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const { validatePassword } = require('../utils/password-validator');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

require('dotenv').config();

// ---------------------------------------------------------------------------
// Rate Limiters (Audit Recommendation #5)
// ---------------------------------------------------------------------------
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 OTP requests per window
  message: {
    success: false,
    error: 'Too many OTP requests. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login attempts per window
  message: {
    success: false,
    error: 'Too many login attempts. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// Subscription gating middleware
// Apply this AFTER authMiddleware.authenticateToken on any route that requires
// an active subscription (e.g. student lists, results, reports).
//
// Usage:
//   router.get('/students', authMiddleware.authenticateToken, checkSubscription, handler)
// ---------------------------------------------------------------------------
const checkSubscription = async (req, res, next) => {
  try {
    const schoolId = req.user?.id;
    if (!schoolId) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const result = await pool.query(
      'SELECT payment_status, subscription_expiry FROM schools WHERE id = $1',
      [schoolId]
    );

    const school = result.rows[0];

    // If no school found, fail early
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found.' });
    }

    const { payment_status, subscription_expiry } = school;
    const now = new Date();

    // 1. Check if status is a paid status
    const paidStatuses = ['completed', 'grace_period'];
    if (!paidStatuses.includes(payment_status)) {
      return res.status(402).json({
        success: false,
        error: 'Subscription required.',
        message: 'Your school does not have an active subscription. Please subscribe via the Sabino app to access this feature.'
      });
    }

    // 2. Problem 4 Fix: Null expiry = data problem = block access
    if (!subscription_expiry) {
      console.warn(`🚨 [checkSubscription] Missing expiry for school ${schoolId} even though status is ${payment_status}`);
      return res.status(402).json({
        success: false,
        error: 'Subscription data incomplete.',
        message: 'Your subscription record is missing an expiry date. Please open the app and tap "Restore Purchases" to sync your account.'
      });
    }

    // 3. Check Expiry
    const expiryDate = new Date(subscription_expiry);
    if (expiryDate < now) {
      // Auto-fix status if EXPIRATION webhook was delayed
      await pool.query(
        "UPDATE schools SET payment_status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND payment_status != 'expired'",
        [schoolId]
      );
      return res.status(402).json({
        success: false,
        error: 'Subscription expired.',
        message: 'Your subscription has expired. Please renew via the Sabino app to continue accessing premium features.'
      });
    }

    // 4. All good — attach info for potential frontend use
    req.subscription = {
      status: payment_status,
      expiresAt: expiryDate.toISOString(),
      daysRemaining: Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000)
    };

    return next();

  } catch (error) {
    console.error('[checkSubscription] Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to verify subscription status.' });
  }
};

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});
// Check account status WITHOUT sending OTP
router.get('/check-status/:email', async (req, res) => {
  try {
    const { email: rawEmail } = req.params;
    if (!rawEmail || rawEmail === 'undefined') return res.status(400).json({ error: "Email is required" });
    const email = rawEmail.toLowerCase();

    const result = await pool.query(
      'SELECT id, name, payment_status FROM schools WHERE email = $1',
      [email]
    );

    if (result.rows.length > 0) {
      const school = result.rows[0];
      return res.status(200).json({
        success: true,
        alreadyRegistered: true,
        resumePayment: school.payment_status === 'pending',
        data: {
          schoolId: school.id,
          name: school.name,
          paymentStatus: school.payment_status,
        }
      });
    }

    return res.status(200).json({
      success: true,
      alreadyRegistered: false
    });

  } catch (error) {
    console.error("Check Status Error:", error);
    res.status(500).json({ error: "Failed to check account status" });
  }
});


// Send OTP
router.post('/otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    const normalizedEmail = email.trim().toLowerCase();
    
    // Check if school with this email already exists
    const existingSchool = await pool.query(
      'SELECT id, name, payment_status FROM schools WHERE email = $1',
      [normalizedEmail]
    );

    if (existingSchool.rows.length > 0) {
      const school = existingSchool.rows[0];
      return res.status(200).json({
        success: true,
        alreadyRegistered: true,
        resumePayment: school.payment_status === 'pending',
        message: school.payment_status === 'completed'
          ? 'This email is already registered. Please login instead.'
          : 'This email is already registered but payment is still pending. You can resume payment.',
        data: {
          schoolId: school.id,
          name: school.name,
          paymentStatus: school.payment_status,
        }
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await pool.query(
      `INSERT INTO email_verifications (email, otp_code, expires_at) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO UPDATE 
       SET otp_code = $2, expires_at = $3, is_verified = false`,
      [email, otpHash, expiresAt]
    );

    const mailOptions = {
      from: `"Sabino Edu" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your School Email",
      html: `
        <div style="font-family: sans-serif; text-align: center; border: 1px solid #ddd; padding: 20px;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Use the code below to complete your school registration:</p>
          <h1 style="color: #4A90E2; letter-spacing: 5px; font-size: 32px;">${otp}</h1>
          <p style="color: #888;">This code expires in 10 minutes.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      alreadyRegistered: false,
      message: "Verification code sent successfully"
    });

  } catch (error) {
    console.error("Email/DB Error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }

});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    
    const verifyRes = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND expires_at > NOW()',
      [normalizedEmail]
    );

    if (verifyRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code"
      });
    }

    const isMatch = await bcrypt.compare(otp, verifyRes.rows[0].otp_code);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code"
      });
    }

    await pool.query(
      'UPDATE email_verifications SET is_verified = true WHERE email = $1',
      [normalizedEmail]
    );

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully."
    });

  } catch (error) {
    console.error("OTP Verification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify OTP. Please try again later."
    });
  }
});

// Forgot Password - Send OTP
router.post('/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const normalizedEmail = email.trim().toLowerCase();
    // Check if school with this email exists
    const existingSchool = await pool.query(
      'SELECT id, name FROM schools WHERE email = $1',
      [normalizedEmail]
    );

    if (existingSchool.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No school account found with this email address.",
        message: "Account not found"
      });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await pool.query(
      `INSERT INTO email_verifications (email, otp_code, expires_at) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO UPDATE 
       SET otp_code = $2, expires_at = $3, is_verified = false`,
      [email, otpHash, expiresAt]
    );

    const mailOptions = {
      from: `"Sabino Edu" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "School Account Password Reset",
      html: `
        <div style="font-family: sans-serif; text-align: center; border: 1px solid #ddd; padding: 20px;">
          <h2 style="color: #333;">Password Reset</h2>
          <p>Use the code below to reset your school administrator password:</p>
          <h1 style="color: #4A90E2; letter-spacing: 5px; font-size: 32px;">${otp}</h1>
          <p style="color: #888;">This code expires in 10 minutes. If you didn't request this, please ignore this email.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Reset code sent successfully"
    });

  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and new password are required"
      });
    }

    // Verify email is verified in email_verifications table
    const verificationCheck = await client.query(
      'SELECT is_verified FROM email_verifications WHERE email = $1 AND is_verified = true',
      [email]
    );

    if (verificationCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Email must be verified first. Please complete OTP verification.'
      });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: passwordValidation.error
      });
    }

    await client.query('BEGIN');

    // Hash password
    const normalizedEmail = email.trim().toLowerCase();
    
    // Update school password
    const updateResult = await client.query(
      'UPDATE schools SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING id',
      [hashedPassword, normalizedEmail]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'School not found'
      });
    }

    // Clean up verification record
    await client.query('DELETE FROM email_verifications WHERE email = $1', [email]);

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now login with your new password.'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reset Password Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Create school (or resume pending registration)
router.post('/', async (req, res) => {
  try {
    const { name, email, password, school_type, country_id, country, phone } = req.body;

    if (!name || !email || !password || !school_type) {
      return res.status(400).json({ success: false, message: 'All required fields must be filled' });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.error
      });
    }

    const emailVerified = await pool.query(
      'SELECT is_verified FROM email_verifications WHERE email = $1 AND is_verified = true',
      [email]
    );

    if (emailVerified.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Email must be verified first. Please complete OTP verification.'
      });
    }

    // Check for existing school record by email
    const existingSchoolRes = await pool.query(
      'SELECT id, name, email, phone, school_type, country_id, country, payment_status FROM schools WHERE email = $1',
      [email]
    );

    if (existingSchoolRes.rows.length > 0) {
      const existingSchool = existingSchoolRes.rows[0];

      if (existingSchool.payment_status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'This email is already registered and active.'
        });
      }

      // Pending payment - return user data and a fresh JWT allowing them to resume payment
      const resumeToken = jwt.sign(
        {
          id: existingSchool.id,
          schoolId: existingSchool.id,
          type: 'school',
          email: existingSchool.email,
          name: existingSchool.name,
          countryId: existingSchool.country_id
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      return res.status(200).json({
        success: true,
        resumePayment: true,
        data: {
          token: resumeToken,
          user: {
            schoolId: existingSchool.id,
            email: existingSchool.email,
            name: existingSchool.name,
            type: 'school',
            countryId: existingSchool.country_id,
            country: existingSchool.country,
            phone: existingSchool.phone,
            paymentStatus: existingSchool.payment_status
          }
        }
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // New registration path
    const hashedPassword = await bcrypt.hash(password, 10);
    const registrationCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const result = await pool.query(
      `INSERT INTO schools (
        registration_code, name, email, password, school_type,
        country_id, country, phone, payment_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, email, country_id`,
      [
        registrationCode,
        name,
        normalizedEmail,
        hashedPassword,
        school_type,
        country_id || null,
        country || null,
        phone || null,
        'pending'
      ]
    );

    const school = result.rows[0];

    // Auto-create default academic session for immediate use
    const currentYear = new Date().getFullYear();
    const defaultSessionName = `${currentYear}/${currentYear + 1}`;

    try {
      await pool.query(
        `INSERT INTO academic_sessions (school_id, session_name, is_active)
         VALUES ($1, $2, $3)
         ON CONFLICT (school_id, session_name) DO UPDATE
         SET is_active = $3`,
        [school.id, defaultSessionName, true]
      );
      console.log(`✓ Default academic session created for school: ${defaultSessionName}`);
    } catch (sessionError) {
      console.error('Warning: Failed to create default academic session:', sessionError);
      // Don't fail registration if session creation fails
    }

    // If country_id was not provided, attempt to resolve it using the country name
    let resolvedCountryId = country_id;
    if (!resolvedCountryId && country) {
      try {
        const countryRow = await pool.query(
          'SELECT id FROM countries WHERE name = $1 LIMIT 1',
          [country]
        );
        if (countryRow.rows.length > 0) {
          resolvedCountryId = countryRow.rows[0].id;
        }
      } catch (countryLookupError) {
        console.warn('Warning: Failed to lookup country:', countryLookupError);
      }
    }

    // Create default preference row for the school (if table exists)
    try {
      await pool.query('INSERT INTO school_preferences (school_id) VALUES ($1)', [school.id]);
    } catch (prefError) {
      console.warn('Warning: Failed to create default school preferences:', prefError);
    }

    const token = jwt.sign(
      {
        id: school.id,
        schoolId: school.id,
        type: 'school',
        email: school.email,
        name,
        countryId: resolvedCountryId
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          schoolId: school.id,
          email: school.email,
          name,
          type: 'school',
          countryId: resolvedCountryId,
          paymentStatus: 'pending'
        }
      }
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again later.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/schools/revenuecat-webhook
// RevenueCat sends this request server-to-server on every subscription event.
// Security: RevenueCat sends Authorization as "Bearer <token>" — must strip the prefix before comparing.
// Configure REVENUECAT_WEBHOOK_AUTH_TOKEN in .env and the same value in RevenueCat Dashboard → Webhooks.
router.post('/revenuecat-webhook', async (req, res) => {
  try {
    // 1. Security Check: Extract token from "Bearer <token>" format
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (!token || token !== process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN) {
      console.log("❌ Unauthorized webhook attempt. Header:", authHeader);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { event } = req.body;


    if (!event) {
      console.warn('[RC Webhook] No event object in payload');
      return res.status(200).send('Webhook received');
    }

    const { type, app_user_id, expiration_at_ms, id: event_id } = event;

    if (!app_user_id) {
      console.warn('[RC Webhook] No app_user_id in payload. Event type:', type);
      return res.status(200).send('Webhook received');
    }

    // 1.5 Idempotency Check (Problem 2 Fix: Use event_id column, not SERIAL id)
    const existingEvent = await pool.query('SELECT id FROM webhook_events WHERE event_id = $1', [event_id]);
    if (existingEvent.rows.length > 0) {
      console.log(`[RC Webhook] Event ${event_id} already processed. Skipping.`);
      return res.status(200).send('Webhook received');
    }

    // 1.8 School Existence Check (Problem 3 Fix)
    const schoolCheck = await pool.query(
      'SELECT id, name, email FROM schools WHERE id = $1',
      [app_user_id]
    );

    if (schoolCheck.rows.length === 0) {
      console.error(`❌ [RC Webhook] CRITICAL: School ID "${app_user_id}" not found in DB.`);
      console.error(`This likely means the Android app is NOT calling Purchases.logIn(schoolId) before purchase.`);
      // Still return 200 to stop retries, but log it clearly
      return res.status(200).send('School not found');
    }

    const school = schoolCheck.rows[0];

    console.log(`[RC Webhook] Event: ${type} for School ID: ${app_user_id} (ID: ${event_id})`);

    // 2. Handle relevant events
    if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL' || type === 'NON_RENEWING_PURCHASE') {
      // Problem 2 Fix: Never trust null expiry for non-renewing purchases. 
      // Default to 4 months if expiration_at_ms is missing.
      let exactExpiry;
      if (expiration_at_ms) {
        exactExpiry = new Date(expiration_at_ms).toISOString();
      } else {
        const fourMonthsLater = new Date();
        fourMonthsLater.setMonth(fourMonthsLater.getMonth() + 4);
        exactExpiry = fourMonthsLater.toISOString();
        console.log(`🕒 [RC Webhook] No expiry in payload. Defaulting to 4 months: ${exactExpiry}`);
      }

      await pool.query(
        'UPDATE schools SET payment_status = $1, subscription_expiry = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['completed', exactExpiry, app_user_id]
      );

      console.log(`✅ [RC Webhook] ${type}: School ${app_user_id} activated until ${exactExpiry}`);
    }
    else if (type === 'EXPIRATION') {
      // Move to 'expired' status
      await pool.query(
        'UPDATE schools SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['expired', app_user_id]
      );

      // Notify school about expiration
      try {
        if (school.email) {
          await transporter.sendMail({
            from: `"Sabino Edu" <${process.env.EMAIL_USER}>`,
            to: school.email,
            subject: 'Your Sabino Edu Subscription has Expired',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #2563EB;">Access Suspended</h2>
                <p>Hello <strong>${school.name}</strong>,</p>
                <p>Your premium subscription to Sabino Edu has expired. Your portal access and results generation have been temporarily suspended.</p>
                <div style="background: #F1F5F9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Action Required:</strong> Log in to your dashboard to renew your access and continue managing your students.</p>
                </div>
                <p>If you have already renewed, please ignore this message or tap "Restore Purchases" in the app.</p>
                <p>Best regards,<br/>Sabino Edu Team</p>
              </div>
            `
          });
          console.log(`📧 [RC Webhook] Expiration email sent to ${school.email}`);
        }
      } catch (emailErr) {
        console.error('❌ [RC Webhook] Failed to send expiration email:', emailErr);
      }

      console.log(`⚠️ [RC Webhook] EXPIRATION: School ID ${app_user_id} moved to expired status`);
    }
    else if (type === 'GRACE_PERIOD_STARTED') {
      // Allow access during grace period
      await pool.query(
        'UPDATE schools SET payment_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['grace_period', app_user_id]
      );
      console.log(`🕒 [RC Webhook] GRACE_PERIOD: School ID ${app_user_id} entered grace period`);
    }
    else if (type === 'CANCELLATION' || type === 'BILLING_ISSUE') {
      console.log(`ℹ️ [RC Webhook] ${type}: Event received for School ID ${app_user_id}`);
    }
    else {
      console.log(`[RC Webhook] Unhandled event type "${type}". Ignoring.`);
    }

    // 2.5 Record processed event for idempotency (Problem 2 Fix: Use event_id column)
    await pool.query(
      'INSERT INTO webhook_events (event_id, type, app_user_id, payload) VALUES ($1, $2, $3, $4)',
      [event_id, type, app_user_id, JSON.stringify(req.body)]
    );

    // 3. Always respond with 200 OK
    res.status(200).send('Webhook received');

  } catch (error) {
    console.error('❌ [RC Webhook] Error:', error);
    // Still return 200 so RevenueCat doesn't retry indefinitely
    res.status(200).send('Webhook received');
  }
});

/**
 * @route   POST /api/schools/sync-subscription
 * @desc    Manual sync with RevenueCat API to ensure local DB matches RC status
 * @access  Private (School Admin)
 */
router.post('/sync-subscription', authMiddleware.authenticateToken, authMiddleware.requireSchool, async (req, res) => {
  try {
    const schoolId = req.user.id;
    const RC_API_KEY = process.env.REVENUECAT_REST_API_KEY;

    if (!RC_API_KEY) {
      console.warn('⚠️ REVENUECAT_REST_API_KEY not configured. Skipping manual sync.');
      return res.status(503).json({ success: false, message: 'Sync service unavailable' });
    }

    console.log(`🔄 [RC Sync] Fetching status for School ID: ${schoolId}`);

    const response = await axios.get(
      `https://api.revenuecat.com/v1/subscribers/${schoolId}`,
      {
        headers: {
          'Authorization': `Bearer ${RC_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const subscriber = response.data.subscriber;
    const entitlements = subscriber?.entitlements || {};

    // Problem 5 Fix: Use actual entitlement ID from env or fallback
    const entitlementId = process.env.REVENUECAT_ENTITLEMENT_ID || 'premium';
    const entitlement = entitlements[entitlementId] || Object.values(entitlements)[0];

    if (entitlement) {
      const expiry = entitlement.expires_date;
      const isActive = new Date(expiry) > new Date();

      await pool.query(
        'UPDATE schools SET payment_status = $1, subscription_expiry = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [isActive ? 'completed' : 'expired', expiry, schoolId]
      );

      return res.json({
        success: true,
        message: 'Subscription status synced successfully',
        data: { isActive, expiry }
      });
    }

    return res.json({
      success: true,
      message: 'No active entitlements found',
      data: { isActive: false }
    });

  } catch (error) {
    console.error('❌ [RC Sync] Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to sync with RevenueCat' });
  }
});

// End of Subscription Routes


// Get user schools (requires auth)
router.get('/', authMiddleware.authenticateToken, authMiddleware.requireSchool, async (req, res) => {
  try {
    // STRICT SECURITY: Extract userId ONLY from token, never from req.body or req.query
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    const result = await pool.query(
      'SELECT * FROM schools WHERE owner_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({
      schools: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current school details using token
router.get('/me', authMiddleware.authenticateToken, checkSubscription, authMiddleware.requireSchool, async (req, res) => {
  try {
    // STRICT SECURITY: Extract schoolId ONLY from token, never from req.body or req.query
    // The authenticateToken middleware attaches the decoded token to req.user
    // In your generateToken function, you stored schoolId as 'id'
    const schoolId = req.user?.id;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    const result = await pool.query(
      `SELECT 
        s.id, 
        s.registration_code, 
        s.name, 
        s.address,
        s.city,
        s.state,
        s.country, 
        s.phone, 
        s.email, 
        s.school_type, 
        COALESCE(pref.logo_url, s.logo) AS logo,
        COALESCE(pref.stamp_url, s.stamp) AS stamp,
        s.created_at
      FROM schools s
      LEFT JOIN school_preferences pref ON pref.school_id = s.id
      WHERE s.id = $1`,
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'School record not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Fetch school profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving profile'
    });
  }
});

// Update current school details using token
router.put('/me', authMiddleware.authenticateToken, authMiddleware.requireSchool, async (req, res) => {
  try {
    const schoolId = req.user?.id;
    if (!schoolId) {
      return res.status(401).json({ success: false, error: 'Authentication missing' });
    }

    const { name, address, city, state, phone, email, registration_code } = req.body;

    const result = await pool.query(
      `UPDATE schools SET 
       name = COALESCE($1, name), 
       address = COALESCE($2, address), 
       city = COALESCE($3, city), 
       state = COALESCE($4, state), 
       phone = COALESCE($5, phone), 
       email = COALESCE($6, email), 
       registration_code = COALESCE($7, registration_code), 
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $8 
       RETURNING *`,
      [name, address, city, state, phone, email, registration_code, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }

    res.json({
      success: true,
      message: 'School profile updated successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update school profile error:', error);
    res.status(500).json({ success: false, error: 'Server error updating profile' });
  }
});

// Update school (requires auth)
router.put('/:schoolId', authMiddleware.authenticateToken, authMiddleware.requireSchool, authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { name, address, city, state, country, phone, email, registration_code } = req.body;

    const result = await pool.query(
      `UPDATE schools SET 
       name = COALESCE($1, name), 
       address = COALESCE($2, address), 
       city = COALESCE($3, city), 
       state = COALESCE($4, state), 
       country = COALESCE($5, country), 
       phone = COALESCE($6, phone), 
       email = COALESCE($7, email), 
       registration_code = COALESCE($8, registration_code), 
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $9 
       RETURNING *`,
      [name, address, city, state, country, phone, email, registration_code, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json({
      message: 'School updated successfully',
      school: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete school (requires auth)
router.delete('/:schoolId', authMiddleware.authenticateToken, authMiddleware.requireSchool, authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    const { schoolId } = req.params;

    const result = await pool.query(
      'DELETE FROM schools WHERE id = $1 RETURNING id',
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json({ message: 'School deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
