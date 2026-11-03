const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');
const { validatePassword } = require('../utils/password-validator');

/**
 * PARENT ACCESS
 * Mount in your server entry file:
 *   app.use('/api/parents', require('./routes/parents'));
 *
 * A parent has ONE login and can be linked to any number of children, even in
 * different schools. The link lives in `parent_students`.
 *
 * Security model
 *  - A parent token is its own type ('parent'). The shared authenticateToken
 *    middleware does NOT accept it, so it can never reach a school or student
 *    route. Only the routes in this file understand it.
 *  - To look at a child, the parent asks for a CHILD TOKEN
 *    (POST /children/:studentId/token): a normal student token (type 'student')
 *    carrying `viaParent`. Every existing student endpoint (grades, report data,
 *    enrollments...) then works unchanged and only ever returns that one child's
 *    records. middleware/auth.js makes `viaParent` tokens read-only.
 *  - Linking needs the child's registration number AND the school-issued link
 *    code. Auto-link by guardian email only happens if the school turned it on.
 */

// ── Setup ───────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  message: { success: false, error: 'Too many code requests. Please try again in 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
});
// Guessing link codes: limited per parent account, not per IP
const linkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 15,
  keyGenerator: (req) => `parent-${req.parent?.parentId || req.ip}`,
  validate: false,
  message: { success: false, error: 'Too many link attempts. Please try again in an hour, or ask the school to confirm the code.' },
  standardHeaders: true, legacyHeaders: false,
});

const MAX_CHILDREN = 20;
const norm = (v) => String(v ?? '').trim();
const normEmail = (v) => norm(v).toLowerCase();
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const signParentToken = (parent) =>
  jwt.sign({ parentId: parent.id, type: 'parent', email: parent.email, name: parent.full_name }, process.env.JWT_SECRET, { expiresIn: '1h' });

const publicParent = (p) => ({ parentId: p.id, fullName: p.full_name, email: p.email, phone: p.phone, type: 'parent' });

