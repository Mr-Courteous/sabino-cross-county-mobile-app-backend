// ─────────────────────────────────────────────────────────────
// routes/teacher-ai/document-extract.js
//
// Turns a document_library row (an uploaded PDF/DOC/DOCX, see
// routes/document-library.js) into plain text Sabino AI can use as
// reference material — "generate a lesson plan grounded in this
// uploaded lesson note", etc.
//
// Groq's chat.completions endpoint (see chat.js) is text-only — no
// native PDF/vision input — so extraction has to happen here before
// the file's content can reach the model at all.
//
// Requires two extra dependencies not otherwise used by the app:
//   npm install pdf-parse mammoth
// ─────────────────────────────────────────────────────────────
const pool = require('../../database/db');

const MAX_REFERENCE_CHARS = 12000; // keeps the Groq prompt a sane size

/**
 * Loads a document_library row by id, enforcing the same visibility
 * rule GET /api/document-library uses: the caller can reference a
 * school-wide doc, their own personal/submission doc, or — if they're
 * the owner/a full admin — anyone's submission.
 */
async function loadReferenceRow(documentId, schoolId, identity, isOwnerOrFullAdminFlag) {
  const result = await pool.query(`SELECT * FROM document_library WHERE id = $1 AND school_id = $2`, [
    documentId,
    schoolId,
  ]);
  if (result.rows.length === 0) return { row: null, error: 'Reference document not found.' };

  const row = result.rows[0];
  const isMine = row.uploaded_by_type === identity.type && Number(row.uploaded_by_id) === Number(identity.id);
  const visible =
    row.visibility === 'school' ||
    isMine ||
    (row.visibility === 'submission' && isOwnerOrFullAdminFlag);

  if (!visible) return { row: null, error: 'You do not have access to that document.' };
  return { row, error: null };
}

async function extractTextFromRow(row) {
  const res = await fetch(row.file_url);
  if (!res.ok) {
    throw new Error(`Could not download the file (status ${res.status}).`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  if (row.file_type === 'pdf') {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    return parsed.text || '';
  }

  if (row.file_type === 'docx') {
    const mammoth = require('mammoth');
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value || '';
  }

  // Old binary .doc format — mammoth/pdf-parse can't read it.
  throw new Error('This file is an old .doc format, which text extraction does not support. Please re-upload it as PDF or DOCX to use it as AI reference material.');
}

/**
 * Public entry point used by chat.js. Returns { text, title, docType }
 * on success, or throws an Error with a message safe to show the user.
 */
async function getReferenceText(documentId, schoolId, identity, isOwnerOrFullAdminFlag) {
  const { row, error } = await loadReferenceRow(documentId, schoolId, identity, isOwnerOrFullAdminFlag);
  if (error) throw new Error(error);

  let text;
  try {
    text = await extractTextFromRow(row);
  } catch (err) {
    // Re-throw dependency-missing errors with a clearer hint for the dev.
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error('Reading PDF/DOCX files requires the pdf-parse and mammoth packages. Run: npm install pdf-parse mammoth');
    }
    throw err;
  }

  text = (text || '').trim();
  if (!text) {
    throw new Error('No readable text was found in that file — it may be a scanned/image-only document.');
  }
  if (text.length > MAX_REFERENCE_CHARS) {
    text = text.slice(0, MAX_REFERENCE_CHARS) + '\n\n[...truncated for length...]';
  }

  return { text, title: row.title, docType: row.doc_type };
}

module.exports = { getReferenceText };
