// ─────────────────────────────────────────────────────────────
// routes/staff-onboarding/management.js
//
// School-owner-facing endpoints for managing additional admin
// accounts. Mounted at /api/staff in index.js.
//
// Hierarchy rule (per product decision): an admin created here can do
// everything the owner can EXCEPT delete data or manage other admins
// (including inviting/creating new admins). That's enforced by requiring
// `authMiddleware.requireOwner` on the routes that create, invite,
// revoke, deactivate, reactivate, or delete other admins below, and by
// the same middleware having been added to the existing delete routes
// elsewhere in the codebase (students, scores, schools).
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
require('dotenv').config();

const { pool, ensureStaffTables, logStaffAudit } = require('./db');
const authMiddleware = require('../../middleware/auth');

router.use(async (req, res, next) => {
  try {
    await ensureStaffTables();
    next();
  } catch (err) {
    console.error('❌ [staff-onboarding/management] Failed to ensure tables:', err.message);
    res.status(500).json({ success: false, error: 'Server initialization error.' });
  }
});

// Everything in this file requires a logged-in school-type account
// (owner OR admin). Read access (listing admins, audit log) is open to
// both. Individual routes tighten this further with requireOwner for
// anything that creates, invites, deactivates, reactivates, or deletes
// an admin account, or revokes an invite — the owner-only actions.
router.use(authMiddleware.authenticateToken, authMiddleware.requireSchool);

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

function generateTempPassword() {
  // 10 random chars from a set guaranteed to satisfy validatePassword
  // (upper, lower, number, symbol), then shuffled.
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;

  let pwd = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  for (let i = 0; i < 6; i++) pwd.push(all[crypto.randomInt(all.length)]);

  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join('');
}

function generateInviteCode() {
  // Short, readable, hard to confuse (no 0/O/1/I).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

function actorInfo(req) {
  return {
    actorType: req.user.role === 'admin' ? 'admin' : 'owner',
    actorStaffId: req.user.role === 'admin' ? req.user.staffId : null,
  };
}

const publicStaffFields = `id, school_id, full_name, email, phone, role, status, force_password_change, created_by_type, last_login_at, deactivated_at, created_at`;

/**
 * @route   GET /api/staff/admins
 * @desc    List all admins for this school (owner is not included —
 *          it lives in the schools table, not here).
 * @access  Private (owner or admin)
 */
router.get('/admins', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${publicStaffFields} FROM staff WHERE school_id = $1 ORDER BY created_at DESC`,
      [req.user.schoolId]
    );

    const pendingInvites = await pool.query(
      `SELECT id, code, full_name, email, phone, role, status, expires_at, created_at
       FROM staff_invite_codes WHERE school_id = $1 AND status = 'pending' ORDER BY created_at DESC`,
      [req.user.schoolId]
    );

    res.json({
      success: true,
      data: {
        admins: result.rows,
        pendingInvites: pendingInvites.rows,
      }
    });
  } catch (error) {
    console.error('❌ [staff-management] list error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load admin accounts.' });
  }
});

/**
 * @route   GET /api/staff/admins/:staffId
 * @access  Private (owner or admin)
 */
router.get('/admins/:staffId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${publicStaffFields} FROM staff WHERE id = $1 AND school_id = $2`,
      [req.params.staffId, req.user.schoolId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin account not found.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ [staff-management] get error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load admin account.' });
  }
});

/**
 * @route   POST /api/staff/admins
 * @desc    Path A — admin-assisted creation. Creates the account
 *          immediately with a temp password and emails the credentials;
 *          the new admin must change the password on first login.
 * @access  Private (OWNER ONLY — admins cannot create other admins)
 * @body    { fullName, email, phone? }
 */