// Authenticates PARENT tokens only (the shared middleware rejects them on purpose)
const authenticateParent = (req, res, next) => {
  const header = req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') ? header.split(' ')[1] : null;
  if (!token) return res.status(401).json({ success: false, error: 'Please log in to continue.' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      const expired = err.name === 'TokenExpiredError';
      return res.status(expired ? 401 : 403).json({ success: false, error: expired ? 'Your session has expired. Please log in again.' : 'Invalid session.', code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' });
    }
    if (decoded.type !== 'parent' || !decoded.parentId) {
      return res.status(403).json({ success: false, error: 'This area is for parent accounts only.', code: 'WRONG_ACCOUNT_TYPE' });
    }
    req.parent = decoded;
    next();
  });
};

// Owner / full admin only on the school side (class & subject teachers excluded)
const requireSchoolAdmin = (req, res, next) => {
  if (req.user?.staffRole === 'class_teacher' || req.user?.staffRole === 'subject_teacher') {
    return res.status(403).json({ success: false, error: 'Only the school owner or an admin can manage parent access.' });
  }
  next();
};

const subscriptionActive = (school) =>
  ['completed', 'grace_period'].includes(school.payment_status) &&
  school.subscription_expiry && new Date(school.subscription_expiry) > new Date();

const newLinkCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

// Link every child whose school turned on auto-link and recorded this e-mail
async function autoLinkByEmail(parentId, email) {
  try {
    await pool.query(
      `INSERT INTO parent_students (parent_id, student_id, school_id, relationship, linked_via)
       SELECT $1, s.id, s.school_id, 'guardian', 'email'
         FROM students s JOIN schools sc ON sc.id = s.school_id
        WHERE sc.parent_auto_link = true AND LOWER(TRIM(s.guardian_email)) = $2
       ON CONFLICT (parent_id, student_id) DO NOTHING`,
      [parentId, email]
    );
  } catch (e) {
    console.warn('[parents] auto-link skipped:', e.message);
  }
}

async function getLinkedChild(parentId, studentId) {
  const r = await pool.query(
    `SELECT ps.id AS link_id, ps.relationship,
            s.id, s.school_id, s.first_name, s.last_name, s.email, s.registration_number, s.phone,
            s.date_of_birth, s.gender, s.photo, s.address,
            sc.name AS school_name, sc.country_id AS school_country_id, sc.country AS school_country_name,
            sc.phone AS school_phone, sc.email AS school_email,
            sc.payment_status, sc.subscription_expiry
       FROM parent_students ps
       JOIN students s  ON s.id = ps.student_id
       JOIN schools  sc ON sc.id = s.school_id
      WHERE ps.parent_id = $1 AND ps.student_id = $2 AND ps.status = 'active'`,
    [parentId, studentId]
  );
  return r.rows[0] || null;
}

// ── Email codes (separate key space from schools/students) ──────────────
async function sendCode(key, email, subject, intro) {
  const code = crypto.randomInt(100000, 999999).toString();
  const hash = await bcrypt.hash(code, 10);
  await pool.query(
    `INSERT INTO email_verifications (email, otp_code, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET otp_code = $2, expires_at = $3, is_verified = false`,
    [key, hash, new Date(Date.now() + 10 * 60000)]
  );
  await transporter.sendMail({
    from: `"Sabino Edu" <${process.env.EMAIL_USER}>`,
    to: email,
    subject,
    html: `<div style="font-family:sans-serif;text-align:center;border:1px solid #ddd;padding:20px">
             <h2 style="color:#333">${subject}</h2><p>${intro}</p>
             <h1 style="color:#4A90E2;letter-spacing:5px;font-size:32px">${code}</h1>
             <p style="color:#888">This code expires in 10 minutes.</p></div>`,
  });
}

async function checkCode(key, code) {
  const r = await pool.query('SELECT otp_code FROM email_verifications WHERE email = $1 AND expires_at > NOW()', [key]);
  if (!r.rows.length) return false;
  return bcrypt.compare(String(code), r.rows[0].otp_code);
}

// ── Public: register / login / reset ────────────────────────────────────
router.post('/otp', otpLimiter, async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    if (!isEmail(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
    const exists = await pool.query('SELECT id FROM parents WHERE email = $1', [email]);
    if (exists.rows.length) {
      return res.status(400).json({ success: false, alreadyRegistered: true, error: 'This email already has a parent account. Please log in.' });
    }
    await sendCode(`parent:${email}`, email, 'Verify your email', 'Use this code to create your Sabino Edu parent account:');
    res.json({ success: true, message: 'Verification code sent.' });
  } catch (e) {
    console.error('[parents] otp:', e.message);
    res.status(500).json({ success: false, error: 'Could not send the code. Please try again.' });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    if (!email || !req.body?.otp) return res.status(400).json({ success: false, error: 'Email and code are required.' });
    if (!(await checkCode(`parent:${email}`, req.body.otp))) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code.' });
    }
    await pool.query('UPDATE email_verifications SET is_verified = true WHERE email = $1', [`parent:${email}`]);
    res.json({ success: true, message: 'Email verified.' });
  } catch (e) {
    console.error('[parents] verify-otp:', e.message);
    res.status(500).json({ success: false, error: 'Could not verify the code.' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const fullName = norm(req.body?.fullName);
    const email = normEmail(req.body?.email);
    const phone = norm(req.body?.phone) || null;
    const password = req.body?.password;
    if (fullName.length < 2 || !isEmail(email)) {
      return res.status(400).json({ success: false, error: 'Your name and a valid email are required.' });
    }
    const pw = validatePassword(password);
    if (!pw.isValid) return res.status(400).json({ success: false, error: pw.error });

    const verified = await pool.query('SELECT 1 FROM email_verifications WHERE email = $1 AND is_verified = true', [`parent:${email}`]);
    if (!verified.rows.length) {
      return res.status(400).json({ success: false, error: 'Please verify your email first.' });
    }
    const hash = await bcrypt.hash(password, 10);
    let parent;
    try {
      const r = await pool.query(
        'INSERT INTO parents (full_name, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, phone',
        [fullName, email, phone, hash]
      );
      parent = r.rows[0];
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ success: false, error: 'This email already has a parent account. Please log in.' });
      throw e;
    }
    await pool.query('DELETE FROM email_verifications WHERE email = $1', [`parent:${email}`]);
    await autoLinkByEmail(parent.id, email);
    res.status(201).json({ success: true, data: { token: signParentToken(parent), parent: publicParent(parent) } });
  } catch (e) {
    console.error('[parents] register:', e.message);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required.' });
    const r = await pool.query('SELECT id, full_name, email, phone, password_hash FROM parents WHERE email = $1', [email]);
    const parent = r.rows[0];
    if (!parent || !(await bcrypt.compare(password, parent.password_hash))) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }
    await pool.query('UPDATE parents SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [parent.id]);
    await autoLinkByEmail(parent.id, email);
    res.json({ success: true, message: 'Login successful', data: { token: signParentToken(parent), parent: publicParent(parent) } });
  } catch (e) {
    console.error('[parents] login:', e.message);
    res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

router.post('/forgot-password', otpLimiter, async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    if (!isEmail(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
    const exists = await pool.query('SELECT id FROM parents WHERE email = $1', [email]);
    if (exists.rows.length) {
      await sendCode(`parentreset:${email}`, email, 'Reset your password', 'Use this code to reset your Sabino Edu parent password:');
    }
    // Same answer whether or not the account exists
    res.json({ success: true, message: 'If that email has an account, a reset code has been sent.' });
  } catch (e) {
    console.error('[parents] forgot-password:', e.message);
    res.status(500).json({ success: false, error: 'Could not send the code. Please try again.' });
  }
});

router.post('/reset-password', loginLimiter, async (req, res) => {
  try {
    const email = normEmail(req.body?.email);
    const { otp, newPassword } = req.body || {};
    if (!email || !otp || !newPassword) return res.status(400).json({ success: false, error: 'Email, code and new password are required.' });
    const pw = validatePassword(newPassword);
    if (!pw.isValid) return res.status(400).json({ success: false, error: pw.error });
    if (!(await checkCode(`parentreset:${email}`, otp))) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code.' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    const r = await pool.query('UPDATE parents SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING id', [hash, email]);
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Invalid or expired code.' });
    await pool.query('DELETE FROM email_verifications WHERE email = $1', [`parentreset:${email}`]);
    res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (e) {
    console.error('[parents] reset-password:', e.message);
    res.status(500).json({ success: false, error: 'Could not reset the password.' });
  }
});

// ── Parent: own profile ─────────────────────────────────────────────────
router.get('/me', authenticateParent, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, full_name, email, phone FROM parents WHERE id = $1', [req.parent.parentId]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Account not found.' });
    res.json({ success: true, data: publicParent(r.rows[0]) });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Could not load your account.' });
  }
});

