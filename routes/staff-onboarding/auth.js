// ─────────────────────────────────────────────────────────────
// routes/staff-onboarding/auth.js
//
// Identity endpoints for the additional-admin accounts a school owner
// can create. Mounted at /api/staff-auth in index.js.
//
// Reuses the exact same building blocks as the rest of the codebase
// (bcryptjs, jsonwebtoken, the email_verifications OTP table, the
// gmail nodemailer transporter, validatePassword) so this plugs into
// the existing auth story instead of inventing a new one.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { pool, ensureStaffTables, logStaffAudit } = require('./db');
const authMiddleware = require('../../middleware/auth');
const { validatePassword } = require('../../utils/password-validator');

// Make sure our tables exist before any route in this file runs.
router.use(async (req, res, next) => {
  try {
    await ensureStaffTables();
    next();
  } catch (err) {
    console.error('❌ [staff-onboarding/auth] Failed to ensure tables:', err.message);
    res.status(500).json({ success: false, error: 'Server initialization error.' });
  }
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function sendMail(to, subject, html) {
  await transporter.sendMail({ from: `"Sabino Edu" <${process.env.EMAIL_USER}>`, to, subject, html });
}

function generateStaffToken(staff) {
  // NOTE: `id` is deliberately the SCHOOL id (not the staff row id) so
  // every existing requireSchool / checkSchoolOwnership / checkSubscription
  // route keeps working unchanged for admins. `staffId` identifies the
  // actual person for audit logging and self-service actions.
  return jwt.sign(
    {
      id: staff.school_id,
      schoolId: staff.school_id,
      type: 'school',
      role: 'admin',
      staffId: staff.id,
      name: staff.full_name,
      email: staff.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * @route   POST /api/staff-auth/login
 * @desc    Login for an additional admin account (not the school owner)
 * @access  Public
 * @body    { email, password }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await pool.query('SELECT * FROM staff WHERE email = $1', [normalizedEmail]);
    const staff = result.rows[0];

    if (!staff || !staff.password_hash) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    if (staff.status === 'deactivated') {
      return res.status(403).json({
        success: false,
        error: 'This admin account has been deactivated. Contact the school owner.',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    const isMatch = await bcrypt.compare(password, staff.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    await pool.query('UPDATE staff SET last_login_at = NOW() WHERE id = $1', [staff.id]);

    const token = generateStaffToken(staff);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          staffId: staff.id,
          schoolId: staff.school_id,
          email: staff.email,
          name: staff.full_name,
          type: 'school',
          role: 'admin',
        },
        forcePasswordChange: staff.force_password_change === true,
      }
    });
  } catch (error) {
    console.error('❌ [staff-auth] Login error:', error.message);
    res.status(500).json({ success: false, error: 'An unexpected server error occurred' });
  }
});

/**
 * @route   GET /api/staff-auth/me
 * @desc    Identity check for whoever is currently logged in on a
 *          school-type token — works for both the owner and admins.
 * @access  Private
 */
router.get('/me', authMiddleware.authenticateToken, authMiddleware.requireSchool, async (req, res) => {
  try {
    if (req.user.role === 'admin' && req.user.staffId) {
      const result = await pool.query(
        'SELECT id, school_id, full_name, email, phone, role, status, force_password_change, last_login_at, created_at FROM staff WHERE id = $1',
        [req.user.staffId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Admin account not found.' });
      }
      const staff = result.rows[0];
      return res.json({
        success: true,
        data: {
          staffId: staff.id,
          schoolId: staff.school_id,
          fullName: staff.full_name,
          email: staff.email,
          phone: staff.phone,
          role: 'admin',
          isOwner: false,
          status: staff.status,
          forcePasswordChange: staff.force_password_change,
          lastLoginAt: staff.last_login_at,
        }
      });
    }

    // Owner — pull the basics from schools.
    const result = await pool.query('SELECT id, name, email FROM schools WHERE id = $1', [req.user.schoolId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'School not found.' });
    }
    const school = result.rows[0];
    res.json({
      success: true,
      data: {
        schoolId: school.id,
        fullName: school.name,
        email: school.email,
        role: 'owner',
        isOwner: true,
        status: 'active',
        forcePasswordChange: false,
      }
    });
  } catch (error) {
    console.error('❌ [staff-auth] /me error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load identity.' });
  }
});

/**
 * @route   POST /api/staff-auth/change-password
 * @desc    Self-service password change. Used both for the mandatory
 *          "change your temp password before you do anything else"
 *          flow (Path A) and for ordinary voluntary changes.
 * @access  Private (admin accounts only — the owner changes their
 *          password through the existing /api/auth flow)
 * @body    { currentPassword, newPassword }
 */
router.post('/change-password', authMiddleware.authenticateToken, authMiddleware.requireSchool, async (req, res) => {
  try {
    if (req.user.role !== 'admin' || !req.user.staffId) {
      return res.status(403).json({ success: false, error: 'This endpoint is for admin accounts only.' });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required.' });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ success: false, error: passwordValidation.error });
    }

    const result = await pool.query('SELECT * FROM staff WHERE id = $1', [req.user.staffId]);
    const staff = result.rows[0];
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Admin account not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, staff.password_hash || '');
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE staff SET password_hash = $1, force_password_change = false, status = 'active', updated_at = NOW() WHERE id = $2`,
      [newHash, staff.id]
    );

    await logStaffAudit({
      schoolId: staff.school_id,
      actorType: 'admin',
      actorStaffId: staff.id,
      action: 'staff.password_changed',
      targetStaffId: staff.id,
    });

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    console.error('❌ [staff-auth] change-password error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to change password.' });
  }
});

/**
 * @route   POST /api/staff-auth/forgot-password
 * @desc    Send a 6-digit OTP to a staff/admin's email (same
 *          email_verifications table the student flow uses).
 * @access  Public
 */
router.post('/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query('SELECT id, full_name FROM staff WHERE email = $1', [normalizedEmail]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No admin account found with this email address.' });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await pool.query(
      `INSERT INTO email_verifications (email, otp_code, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
       SET otp_code = $2, expires_at = $3, is_verified = false`,
      [normalizedEmail, otpHash, expiresAt]
    );

    await sendMail(normalizedEmail, 'Admin Password Reset Code', `
      <div style="font-family: sans-serif; text-align: center; border: 1px solid #ddd; padding: 20px;">
        <h2 style="color: #333;">Password Reset</h2>
        <p>Use the code below to reset your Sabino Edu admin password:</p>
        <h1 style="color: #4A90E2; letter-spacing: 5px; font-size: 32px;">${otp}</h1>
        <p style="color: #888;">This code expires in 10 minutes. If you didn't request this, please ignore this email.</p>
      </div>
    `);

    res.status(200).json({ success: true, message: 'Reset code sent successfully' });
  } catch (error) {
    console.error('❌ [staff-auth] forgot-password error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});

/**
 * @route   POST /api/staff-auth/verify-otp
 * @access  Public
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const verifyRes = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND expires_at > NOW()',
      [normalizedEmail]
    );

    if (verifyRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    const isMatch = await bcrypt.compare(otp, verifyRes.rows[0].otp_code);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    await pool.query('UPDATE email_verifications SET is_verified = true WHERE email = $1', [normalizedEmail]);

    res.status(200).json({ success: true, message: 'OTP verified successfully.' });
  } catch (error) {
    console.error('❌ [staff-auth] verify-otp error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to verify OTP. Please try again later.' });
  }
});

/**
 * @route   POST /api/staff-auth/reset-password
 * @access  Public (requires a prior verified OTP)
 * @body    { email, password }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and new password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const verificationCheck = await pool.query(
      'SELECT is_verified FROM email_verifications WHERE email = $1 AND is_verified = true',
      [normalizedEmail]
    );
    if (verificationCheck.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Email must be verified first. Please complete OTP verification.' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ success: false, error: passwordValidation.error });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updateResult = await pool.query(
      `UPDATE staff SET password_hash = $1, force_password_change = false, status = 'active', updated_at = NOW()
       WHERE email = $2 RETURNING id, school_id`,
      [passwordHash, normalizedEmail]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin account not found' });
    }

    await pool.query('DELETE FROM email_verifications WHERE email = $1', [normalizedEmail]);

    await logStaffAudit({
      schoolId: updateResult.rows[0].school_id,
      actorType: 'admin',
      actorStaffId: updateResult.rows[0].id,
      action: 'staff.password_reset',
      targetStaffId: updateResult.rows[0].id,
    });

    res.status(200).json({ success: true, message: 'Password reset successful. You can now login with your new password.' });
  } catch (error) {
    console.error('❌ [staff-auth] reset-password error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /api/staff-auth/redeem-code
 * @desc    Self-registration Path B: a teacher/admin who was given an
 *          invite code by the school owner sets their own password and
 *          activates the account.
 * @access  Public
 * @body    { code, fullName?, phone?, password }
 */
router.post('/redeem-code', async (req, res) => {
  const client = await pool.connect();
  try {
    const { code, fullName, phone, password } = req.body;
    if (!code || !password) {
      return res.status(400).json({ success: false, error: 'Invite code and password are required.' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ success: false, error: passwordValidation.error });
    }

    const normalizedCode = code.trim().toUpperCase();

    await client.query('BEGIN');

    const codeResult = await client.query(
      `SELECT * FROM staff_invite_codes WHERE code = $1 FOR UPDATE`,
      [normalizedCode]
    );

    if (codeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Invalid invite code.' });
    }

    const invite = codeResult.rows[0];

    if (invite.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: `This invite code has already been ${invite.status}.` });
    }

    if (new Date(invite.expires_at) <= new Date()) {
      await client.query('UPDATE staff_invite_codes SET status = $1 WHERE id = $2', ['expired', invite.id]);
      await client.query('COMMIT');
      return res.status(410).json({ success: false, error: 'This invite code has expired. Ask the school owner for a new one.' });
    }

    const resolvedName = (fullName || invite.full_name || '').trim();
    if (!resolvedName) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Full name is required.' });
    }

    // The email on the invite (if the owner pre-filled one) is authoritative;
    // otherwise the code alone is the credential and we require the email
    // be supplied here. Keeping this simple per current scope: require the
    // invite to carry the email (owner enters it when generating the code).
    if (!invite.email) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'This invite code is not linked to an email address. Ask the school owner to regenerate it.' });
    }

    const existingStaff = await client.query('SELECT id FROM staff WHERE email = $1', [invite.email]);
    if (existingStaff.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'An account with this email already exists. Try logging in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const staffResult = await client.query(
      `INSERT INTO staff (school_id, full_name, email, phone, role, password_hash, status, force_password_change, created_by_type, created_by_staff_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', false, $7, $8)
       RETURNING id, school_id, full_name, email, role, status, created_at`,
      [invite.school_id, resolvedName, invite.email, phone || invite.phone || null, invite.role, passwordHash, invite.created_by_type, invite.created_by_staff_id]
    );

    await client.query(
      `UPDATE staff_invite_codes SET status = 'used', used_at = NOW(), redeemed_by_staff_id = $1 WHERE id = $2`,
      [staffResult.rows[0].id, invite.id]
    );

    await client.query('COMMIT');

    const staff = staffResult.rows[0];

    await logStaffAudit({
      schoolId: staff.school_id,
      actorType: 'admin',
      actorStaffId: staff.id,
      action: 'staff.self_registered',
      targetStaffId: staff.id,
      details: { via: 'invite_code' },
    });

    const token = generateStaffToken({ id: staff.id, school_id: staff.school_id, full_name: staff.full_name, email: staff.email });

    res.status(201).json({
      success: true,
      message: 'Account activated successfully.',
      data: {
        token,
        user: {
          staffId: staff.id,
          schoolId: staff.school_id,
          email: staff.email,
          name: staff.full_name,
          type: 'school',
          role: 'admin',
        }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [staff-auth] redeem-code error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
