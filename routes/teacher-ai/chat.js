// ─────────────────────────────────────────────────────────────
// routes/teacher-ai/chat.js
//
// The open-ended "Ask Sabino AI" chat (addendum §1.3, teacher_ai_chat)
// that can produce a Scheme of Work, Lesson Plan or Lesson Note.
//
// Reuses the exact same AI building block already in production —
// Groq via the OpenAI SDK (see routes/reports.js's AI remark feature)
// — instead of introducing a second provider/config into the app.
//
// Mounted at /api/teacher-ai/chat (see index.js).
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const multer = require('multer');
const OpenAI = require('openai');
const authMiddleware = require('../../middleware/auth');
const checkSubscription = require('../../middleware/checkSubscription');
const { pool, ensureTeacherAiTables, getTeacherIdentity, isSameTeacher, pruneOldConversations } = require('./db');
const { getReferenceText, extractUploadedFileText } = require('./document-extract');
const { stripMarkdown, stripMarkdownDeep } = require('./format');

// Per-teacher conversation history is capped at this many threads —
// enough for the AI (and the teacher) to have useful recall of recent
// work without the table growing unbounded. Oldest ones are dropped
// automatically whenever a new conversation is started (see
// pruneOldConversations below). Within a single conversation, all
// messages are kept (a teacher can scroll back through the full
// thread); only the number of separate conversations is limited.
const MAX_CONVERSATIONS_PER_TEACHER = 20;

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});
// Groq deprecated/decommissioned llama-3.3-70b-versatile (announced
// 2026-06-17, shut off 2026-08-16) — every call was failing with
// `model_decommissioned` and getting swallowed into a generic 502
// below. openai/gpt-oss-120b is Groq's own recommended replacement.
const AI_MODEL = 'openai/gpt-oss-120b';
// gpt-oss-120b is text-only. When a turn includes an image, the call is
// routed to Groq's multimodal model instead (see buildChatMessages below).
const VISION_MODEL = 'qwen/qwen3.6-27b';

// Mandatory disclaimer, per addendum §1.3 / §1.5 — "carries the
// disclaimer ... wherever generated content is displayed, in chat and
// in the editor, not only at the point of approval."
const DISCLAIMER = 'AI-generated content may contain errors. You are encouraged to review before use.';

const VALID_CONTENT_TYPES = ['scheme_of_work', 'lesson_plan', 'lesson_note'];

// ── Composer paperclip-attach flow (POST /attachments/extract, below) —
//    mirrors the multer/mime setup already used in
//    routes/document-library.js. Files are read straight into memory and
//    turned into text; nothing here is ever persisted to document_library
//    or blob storage, unlike a real library upload. ──
const ATTACHMENT_MAX_SIZE = 20 * 1024 * 1024; // 20MB, same ceiling as document-library
const ATTACHMENT_MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
// Images go through a separate path below (base64 data URL for the vision
// model, not text extraction), but share the same upload endpoint/multer
// config as documents.
const IMAGE_MIME_TO_EXT = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};
// Kept well under Groq's 20MB-per-request cap for image_url input, since
// base64 inflates the raw file by ~33% and the request also carries the
// system prompt + conversation history.
const IMAGE_MAX_SIZE = 8 * 1024 * 1024; // 8MB
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_SIZE },
});
// A chat message can carry more than one file attachment, but only the
// first few get their content read into the AI prompt — keeps the
// per-turn prompt bounded even if someone attaches a stack of files.
const MAX_ATTACHMENTS_WITH_CONTENT = 3;

const SCHEMAS = {
  scheme_of_work:
    '{"contentType":"scheme_of_work","title":"string","weeks":[{"weekNo":1,"topic":"string","objectives":"string","resources":"string"}]}',
  lesson_plan:
    '{"contentType":"lesson_plan","title":"string","topic":"string","duration":"string","objectives":"string","materials":"string","teacherActivities":"string","studentActivities":"string","evaluation":"string"}',
  lesson_note:
    '{"contentType":"lesson_note","title":"string","topic":"string","objectives":"string","teacherActivities":"string","studentActivities":"string","assessment":"string"}',
};

const STRUCTURED_START = '<<<SABINO_STRUCTURED>>>';
const STRUCTURED_END = '<<<END_STRUCTURED>>>';

