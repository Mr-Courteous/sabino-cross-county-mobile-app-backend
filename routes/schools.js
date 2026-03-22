const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const authMiddleware = require('../middleware/auth');
const { validatePassword } = require('../utils/password-validator');
require('dotenv').config();

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'inumiduncourteous@gmail.com',
    pass: 'vvcx njbg cwac kuao',
  },
});


// Send OTP
router.post('/otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Check if school with this email already exists
    const existingSchool = await pool.query(
      'SELECT id, name, payment_status FROM schools WHERE email = $1',
      [email]
    );

    if (existingSchool.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This email has already been registered. Please login instead.'
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await pool.query(
      `INSERT INTO email_verifications (email, otp_code, expires_at) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO UPDATE 
       SET otp_code = $2, expires_at = $3, is_verified = false`,
      [email, otp, expiresAt]
    );

    const mailOptions = {
      from: '"Sabino School" Sabinoschool1@gmail.com <',
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

    const verifyRes = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND otp_code = $2 AND expires_at > NOW()',
      [email, otp]
    );

    if (verifyRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code"
      });
    }

    await pool.query(
      'UPDATE email_verifications SET is_verified = true WHERE email = $1',
      [email]
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
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Check if school with this email exists
    const existingSchool = await pool.query(
      'SELECT id, name FROM schools WHERE email = $1',
      [email]
    );

    if (existingSchool.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No school account found with this email address.",
        message: "Account not found"
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await pool.query(
      `INSERT INTO email_verifications (email, otp_code, expires_at) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO UPDATE 
       SET otp_code = $2, expires_at = $3, is_verified = false`,
      [email, otp, expiresAt]
    );

    const mailOptions = {
      from: '"Sabino School" <inumiduncourteous@gmail.com>',
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
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update school password
    const updateResult = await client.query(
      'UPDATE schools SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING id',
      [hashedPassword, email]
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
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '24h' }
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
        email,
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
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
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

// Update payment status after verifying Google Play purchase
router.patch('/:schoolId/payment-status', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { schoolId } = req.params;
    const purchaseToken = req.body.purchaseToken || req.body.purchase_token;
    const paymentStatus = req.body.payment_status || req.body.paymentStatus;
    const subscriptionDetails = req.body.subscriptionDetails || req.body.subscription_details;

    // Ensure authenticated user can only update their own record
    const tokenSchoolId = req.user?.id;
    if (!tokenSchoolId || parseInt(schoolId, 10) !== tokenSchoolId) {
      return res.status(403).json({ success: false, message: 'Forbidden: You can only update your own payment status.' });
    }

    if (!purchaseToken) {
      return res.status(400).json({ success: false, message: 'purchaseToken is required' });
    }

    if (!paymentStatus || paymentStatus !== 'completed') {
      return res.status(400).json({ success: false, message: 'payment_status must be "completed" for verified payment updates.' });
    }

    // Verify purchase with Google Play using service account
    const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
    const subscriptionId = process.env.GOOGLE_PLAY_SUBSCRIPTION_ID || '12345sabino';
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

    if (!packageName || !subscriptionId || !keyFile) {
      console.error('Google Play configuration missing');
      return res.status(500).json({
        success: false,
        message: 'Server not configured for Google Play verification.'
      });
    }

    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    const androidpublisher = google.androidpublisher({ version: 'v3', auth });

    // Verify the purchase token with Google
    const response = await androidpublisher.purchases.subscriptions.get({
      packageName,
      subscriptionId,
      token: purchaseToken,
    });

    const purchaseData = response.data;

    // Check if purchase is valid and active
    if (purchaseData.purchaseState !== 0) {
      return res.status(401).json({
        success: false,
        message: 'Purchase is not valid or has been cancelled.'
      });
    }

    const expiryTimeMillis = parseInt(purchaseData.expiryTimeMillis, 10);
    if (Number.isNaN(expiryTimeMillis) || expiryTimeMillis <= Date.now()) {
      return res.status(401).json({
        success: false,
        message: 'Subscription has expired.'
      });
    }

    // Purchase is verified and active, update database
    const expiryDate = new Date(expiryTimeMillis);

    await pool.query(
      `UPDATE schools SET
        payment_status = $1,
        purchase_token = $2,
        subscription_expiry = $3,
        google_play_order_id = $4,
        subscription_details = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6`,
      [
        'completed',
        purchaseToken,
        expiryDate,
        purchaseData.orderId || null,
        JSON.stringify(purchaseData),
        schoolId
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Payment verified and subscription activated.',
      data: {
        schoolId: parseInt(schoolId, 10),
        subscriptionExpiry: expiryDate,
        paymentStatus: 'completed'
      }
    });
  } catch (error) {
    console.error('Payment verification error:', error);

    // Handle Google API errors specifically
    if (error?.code === 401 || error?.code === 403) {
      return res.status(401).json({
        success: false,
        message: 'Invalid purchase token. Please retry the purchase.'
      });
    }

    if (error?.code === 404) {
      return res.status(401).json({
        success: false,
        message: 'Purchase not found. Please ensure the purchase was completed.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Unable to verify purchase at this time. Please try again later.',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get user schools (requires auth)
router.get('/', authMiddleware.authenticateToken, async (req, res) => {
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
router.get('/me', authMiddleware.authenticateToken, async (req, res) => {
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

// Update school (requires auth)
router.put('/:schoolId', authMiddleware.authenticateToken, authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { name, address, city, state, country, phone, email } = req.body;

    const result = await pool.query(
      `UPDATE schools SET 
       name = COALESCE($1, name), 
       address = COALESCE($2, address), 
       city = COALESCE($3, city), 
       state = COALESCE($4, state), 
       country = COALESCE($5, country), 
       phone = COALESCE($6, phone), 
       email = COALESCE($7, email), 
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $8 
       RETURNING *`,
      [name, address, city, state, country, phone, email, schoolId]
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
router.delete('/:schoolId', authMiddleware.authenticateToken, authMiddleware.checkSchoolOwnership, async (req, res) => {
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