router.put('/me', authenticateParent, async (req, res) => {
  try {
    const fullName = norm(req.body?.fullName);
    const phone = norm(req.body?.phone) || null;
    if (fullName.length < 2) return res.status(400).json({ success: false, error: 'Name is required.' });
    const r = await pool.query(
      'UPDATE parents SET full_name = $1, phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, full_name, email, phone',
      [fullName, phone, req.parent.parentId]
    );
    res.json({ success: true, data: publicParent(r.rows[0]) });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Could not update your details.' });
  }
});

// ── Parent: children ────────────────────────────────────────────────────
router.get('/children', authenticateParent, async (req, res) => {
  try {
    const parentId = req.parent.parentId;
    const parentRow = await pool.query('SELECT email FROM parents WHERE id = $1', [parentId]);
    if (parentRow.rows[0]) await autoLinkByEmail(parentId, parentRow.rows[0].email);

    const kids = await pool.query(
      `SELECT ps.id AS link_id, ps.relationship, ps.linked_via,
              s.id AS student_id, s.first_name, s.last_name, s.registration_number, s.photo, s.gender, s.date_of_birth,
              sc.id AS school_id, sc.name AS school_name, sc.payment_status, sc.subscription_expiry
         FROM parent_students ps
         JOIN students s  ON s.id = ps.student_id
         JOIN schools  sc ON sc.id = s.school_id
        WHERE ps.parent_id = $1 AND ps.status = 'active'
        ORDER BY s.first_name, s.last_name`,
      [parentId]
    );

    const children = [];
    for (const k of kids.rows) {
      const enr = await pool.query(
        `SELECT e.id AS enrollment_id, e.session_id, e.status, c.class_name, ay.session_name
           FROM enrollments e
           JOIN classes c ON c.id = e.class_id
           LEFT JOIN academic_years ay ON ay.id = e.session_id
          WHERE e.student_id = $1
          ORDER BY e.id DESC LIMIT 1`,
        [k.student_id]
      );
      const latest = await pool.query(
        `SELECT s.session_id, s.term, COUNT(*)::int AS subjects,
                ROUND(AVG(s.total_score)::numeric, 1) AS average_total
           FROM scores s JOIN enrollments e ON e.id = s.enrollment_id
          WHERE e.student_id = $1
          GROUP BY s.session_id, s.term
          ORDER BY s.session_id DESC, s.term DESC LIMIT 1`,
        [k.student_id]
      );
      children.push({
        studentId: k.student_id,
        firstName: k.first_name,
        lastName: k.last_name,
        registrationNumber: k.registration_number,
        photo: k.photo,
        gender: k.gender,
        relationship: k.relationship,
        linkedVia: k.linked_via,
        school: { id: k.school_id, name: k.school_name, active: !!subscriptionActive(k) },
        currentClass: enr.rows[0]?.class_name || null,
        currentSession: enr.rows[0]?.session_name || null,
        enrollmentStatus: enr.rows[0]?.status || null,
        latestResults: latest.rows[0]
          ? { sessionId: latest.rows[0].session_id, term: latest.rows[0].term, subjects: latest.rows[0].subjects, averageTotal: Number(latest.rows[0].average_total) }
          : null,
      });
    }
    res.json({ success: true, data: children, count: children.length });
  } catch (e) {
    console.error('[parents] children:', e.message);
    res.status(500).json({ success: false, error: 'Could not load your children.' });
  }
});

