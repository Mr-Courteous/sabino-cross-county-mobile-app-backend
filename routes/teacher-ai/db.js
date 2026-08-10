// ─────────────────────────────────────────────────────────────
// routes/teacher-ai/db.js
//
// Table bootstrap + shared helpers for the Teacher AI (Teaching
// Assistant) module — Part 1 of the Sabino Edu addendum v1.1:
// Scheme of Work, Lesson Plan, Lesson Note, and the AI chat that
// drives them.
//
// Follows the same "CREATE TABLE IF NOT EXISTS, memoized, best
// effort" pattern already used by routes/staff-onboarding/db.js —
// no separate migration runner required.
// ─────────────────────────────────────────────────────────────
const pool = require('../../database/db');

let tablesReadyPromise = null;

/**
 * Ensures every table this module needs exists. Safe to call on every
 * request — memoized so we only hit the DB once per process lifetime.
 */
async function ensureTeacherAiTables() {
  if (tablesReadyPromise) return tablesReadyPromise;

  tablesReadyPromise = (async () => {
    // ── AI conversations (the "Ask Sabino AI" chat) ──────────────────
    // messages[] is kept as a single JSONB array rather than a child
    // table — a conversation is always read/written as one whole
    // thread, never queried message-by-message, so this matches the
    // access pattern and avoids an extra join for every chat turn.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        teacher_type VARCHAR(10) NOT NULL,
        teacher_id INTEGER NOT NULL,
        teacher_name VARCHAR(255),
        content_type VARCHAR(30),
        context_ref JSONB,
        title VARCHAR(255),
        messages JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // content_type: 'scheme_of_work' | 'lesson_plan' | 'lesson_note' | NULL (open chat)

    // ── Scheme of Work ────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_scheme_of_work (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        teacher_type VARCHAR(10) NOT NULL,
        teacher_id INTEGER NOT NULL,
        teacher_name VARCHAR(255),
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        term VARCHAR(20),
        session VARCHAR(20),
        title VARCHAR(255),
        weeks JSONB NOT NULL DEFAULT '[]',
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        created_via VARCHAR(20) NOT NULL DEFAULT 'manual',
        ai_provenance JSONB,
        approved_at TIMESTAMP,
        approved_by_type VARCHAR(10),
        approved_by_id INTEGER,
        approved_by_name VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Lesson Plan ────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_lesson_plans (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        teacher_type VARCHAR(10) NOT NULL,
        teacher_id INTEGER NOT NULL,
        teacher_name VARCHAR(255),
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        term VARCHAR(20),
        session VARCHAR(20),
        title VARCHAR(255),
        topic VARCHAR(255),
        duration VARCHAR(100),
        objectives TEXT,
        materials TEXT,
        teacher_activities TEXT,
        student_activities TEXT,
        evaluation TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        created_via VARCHAR(20) NOT NULL DEFAULT 'manual',
        ai_provenance JSONB,
        approved_at TIMESTAMP,
        approved_by_type VARCHAR(10),
        approved_by_id INTEGER,
        approved_by_name VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Lesson Note ────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_lesson_notes (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        teacher_type VARCHAR(10) NOT NULL,
        teacher_id INTEGER NOT NULL,
        teacher_name VARCHAR(255),
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        term VARCHAR(20),
        session VARCHAR(20),
        title VARCHAR(255),
        topic VARCHAR(255),
        objectives TEXT,
        teacher_activities TEXT,
        student_activities TEXT,
        assessment TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        created_via VARCHAR(20) NOT NULL DEFAULT 'manual',
        ai_provenance JSONB,
        approved_at TIMESTAMP,
        approved_by_type VARCHAR(10),
        approved_by_id INTEGER,
        approved_by_name VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // status: 'draft' | 'approved' — see addendum §1.5. Nothing in Draft
    // state is visible outside the authoring teacher's own editor;
    // Approved documents become read-only-visible to Admin under Academics.

    // Helpful indexes — best effort, ignore if they already exist.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_conv_school ON ai_conversations(school_id, teacher_type, teacher_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_sow_school ON ai_scheme_of_work(school_id, teacher_type, teacher_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_sow_status ON ai_scheme_of_work(school_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_lp_school ON ai_lesson_plans(school_id, teacher_type, teacher_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_lp_status ON ai_lesson_plans(school_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_ln_school ON ai_lesson_notes(school_id, teacher_type, teacher_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_ln_status ON ai_lesson_notes(school_id, status)`);
  })();

  return tablesReadyPromise;
}

/**
 * Identifies "which teacher" is making the request.
 *
 * The app has no separate teacher login — a Teacher is either the
 * school OWNER (routes/auth.js token: id/schoolId, no staffId) or an
 * additional STAFF account (routes/staff-onboarding token: staffId
 * set). Both carry type: 'school'. We key every AI document/
 * conversation on (teacher_type, teacher_id) rather than a single id
 * column because staff.id and schools.id are independent sequences —
 * comparing a bare numeric id across the two would risk one teacher
 * silently matching another's documents.
 */
function getTeacherIdentity(req) {
  if (req.user?.staffId) {
    return { type: 'staff', id: req.user.staffId, name: req.user.name || null };
  }
  return { type: 'owner', id: req.user.id, name: req.user.name || null };
}

function isSameTeacher(identity, row) {
  return row.teacher_type === identity.type && Number(row.teacher_id) === Number(identity.id);
}

module.exports = { pool, ensureTeacherAiTables, getTeacherIdentity, isSameTeacher };
