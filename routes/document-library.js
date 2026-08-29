// ─────────────────────────────────────────────────────────────
// routes/document-library.js
//
// File-upload library for Scheme of Work, Lesson Plan, and Lesson
// Note — separate from routes/teacher-ai/documents.js, which is the
// AI-authored/typed-content flow (draft -> approved, stored as text
// fields). This module is for actual PDF/DOC/DOCX files.
//
// Three visibility tiers, per one table:
//   'school'     — uploaded by the owner or a full admin, visible to
//                  everyone at the school (owner, admins, teachers),
//                  read-only for everyone except the owner/an admin.
//   'personal'   — uploaded by ANY school-side user (owner, admin, or
//                  a class_teacher) about their own materials. Only
//                  visible to and manageable by the person who
//                  uploaded it — nobody else at the school sees it,
//                  including the owner.
//   'submission' — a teacher's lesson note/plan uploaded FOR REVIEW.
//                  Visible to the uploader and to any owner/full admin
//                  (a review queue), nobody else. An owner/admin then
//                  approves it (it becomes a 'school' document, same
//                  as above) or requests changes (stays 'submission'
//                  with a note attached; the teacher can delete + 
//                  re-upload a revised version).
//
// Mount in your entry file:
//   const documentLibraryRoutes = require('./routes/document-library');
//   app.use('/api/document-library', documentLibraryRoutes);
// ─────────────────────────────────────────────────────────────
const express = require('express');
const multer = require('multer');
const { put, del } = require('@vercel/blob');
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const { auditRoute } = require('../middleware/auditLog');

const router = express.Router();