router.post('/children/link', authenticateParent, linkLimiter, async (req, res) => {
  try {
    const parentId = req.parent.parentId;
    const reg = norm(req.body?.registrationNumber).toUpperCase();
    const code = norm(req.body?.linkCode).toUpperCase();
    const relationship = norm(req.body?.relationship).slice(0, 30) || 'parent';
    if (!reg || !code) {
      return res.status(400).json({ success: false, error: "Enter the child's registration number and the link code from the school." });
    }
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM parent_students WHERE parent_id = $1 AND status = 'active'", [parentId]);
    if (count.rows[0].n >= MAX_CHILDREN) {
      return res.status(400).json({ success: false, error: `You can link up to ${MAX_CHILDREN} children.` });
    }
    const found = await pool.query(
      `SELECT id, school_id, first_name, last_name FROM students
        WHERE UPPER(TRIM(registration_number)) = $1 AND UPPER(TRIM(parent_link_code)) = $2`,
      [reg, code]
    );
    if (!found.rows.length) {
      // Same message for "no such student" and "wrong code" on purpose
      return res.status(404).json({ success: false, error: 'No student matches that registration number and code. Check both with the school.' });
    }
    const st = found.rows[0];
    await pool.query(
      `INSERT INTO parent_students (parent_id, student_id, school_id, relationship, status, linked_via)
       VALUES ($1, $2, $3, $4, 'active', 'code')
       ON CONFLICT (parent_id, student_id)
       DO UPDATE SET status = 'active', revoked_at = NULL, linked_via = 'code', relationship = EXCLUDED.relationship`,
      [parentId, st.id, st.school_id, relationship]
    );
    res.status(201).json({ success: true, message: `${st.first_name} ${st.last_name} was added to your account.`, data: { studentId: st.id } });
  } catch (e) {
    console.error('[parents] link:', e.message);
    res.status(500).json({ success: false, error: 'Could not link the child. Please try again.' });
  }
});

