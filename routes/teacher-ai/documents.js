// ─────────────────────────────────────────────────────────────
// routes/teacher-ai/documents.js
//
// One router *factory* shared by Scheme of Work, Lesson Plan and
// Lesson Note — per addendum §1.4, all three "should be built on the
// identical shape already proven by Lesson Note ... rather than a
// bespoke flow each". The three only differ in which extra columns
// they carry, so that's the one thing the factory takes as config.
//
// Mounted (see index.js) at:
//   /api/teacher-ai/scheme-of-work
//   /api/teacher-ai/lesson-plans
//   /api/teacher-ai/lesson-notes
// ─────────────────────────────────────────────────────────────
const express = require('express');
const authMiddleware = require('../../middleware/auth');
const checkSubscription = require('../../middleware/checkSubscription');
const { auditRoute } = require('../../middleware/auditLog');
const { pool, ensureTeacherAiTables, getTeacherIdentity, isSameTeacher } = require('./db');

// ── camelCase <-> snake_case helpers (request bodies are camelCase,
//    matching the rest of the client-facing API; columns are snake_case) ──
const toSnake = (s) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function rowToCamel(row) {
  if (!row) return row;
  const out = {};
  for (const key of Object.keys(row)) out[toCamel(key)] = row[key];
  return out;
}

// Fields every one of the three document types shares, on top of its
// own extraColumns. subjectId/classId/term/session are how a document
// gets "saved under a class" per addendum §1.4's closing note — a
// teacher filters/searches by class to find it again.
const COMMON_EDITABLE_FIELDS = ['subjectId', 'classId', 'term', 'session', 'title'];

const DOC_TYPES = {
  'scheme-of-work': {
    table: 'ai_scheme_of_work',
    label: 'Scheme of Work',
    contentType: 'scheme_of_work',
    extraFields: ['weeks'],
    jsonFields: new Set(['weeks']),
    defaultTitle: (b) => `Scheme of Work${b.term ? ' — ' + b.term : ''}`,
  },
  'lesson-plans': {
    table: 'ai_lesson_plans',
    label: 'Lesson Plan',
    contentType: 'lesson_plan',
    extraFields: ['topic', 'duration', 'objectives', 'materials', 'teacherActivities', 'studentActivities', 'evaluation'],
    jsonFields: new Set(),
    defaultTitle: (b) => b.topic || 'Untitled Lesson Plan',
  },
  'lesson-notes': {
    table: 'ai_lesson_notes',
    label: 'Lesson Note',
    contentType: 'lesson_note',
    extraFields: ['topic', 'objectives', 'teacherActivities', 'studentActivities', 'assessment'],
    jsonFields: new Set(),
    defaultTitle: (b) => b.topic || 'Untitled Lesson Note',
  },
};