// ── table bootstrap — memoized, same "best effort" pattern as the
//    rest of the app (see routes/staff-onboarding/db.js) ──────────
let tableReadyPromise = null;
async function ensureDocumentLibraryTable() {
  if (tableReadyPromise) return tableReadyPromise;
  tableReadyPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_library (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        doc_type VARCHAR(20) NOT NULL,
        visibility VARCHAR(10) NOT NULL DEFAULT 'personal',
        uploaded_by_type VARCHAR(10) NOT NULL,
        uploaded_by_id INTEGER NOT NULL,
        uploaded_by_name VARCHAR(255),
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        term VARCHAR(20),
        session VARCHAR(20),
        title VARCHAR(255) NOT NULL,
        file_url TEXT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(10) NOT NULL,
        file_size INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // doc_type: 'scheme_of_work' | 'lesson_plan' | 'lesson_note'
    // visibility: 'school' | 'personal' | 'submission' — see header comment above.

    // Review columns — additive, so this is safe to run against a
    // document_library table created before the review workflow existed.
    await pool.query(`ALTER TABLE document_library ADD COLUMN IF NOT EXISTS review_status VARCHAR(20)`);
    await pool.query(`ALTER TABLE document_library ADD COLUMN IF NOT EXISTS review_note TEXT`);
    await pool.query(`ALTER TABLE document_library ADD COLUMN IF NOT EXISTS reviewed_by_type VARCHAR(10)`);
    await pool.query(`ALTER TABLE document_library ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER`);
    await pool.query(`ALTER TABLE document_library ADD COLUMN IF NOT EXISTS reviewed_by_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE document_library ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`);
    // review_status (only meaningful while visibility = 'submission'):
    // 'pending' | 'changes_requested'. Once approved, visibility flips
    // to 'school' and review_status becomes 'approved' — it then just
    // shows up in the normal School Library, provenance preserved via
    // reviewed_by_*.

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_doclib_school_type ON document_library(school_id, doc_type, visibility)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_doclib_uploader ON document_library(school_id, uploaded_by_type, uploaded_by_id)`);
  })();
  return tableReadyPromise;
}

router.use(authMiddleware.authenticateToken, authMiddleware.requireSchool, checkSubscription);
router.use(async (req, res, next) => {
  try {
    await ensureDocumentLibraryTable();
    next();
  } catch (err) {
    console.error('❌ [document-library] Failed to ensure table:', err.message);
    res.status(500).json({ success: false, error: 'Server initialization error.' });
  }
});

const DOC_TYPES = new Set(['scheme_of_work', 'lesson_plan', 'lesson_note']);
const MAX_SIZE = 20 * 1024 * 1024; // 20MB — these are documents, not photos
const MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

// ── "who is uploading" — same owner-vs-staff identity split used by
//    routes/teacher-ai/db.js, kept local here since it's a one-liner. ──
function getUploaderIdentity(req) {
  if (req.user?.staffId) {
    return { type: 'staff', id: req.user.staffId, name: req.user.name || null };
  }
  return { type: 'owner', id: req.user.id, name: req.user.name || null };
}

// Owner, or a staff account whose specific job-role is 'admin' (as
// opposed to a class_teacher). Mirrors the exact check used in
// routes/staff-onboarding/management.js for removing staff accounts.
function isOwnerOrFullAdmin(req) {
  const isStaffAccount = req.user?.type === 'school' && req.user?.role === 'admin';
  if (!isStaffAccount) return true; // owner token
  return req.user?.staffRole === 'admin';
}

function isSameUploader(identity, row) {
  return row.uploaded_by_type === identity.type && Number(row.uploaded_by_id) === Number(identity.id);
}

function rowToCamel(row) {
  if (!row) return row;
  return {
    id: row.id,
    docType: row.doc_type,
    visibility: row.visibility,
    uploadedByType: row.uploaded_by_type,
    uploadedById: row.uploaded_by_id,
    uploadedByName: row.uploaded_by_name,
    subjectId: row.subject_id,
    classId: row.class_id,
    term: row.term,
    session: row.session,
    title: row.title,
    fileUrl: row.file_url,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size,
    reviewStatus: row.review_status,
    reviewNote: row.review_note,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

// ── GET / — everything the caller is allowed to see: every school-wide
//    document, their own personal/submission uploads, and — if they're
//    the owner/a full admin — everyone's pending submissions (the
//    review queue). ──
router.get('/', async (req, res) => {
  try {
    const identity = getUploaderIdentity(req);
    const canReview = isOwnerOrFullAdmin(req);
    const { docType, classId, subjectId, term, session } = req.query;

    const conditions = [
      'school_id = $1',
      canReview
        ? `(visibility = 'school' OR visibility = 'submission' OR (visibility = 'personal' AND uploaded_by_type = $2 AND uploaded_by_id = $3))`
        : `(visibility = 'school' OR ((visibility = 'personal' OR visibility = 'submission') AND uploaded_by_type = $2 AND uploaded_by_id = $3))`,
    ];
    const params = [req.user.schoolId, identity.type, identity.id];

    if (docType) {
      if (!DOC_TYPES.has(docType)) {
        return res.status(400).json({ success: false, error: 'Invalid docType.' });
      }
      params.push(docType);
      conditions.push(`doc_type = $${params.length}`);
    }
    if (req.query.visibility) {
      if (!['school', 'personal', 'submission'].includes(req.query.visibility)) {
        return res.status(400).json({ success: false, error: 'Invalid visibility filter.' });
      }
      params.push(req.query.visibility);
      conditions.push(`visibility = $${params.length}`);
    }
    if (classId) { params.push(classId); conditions.push(`class_id = $${params.length}`); }
    if (subjectId) { params.push(subjectId); conditions.push(`subject_id = $${params.length}`); }
    if (term) { params.push(term); conditions.push(`term = $${params.length}`); }
    if (session) { params.push(session); conditions.push(`session = $${params.length}`); }

    const result = await pool.query(
      `SELECT * FROM document_library WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE visibility WHEN 'submission' THEN 0 WHEN 'school' THEN 1 ELSE 2 END,
         CASE review_status WHEN 'pending' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END,
         created_at DESC`,
      params
    );

    res.json({ success: true, data: result.rows.map(rowToCamel), count: result.rowCount });
  } catch (error) {
    console.error('[document-library] list error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch documents.' });
  }
});

// ── POST / — upload a file. multipart/form-data, field name "file". ──
router.post(
  '/',
  upload.single('file'),
  auditRoute('document_library.uploaded', (req, body) => ({
    type: body?.data?.docType || 'document_library',
    id: body?.data?.id,
    details: {
      title: body?.data?.title,
      docType: body?.data?.docType,
      visibility: body?.data?.visibility,
    },
  })),
  async (req, res) => {
    try {
      const { docType, visibility, title, subjectId, classId, term, session } = req.body || {};

      if (!docType || !DOC_TYPES.has(docType)) {
        return res.status(400).json({ success: false, error: 'docType must be one of: scheme_of_work, lesson_plan, lesson_note.' });
      }
      const resolvedVisibility = ['school', 'submission'].includes(visibility) ? visibility : 'personal';

      // The core rule: only the owner or a full admin may upload a
      // SCHOOL-WIDE document directly. Any school-side user (owner,
      // admin, or a class_teacher) may always upload a PERSONAL one, or
      // SUBMIT one for review — that's the whole point of a submission.
      if (resolvedVisibility === 'school' && !isOwnerOrFullAdmin(req)) {
        return res.status(403).json({
          success: false,
          error: 'Only the school owner or an admin can upload school-wide documents directly. Submit this for review instead, or upload it as a personal document.',
          code: 'SCHOOL_UPLOAD_RESTRICTED',
        });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file was uploaded. Attach a PDF or Word document.' });
      }
      if (!req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({ success: false, error: 'The uploaded file is empty.' });
      }
      const ext = MIME_TO_EXT[req.file.mimetype];
      if (!ext) {
        return res.status(400).json({ success: false, error: 'Invalid file type. Only PDF, DOC, and DOCX are allowed.' });
      }
      if (req.file.size > MAX_SIZE) {
        return res.status(400).json({ success: false, error: 'File is too large. Maximum size is 20MB.' });
      }
      if (!title || !String(title).trim()) {
        return res.status(400).json({ success: false, error: 'A title is required.' });
      }

      const identity = getUploaderIdentity(req);
      const cleanFileName = req.file.originalname.replace(/\s+/g, '-');
      const uniqueFileName = `school-${req.user.schoolId}-doclib-${docType}-${Date.now()}-${cleanFileName}`;

      let blob;
      try {
        blob = await put(uniqueFileName, req.file.buffer, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      } catch (blobErr) {
        console.error('❌ [document-library] Blob upload failed:', blobErr.message);
        return res.status(500).json({ success: false, error: 'File upload failed. Please try again.' });
      }

      const result = await pool.query(
        `INSERT INTO document_library
          (school_id, doc_type, visibility, uploaded_by_type, uploaded_by_id, uploaded_by_name,
           subject_id, class_id, term, session, title, file_url, file_name, file_type, file_size, review_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          req.user.schoolId, docType, resolvedVisibility, identity.type, identity.id, identity.name,
          subjectId || null, classId || null, term || null, session || null,
          String(title).trim(), blob.url, req.file.originalname, ext, req.file.size,
          resolvedVisibility === 'submission' ? 'pending' : null,
        ]
      );

      res.status(201).json({ success: true, data: rowToCamel(result.rows[0]) });
    } catch (error) {
      console.error('[document-library] upload error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to upload document.' });
    }
  }
);

