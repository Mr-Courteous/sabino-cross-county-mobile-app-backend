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
//   npm install unpdf mammoth
//
// NOTE: previously used `pdf-parse`, which pulls in a browser build of
// pdfjs-dist that expects DOM globals (DOMMatrix/Path2D/ImageData) to
// exist. Those aren't present in plain Node, so certain PDFs (ones that
// hit font/rendering code paths) failed with "DOMMatrix is not defined"
// — surfaced verbatim to the app via the catch block in chat.js. `unpdf`
// ships a serverless PDF.js build made for Node/worker environments, so
// it doesn't need those DOM globals at all.
// ─────────────────────────────────────────────────────────────
const pool = require('../../database/db');

const MAX_REFERENCE_CHARS = 12000; // keeps the Groq prompt a sane size
// Ad-hoc chat attachments (routes/teacher-ai/chat.js POST /attachments/extract)
// get a smaller cap than a pinned reference doc, since a single message can
// carry more than one of these and they all go into the same prompt.
const MAX_ATTACHMENT_CHARS = 8000;

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

/**
 * Shared by both entry points below: turns a raw file buffer into
 * plain text. `fileType` is 'pdf' | 'docx' | 'doc'.
 */
async function extractTextFromBuffer(buffer, fileType) {
  if (fileType === 'pdf') {
    // unpdf is ESM-only — dynamic import() works fine from this CommonJS
    // file (require() would not).
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n\n') : (text || '');
  }

  if (fileType === 'docx') {
    const mammoth = require('mammoth');
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value || '';
  }

  // Old binary .doc format — mammoth/unpdf can't read it.
  throw new Error('This file is an old .doc format, which text extraction does not support. Please re-upload it as PDF or DOCX to use it as AI reference material.');
}

async function extractTextFromRow(row) {
  const res = await fetch(row.file_url);
  if (!res.ok) {
    throw new Error(`Could not download the file (status ${res.status}).`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return extractTextFromBuffer(buffer, row.file_type);
}

// require() misses throw MODULE_NOT_FOUND; dynamic import() misses (used
// for the ESM-only `unpdf`) throw ERR_MODULE_NOT_FOUND — remap both to a
// message that actually tells the dev what to do about it.
function remapDependencyError(err) {
  if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND') {
    return new Error('Reading PDF/DOCX files requires the unpdf and mammoth packages. Run: npm install unpdf mammoth');
  }
  return err;
}

function cleanExtractedText(rawText, maxChars) {
  let text = (rawText || '').trim();
  if (!text) {
    throw new Error('No readable text was found in that file — it may be a scanned/image-only document.');
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + '\n\n[...truncated for length...]';
  }
  return text;
}

/**
 * Public entry point used by chat.js for the "generate from this
 * uploaded library file" flow. Returns { text, title, docType } on
 * success, or throws an Error with a message safe to show the user.
 */
async function getReferenceText(documentId, schoolId, identity, isOwnerOrFullAdminFlag) {
  const { row, error } = await loadReferenceRow(documentId, schoolId, identity, isOwnerOrFullAdminFlag);
  if (error) throw new Error(error);

  let text;
  try {
    text = await extractTextFromRow(row);
  } catch (err) {
    throw remapDependencyError(err);
  }

  text = cleanExtractedText(text, MAX_REFERENCE_CHARS);
  return { text, title: row.title, docType: row.doc_type };
}

/**
 * Public entry point used by chat.js's POST /attachments/extract — the
 * composer's paperclip-attach flow. Takes an in-memory upload straight
 * from multer (no document_library row, nothing persisted) and returns
 * cleaned text, or throws an Error safe to show the user.
 */
async function extractUploadedFileText(buffer, fileType) {
  let text;
  try {
    text = await extractTextFromBuffer(buffer, fileType);
  } catch (err) {
    throw remapDependencyError(err);
  }
  return cleanExtractedText(text, MAX_ATTACHMENT_CHARS);
}

module.exports = { getReferenceText, extractUploadedFileText };