function buildSystemPrompt(lockedContentType) {
  const base = `You are Sabino AI, a teaching assistant embedded in Sabino Edu, a school app used by teachers in Nigerian/African schools. You help teachers produce three kinds of classroom-ready material:
- Scheme of Work: a term-long, week-by-week breakdown of what will be taught.
- Lesson Plan: a plan for a single lesson or block of lessons (objectives, materials, activity flow, timing, evaluation).
- Lesson Note: a classroom-ready note a teacher delivers from directly (topic, objectives, teacher activities, student activities, assessment).

Tone: write the way a measured, well-read colleague would — calm, professional and academic, the way a subject head would phrase things in a staffroom memo. Avoid hype, exclamation marks, emojis, slang and overly casual phrasing. Be concise, practical and curriculum-appropriate.

Formatting: reply in plain prose sentences and paragraphs only. Do not use markdown syntax of any kind — no asterisks, underscores, hash symbols, backticks or bullet dashes. If you are listing several items, write them as a short run of plain numbered sentences (e.g. "1. First point. 2. Second point.") or as a normal paragraph, never as a bulleted or symbol-prefixed list.`;

  if (lockedContentType && SCHEMAS[lockedContentType]) {
    return `${base}

This conversation was started for a ${lockedContentType.replace(/_/g, ' ')}. Whenever your reply generates or updates that document, after your prose reply add a new line with exactly ${STRUCTURED_START}, then ONE JSON object (no markdown, no commentary) matching this schema, then a new line with exactly ${STRUCTURED_END}:
${SCHEMAS[lockedContentType]}
If the teacher is just asking a question and not generating/updating the document, omit the structured block entirely.`;
  }

  return `${base}

If your reply generates one of the three document types above, after your prose reply add a new line with exactly ${STRUCTURED_START}, then ONE JSON object (no markdown, no commentary) matching whichever of these schemas fits, then a new line with exactly ${STRUCTURED_END}:
Scheme of Work: ${SCHEMAS.scheme_of_work}
Lesson Plan: ${SCHEMAS.lesson_plan}
Lesson Note: ${SCHEMAS.lesson_note}
If the teacher is just chatting or asking a question, omit the structured block entirely.`;
}

function parseAiReply(raw) {
  const startIdx = raw.indexOf(STRUCTURED_START);
  const endIdx = raw.indexOf(STRUCTURED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { text: raw.trim(), structured: null };
  }

  const text = raw.slice(0, startIdx).trim();
  const jsonSlice = raw.slice(startIdx + STRUCTURED_START.length, endIdx).trim();
  try {
    const structured = JSON.parse(jsonSlice);
    return { text, structured };
  } catch (err) {
    console.error('[teacher-ai/chat] Failed to parse structured block:', err.message);
    return { text, structured: null };
  }
}

// Owner, or a staff account whose specific job-role is 'admin'. Mirrors
// the check in routes/document-library.js — needed here too so an
// admin/owner can reference ANY teacher's pending submission, not only
// their own documents.
function isOwnerOrFullAdmin(req) {
  const isStaffAccount = req.user?.type === 'school' && req.user?.role === 'admin';
  if (!isStaffAccount) return true;
  return req.user?.staffRole === 'admin';
}

router.use(authMiddleware.authenticateToken, authMiddleware.requireSchool, checkSubscription);
router.use(async (req, res, next) => {
  try {
    await ensureTeacherAiTables();
    next();
  } catch (err) {
    console.error('❌ [teacher-ai/chat] Failed to ensure tables:', err.message);
    res.status(500).json({ success: false, error: 'Server initialization error.' });
  }
});