router.post('/admins', authMiddleware.requireOwner, async (req, res) => {
  const client = await pool.connect();
  try {
    const { fullName, email, phone } = req.body;
    if (!fullName || !email) {
      return res.status(400).json({ success: false, error: 'fullName and email are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM staff WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'An admin account with this email already exists.' });
    }

    const schoolResult = await client.query('SELECT id, name, email FROM schools WHERE id = $1', [req.user.schoolId]);
    if (schoolResult.rows.length === 0 || schoolResult.rows[0].email.toLowerCase() === normalizedEmail) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'This email belongs to the school owner account.' });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const { actorType, actorStaffId } = actorInfo(req);

    const insertResult = await client.query(
      `INSERT INTO staff (school_id, full_name, email, phone, role, password_hash, status, force_password_change, created_by_type, created_by_staff_id)
       VALUES ($1, $2, $3, $4, 'admin', $5, 'password_reset_required', true, $6, $7)
       RETURNING ${publicStaffFields}`,
      [req.user.schoolId, fullName.trim(), normalizedEmail, phone || null, passwordHash, actorType, actorStaffId]
    );

    await client.query('COMMIT');

    const newStaff = insertResult.rows[0];
    const schoolName = schoolResult.rows[0].name;

    await logStaffAudit({
      schoolId: req.user.schoolId,
      actorType,
      actorStaffId,
      action: 'staff.created',
      targetStaffId: newStaff.id,
      details: { method: 'admin_assisted', email: normalizedEmail },
    });

    try {
      await sendMail(normalizedEmail, `You've been added as an admin on ${schoolName}'s Sabino Edu account`, `
        <div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px; max-width: 480px; margin: auto;">
          <h2 style="color: #333;">Welcome to Sabino Edu</h2>
          <p>You've been added as an admin for <strong>${schoolName}</strong>.</p>
          <p>Use these temporary credentials to log in — you'll be asked to set your own password on first login:</p>
          <p><strong>Email:</strong> ${normalizedEmail}<br/><strong>Temporary password:</strong> ${tempPassword}</p>
          <p style="color: #888; font-size: 13px;">For security, this temporary password will stop working once you set your own.</p>
        </div>
      `);
    } catch (mailErr) {
      console.error('⚠️ [staff-management] Failed to email new admin credentials:', mailErr.message);
      // Don't fail the request — the owner can still relay credentials manually.
    }

    res.status(201).json({
      success: true,
      message: 'Admin account created. Credentials have been emailed.',
      data: {
        admin: newStaff,
        // Returned once, here only, in case the email doesn't land —
        // never persisted or re-shown anywhere else.
        temporaryPassword: tempPassword,
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [staff-management] create error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * @route   POST /api/staff/admins/invite
 * @desc    Path B — generate a self-registration code for a new admin.
 *          The invitee redeems it via POST /api/staff-auth/redeem-code.
 * @access  Private (OWNER ONLY — admins cannot invite other admins)
 * @body    { email, fullName?, phone?, expiresInHours? }
 */
router.post('/admins/invite', authMiddleware.requireOwner, async (req, res) => {
  try {
    const { email, fullName, phone, expiresInHours } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'email is required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingStaff = await pool.query('SELECT id FROM staff WHERE email = $1', [normalizedEmail]);
    if (existingStaff.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'An admin account with this email already exists.' });
    }

    const existingInvite = await pool.query(
      `SELECT id FROM staff_invite_codes WHERE email = $1 AND school_id = $2 AND status = 'pending'`,
      [normalizedEmail, req.user.schoolId]
    );
    if (existingInvite.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'A pending invite already exists for this email.' });
    }

    let code = generateInviteCode();
    // Vanishingly unlikely, but guard the unique constraint anyway.
    for (let attempts = 0; attempts < 5; attempts++) {
      const clash = await pool.query('SELECT id FROM staff_invite_codes WHERE code = $1', [code]);
      if (clash.rows.length === 0) break;
      code = generateInviteCode();
    }

    const hours = Number.isFinite(Number(expiresInHours)) && Number(expiresInHours) > 0 ? Number(expiresInHours) : 72;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    const { actorType, actorStaffId } = actorInfo(req);

    const result = await pool.query(
      `INSERT INTO staff_invite_codes (school_id, code, full_name, email, phone, role, status, created_by_type, created_by_staff_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'admin', 'pending', $6, $7, $8)
       RETURNING id, code, full_name, email, phone, role, status, expires_at, created_at`,
      [req.user.schoolId, code, fullName || null, normalizedEmail, phone || null, actorType, actorStaffId, expiresAt]
    );

    const invite = result.rows[0];

    await logStaffAudit({
      schoolId: req.user.schoolId,
      actorType,
      actorStaffId,
      action: 'staff.invited',
      details: { email: normalizedEmail, code, expiresAt },
    });

    const schoolResult = await pool.query('SELECT name FROM schools WHERE id = $1', [req.user.schoolId]);
    const schoolName = schoolResult.rows[0]?.name || 'your school';

    try {
      await sendMail(normalizedEmail, `You're invited to join ${schoolName} on Sabino Edu`, `
        <div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px; max-width: 480px; margin: auto;">
          <h2 style="color: #333;">You're invited</h2>
          <p>You've been invited to join <strong>${schoolName}</strong> as an admin on Sabino Edu.</p>
          <p>Open the Sabino Edu app, choose "I have an invite code", and enter:</p>
          <h1 style="color: #4A90E2; letter-spacing: 3px; font-size: 28px;">${code}</h1>
          <p style="color: #888; font-size: 13px;">This code expires in ${hours} hours and can only be used once.</p>
        </div>
      `);
    } catch (mailErr) {
      console.error('⚠️ [staff-management] Failed to email invite code:', mailErr.message);
    }

    res.status(201).json({ success: true, message: 'Invite code generated.', data: invite });
  } catch (error) {
    console.error('❌ [staff-management] invite error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   DELETE /api/staff/admins/invite/:inviteId
 * @desc    Revoke a not-yet-redeemed invite code.
 * @access  Private (OWNER ONLY)
 */
router.delete('/admins/invite/:inviteId', authMiddleware.requireOwner, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE staff_invite_codes SET status = 'revoked' WHERE id = $1 AND school_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.inviteId, req.user.schoolId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Pending invite not found.' });
    }
    const { actorType, actorStaffId } = actorInfo(req);
    await logStaffAudit({ schoolId: req.user.schoolId, actorType, actorStaffId, action: 'staff.invite_revoked', details: { inviteId: req.params.inviteId } });
    res.json({ success: true, message: 'Invite revoked.' });
  } catch (error) {
    console.error('❌ [staff-management] revoke invite error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to revoke invite.' });
  }
});

/**
 * @route   PATCH /api/staff/admins/:staffId/deactivate
 * @desc    Revoke an admin's access without deleting their record.
 *          Owner-only — hierarchy rule.
 * @access  Private (OWNER ONLY)
 */
router.patch('/admins/:staffId/deactivate', authMiddleware.requireOwner, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE staff SET status = 'deactivated', deactivated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND school_id = $2 RETURNING id, full_name, email`,
      [req.params.staffId, req.user.schoolId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin account not found.' });
    }
    await logStaffAudit({ schoolId: req.user.schoolId, actorType: 'owner', action: 'staff.deactivated', targetStaffId: result.rows[0].id });
    res.json({ success: true, message: 'Admin access revoked.', data: result.rows[0] });
  } catch (error) {
    console.error('❌ [staff-management] deactivate error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to deactivate admin.' });
  }
});

/**
 * @route   PATCH /api/staff/admins/:staffId/reactivate
 * @access  Private (OWNER ONLY)
 */
router.patch('/admins/:staffId/reactivate', authMiddleware.requireOwner, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE staff SET status = 'active', deactivated_at = NULL, updated_at = NOW()
       WHERE id = $1 AND school_id = $2 RETURNING id, full_name, email`,
      [req.params.staffId, req.user.schoolId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin account not found.' });
    }
    await logStaffAudit({ schoolId: req.user.schoolId, actorType: 'owner', action: 'staff.reactivated', targetStaffId: result.rows[0].id });
    res.json({ success: true, message: 'Admin access restored.', data: result.rows[0] });
  } catch (error) {
    console.error('❌ [staff-management] reactivate error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to reactivate admin.' });
  }
});

