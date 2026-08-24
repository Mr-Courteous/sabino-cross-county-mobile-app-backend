// ─────────────────────────────────────────────────────────────
// routes/teacher-ai/format.js
//
// The mobile app renders assistant text in a plain <Text> component
// with no markdown renderer, so any markdown the model produces
// (**bold**, `code`, # Heading, - bullet) shows up to the teacher as
// literal asterisks/hashes/backticks. Rather than add a markdown
// renderer to the app, we ask the model for plain prose (see the
// system prompt below) and then defensively strip any markdown
// syntax that slips through anyway, so the client never has to care.
// ─────────────────────────────────────────────────────────────

/**
 * Strips common markdown syntax from a string, leaving plain,
 * readable text. Safe to run on text that has no markdown in it —
 * it's a no-op in that case.
 */
function stripMarkdown(input) {
  if (typeof input !== 'string' || !input) return input;

  let text = input;

  // Fenced code blocks — keep the inner content, drop the ``` fences.
  text = text.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '$1');

  // Headings: "## Some heading" -> "Some heading"
  text = text.replace(/^ {0,3}#{1,6}\s+/gm, '');

  // Bold/italic/strikethrough: **x**, __x__, *x*, _x_, ~~x~~
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/___([^_]+)___/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(^|[^\w])\*([^*\n]+)\*(?!\w)/g, '$1$2');
  text = text.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Bullet markers at the start of a line: "- ", "* ", "+ " -> nothing
  // (the sentence itself still reads fine on its own line).
  text = text.replace(/^[ \t]*[-*+]\s+/gm, '');

  // Numbered list markers stay (e.g. "1. ") — those are plain text
  // already and are exactly the format we want lists in.

  // Blockquote markers
  text = text.replace(/^[ \t]*>\s?/gm, '');

  // Horizontal rules
  text = text.replace(/^ {0,3}([-*_]){3,}\s*$/gm, '');

  // Markdown links/images: [text](url) -> text
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Collapse any 3+ blank lines left behind by the removals above.
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Recursively applies stripMarkdown to every string value in a
 * structured payload (the Scheme of Work / Lesson Plan / Lesson Note
 * JSON), since those fields get displayed to the teacher too.
 */
function stripMarkdownDeep(value) {
  if (typeof value === 'string') return stripMarkdown(value);
  if (Array.isArray(value)) return value.map(stripMarkdownDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = stripMarkdownDeep(value[key]);
    return out;
  }
  return value;
}

module.exports = { stripMarkdown, stripMarkdownDeep };
