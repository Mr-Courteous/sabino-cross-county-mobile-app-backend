const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const authMiddleware = require('../middleware/auth');
require('dotenv').config();




router.use(authMiddleware.authenticateToken);

/**
 * @route   GET /api/subjects/search
 * @desc    Search the global subject library by keyword
 * @access  Private (Authenticated users only)
 */
router.get('/search', async (req, res) => {
  try {
    const { keyword } = req.query;

    // Shared library (school_id IS NULL) plus this school's own subjects.
    let query = `
      SELECT id, subject_name as name, category, education_level, (school_id IS NOT NULL) AS is_custom
      FROM global_subjects
      WHERE (school_id IS NULL OR school_id = $1)
    `;
    const params = [req.user?.schoolId || null];

    if (keyword && keyword.trim()) {
      query += ` AND subject_name ILIKE $2`;
      params.push(`%${keyword.trim()}%`);
    }

    query += ` ORDER BY subject_name ASC LIMIT 50`;

    const result = await pool.query(query, params);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Subject Search Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * School-owned subjects. They are stored beside the shared library
 * (global_subjects.school_id = this school) so every existing join and
 * report keeps working, but only this school can see or use them.
 *
 *   GET    /api/subjects/school        this school's own subjects
 *   POST   /api/subjects/school        { name, category?, educationLevel? }
 *   PUT    /api/subjects/school/:id    { name?, category?, educationLevel? }
 *   DELETE /api/subjects/school/:id    409 if any scores already use it
 */
const requireSubjectEditor = (req, res, next) => {
  if (req.user?.type !== 'school') {
    return res.status(403).json({ success: false, error: 'School accounts only.' });
  }
  if (req.user?.staffRole === 'class_teacher' || req.user?.staffRole === 'subject_teacher') {
    return res.status(403).json({ success: false, error: 'Only the school owner or an admin can manage subjects.' });
  }
  next();
};
const cleanText = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

router.get('/school', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, subject_name AS name, category, education_level
         FROM global_subjects WHERE school_id = $1 ORDER BY subject_name ASC`,
      [req.user?.schoolId]
    );
    res.json({ success: true, data: result.rows, count: result.rowCount });
  } catch (error) {
    console.error('❌ School Subjects Error:', error);
    res.status(500).json({ success: false, error: 'Failed to load subjects.' });
  }
});

router.post('/school', requireSubjectEditor, async (req, res) => {
  try {
    const name = cleanText(req.body?.name, 100);
    if (!name) return res.status(400).json({ success: false, error: 'Subject name is required.' });
    const schoolId = req.user.schoolId;

    // Don't let a school shadow a shared-library subject with the same name.
    const clash = await pool.query(
      `SELECT id, school_id FROM global_subjects
        WHERE LOWER(subject_name) = LOWER($1) AND (school_id IS NULL OR school_id = $2) LIMIT 1`,
      [name, schoolId]
    );
    if (clash.rows.length) {
      return res.status(409).json({
        success: false,
        error: clash.rows[0].school_id ? `You already added "${name}".` : `"${name}" already exists in the subject library - pick it from the list instead.`,
        existingId: clash.rows[0].id,
      });
    }
    const result = await pool.query(
      `INSERT INTO global_subjects (subject_name, category, education_level, school_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, subject_name AS name, category, education_level`,
      [name, cleanText(req.body?.category, 50) || null, cleanText(req.body?.educationLevel, 50) || null, schoolId, req.user.id || req.user.staffId || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'That subject already exists.' });
    }
    console.error('❌ Create Subject Error:', error);
    res.status(500).json({ success: false, error: 'Failed to create subject.' });
  }
});

router.put('/school/:id', requireSubjectEditor, async (req, res) => {
  try {
    const sets = []; const params = [];
    if (req.body?.name !== undefined) {
      const name = cleanText(req.body.name, 100);
      if (!name) return res.status(400).json({ success: false, error: 'Subject name cannot be empty.' });
      params.push(name); sets.push(`subject_name = $${params.length}`);
    }
    if (req.body?.category !== undefined) { params.push(cleanText(req.body.category, 50) || null); sets.push(`category = $${params.length}`); }
    if (req.body?.educationLevel !== undefined) { params.push(cleanText(req.body.educationLevel, 50) || null); sets.push(`education_level = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update.' });
    params.push(req.params.id, req.user.schoolId);
    const result = await pool.query(
      `UPDATE global_subjects SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND school_id = $${params.length}
        RETURNING id, subject_name AS name, category, education_level`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Subject not found (shared library subjects cannot be edited).' });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, error: 'Another of your subjects already has that name.' });
    console.error('❌ Update Subject Error:', error);
    res.status(500).json({ success: false, error: 'Failed to update subject.' });
  }
});

router.delete('/school/:id', requireSubjectEditor, async (req, res) => {
  try {
    const used = await pool.query('SELECT COUNT(*)::int AS n FROM scores WHERE subject_id = $1 AND school_id = $2', [req.params.id, req.user.schoolId]);
    if (used.rows[0].n > 0) {
      return res.status(409).json({
        success: false,
        error: `${used.rows[0].n} score record(s) use this subject, so it can't be deleted. Rename it instead.`,
        code: 'SUBJECT_IN_USE',
      });
    }
    const result = await pool.query('DELETE FROM global_subjects WHERE id = $1 AND school_id = $2 RETURNING id', [req.params.id, req.user.schoolId]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Subject not found.' });
    res.json({ success: true, message: 'Subject deleted.' });
  } catch (error) {
    console.error('❌ Delete Subject Error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete subject.' });
  }
});

module.exports=router;