const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');

/**
 * Mount in your server entry file:
 *   app.use('/api/academic-structure', require('./routes/academic-structure'));
 *
 *   GET    /arms?classId=            list arms (optionally for one class)
 *   POST   /arms                     { classId, armName }
 *   PUT    /arms/:id                 { armName }
 *   DELETE /arms/:id?force=true      409 while students are in the arm unless force=true
 *   PUT    /enrollments/:id/arm      { armId | null }   put a student in / out of an arm
 *   GET    /assignments?staffId=&classId=&subjectId=
 *   POST   /assignments              { staffId, subjectId, classId, armId? }
 *   DELETE /assignments/:id
 *
 * Classes themselves are managed in routes/classes.js
 * (POST/PUT/DELETE /api/classes/school), and school-owned subjects in
 * routes/subjects.js (/api/subjects/school).
 */
router.use(authMiddleware.authenticateToken);
router.use(authMiddleware.requireSchool);

const requireEditor = (req, res, next) => {
  if (req.user?.staffRole === 'class_teacher' || req.user?.staffRole === 'subject_teacher') {
    return res.status(403).json({
      success: false,
      error: 'Only the school owner or an admin can change the academic structure.',
      code: 'STRUCTURE_EDIT_FORBIDDEN',
    });
  }
  next();
};

const cleanName = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// ── Arms ────────────────────────────────────────────────────────────────
router.get('/arms', async (req, res) => {
  try {
    const params = [req.user.schoolId];
    let where = 'a.school_id = $1';
    if (req.query.classId) { params.push(Number(req.query.classId)); where += ` AND a.class_id = $${params.length}`; }
    const r = await pool.query(
      `SELECT a.id, a.class_id, c.class_name, a.arm_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.arm_id = a.id AND e.status = 'active')::int AS student_count
         FROM class_arms a JOIN classes c ON c.id = a.class_id
        WHERE ${where}
        ORDER BY c.class_name ASC, a.arm_name ASC`,
      params
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  } catch (error) {
    console.error('❌ [academic-structure] list arms:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load class arms.' });
  }
});

router.post('/arms', requireEditor, checkSubscription, async (req, res) => {
  try {
    const classId = Number(req.body?.classId);
    const armName = cleanName(req.body?.armName, 30);
    if (!classId || !armName) {
      return res.status(400).json({ success: false, error: 'classId and armName are required.' });
    }
    const cls = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND school_id = $2 AND archived_at IS NULL',
      [classId, req.user.schoolId]
    );
    if (cls.rows.length === 0) return res.status(404).json({ success: false, error: 'Class not found.' });

    const r = await pool.query(
      `INSERT INTO class_arms (school_id, class_id, arm_name) VALUES ($1, $2, $3)
       ON CONFLICT (class_id, arm_name) DO NOTHING
       RETURNING id, class_id, arm_name`,
      [req.user.schoolId, classId, armName]
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ success: false, error: `Arm "${armName}" already exists in this class.` });
    }
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (error) {
    console.error('❌ [academic-structure] create arm:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create class arm.' });
  }
});

router.put('/arms/:id', requireEditor, checkSubscription, async (req, res) => {
  try {
    const armName = cleanName(req.body?.armName, 30);
    if (!armName) return res.status(400).json({ success: false, error: 'armName is required.' });
    const r = await pool.query(
      `UPDATE class_arms SET arm_name = $1 WHERE id = $2 AND school_id = $3 RETURNING id, class_id, arm_name`,
      [armName, req.params.id, req.user.schoolId]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Arm not found.' });
    res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Another arm in this class already has that name.' });
    }
    console.error('❌ [academic-structure] rename arm:', error.message);
    res.status(500).json({ success: false, error: 'Failed to rename class arm.' });
  }
});

router.delete('/arms/:id', requireEditor, checkSubscription, async (req, res) => {
  try {
    const inUse = await pool.query(
      `SELECT COUNT(*)::int AS n FROM enrollments e
        WHERE e.arm_id = $1 AND e.school_id = $2 AND e.status = 'active'`,
      [req.params.id, req.user.schoolId]
    );
    if (inUse.rows[0].n > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        success: false,
        error: `${inUse.rows[0].n} student(s) are in this arm. They will stay in the class but lose the arm.`,
        code: 'ARM_IN_USE',
        studentCount: inUse.rows[0].n,
      });
    }
    const r = await pool.query('DELETE FROM class_arms WHERE id = $1 AND school_id = $2 RETURNING id', [req.params.id, req.user.schoolId]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Arm not found.' });
    res.json({ success: true, message: 'Arm removed.' });
  } catch (error) {
    console.error('❌ [academic-structure] delete arm:', error.message);
    res.status(500).json({ success: false, error: 'Failed to remove class arm.' });
  }
});

