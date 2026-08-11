// ─────────────────────────────────────────────────────────────
// routes/attendance/db.js
//
// Table bootstrap + shared helpers for the Attendance Register module.
// Follows the same "CREATE TABLE IF NOT EXISTS, best effort, memoized"
// pattern used by routes/staff-onboarding/db.js — no separate migration
// runner required, safe to call on every request.
// ─────────────────────────────────────────────────────────────
const pool = require('../../database/db');

let tablesReadyPromise = null;

// Status codes used across the register, matching a standard Nigerian
// secondary-school attendance-register legend. Kept as a single source
// of truth so the CHECK constraint and the API's legend response never
// drift apart.
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'sick', 'excused'];

const ATTENDANCE_LEGEND = [
  { code: '/', status: 'present', label: 'Present' },
  { code: 'A', status: 'absent', label: 'Absent' },
  { code: 'L', status: 'late', label: 'Late' },
  { code: 'I', status: 'sick', label: 'Ill / Sick' },
  { code: 'E', status: 'excused', label: 'Excused (permission granted)' },
];

// A class-teacher's roll call can be split into a morning and an
// afternoon session (paper register convention) or taken once for the
// whole day — the caller picks per school/class preference.
const ATTENDANCE_PERIODS = ['full_day', 'morning', 'afternoon'];

