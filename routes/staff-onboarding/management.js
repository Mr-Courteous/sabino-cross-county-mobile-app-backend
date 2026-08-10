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

const { pool, ensureStaffTables, logStaffAudit, resolveClassForSchool } = require('./db');
const authMiddleware = require('../../middleware/auth');

// 'class_teacher' is a class-SCOPED account (see middleware/auth.js ->
// getTeacherClassScope): once assigned a class, they're restricted to
// only that class on write routes that opt into enforceClassScope.
// 'admin' remains the existing, unrestricted staff account. Subject-
// scoped teachers ('subject_teacher', per the addendum) aren't wired
// into any enforcement yet — out of scope for now, flagged for later.
const ALLOWED_STAFF_ROLES = ['admin', 'class_teacher'];

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

const publicStaffFields = `id, school_id, full_name, email, phone, role, class_id, status, force_password_change, created_by_type, last_login_at, deactivated_at, created_at`;

/**
 * @route   GET /api/staff/admins
 * @desc    List all admins for this school (owner is not included —
 *          it lives in the schools table, not here).
 * @access  Private (owner or admin)
 */
router.get('/admins', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.school_id, s.full_name, s.email, s.phone, s.role, s.class_id, c.class_name,
              s.status, s.force_password_change, s.created_by_type, s.last_login_at, s.deactivated_at, s.created_at
       FROM staff s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.school_id = $1
       ORDER BY s.created_at DESC`,
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
      `SELECT s.id, s.school_id, s.full_name, s.email, s.phone, s.role, s.class_id, c.class_name,
              s.status, s.force_password_change, s.created_by_type, s.last_login_at, s.deactivated_at, s.created_at
       FROM staff s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1 AND s.school_id = $2`,
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
 * @body    { fullName, email, phone?, role?, classId?, className? }
 *          role: 'admin' (default) | 'class_teacher'.
 *          classId / className: only meaningful for 'class_teacher' —
 *          className is what a country-scoped picker (GET /api/classes)
 *          hands back (e.g. "GHS 1"); it's resolved/created against
 *          this school's own `classes` table. classId is used as-is if
 *          you already have this school's real class id. Optional per
 *          addendum §3.2 — a class_teacher can be created without one
 *          and assigned later via PATCH /admins/:staffId/class.
 */
router.post('/admins', authMiddleware.requireOwner, async (req, res) => {
  const client = await pool.connect();
  try {
    const { fullName, email, phone, role, classId, className } = req.body;
    if (!fullName || !email) {
      return res.status(400).json({ success: false, error: 'fullName and email are required.' });
    }

    const resolvedRole = role || 'admin';
    if (!ALLOWED_STAFF_ROLES.includes(resolvedRole)) {
      return res.status(400).json({ success: false, error: `role must be one of: ${ALLOWED_STAFF_ROLES.join(', ')}` });
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

    let resolvedClass = null;
    if (classId || className) {
      try {
        resolvedClass = await resolveClassForSchool({ classId, className, schoolId: req.user.schoolId, client });
      } catch (classErr) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: classErr.message });
      }
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const { actorType, actorStaffId } = actorInfo(req);

    const insertResult = await client.query(
      `INSERT INTO staff (school_id, full_name, email, phone, role, class_id, password_hash, status, force_password_change, created_by_type, created_by_staff_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'password_reset_required', true, $8, $9)
       RETURNING ${publicStaffFields}`,
      [req.user.schoolId, fullName.trim(), normalizedEmail, phone || null, resolvedRole, resolvedClass?.id || null, passwordHash, actorType, actorStaffId]
    );

    await client.query('COMMIT');

    const newStaff = { ...insertResult.rows[0], class_name: resolvedClass?.class_name || null };
    const schoolName = schoolResult.rows[0].name;

    await logStaffAudit({
      schoolId: req.user.schoolId,
      actorType,
      actorStaffId,
      action: 'staff.created',
      targetStaffId: newStaff.id,
      details: { method: 'admin_assisted', email: normalizedEmail, role: resolvedRole, classId: resolvedClass?.id || null },
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
 * @body    { email, fullName?, phone?, expiresInHours?, role?, classId?, className? }
 *          role/classId/className — same meaning as POST /admins.
 */
router.post('/admins/invite', authMiddleware.requireOwner, async (req, res) => {
  try {
    const { email, fullName, phone, expiresInHours, role, classId, className } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'email is required.' });
    }

    const resolvedRole = role || 'admin';
    if (!ALLOWED_STAFF_ROLES.includes(resolvedRole)) {
      return res.status(400).json({ success: false, error: `role must be one of: ${ALLOWED_STAFF_ROLES.join(', ')}` });
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

    let resolvedClass = null;
    if (classId || className) {
      try {
        resolvedClass = await resolveClassForSchool({ classId, className, schoolId: req.user.schoolId });
      } catch (classErr) {
        return res.status(400).json({ success: false, error: classErr.message });
      }
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
      `INSERT INTO staff_invite_codes (school_id, code, full_name, email, phone, role, class_id, status, created_by_type, created_by_staff_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
       RETURNING id, code, full_name, email, phone, role, class_id, status, expires_at, created_at`,
      [req.user.schoolId, code, fullName || null, normalizedEmail, phone || null, resolvedRole, resolvedClass?.id || null, actorType, actorStaffId, expiresAt]
    );

    const invite = { ...result.rows[0], class_name: resolvedClass?.class_name || null };

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
 * @route   POST /api/staff/admins/invite/:inviteId/resend
 * @desc    Re-send an existing invite code by email, and refresh its
 *          expiry — covers both "they lost the message" and "the code
 *          expired before they used it" without generating a brand new
 *          code (which would also mean a new email/link for them to
 *          confuse with the old one). Only works on a still-pending
 *          (not used, not revoked) invite; a used/revoked one needs a
 *          fresh invite via POST /admins/invite instead.
 * @access  Private (OWNER ONLY — same hierarchy rule as invite/create)
 * @body    { expiresInHours? } — default 72, same as invite creation.
 */
router.post('/admins/invite/:inviteId/resend', authMiddleware.requireOwner, async (req, res) => {
  try {
    const { expiresInHours } = req.body || {};
    const hours = Number.isFinite(Number(expiresInHours)) && Number(expiresInHours) > 0 ? Number(expiresInHours) : 72;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const inviteResult = await pool.query(
      `UPDATE staff_invite_codes SET expires_at = $1
       WHERE id = $2 AND school_id = $3 AND status = 'pending'
       RETURNING id, code, full_name, email, phone, role, class_id, status, expires_at, created_at`,
      [expiresAt, req.params.inviteId, req.user.schoolId]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No pending invite found with that id. It may have already been used or revoked — generate a new invite instead.',
      });
    }

    const invite = inviteResult.rows[0];
    const schoolResult = await pool.query('SELECT name FROM schools WHERE id = $1', [req.user.schoolId]);
    const schoolName = schoolResult.rows[0]?.name || 'your school';

    try {
      await sendMail(invite.email, `Reminder: you're invited to join ${schoolName} on Sabino Edu`, `
        <div style="font-family: sans-serif; border: 1px solid #ddd; padding: 20px; max-width: 480px; margin: auto;">
          <h2 style="color: #333;">You're invited</h2>
          <p>This is a reminder that you've been invited to join <strong>${schoolName}</strong> on Sabino Edu.</p>
          <p>Open the Sabino Edu app, choose "I have an invite code", and enter:</p>
          <h1 style="color: #4A90E2; letter-spacing: 3px; font-size: 28px;">${invite.code}</h1>
          <p style="color: #888; font-size: 13px;">This code now expires in ${hours} hours and can only be used once.</p>
        </div>
      `);
    } catch (mailErr) {
      console.error('⚠️ [staff-management] Failed to re-email invite code:', mailErr.message);
      return res.status(502).json({
        success: false,
        error: 'The invite was refreshed but the reminder email could not be sent. Share the code directly instead.',
        data: invite,
      });
    }

    const { actorType, actorStaffId } = actorInfo(req);
    await logStaffAudit({
      schoolId: req.user.schoolId,
      actorType,
      actorStaffId,
      action: 'staff.invite_resent',
      details: { inviteId: invite.id, email: invite.email },
    });

    res.json({ success: true, message: `Invite resent to ${invite.email}.`, data: invite });
  } catch (error) {
    console.error('❌ [staff-management] resend invite error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to resend invite.' });
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
 * @route   PATCH /api/staff/admins/:staffId/class
 * @desc    Assign, change, or clear a class_teacher's class. This is
 *          how "GHS 1 teacher" gets scoped after account creation, or
 *          re-scoped later (new term, different class). Only meaningful
 *          for role 'class_teacher' — silently allowed for 'admin' too
 *          (it just won't do anything, since enforceClassScope only
 *          reads classId for staffRole === 'class_teacher'), which
 *          avoids forcing the caller to know a staff member's role
 *          before calling this.
 * @access  Private (OWNER ONLY — same hierarchy rule as create/invite)
 * @body    { classId?, className?, clear? }
 *          Pass clear: true (or classId: null with no className) to
 *          remove the assignment — e.g. a teacher leaving the class
 *          mid-term shouldn't stay locked to it.
 */
router.patch('/admins/:staffId/class', authMiddleware.requireOwner, async (req, res) => {
  try {
    const { classId, className, clear } = req.body || {};

    const staffCheck = await pool.query('SELECT id, role FROM staff WHERE id = $1 AND school_id = $2', [req.params.staffId, req.user.schoolId]);
    if (staffCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin account not found.' });
    }

    let resolvedClass = null;
    if (!clear && (classId || className)) {
      try {
        resolvedClass = await resolveClassForSchool({ classId, className, schoolId: req.user.schoolId });
      } catch (classErr) {
        return res.status(400).json({ success: false, error: classErr.message });
      }
    } else if (!clear && !classId && !className) {
      return res.status(400).json({ success: false, error: 'Provide classId or className, or clear: true to remove the assignment.' });
    }

    const result = await pool.query(
      `UPDATE staff SET class_id = $1, updated_at = NOW()
       WHERE id = $2 AND school_id = $3
       RETURNING id, full_name, email, role, class_id`,
      [resolvedClass?.id || null, req.params.staffId, req.user.schoolId]
    );

    const { actorType, actorStaffId } = actorInfo(req);
    await logStaffAudit({
      schoolId: req.user.schoolId,
      actorType,
      actorStaffId,
      action: resolvedClass ? 'staff.class_assigned' : 'staff.class_cleared',
      targetStaffId: result.rows[0].id,
      details: { classId: resolvedClass?.id || null, className: resolvedClass?.class_name || null },
    });

    res.json({
      success: true,
      message: resolvedClass ? `Assigned to ${resolvedClass.class_name}.` : 'Class assignment cleared.',
      data: { ...result.rows[0], class_name: resolvedClass?.class_name || null },
    });
  } catch (error) {
    console.error('❌ [staff-management] class assignment error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update class assignment.' });
  }
});

/**
 * @route   DELETE /api/staff/admins/:staffId
 * @desc    Permanently remove a staff account.
 *          - Owner: can delete anyone (admin or class_teacher).
 *          - A full admin: can delete a class_teacher, but NOT another
 *            admin — preserves the "admins cannot manage other admins"
 *            hierarchy rule while letting them manage the teachers they
 *            (or the owner) onboarded day-to-day.
 *          - A class_teacher: cannot delete anyone.
 * @access  Private (Owner, or an admin acting on a class_teacher)
 */
router.delete('/admins/:staffId', async (req, res) => {
  try {
    const targetCheck = await pool.query(
      'SELECT id, role, full_name, email FROM staff WHERE id = $1 AND school_id = $2',
      [req.params.staffId, req.user.schoolId]
    );
    if (targetCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Staff account not found.' });
    }
    const target = targetCheck.rows[0];

    // Tokens with no `role` field, or role !== 'admin', are the owner
    // (see middleware/auth.js -> requireOwner). Any staff-issued token
    // carries role: 'admin' regardless of job title — `staffRole` is
    // what actually distinguishes 'admin' from 'class_teacher'.
    const isOwner = !(req.user.type === 'school' && req.user.role === 'admin');
    if (!isOwner) {
      if (req.user.staffRole !== 'admin') {
        return res.status(403).json({ success: false, error: 'Only the school owner or an admin can remove staff accounts.' });
      }
      if (target.role === 'admin') {
        return res.status(403).json({ success: false, error: 'Only the school owner can remove another admin account.' });
      }
    }

    await pool.query(`DELETE FROM staff WHERE id = $1 AND school_id = $2`, [req.params.staffId, req.user.schoolId]);

    const { actorType, actorStaffId } = actorInfo(req);
    await logStaffAudit({
      schoolId: req.user.schoolId,
      actorType,
      actorStaffId,
      action: 'staff.deleted',
      targetStaffId: target.id,
      details: { email: target.email, role: target.role },
    });

    res.json({
      success: true,
      message: `${target.role === 'class_teacher' ? 'Teacher' : 'Admin'} account permanently deleted.`,
    });
  } catch (error) {
    console.error('❌ [staff-management] delete error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete staff account.' });
  }
});

/**
 * @route   GET /api/staff/audit-log
 * @desc    Recent staff-management activity for this school, paginated
 *          with a keyset cursor (id-based — cheap and stable even as
 *          the table grows, unlike OFFSET which gets slower and can
 *          skip/repeat rows if new entries land between page fetches).
 * @query   limit  (optional, default 30, max 100)
 * @query   before (optional) — id of the oldest entry already loaded;
 *          returns the next page older than that entry.
 * @access  Private (owner or admin — transparency, not a delete action)
 */
router.get('/audit-log', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const before = req.query.before ? parseInt(req.query.before) : null;

    const params = [req.user.schoolId];
    let cursorClause = '';
    if (before && !Number.isNaN(before)) {
      params.push(before);
      cursorClause = ` AND id < $${params.length}`;
    }
    params.push(limit + 1); // fetch one extra row to know if another page exists

    const result = await pool.query(
      `SELECT id, actor_type, actor_staff_id, action, target_staff_id, target_type, target_id, details, created_at
       FROM staff_audit_logs WHERE school_id = $1${cursorClause} ORDER BY id DESC LIMIT $${params.length}`,
      params
    );

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;

    res.json({
      success: true,
      data: rows,
      pagination: { hasMore, nextCursor, limit }
    });
  } catch (error) {
    console.error('❌ [staff-management] audit-log error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load audit log.' });
  }
});

module.exports = router;