// ── POST /attachments/extract — the composer's paperclip-attach button.
//    Called once per file, right after picking it (before the teacher
//    even hits send), so the chip can show a spinner then either
//    "ready" or a clear error. Nothing here touches document_library —
//    this is ad hoc, per-message content, not a saved library file. ──
router.post('/attachments/extract', attachmentUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file was received.' });
    }

    const originalName = req.file.originalname || 'file';

    // ── Image path: no text extraction — just hand back a base64 data
    //    URL the composer can attach as-is, for the vision model to read
    //    directly when the message is sent (see buildChatMessages). ──
    let imageExt = IMAGE_MIME_TO_EXT[req.file.mimetype];
    if (!imageExt) {
      const ext = (originalName.split('.').pop() || '').toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') imageExt = 'jpeg';
      else if (ext === 'png' || ext === 'webp') imageExt = ext;
    }
    if (imageExt) {
      if (req.file.buffer.length > IMAGE_MAX_SIZE) {
        return res.status(400).json({ success: false, error: 'That image is larger than the 8MB limit — try a smaller photo.' });
      }
      const mimeType = imageExt === 'jpeg' ? 'image/jpeg' : `image/${imageExt}`;
      const imageDataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
      return res.json({ success: true, data: { name: originalName, fileType: 'image', imageDataUrl } });
    }

    let fileType = ATTACHMENT_MIME_TO_EXT[req.file.mimetype];
    if (!fileType) {
      // Some mobile clients send a generic mimetype (e.g.
      // application/octet-stream) — fall back to the file extension.
      const ext = (originalName.split('.').pop() || '').toLowerCase();
      if (ext === 'pdf' || ext === 'doc' || ext === 'docx') fileType = ext;
    }
    if (!fileType) {
      return res.status(400).json({
        success: false,
        error: "Sabino AI can only read PDF, Word (.docx) and image (jpg/png/webp) files right now.",
      });
    }

    const text = await extractUploadedFileText(req.file.buffer, fileType);
    res.json({ success: true, data: { name: originalName, fileType, text } });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'That file is larger than the 20MB limit.' });
    }
    // err.message here is always one of the user-safe strings thrown by
    // extractUploadedFileText (old .doc format, scanned/empty PDF,
    // missing dependency) — safe to return as-is.
    res.status(400).json({ success: false, error: err.message || 'Could not read that file.' });
  }
});