router.put('/enrollments/:id/arm', requireEditor, checkSubscription, async (req, res) => {
  try {
    const armId = req.body?.armId === null || req.body?.armId === undefined ? null : Number(req.body.armId);
    const enr = await pool.query('SELECT id, class_id FROM enrollments WHERE id = $1 AND school_id = $2', [req.params.id, req.user.schoolId]);
    if (enr.rows.length === 0) return res.status(404).json({ success: false, error: 'Enrollment not found.' });
    if (armId !== null) {
      const arm = await pool.query('SELECT id FROM class_arms WHERE id = $1 AND school_id = $2 AND class_id = $3', [armId, req.user.schoolId, enr.rows[0].class_id]);
      if (arm.rows.length === 0) {
        return res.status(400).json({ success: false, error: 'That arm does not belong to the student\'s class.' });
      }
    }
    await pool.query('UPDATE enrollments SET arm_id = $1 WHERE id = $2', [armId, req.params.id]);
    res.json({ success: true, message: armId ? 'Student placed in arm.' : 'Student removed from arm.' });
  } catch (error) {
    console.error('❌ [academic-structure] set arm:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update the student\'s arm.' });
  }
});

// ── Teacher assignments ─────────────────────────────────────────────────
router.get('/assignments', async (req, res) => {
  try {
    const params = [req.user.schoolId];
    const where = ['t.school_id = $1'];
    for (const [q, col] of [['staffId', 't.staff_id'], ['classId', 't.class_id'], ['subjectId', 't.subject_id']]) {
      if (req.query[q]) { params.push(Number(req.query[q])); where.push(`${col} = $${params.length}`); }
    }
    const r = await pool.query(
      `SELECT t.id, t.staff_id, st.full_name AS staff_name, t.subject_id, g.subject_name,
              t.class_id, c.class_name, t.arm_id, a.arm_name
         FROM teacher_assignments t
         JOIN classes c ON c.id = t.class_id
         JOIN global_subjects g ON g.id = t.subject_id
         LEFT JOIN class_arms a ON a.id = t.arm_id
         LEFT JOIN staff st ON st.id = t.staff_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.class_name, g.subject_name`,
      params
    );
    res.json({ success: true, data: r.rows, count: r.rowCount });
  } catch (error) {
    if (error.code === '42P01') { // staff table not created yet
      return res.json({ success: true, data: [], count: 0 });
    }
    console.error('❌ [academic-structure] list assignments:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load teacher assignments.' });
  }
});

router.post('/assignments', requireEditor, checkSubscription, async (req, res) => {
  try {
    const staffId = Number(req.body?.staffId);
    const subjectId = Number(req.body?.subjectId);
    const classId = Number(req.body?.classId);
    const armId = req.body?.armId ? Number(req.body.armId) : null;
    if (!staffId || !subjectId || !classId) {
      return res.status(400).json({ success: false, error: 'staffId, subjectId and classId are required.' });
    }
    const schoolId = req.user.schoolId;

    const [staff, subject, cls] = await Promise.all([
      pool.query('SELECT id FROM staff WHERE id = $1 AND school_id = $2', [staffId, schoolId]),
      pool.query('SELECT id FROM global_subjects WHERE id = $1 AND (school_id IS NULL OR school_id = $2)', [subjectId, schoolId]),
      pool.query('SELECT id FROM classes WHERE id = $1 AND school_id = $2 AND archived_at IS NULL', [classId, schoolId]),
    ]);
    if (!staff.rows.length) return res.status(404).json({ success: false, error: 'Staff member not found.' });
    if (!subject.rows.length) return res.status(404).json({ success: false, error: 'Subject not found.' });
    if (!cls.rows.length) return res.status(404).json({ success: false, error: 'Class not found.' });
    if (armId) {
      const arm = await pool.query('SELECT id FROM class_arms WHERE id = $1 AND school_id = $2 AND class_id = $3', [armId, schoolId, classId]);
      if (!arm.rows.length) return res.status(400).json({ success: false, error: 'That arm does not belong to this class.' });
    }

    const r = await pool.query(
      `INSERT INTO teacher_assignments (school_id, staff_id, subject_id, class_id, arm_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [schoolId, staffId, subjectId, classId, armId]
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ success: false, error: 'This teacher is already assigned to that subject and class.' });
    }
    res.status(201).json({ success: true, data: { id: r.rows[0].id } });
  } catch (error) {
    console.error('❌ [academic-structure] create assignment:', error.message);
    res.status(500).json({ success: false, error: 'Failed to assign teacher.' });
  }
});

router.delete('/assignments/:id', requireEditor, checkSubscription, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM teacher_assignments WHERE id = $1 AND school_id = $2 RETURNING id', [req.params.id, req.user.schoolId]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Assignment not found.' });
    res.json({ success: true, message: 'Assignment removed.' });
  } catch (error) {
    console.error('❌ [academic-structure] delete assignment:', error.message);
    res.status(500).json({ success: false, error: 'Failed to remove assignment.' });
  }
});

module.exports = router;