function buildDocumentsRouter(typeKey) {
  const config = DOC_TYPES[typeKey];
  if (!config) throw new Error(`[teacher-ai] Unknown document type: ${typeKey}`);

  const router = express.Router();
  const editableFields = [...COMMON_EDITABLE_FIELDS, ...config.extraFields];

  router.use(authMiddleware.authenticateToken, authMiddleware.requireSchool, checkSubscription);
  router.use(async (req, res, next) => {
    try {
      await ensureTeacherAiTables();
      next();
    } catch (err) {
      console.error(`❌ [teacher-ai/${typeKey}] Failed to ensure tables:`, err.message);
      res.status(500).json({ success: false, error: 'Server initialization error.' });
    }
  });

  // ── GET / — the authenting teacher's own documents (draft + approved) ──
  // Query filters double as the "search/click a class to see what's
  // saved under it" browsing pattern from addendum §1.4.
  router.get('/', async (req, res) => {
    try {
      const identity = getTeacherIdentity(req);
      const { subjectId, classId, term, session, status } = req.query;

      const conditions = ['school_id = $1', 'teacher_type = $2', 'teacher_id = $3'];
      const params = [req.user.schoolId, identity.type, identity.id];

      if (subjectId) { params.push(subjectId); conditions.push(`subject_id = $${params.length}`); }
      if (classId) { params.push(classId); conditions.push(`class_id = $${params.length}`); }
      if (term) { params.push(term); conditions.push(`term = $${params.length}`); }
      if (session) { params.push(session); conditions.push(`session = $${params.length}`); }
      if (status) { params.push(status); conditions.push(`status = $${params.length}`); }

      const result = await pool.query(
        `SELECT * FROM ${config.table} WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`,
        params
      );

      res.json({ success: true, data: result.rows.map(rowToCamel), count: result.rowCount });
    } catch (error) {
      console.error(`[teacher-ai/${typeKey}] list error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch documents.' });
    }
  });

  // ── GET /admin/approved — Admin oversight (addendum §1.5): "Once
  //    Approved ... becomes visible to Admin under Academics, read-only."
  //    Any authenticated school-side user can call this (owner or staff);
  //    it never exposes another teacher's drafts, only approved work. ──
  router.get('/admin/approved', async (req, res) => {
    try {
      const { subjectId, classId, term, session } = req.query;
      const conditions = ['school_id = $1', "status = 'approved'"];
      const params = [req.user.schoolId];

      if (subjectId) { params.push(subjectId); conditions.push(`subject_id = $${params.length}`); }
      if (classId) { params.push(classId); conditions.push(`class_id = $${params.length}`); }
      if (term) { params.push(term); conditions.push(`term = $${params.length}`); }
      if (session) { params.push(session); conditions.push(`session = $${params.length}`); }

      const result = await pool.query(
        `SELECT * FROM ${config.table} WHERE ${conditions.join(' AND ')} ORDER BY approved_at DESC`,
        params
      );

      res.json({ success: true, data: result.rows.map(rowToCamel), count: result.rowCount });
    } catch (error) {
      console.error(`[teacher-ai/${typeKey}] admin list error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch documents.' });
    }
  });

  // ── GET /:id — single document. Owner sees draft or approved; anyone
  //    else at the school only sees it once Approved (oversight, §1.5). ──
  router.get('/:id', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM ${config.table} WHERE id = $1 AND school_id = $2`,
        [req.params.id, req.user.schoolId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: `${config.label} not found.` });
      }
      const row = result.rows[0];
      const identity = getTeacherIdentity(req);
      if (!isSameTeacher(identity, row) && row.status !== 'approved') {
        return res.status(403).json({
          success: false,
          error: 'This document is still a draft and is only visible to the teacher who created it.',
        });
      }
      res.json({ success: true, data: rowToCamel(row) });
    } catch (error) {
      console.error(`[teacher-ai/${typeKey}] get error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch document.' });
    }
  });

  // ── POST / — create a new Draft. Either a blank manual document, or
  //    the "Copy to Editor" landing spot for AI-generated content — the
  //    client sends createdVia: 'ai' + aiProvenance in the latter case. ──
  router.post(
    '/',
    auditRoute(`${config.contentType}.created`, (req, body) => ({
      type: config.contentType,
      id: body?.data?.id,
    })),
    async (req, res) => {
      try {
        const identity = getTeacherIdentity(req);
        const body = req.body || {};

        const columns = ['school_id', 'teacher_type', 'teacher_id', 'teacher_name'];
        const values = [req.user.schoolId, identity.type, identity.id, identity.name];

        for (const field of editableFields) {
          columns.push(toSnake(field));
          let value = body[field] ?? (config.jsonFields.has(field) ? [] : null);
          values.push(config.jsonFields.has(field) ? JSON.stringify(value) : value);
        }

        if (!body.title) {
          const titleIndex = columns.indexOf('title');
          if (titleIndex !== -1) values[titleIndex] = config.defaultTitle(body);
        }

        const createdVia = body.createdVia === 'ai' ? 'ai' : 'manual';
        columns.push('created_via');
        values.push(createdVia);

        columns.push('ai_provenance');
        values.push(body.aiProvenance ? JSON.stringify(body.aiProvenance) : null);

        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const result = await pool.query(
          `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
          values
        );

        res.status(201).json({ success: true, data: rowToCamel(result.rows[0]) });
      } catch (error) {
        console.error(`[teacher-ai/${typeKey}] create error:`, error.message);
        res.status(500).json({ success: false, error: `Failed to create ${config.label.toLowerCase()}.` });
      }
    }
  );

  // ── PUT /:id — edit while Draft. Only the owning teacher, and only
  //    before approval — once Approved a document is locked (§1.5). ──
  router.put('/:id', async (req, res) => {
    try {
      const existing = await pool.query(
        `SELECT * FROM ${config.table} WHERE id = $1 AND school_id = $2`,
        [req.params.id, req.user.schoolId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, error: `${config.label} not found.` });
      }
      const row = existing.rows[0];
      const identity = getTeacherIdentity(req);
      if (!isSameTeacher(identity, row)) {
        return res.status(403).json({ success: false, error: 'You can only edit your own documents.' });
      }
      if (row.status === 'approved') {
        return res.status(409).json({
          success: false,
          error: 'This document has already been approved and can no longer be edited.',
        });
      }

      const body = req.body || {};
      const setClauses = [];
      const values = [];
      for (const field of editableFields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          values.push(config.jsonFields.has(field) ? JSON.stringify(body[field]) : body[field]);
          setClauses.push(`${toSnake(field)} = $${values.length}`);
        }
      }
      if (setClauses.length === 0) {
        return res.status(400).json({ success: false, error: 'No editable fields provided.' });
      }
      setClauses.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.params.id);

      const result = await pool.query(
        `UPDATE ${config.table} SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );

      res.json({ success: true, data: rowToCamel(result.rows[0]) });
    } catch (error) {
      console.error(`[teacher-ai/${typeKey}] update error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to update document.' });
    }
  });

  // ── POST /:id/approve — the one and only path to Approved (§1.5). ──
  router.post(
    '/:id/approve',
    auditRoute(`${config.contentType}.approved`, (req) => ({ type: config.contentType, id: req.params.id })),
    async (req, res) => {
      try {
        const existing = await pool.query(
          `SELECT * FROM ${config.table} WHERE id = $1 AND school_id = $2`,
          [req.params.id, req.user.schoolId]
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ success: false, error: `${config.label} not found.` });
        }
        const row = existing.rows[0];
        const identity = getTeacherIdentity(req);
        if (!isSameTeacher(identity, row)) {
          return res.status(403).json({ success: false, error: 'You can only approve your own documents.' });
        }
        if (row.status === 'approved') {
          return res.status(409).json({ success: false, error: 'This document is already approved.' });
        }

        const result = await pool.query(
          `UPDATE ${config.table}
           SET status = 'approved', approved_at = CURRENT_TIMESTAMP,
               approved_by_type = $1, approved_by_id = $2, approved_by_name = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 RETURNING *`,
          [identity.type, identity.id, identity.name, req.params.id]
        );

        res.json({ success: true, data: rowToCamel(result.rows[0]) });
      } catch (error) {
        console.error(`[teacher-ai/${typeKey}] approve error:`, error.message);
        res.status(500).json({ success: false, error: 'Failed to approve document.' });
      }
    }
  );

  // ── DELETE /:id — draft cleanup only. Approved documents are kept for
  //    the Admin oversight trail and are never deletable via this route. ──
  router.delete(
    '/:id',
    auditRoute(`${config.contentType}.deleted`, (req) => ({ type: config.contentType, id: req.params.id })),
    async (req, res) => {
      try {
        const existing = await pool.query(
          `SELECT * FROM ${config.table} WHERE id = $1 AND school_id = $2`,
          [req.params.id, req.user.schoolId]
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ success: false, error: `${config.label} not found.` });
        }
        const row = existing.rows[0];
        const identity = getTeacherIdentity(req);
        if (!isSameTeacher(identity, row)) {
          return res.status(403).json({ success: false, error: 'You can only delete your own documents.' });
        }
        if (row.status === 'approved') {
          return res.status(409).json({ success: false, error: 'Approved documents cannot be deleted.' });
        }

        await pool.query(`DELETE FROM ${config.table} WHERE id = $1`, [req.params.id]);
        res.json({ success: true, data: { id: Number(req.params.id) } });
      } catch (error) {
        console.error(`[teacher-ai/${typeKey}] delete error:`, error.message);
        res.status(500).json({ success: false, error: 'Failed to delete document.' });
      }
    }
  );

  return router;
}

module.exports = { buildDocumentsRouter, DOC_TYPES };