router.delete('/children/:studentId', authenticateParent, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE parent_students SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
        WHERE parent_id = $1 AND student_id = $2 AND status = 'active' RETURNING id`,
      [req.parent.parentId, req.params.studentId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Child not found on your account.' });
    res.json({ success: true, message: 'Child removed from your account.' });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Could not remove the child.' });
  }
});

/**
 * Child token: a read-only student-type token for ONE linked child. Use it with
 * the normal student endpoints:
 *   GET /api/scores/my-grades?term=&sessionId=
 *   GET /api/students/me/enrollments
 *   GET /api/reports/data/student/:enrollmentId ...
 */
router.post('/children/:studentId/token', authenticateParent, async (req, res) => {
  try {
    const child = await getLinkedChild(req.parent.parentId, req.params.studentId);
    if (!child) return res.status(404).json({ success: false, error: 'Child not found on your account.' });

    let countryId = child.school_country_id || null;
    if (!countryId && child.school_country_name) {
      try {
        const c = await pool.query('SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1', [child.school_country_name.trim()]);
        countryId = c.rows[0]?.id || null;
      } catch (_) { /* optional */ }
    }
    const token = jwt.sign(
      {
        studentId: child.id,
        registrationNumber: child.registration_number,
        schoolId: child.school_id,
        countryId,
        type: 'student',
        viaParent: req.parent.parentId,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const { payment_status, subscription_expiry, link_id, relationship, ...student } = child;
    res.json({
      success: true,
      data: {
        token,
        schoolActive: !!subscriptionActive(child),
        student: { ...student, school_country_id: countryId, type: 'student' },
      },
    });
  } catch (e) {
    console.error('[parents] child token:', e.message);
    res.status(500).json({ success: false, error: 'Could not open the child record.' });
  }
});

// Profile, enrollment history and the list of report cards that exist
router.get('/children/:studentId/overview', authenticateParent, async (req, res) => {
  try {
    const child = await getLinkedChild(req.parent.parentId, req.params.studentId);
    if (!child) return res.status(404).json({ success: false, error: 'Child not found on your account.' });

    const enrollments = await pool.query(
      `SELECT e.id AS enrollment_id, e.session_id, e.status, e.class_id, c.class_name, ay.session_name
         FROM enrollments e
         JOIN classes c ON c.id = e.class_id
         LEFT JOIN academic_years ay ON ay.id = e.session_id
        WHERE e.student_id = $1 ORDER BY e.id DESC`,
      [child.id]
    );
    const terms = await pool.query(
      `SELECT e.id AS enrollment_id, s.session_id, s.term, c.class_name, ay.session_name,
              COUNT(*)::int AS subjects, ROUND(AVG(s.total_score)::numeric, 1) AS average_total
         FROM scores s
         JOIN enrollments e ON e.id = s.enrollment_id
         JOIN classes c ON c.id = e.class_id
         LEFT JOIN academic_years ay ON ay.id = s.session_id
        WHERE e.student_id = $1
        GROUP BY e.id, s.session_id, s.term, c.class_name, ay.session_name
        ORDER BY s.session_id DESC, s.term DESC`,
      [child.id]
    );
    res.json({
      success: true,
      data: {
        student: {
          studentId: child.id, firstName: child.first_name, lastName: child.last_name,
          registrationNumber: child.registration_number, gender: child.gender,
          dateOfBirth: child.date_of_birth, address: child.address, photo: child.photo,
        },
        relationship: child.relationship,
        school: { name: child.school_name, phone: child.school_phone, email: child.school_email, active: !!subscriptionActive(child) },
        enrollments: enrollments.rows,
        reportTerms: terms.rows.map((t) => ({ ...t, average_total: Number(t.average_total) })),
      },
    });
  } catch (e) {
    console.error('[parents] overview:', e.message);
    res.status(500).json({ success: false, error: 'Could not load the child details.' });
  }
});

// Attendance: per-term summary + the most recent marked days
router.get('/children/:studentId/attendance', authenticateParent, async (req, res) => {
  try {
    const child = await getLinkedChild(req.parent.parentId, req.params.studentId);
    if (!child) return res.status(404).json({ success: false, error: 'Child not found on your account.' });
    try {
      const summary = await pool.query(
        `SELECT ar.enrollment_id, ar.class_id, ar.session_id, ar.term, c.class_name, ay.session_name,
                COUNT(*) FILTER (WHERE ar.status = 'present')::int AS present,
                COUNT(*) FILTER (WHERE ar.status = 'late')::int    AS late,
                COUNT(*) FILTER (WHERE ar.status = 'absent')::int  AS absent,
                COUNT(*) FILTER (WHERE ar.status = 'sick')::int    AS sick,
                COUNT(*) FILTER (WHERE ar.status = 'excused')::int AS excused,
                (SELECT COUNT(*)::int FROM (
                   SELECT DISTINCT attendance_date, period FROM attendance_records x
                    WHERE x.school_id = ar.school_id AND x.class_id = ar.class_id
                      AND x.session_id = ar.session_id AND x.term = ar.term) d) AS sessions_held
           FROM attendance_records ar
           JOIN classes c ON c.id = ar.class_id
           LEFT JOIN academic_years ay ON ay.id = ar.session_id
          WHERE ar.student_id = $1 AND ar.school_id = $2
          GROUP BY ar.enrollment_id, ar.class_id, ar.session_id, ar.term, ar.school_id, c.class_name, ay.session_name
          ORDER BY ar.session_id DESC, ar.term DESC`,
        [child.id, child.school_id]
      );
      const recent = await pool.query(
        `SELECT attendance_date, period, status, remarks FROM attendance_records
          WHERE student_id = $1 AND school_id = $2
          ORDER BY attendance_date DESC, id DESC LIMIT 40`,
        [child.id, child.school_id]
      );
      const terms = summary.rows.map((t) => {
        const attended = t.present + t.late;
        return { ...t, percentage: t.sessions_held > 0 ? Number(((attended / t.sessions_held) * 100).toFixed(1)) : null };
      });
      return res.json({ success: true, data: { terms, recent: recent.rows } });
    } catch (e) {
      if (e.code === '42P01') return res.json({ success: true, data: { terms: [], recent: [] } }); // register not used yet
      throw e;
    }
  } catch (e) {
    console.error('[parents] attendance:', e.message);
    res.status(500).json({ success: false, error: 'Could not load attendance.' });
  }
});

// ── School side: manage parent access ───────────────────────────────────
const schoolAuth = [authMiddleware.authenticateToken, authMiddleware.requireSchool, requireSchoolAdmin];

router.get('/school/settings', ...schoolAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT sc.parent_auto_link,
              (SELECT COUNT(DISTINCT parent_id)::int FROM parent_students WHERE school_id = sc.id AND status = 'active') AS parents,
              (SELECT COUNT(DISTINCT student_id)::int FROM parent_students WHERE school_id = sc.id AND status = 'active') AS linked_students
         FROM schools sc WHERE sc.id = $1`,
      [req.user.schoolId]
    );
    res.json({ success: true, data: { autoLink: !!r.rows[0]?.parent_auto_link, parents: r.rows[0]?.parents || 0, linkedStudents: r.rows[0]?.linked_students || 0 } });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Could not load settings.' });
  }
});