/**
 * @route   DELETE /api/staff/admins/:staffId
 * @desc    Permanently remove an admin account. Owner-only — hierarchy
 *          rule ("the new admin route cannot delete student or any
 *          data", which naturally extends to not being able to delete
 *          *other admins* either).
 * @access  Private (OWNER ONLY)
 */
router.delete('/admins/:staffId', authMiddleware.requireOwner, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM staff WHERE id = $1 AND school_id = $2 RETURNING id, full_name, email`,
      [req.params.staffId, req.user.schoolId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin account not found.' });
    }
    await logStaffAudit({ schoolId: req.user.schoolId, actorType: 'owner', action: 'staff.deleted', targetStaffId: result.rows[0].id, details: { email: result.rows[0].email } });
    res.json({ success: true, message: 'Admin account permanently deleted.' });
  } catch (error) {
    console.error('❌ [staff-management] delete error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete admin account.' });
  }
});

/**
 * @route   GET /api/staff/audit-log
 * @desc    Recent staff-management activity for this school.
 * @access  Private (owner or admin — transparency, not a delete action)
 */
router.get('/audit-log', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const result = await pool.query(
      `SELECT id, actor_type, actor_staff_id, action, target_staff_id, target_type, target_id, details, created_at
       FROM staff_audit_logs WHERE school_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [req.user.schoolId, limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ [staff-management] audit-log error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load audit log.' });
  }
});

module.exports = router;