// ── GET / — the teacher's own conversation history, most recent first ──
router.get('/', async (req, res) => {
  try {
    const identity = getTeacherIdentity(req);
    const result = await pool.query(
      `SELECT id, content_type, context_ref, title, updated_at, created_at,
              jsonb_array_length(messages) AS message_count
       FROM ai_conversations
       WHERE school_id = $1 AND teacher_type = $2 AND teacher_id = $3
       ORDER BY updated_at DESC
       LIMIT ${MAX_CONVERSATIONS_PER_TEACHER}`,
      [req.user.schoolId, identity.type, identity.id]
    );
    res.json({
      success: true,
      data: result.rows.map((r) => ({
        id: r.id,
        contentType: r.content_type,
        contextRef: r.context_ref,
        title: r.title,
        messageCount: r.message_count,
        updatedAt: r.updated_at,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error('[teacher-ai/chat] list error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch conversations.' });
  }
});

// ── GET /:id — full conversation thread ──
router.get('/:id', async (req, res) => {
  try {
    const identity = getTeacherIdentity(req);
    const result = await pool.query(`SELECT * FROM ai_conversations WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.user.schoolId,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }
    const row = result.rows[0];
    if (!isSameTeacher(identity, row)) {
      return res.status(403).json({ success: false, error: 'You can only view your own conversations.' });
    }
    res.json({
      success: true,
      data: {
        id: row.id,
        contentType: row.content_type,
        contextRef: row.context_ref,
        title: row.title,
        messages: row.messages,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error('[teacher-ai/chat] get error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch conversation.' });
  }
});

// ── POST / — send a message, get an AI reply ──
router.post('/', async (req, res) => {
  try {
    const { message, conversationId, contentType, contextRef, attachments, referenceDocumentId } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'A message is required.' });
    }
    if (contentType && !VALID_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({
        success: false,
        error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}`,
      });
    }

    const identity = getTeacherIdentity(req);

    // ── Load or create the conversation ──
    let conversation;
    if (conversationId) {
      const existing = await pool.query(`SELECT * FROM ai_conversations WHERE id = $1 AND school_id = $2`, [
        conversationId,
        req.user.schoolId,
      ]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Conversation not found.' });
      }
      if (!isSameTeacher(identity, existing.rows[0])) {
        return res.status(403).json({ success: false, error: 'You can only continue your own conversations.' });
      }
      conversation = existing.rows[0];
    } else {
      const created = await pool.query(
        `INSERT INTO ai_conversations (school_id, teacher_type, teacher_id, teacher_name, content_type, context_ref, title, messages)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '[]')
         RETURNING *`,
        [
          req.user.schoolId,
          identity.type,
          identity.id,
          identity.name,
          contentType || null,
          contextRef ? JSON.stringify(contextRef) : null,
          message.trim().slice(0, 80),
        ]
      );
      conversation = created.rows[0];
      // A brand-new thread was just started — drop the oldest ones
      // beyond the cap so history doesn't grow without bound.
      await pruneOldConversations(req.user.schoolId, identity, MAX_CONVERSATIONS_PER_TEACHER);
    }

    // ── Resolve a "generate from this uploaded file" reference, BEFORE
    //    touching history — so a bad/inaccessible document errors out
    //    cleanly with nothing partially saved. Only re-extracted once
    //    per conversation (tracked in context_ref) so a long back-and-
    //    forth doesn't re-download/re-parse the file every turn. ──
    let referenceMessage = null;
    let nextContextRef = conversation.context_ref || null;
    if (referenceDocumentId && conversation.context_ref?.referenceDocumentId !== referenceDocumentId) {
      try {
        const ref = await getReferenceText(
          referenceDocumentId,
          req.user.schoolId,
          identity,
          isOwnerOrFullAdmin(req)
        );
        referenceMessage = {
          role: 'user',
          content: `Reference document — "${ref.title}" (${(ref.docType || '').replace(/_/g, ' ')}). Use this as the basis for what I ask next:\n\n${ref.text}`,
          isReference: true,
          referenceDocumentId,
          createdAt: new Date().toISOString(),
        };
        nextContextRef = { ...(conversation.context_ref || {}), referenceDocumentId, referenceTitle: ref.title };
      } catch (refErr) {
        return res.status(400).json({ success: false, error: refErr.message, conversationId: conversation.id });
      }
    }

    // ── Turn any paperclip-attached files that came with extracted text
    //    (from POST /attachments/extract) into synthetic prior "user"
    //    messages, same pattern as the library referenceMessage above —
    //    except these are per-message, not pinned to the whole
    //    conversation, since a teacher can attach a different file to
    //    each question they ask. ──
    const attachmentReferenceMessages = Array.isArray(attachments)
      ? attachments
          .filter((a) => a && ((typeof a.text === 'string' && a.text.trim()) || a.imageDataUrl))
          .slice(0, MAX_ATTACHMENTS_WITH_CONTENT)
          .map((a) => {
            if (a.imageDataUrl) {
              // Multimodal content block — passed straight through to the
              // vision model (see buildChatMessages). Plain gpt-oss-120b
              // calls never see this shape since hasImage routes them to
              // VISION_MODEL instead.
              return {
                role: 'user',
                content: [
                  { type: 'text', text: `Attached image — "${a.name || 'Untitled'}". Use this as context for the message that follows.` },
                  { type: 'image_url', image_url: { url: a.imageDataUrl } },
                ],
                isReference: true,
                attachmentName: a.name || null,
                createdAt: new Date().toISOString(),
              };
            }
            return {
              role: 'user',
              content: `Attached file — "${a.name || 'Untitled'}". Use this as context for the message that follows:\n\n${a.text.trim()}`,
              isReference: true,
              attachmentName: a.name || null,
              createdAt: new Date().toISOString(),
            };
          })
      : [];

    // ── Append the reference(s) and the user's message, so none of it
    //    is ever lost even if the AI call below fails. ──
    const history = Array.isArray(conversation.messages) ? conversation.messages : [];
    if (referenceMessage) history.push(referenceMessage);
    attachmentReferenceMessages.forEach((m) => history.push(m));
    const userMessage = {
      role: 'user',
      content: message.trim(),
      // The extracted text itself already lives in the reference
      // messages above — store only the label here so the same content
      // isn't duplicated twice in the conversation.
      attachments: Array.isArray(attachments)
        ? attachments.map((a) => ({ type: a.type, name: a.name, hasContent: !!((a.text && a.text.trim()) || a.imageDataUrl) }))
        : [],
      createdAt: new Date().toISOString(),
    };
    history.push(userMessage);

    await pool.query(
      `UPDATE ai_conversations SET messages = $1, context_ref = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [JSON.stringify(history), nextContextRef ? JSON.stringify(nextContextRef) : null, conversation.id]
    );

    // ── Call the AI ──
    const effectiveContentType = contentType || conversation.content_type || null;
    const systemPrompt = buildSystemPrompt(effectiveContentType);

    // Last 20 turns of history is enough context for this use case and
    // keeps the request small/fast on Groq. A message's `content` is
    // normally a plain string, but an image-attachment reference message
    // (above) stores a multimodal array instead — only the most recent
    // one of those is kept intact; any earlier ones are collapsed down to
    // their text part so the request stays within Groq's per-request
    // image cap and doesn't balloon with old base64 data every turn.
    const recentHistory = history.slice(-20);
    let lastImageIdx = -1;
    recentHistory.forEach((m, i) => {
      if (Array.isArray(m.content) && m.content.some((c) => c && c.type === 'image_url')) lastImageIdx = i;
    });
    const hasImage = lastImageIdx !== -1;
    const conversationMessages = recentHistory.map((m, i) => {
      let content = m.content;
      if (Array.isArray(content) && i !== lastImageIdx) {
        const textOnly = content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim();
        content = textOnly || '[An image was attached here earlier in the conversation.]';
      }
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
    });
    const chatMessages = [{ role: 'system', content: systemPrompt }, ...conversationMessages];

    let raw;
    try {
      const completion = await openai.chat.completions.create({
        model: hasImage ? VISION_MODEL : AI_MODEL,
        messages: chatMessages,
        temperature: 0.4,
      });
      raw = completion.choices?.[0]?.message?.content || '';
    } catch (aiError) {
      // Log the actual Groq error body (model_decommissioned, invalid
      // key, rate limit, etc.) — aiError.message alone is often just
      // "400 status code (no body)" from the OpenAI SDK and hides the
      // real cause. Check this log first when chasing a 502 here.
      console.error(
        '[teacher-ai/chat] AI call failed:',
        aiError?.response?.data || aiError?.error || aiError.message
      );
      return res.status(502).json({
        success: false,
        error: 'Sabino AI is temporarily unavailable. Please try again in a moment.',
        conversationId: conversation.id,
      });
    }

    const { text: rawText, structured: rawStructured } = parseAiReply(raw);
    // Defensive cleanup: strip any markdown the model produced anyway,
    // since the app displays this text verbatim with no markdown
    // renderer (see format.js for why).
    const text = stripMarkdown(rawText);
    const structured = rawStructured ? stripMarkdownDeep(rawStructured) : null;
    const resolvedContentType = (structured && structured.contentType) || effectiveContentType || null;

    const assistantMessage = {
      role: 'assistant',
      content: text,
      structured: structured || null,
      contentType: resolvedContentType,
      model: hasImage ? VISION_MODEL : AI_MODEL,
      createdAt: new Date().toISOString(),
    };
    history.push(assistantMessage);

    const updated = await pool.query(
      `UPDATE ai_conversations
       SET messages = $1, content_type = COALESCE($2, content_type), updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, content_type, context_ref, title`,
      [JSON.stringify(history), resolvedContentType, conversation.id]
    );

    res.json({
      success: true,
      data: {
        conversationId: updated.rows[0].id,
        contentType: updated.rows[0].content_type,
        // Total entries in the stored thread, INCLUDING the synthetic
        // reference messages above — this is what actually determines
        // the `history.slice(-20)` window the AI sees, so the frontend
        // uses this (not its own display-message count) to decide when
        // to show the "older messages are outside AI context" notice.
        messageCount: history.length,
        message: {
          role: 'assistant',
          text,
          structured,
          contentType: resolvedContentType,
        },
        // Handy for "Copy to Editor" on the client — tells it which
        // /api/teacher-ai/<endpoint> to POST the structured payload to.
        copyToEditorEndpoint:
          resolvedContentType === 'scheme_of_work'
            ? 'scheme-of-work'
            : resolvedContentType === 'lesson_plan'
            ? 'lesson-plans'
            : resolvedContentType === 'lesson_note'
            ? 'lesson-notes'
            : null,
        disclaimer: DISCLAIMER,
      },
    });
  } catch (error) {
    console.error('[teacher-ai/chat] send error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to process chat message.' });
  }
});

// ── DELETE /:id — discard a conversation ──
router.delete('/:id', async (req, res) => {
  try {
    const identity = getTeacherIdentity(req);
    const existing = await pool.query(`SELECT * FROM ai_conversations WHERE id = $1 AND school_id = $2`, [
      req.params.id,
      req.user.schoolId,
    ]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }
    if (!isSameTeacher(identity, existing.rows[0])) {
      return res.status(403).json({ success: false, error: 'You can only delete your own conversations.' });
    }
    await pool.query(`DELETE FROM ai_conversations WHERE id = $1`, [req.params.id]);
    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch (error) {
    console.error('[teacher-ai/chat] delete error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete conversation.' });
  }
});

module.exports = router;