async function ensureAttendanceTables() {
  if (tablesReadyPromise) return tablesReadyPromise;

  tablesReadyPromise = (async () => {
    // One row per (enrollment, date, period). Denormalizes class_id and
    // student_id alongside enrollment_id so class-wide and student-wide
    // queries don't always need a join back through enrollments.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
        term INTEGER NOT NULL CHECK (term IN (1, 2, 3)),
        attendance_date DATE NOT NULL,
        period VARCHAR(10) NOT NULL DEFAULT 'full_day' CHECK (period IN ('full_day', 'morning', 'afternoon')),
        status VARCHAR(10) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'sick', 'excused')),
        remarks TEXT,
        marked_by_type VARCHAR(20) NOT NULL DEFAULT 'owner',
        marked_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(enrollment_id, attendance_date, period)
      )
    `);

    // Weekly sign-off trail — mirrors the paper register's "Teacher's
    // declaration / Principal's oversight / Ministry inspector" blocks.
    // One row per (class, session, term, week). Each of the three
    // blocks is a set of nullable columns filled in independently as
    // each party signs — never overwritten by the others.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_weekly_signoffs (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
        term INTEGER NOT NULL CHECK (term IN (1, 2, 3)),
        week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 13),
        teacher_signed_at TIMESTAMP,
        teacher_signed_by_type VARCHAR(20),
        teacher_signed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        principal_signed_at TIMESTAMP,
        principal_name VARCHAR(255),
        principal_signed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        inspector_signed_at TIMESTAMP,
        inspector_name VARCHAR(255),
        inspector_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(class_id, session_id, term, week_number)
      )
    `);

    // Per-student, per-term free-text remark for the terminal summary
    // ("chronic absenteeism, health issues, exemplary punctuality...").
    // Kept out of `students` (which is school-wide, not term-scoped).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_term_remarks (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
        session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
        term INTEGER NOT NULL CHECK (term IN (1, 2, 3)),
        remarks TEXT,
        updated_by_type VARCHAR(20),
        updated_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(enrollment_id, session_id, term)
      )
    `);

    // Register-specific bio-data fields the paper register expects that
    // the core `students` table doesn't carry yet. Purely additive and
    // nullable — no existing query on `students` is affected.
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS state_of_origin VARCHAR(100)`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS lga VARCHAR(100)`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(50)`);
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_address TEXT`);

    // School-level "education district" — the other half of "school name
    // and its official location or education district" or that the
    // register's cover page needs. Additive; `address`/`city`/`state`
    // already cover the rest of "location".
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS education_district VARCHAR(255)`);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_records_class_date ON attendance_records(class_id, attendance_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_records_enrollment ON attendance_records(enrollment_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_records_school_term ON attendance_records(school_id, session_id, term)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_signoffs_class ON attendance_weekly_signoffs(class_id, session_id, term)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_remarks_enrollment ON attendance_term_remarks(enrollment_id)`);
  })();

  return tablesReadyPromise;
}

// ─────────────────────────────────────────────────────────────
// getAttendanceActor(req)
//
// Reads the same additive JWT claims middleware/auth.js already relies
// on (staffRole, classId, role, staffId) and turns them into a single
// shape every route in this module can branch on. Mirrors, but does
// not replace, authMiddleware.getTeacherClassScope.
// ─────────────────────────────────────────────────────────────
function getAttendanceActor(req) {
  const isSchoolAccount = req.user?.type === 'school';
  const staffRole = req.user?.staffRole || null;
  const isClassTeacher = isSchoolAccount && staffRole === 'class_teacher';
  const isOwner = isSchoolAccount && req.user?.role !== 'admin';

  return {
    schoolId: req.user?.schoolId,
    staffId: req.user?.staffId || null,
    isOwner,
    isClassTeacher,
    // Owners and non-class-teacher admins ('admin', or any future
    // unrestricted staff role) can act on every class in the school.
    isUnrestricted: isOwner || (isSchoolAccount && !isClassTeacher),
    assignedClassId: isClassTeacher ? (req.user?.classId || null) : null,
    actorType: isOwner ? 'owner' : (isClassTeacher ? 'class_teacher' : 'admin'),
  };
}

// ─────────────────────────────────────────────────────────────
// requireAssignedTeacherOrUnrestricted
//
// The bare minimum guard: blocks ONLY an unassigned class_teacher.
// Owners, full admins, and class_teachers who DO have a class all pass
// through — used by routes (like the classes list) that don't target
// one specific :classId, so there's nothing further to match against.
// Always attaches the resolved actor to req.attendanceActor.
// ─────────────────────────────────────────────────────────────
function requireAssignedTeacherOrUnrestricted() {
  return (req, res, next) => {
    const actor = getAttendanceActor(req);
    req.attendanceActor = actor;

    if (actor.isUnrestricted) return next();

    if (actor.isClassTeacher && !actor.assignedClassId) {
      return res.status(403).json({
        success: false,
        error: 'You are not assigned to any class.',
        code: 'NOT_ASSIGNED_TO_CLASS',
      });
    }

    next();
  };
}

// ─────────────────────────────────────────────────────────────
// requireClassAccess
//
// Route-level guard for anything scoped to a single :classId (or a
// classId read from the body via getClassId(req)). Enforces exactly
// the rule the product asked for:
//   - owner / full admin -> any class in the school
//   - class_teacher assigned to THIS class -> allowed
//   - class_teacher assigned to a DIFFERENT class -> 403
//   - class_teacher with NO class assigned -> 403 "not assigned"
// Attaches the resolved actor to req.attendanceActor for handlers to
// reuse (e.g. to stamp marked_by_type / marked_by_staff_id).
// ─────────────────────────────────────────────────────────────
function requireClassAccess(getClassId = (req) => req.params.classId) {
  const baseGuard = requireAssignedTeacherOrUnrestricted();

  return (req, res, next) => {
    baseGuard(req, res, (err) => {
      if (err) return next(err);
      const actor = req.attendanceActor;

      // baseGuard already let unrestricted actors and assigned
      // class_teachers through (and already rejected unassigned ones).
      // Unrestricted actors need no further check here.
      if (actor.isUnrestricted) return next();

      const requestedClassId = getClassId(req);
      if (requestedClassId === null || requestedClassId === undefined || requestedClassId === '') {
        return res.status(400).json({ success: false, error: 'classId is required.' });
      }

      if (Number(requestedClassId) !== Number(actor.assignedClassId)) {
        return res.status(403).json({
          success: false,
          error: 'You can only do this for your assigned class.',
          code: 'CLASS_SCOPE_VIOLATION',
        });
      }

      next();
    });
  };
}

module.exports = {
  pool,
  ensureAttendanceTables,
  getAttendanceActor,
  requireAssignedTeacherOrUnrestricted,
  requireClassAccess,
  ATTENDANCE_STATUSES,
  ATTENDANCE_LEGEND,
  ATTENDANCE_PERIODS,
};