router.put('/school/settings', ...schoolAuth, async (req, res) => {
  try {
    await pool.query('UPDATE schools SET parent_auto_link = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [req.body?.autoLink === true, req.user.schoolId]);
    res.json({ success: true, data: { autoLink: req.body?.autoLink === true } });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Could not save settings.' });
  }
});

router.get('/school/students', ...schoolAuth, async (req, res) => {
  try {
    const params = [req.user.schoolId];
    let where = 's.school_id = $1';
    const q = norm(req.query.search);
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (s.first_name ILIKE $2 OR s.last_name ILIKE $2 OR s.registration_number ILIKE $2 OR (s.first_name || ' ' || s.last_name) ILIKE $2)`;
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const r = await pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.registration_number, s.parent_link_code,
              s.guardian_name, s.guardian_email, s.guardian_phone,
              (SELECT COUNT(*)::int FROM parent_students ps WHERE ps.student_id = s.id AND ps.status = 'active') AS linked_parents
         FROM students s WHERE ${where}
        ORDER BY s.last_name, s.first_name LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  } catch (e) {
    console.error('[parents] school students:', e.message);
    res.status(500).json({ success: false, error: 'Could not load students.' });
  }
});

router.put('/school/students/:studentId/guardian', ...schoolAuth, async (req, res) => {
  try {
    const email = normEmail(req.body?.guardianEmail) || null;
    if (email && !isEmail(email)) return res.status(400).json({ success: false, error: 'Enter a valid guardian email.' });
    const r = await pool.query(
      `UPDATE students SET guardian_name = $1, guardian_email = $2, guardian_phone = $3
        WHERE id = $4 AND school_id = $5 RETURNING id`,
      [norm(req.body?.guardianName).slice(0, 150) || null, email, norm(req.body?.guardianPhone).slice(0, 40) || null, req.params.studentId, req.user.schoolId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Student not found.' });
    if (email) { // parents who registered earlier get linked right away (if the school allows it)
      await pool.query(
        `INSERT INTO parent_students (parent_id, student_id, school_id, relationship, linked_via)
         SELECT p.id, $1, $2, 'guardian', 'email' FROM parents p
          WHERE LOWER(p.email) = $3 AND (SELECT parent_auto_link FROM schools WHERE id = $2)
         ON CONFLICT (parent_id, student_id) DO NOTHING`,
        [r.rows[0].id, req.user.schoolId, email]
      );
    }
    res.json({ success: true, message: 'Guardian details saved.' });
  } catch (e) {
    console.error('[parents] guardian:', e.message);
    res.status(500).json({ success: false, error: 'Could not save guardian details.' });
  }
});

router.post('/school/students/:studentId/regenerate-code', ...schoolAuth, async (req, res) => {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await pool.query(
          'UPDATE students SET parent_link_code = $1 WHERE id = $2 AND school_id = $3 RETURNING id, parent_link_code',
          [newLinkCode(), req.params.studentId, req.user.schoolId]
        );
        if (!r.rows.length) return res.status(404).json({ success: false, error: 'Student not found.' });
        let revoked = 0;
        if (req.body?.revokeLinks === true) {
          const rv = await pool.query(
            `UPDATE parent_students SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
              WHERE student_id = $1 AND school_id = $2 AND status = 'active'`,
            [r.rows[0].id, req.user.schoolId]
          );
          revoked = rv.rowCount;
        }
        return res.json({ success: true, data: { parentLinkCode: r.rows[0].parent_link_code, revokedLinks: revoked } });
      } catch (e) {
        if (e.code !== '23505') throw e; // code collision: try another
      }
    }
    res.status(500).json({ success: false, error: 'Could not generate a unique code. Try again.' });
  } catch (e) {
    console.error('[parents] regenerate:', e.message);
    res.status(500).json({ success: false, error: 'Could not regenerate the code.' });
  }
});

router.get('/school/students/:studentId/links', ...schoolAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ps.id AS link_id, ps.relationship, ps.linked_via, ps.created_at, p.full_name, p.email, p.phone
         FROM parent_students ps JOIN parents p ON p.id = ps.parent_id
        WHERE ps.student_id = $1 AND ps.school_id = $2 AND ps.status = 'active'
        ORDER BY ps.created_at`,
      [req.params.studentId, req.user.schoolId]
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Could not load linked parents.' });
  }
});

router.delete('/school/links/:linkId', ...schoolAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE parent_students SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND school_id = $2 AND status = 'active' RETURNING id`,
      [req.params.linkId, req.user.schoolId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Link not found.' });
    res.json({ success: true, message: 'Parent access removed.' });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Could not remove access.' });
  }
});

module.exports = router;