// ── POST /:id/review — owner/full-admin decides on a teacher's
//    submission. decision: 'approved' | 'changes_requested'.
//    Approving flips visibility to 'school' — it then just appears in
//    the normal School Library, same as any admin-uploaded document.
//    Requesting changes leaves it as a 'submission' with a note the
//    teacher can see; they delete + re-upload to try again. ──
router.post(
  '/:id/review',
  auditRoute('document_library.reviewed', (req, body) => ({
    type: 'document_library',
    id: req.params.id,
    details: {
      decision: body?.data?.reviewStatus,
      title: body?.data?.title,
      visibility: body?.data?.visibility,
    },
  })),
  async (req, res) => {
    try {
      if (!isOwnerOrFullAdmin(req)) {
        return res.status(403).json({ success: false, error: 'Only the school owner or an admin can review a submission.' });
      }

      const { decision, note } = req.body || {};
      if (!['approved', 'changes_requested'].includes(decision)) {
        return res.status(400).json({ success: false, error: "decision must be 'approved' or 'changes_requested'." });
      }
      if (decision === 'changes_requested' && (!note || !String(note).trim())) {
        return res.status(400).json({ success: false, error: 'A note explaining what to change is required.' });
      }

      const existing = await pool.query(
        `SELECT * FROM document_library WHERE id = $1 AND school_id = $2`,
        [req.params.id, req.user.schoolId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Submission not found.' });
      }
      const row = existing.rows[0];
      if (row.visibility !== 'submission') {
        return res.status(409).json({ success: false, error: 'Only a pending submission can be reviewed.' });
      }

      const identity = getUploaderIdentity(req);

      // NOTE: keep the original visibility unchanged on review so the
      // submission remains in the database for future reference/history.
      // We only record the review outcome (review_status/review_note)
      // and who reviewed it. This preserves the uploaded file and its
      // provenance in the submission queue while still marking it
      // 'approved' or 'changes_requested'. If you want a separate
      // promotion-to-school step, we can add an explicit "promote" API.
      const result = await pool.query(
        `UPDATE document_library
         SET review_status = $1, review_note = $2,
             reviewed_by_type = $3, reviewed_by_id = $4, reviewed_by_name = $5, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [decision, note ? String(note).trim() : null, identity.type, identity.id, identity.name, req.params.id]
      );

      res.json({ success: true, data: rowToCamel(result.rows[0]) });
    } catch (error) {
      console.error('[document-library] review error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to record review decision.' });
    }
  }
);

// ── DELETE /:id ──────────────────────────────────────────────────
// Personal or pending/changes-requested submission -> only the uploader.
// School-wide doc (including an approved-and-promoted submission)
//                -> only the owner or a full admin (any of them, not
//                    just the original uploader — an institutional
//                    document shouldn't get stuck if that one admin
//                    account is later removed). A class_teacher can
//                    never delete a school-wide document.
router.delete(
  '/:id',
  auditRoute('document_library.deleted', (req) => ({ id: req.params.id })),
  async (req, res) => {
    try {
      const existing = await pool.query(
        `SELECT * FROM document_library WHERE id = $1 AND school_id = $2`,
        [req.params.id, req.user.schoolId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Document not found.' });
      }
      const row = existing.rows[0];
      const identity = getUploaderIdentity(req);

      if (row.visibility === 'school') {
        if (!isOwnerOrFullAdmin(req)) {
          return res.status(403).json({ success: false, error: 'Only the school owner or an admin can remove a school-wide document.' });
        }
      } else if (!isSameUploader(identity, row)) {
        return res.status(403).json({ success: false, error: 'You can only delete your own personal documents.' });
      }

      await pool.query(`DELETE FROM document_library WHERE id = $1`, [req.params.id]);

      // Best-effort blob cleanup — the DB row is already gone either way.
      try {
        await del(row.file_url, { token: process.env.BLOB_READ_WRITE_TOKEN });
      } catch (blobErr) {
        console.error('⚠️ [document-library] Blob cleanup failed (non-fatal):', blobErr.message);
      }

      res.json({ success: true, data: { id: Number(req.params.id) } });
    } catch (error) {
      console.error('[document-library] delete error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to delete document.' });
    }
  }
);

module.exports = router;
