// ─────────────────────────────────────────────────────────────
// routes/attendance/index.js
//
// Attendance Register module — a digital version of the standard
// secondary-school class attendance register: daily/weekly roll call,
// a weekly grid view, a terminal (per-term) summary, and a weekly
// sign-off trail (class teacher -> principal -> ministry inspector).
//
// Mount in your server entry file:
//   app.use('/api/attendance', require('./routes/attendance'));
//
// Access rule (per product spec):
//   - School owner and full admins ('admin' staffRole) -> any class.
//   - A 'class_teacher' staff account -> ONLY their assigned class.
//   - A 'class_teacher' with no class assigned yet -> every route in
//     this file rejects with 403 "You are not assigned to any class."
// Enforced centrally by requireClassAccess() in ./db.js — see there
// for the exact rule.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');

const authMiddleware = require('../../middleware/auth');
const checkSubscription = require('../../middleware/checkSubscription');
const { auditRoute } = require('../../middleware/auditLog');
const {
  pool,
  ensureAttendanceTables,
  requireAssignedTeacherOrUnrestricted,
  requireClassAccess,
  ATTENDANCE_STATUSES,
  ATTENDANCE_LEGEND,
  ATTENDANCE_PERIODS,
} = require('./db');

router.use(async (req, res, next) => {
  try {
    await ensureAttendanceTables();
    next();
  } catch (err) {
    console.error('❌ [attendance] Failed to ensure tables:', err.message);
    res.status(500).json({ success: false, error: 'Server initialization error.' });
  }
});

// Every route needs a logged-in school-type account (owner, admin, or
// class_teacher — all issue type: 'school' tokens).
router.use(authMiddleware.authenticateToken, authMiddleware.requireSchool);

// ─────────────────────────────────────────────────────────────
// Small shared helpers
// ─────────────────────────────────────────────────────────────
const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
const isWeekday = (dateStr) => {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5; // Mon-Fri
};
const mondayOf = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7; // Sunday -> 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
};
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Loads a class's roster (active enrollments for a session), ordered
 * the way the paper register orders it: boys first, then girls, each
 * group alphabetical by surname — with a running serial number reset
 * per gender group, matching "Boys listed first, then Girls".
 */
async function loadRoster(schoolId, classId, sessionId) {
  const result = await pool.query(
    `SELECT
       e.id AS enrollment_id,
       s.id AS student_id,
       s.first_name,
       s.last_name,
       s.registration_number,
       s.date_of_birth,
       s.gender,
       s.state_of_origin,
       s.lga,
       s.guardian_name,
       s.guardian_phone,
       s.guardian_address,
       s.address
     FROM enrollments e
     JOIN students s ON s.id = e.student_id
     WHERE e.school_id = $1 AND e.class_id = $2 AND e.session_id = $3 AND e.status = 'active'
     ORDER BY
       CASE WHEN lower(s.gender) = 'male' THEN 0 WHEN lower(s.gender) = 'female' THEN 1 ELSE 2 END,
       s.last_name ASC, s.first_name ASC`,
    [schoolId, classId, sessionId]
  );

  let boySerial = 0;
  let girlSerial = 0;
  return result.rows.map((row) => {
    const genderKey = (row.gender || '').toLowerCase();
    let serial;
    if (genderKey === 'male') serial = ++boySerial;
    else if (genderKey === 'female') serial = ++girlSerial;
    else serial = null;
    return { ...row, serial };
  });
}

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/classes
// The classes the logged-in account may take attendance for.
// Owner/admin -> every class in the school. class_teacher -> just
// their one assigned class. Unassigned class_teacher -> 403.
// ─────────────────────────────────────────────────────────────
router.get('/classes', checkSubscription, requireAssignedTeacherOrUnrestricted(), async (req, res) => {
  try {
    const actor = req.attendanceActor;
    const schoolId = req.user.schoolId;

    let result;
    if (actor.isUnrestricted) {
      result = await pool.query(
        `SELECT id, class_name, capacity FROM classes WHERE school_id = $1 ORDER BY class_name ASC`,
        [schoolId]
      );
    } else {
      result = await pool.query(
        `SELECT id, class_name, capacity FROM classes WHERE school_id = $1 AND id = $2`,
        [schoolId, actor.assignedClassId]
      );
    }

    res.status(200).json({ success: true, data: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('❌ [attendance] /classes error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/legend
// Static reference data for rendering the register key/legend.
// ─────────────────────────────────────────────────────────────
router.get('/legend', (req, res) => {
  res.status(200).json({ success: true, data: { legend: ATTENDANCE_LEGEND, periods: ATTENDANCE_PERIODS } });
});

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/roster/:classId?sessionId=
// Student bio-data section — the class list a teacher marks against.
// ─────────────────────────────────────────────────────────────
router.get('/roster/:classId', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);

    if (!classId || !sessionId) {
      return res.status(400).json({ success: false, error: 'classId and sessionId are required.' });
    }

    const classCheck = await pool.query('SELECT id, class_name FROM classes WHERE id = $1 AND school_id = $2', [classId, schoolId]);
    if (classCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Class not found for your school.' });
    }

    const roster = await loadRoster(schoolId, classId, sessionId);

    res.status(200).json({
      success: true,
      data: {
        class: classCheck.rows[0],
        students: roster,
        boysCount: roster.filter((r) => (r.gender || '').toLowerCase() === 'male').length,
        girlsCount: roster.filter((r) => (r.gender || '').toLowerCase() === 'female').length,
      },
      count: roster.length,
    });
  } catch (error) {
    console.error('❌ [attendance] /roster error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/attendance/students/:studentId/bio-data
// Fills in the register-only bio-data fields (state of origin, LGA,
// guardian contact) that aren't part of the core student profile.
// Body: { classId, stateOfOrigin, lga, guardianName, guardianPhone, guardianAddress }
// classId is required purely so a class_teacher's scope can be checked
// against a class the student is actually enrolled in.
// ─────────────────────────────────────────────────────────────
router.patch(
  '/students/:studentId/bio-data',
  checkSubscription,
  requireClassAccess((req) => req.body?.classId),
  auditRoute('attendance.student_bio_data_updated', (req) => ({ type: 'student', id: parseInt(req.params.studentId) })),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const studentId = parseInt(req.params.studentId);
      const { classId, stateOfOrigin, lga, guardianName, guardianPhone, guardianAddress } = req.body;

      if (!studentId || !classId) {
        return res.status(400).json({ success: false, error: 'classId is required.' });
      }

      const enrolled = await pool.query(
        `SELECT 1 FROM enrollments WHERE school_id = $1 AND student_id = $2 AND class_id = $3 AND status = 'active'`,
        [schoolId, studentId, classId]
      );
      if (enrolled.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Student is not actively enrolled in that class.' });
      }

      const result = await pool.query(
        `UPDATE students SET
           state_of_origin = COALESCE($1, state_of_origin),
           lga = COALESCE($2, lga),
           guardian_name = COALESCE($3, guardian_name),
           guardian_phone = COALESCE($4, guardian_phone),
           guardian_address = COALESCE($5, guardian_address),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $6 AND school_id = $7
         RETURNING id, first_name, last_name, state_of_origin, lga, guardian_name, guardian_phone, guardian_address`,
        [stateOfOrigin || null, lga || null, guardianName || null, guardianPhone || null, guardianAddress || null, studentId, schoolId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Student not found.' });
      }

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error('❌ [attendance] /students/:studentId/bio-data error:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/dates/:classId?sessionId=&term=&period=
// Distinct dates that have at least one SAVED attendance record for
// this class (optionally narrowed to a term and/or period). Powers
// the date-picker's "jump to any saved date" list — the client no
// longer has to page day-by-day to find out where records exist.
// term and period are optional filters; sessionId is required.
// ─────────────────────────────────────────────────────────────
router.get('/dates/:classId', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);
    const term = req.query.term ? parseInt(req.query.term) : null;
    const period = req.query.period || null;

    if (!classId || !sessionId) {
      return res.status(400).json({ success: false, error: 'classId and sessionId are required.' });
    }
    if (term !== null && ![1, 2, 3].includes(term)) {
      return res.status(400).json({ success: false, error: 'term must be 1, 2, or 3.' });
    }
    if (period !== null && !ATTENDANCE_PERIODS.includes(period)) {
      return res.status(400).json({ success: false, error: `period must be one of: ${ATTENDANCE_PERIODS.join(', ')}` });
    }

    const conditions = ['school_id = $1', 'class_id = $2', 'session_id = $3'];
    const params = [schoolId, classId, sessionId];
    if (term !== null) {
      conditions.push(`term = $${params.length + 1}`);
      params.push(term);
    }
    if (period !== null) {
      conditions.push(`period = $${params.length + 1}`);
      params.push(period);
    }

    const result = await pool.query(
      `SELECT
         attendance_date,
         ARRAY_AGG(DISTINCT period) AS periods,
         COUNT(*) AS marked_count,
         COUNT(*) FILTER (WHERE status = 'present') AS present_count,
         COUNT(*) FILTER (WHERE status = 'absent') AS absent_count,
         COUNT(*) FILTER (WHERE status = 'late') AS late_count,
         COUNT(*) FILTER (WHERE status = 'sick') AS sick_count,
         COUNT(*) FILTER (WHERE status = 'excused') AS excused_count
       FROM attendance_records
       WHERE ${conditions.join(' AND ')}
       GROUP BY attendance_date
       ORDER BY attendance_date DESC`,
      params
    );

    const dates = result.rows.map((row) => ({
      date: row.attendance_date.toISOString().slice(0, 10),
      periods: row.periods,
      markedCount: parseInt(row.marked_count, 10),
      presentCount: parseInt(row.present_count, 10),
      absentCount: parseInt(row.absent_count, 10),
      lateCount: parseInt(row.late_count, 10),
      sickCount: parseInt(row.sick_count, 10),
      excusedCount: parseInt(row.excused_count, 10),
    }));

    res.status(200).json({ success: true, data: dates, count: dates.length });
  } catch (error) {
    console.error('❌ [attendance] /dates error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/day/:classId?date=&sessionId=&period=
// Roster merged with that day's marks (unmarked students come back
// with status: null so the client can render an empty cell).
// ─────────────────────────────────────────────────────────────
router.get('/day/:classId', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);
    const period = req.query.period || 'full_day';
    const date = req.query.date;

    if (!classId || !sessionId || !date) {
      return res.status(400).json({ success: false, error: 'classId, sessionId, and date are required.' });
    }
    if (!isValidDate(date)) {
      return res.status(400).json({ success: false, error: 'date must be in YYYY-MM-DD format.' });
    }
    if (!ATTENDANCE_PERIODS.includes(period)) {
      return res.status(400).json({ success: false, error: `period must be one of: ${ATTENDANCE_PERIODS.join(', ')}` });
    }

    const roster = await loadRoster(schoolId, classId, sessionId);

    const marks = await pool.query(
      `SELECT enrollment_id, status, remarks, marked_by_type, updated_at
       FROM attendance_records
       WHERE school_id = $1 AND class_id = $2 AND attendance_date = $3 AND period = $4`,
      [schoolId, classId, date, period]
    );
    const marksByEnrollment = new Map(marks.rows.map((m) => [m.enrollment_id, m]));

    const students = roster.map((student) => {
      const mark = marksByEnrollment.get(student.enrollment_id);
      return {
        ...student,
        status: mark?.status || null,
        remarks: mark?.remarks || null,
        markedByType: mark?.marked_by_type || null,
        markedAt: mark?.updated_at || null,
      };
    });

    res.status(200).json({
      success: true,
      data: { date, period, students },
      count: students.length,
      markedCount: marks.rows.length,
    });
  } catch (error) {
    console.error('❌ [attendance] /day error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/attendance/mark
// Bulk roll-call submission for one class/date/period.
// Body: {
//   classId, sessionId, term, date, period ('full_day'|'morning'|'afternoon'),
//   records: [{ enrollmentId, status, remarks? }, ...]
// }
// ─────────────────────────────────────────────────────────────
router.post(
  '/mark',
  checkSubscription,
  requireClassAccess((req) => req.body?.classId),
  auditRoute('attendance.marked', (req, body) => ({
    type: 'attendance',
    id: req.body?.classId,
    details: { date: req.body?.date, period: req.body?.period, count: body?.data?.saved },
  })),
  async (req, res) => {
    // Validation happens on the shared pool (no transaction needed yet)
    // so an early return never leaks a checked-out client. A dedicated
    // client is only acquired once we're actually ready to BEGIN.
    try {
      const schoolId = req.user.schoolId;
      const actor = req.attendanceActor;
      const { classId, sessionId, term, date, period = 'full_day', records } = req.body;

      if (!classId || !sessionId || !term || !date || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'classId, sessionId, term, date, and a non-empty records array are required.',
        });
      }
      if (![1, 2, 3].includes(parseInt(term))) {
        return res.status(400).json({ success: false, error: 'term must be 1, 2, or 3.' });
      }
      if (!isValidDate(date)) {
        return res.status(400).json({ success: false, error: 'date must be in YYYY-MM-DD format.' });
      }
      if (!isWeekday(date)) {
        return res.status(400).json({ success: false, error: 'Attendance can only be marked Monday to Friday.' });
      }
      if (!ATTENDANCE_PERIODS.includes(period)) {
        return res.status(400).json({ success: false, error: `period must be one of: ${ATTENDANCE_PERIODS.join(', ')}` });
      }

      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (!r.enrollmentId || !ATTENDANCE_STATUSES.includes(r.status)) {
          return res.status(400).json({
            success: false,
            error: `Record ${i + 1}: enrollmentId is required and status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`,
          });
        }
      }

      // Confirm every enrollment named actually belongs to this class /
      // school / session, so a stray or spoofed enrollmentId can't
      // write an attendance row against another class.
      const enrollmentIds = records.map((r) => parseInt(r.enrollmentId));
      const validEnrollments = await pool.query(
        `SELECT id, student_id FROM enrollments
         WHERE id = ANY($1::int[]) AND school_id = $2 AND class_id = $3 AND session_id = $4 AND status = 'active'`,
        [enrollmentIds, schoolId, classId, sessionId]
      );
      const validMap = new Map(validEnrollments.rows.map((e) => [e.id, e.student_id]));
      const invalid = enrollmentIds.filter((id) => !validMap.has(id));
      if (invalid.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Some enrollments are not active in this class/session.',
          invalidEnrollmentIds: invalid,
        });
      }

      const client = await pool.connect();
      const saved = [];
      try {
        await client.query('BEGIN');
        for (const r of records) {
          const enrollmentId = parseInt(r.enrollmentId);
          const result = await client.query(
            `INSERT INTO attendance_records (
               school_id, class_id, enrollment_id, student_id, session_id, term,
               attendance_date, period, status, remarks, marked_by_type, marked_by_staff_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (enrollment_id, attendance_date, period)
             DO UPDATE SET
               status = EXCLUDED.status,
               remarks = EXCLUDED.remarks,
               marked_by_type = EXCLUDED.marked_by_type,
               marked_by_staff_id = EXCLUDED.marked_by_staff_id,
               updated_at = CURRENT_TIMESTAMP
             RETURNING id, enrollment_id, status, remarks`,
            [
              schoolId, classId, enrollmentId, validMap.get(enrollmentId), sessionId, parseInt(term),
              date, period, r.status, r.remarks || null, actor.actorType, actor.staffId,
            ]
          );
          saved.push(result.rows[0]);
        }

        await client.query('COMMIT');
        res.status(200).json({ success: true, data: { date, period, saved: saved.length, records: saved } });
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ [attendance] /mark error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Internal Server Error' });
      }
    }
  }
);

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/week/:classId?weekStart=&sessionId=&period=
// Daily and weekly attendance grid — Monday to Friday for the week
// containing weekStart, plus daily boy/girl/overall totals.
// ─────────────────────────────────────────────────────────────
router.get('/week/:classId', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);
    const period = req.query.period || 'full_day';
    const anyDateInWeek = req.query.weekStart;

    if (!classId || !sessionId || !anyDateInWeek) {
      return res.status(400).json({ success: false, error: 'classId, sessionId, and weekStart are required.' });
    }
    if (!isValidDate(anyDateInWeek)) {
      return res.status(400).json({ success: false, error: 'weekStart must be in YYYY-MM-DD format.' });
    }
    if (!ATTENDANCE_PERIODS.includes(period)) {
      return res.status(400).json({ success: false, error: `period must be one of: ${ATTENDANCE_PERIODS.join(', ')}` });
    }

    const monday = mondayOf(anyDateInWeek);
    const weekDates = [0, 1, 2, 3, 4].map((n) => addDays(monday, n)); // Mon-Fri

    const roster = await loadRoster(schoolId, classId, sessionId);

    const marks = await pool.query(
      `SELECT enrollment_id, attendance_date, status
       FROM attendance_records
       WHERE school_id = $1 AND class_id = $2 AND session_id = $3
         AND attendance_date BETWEEN $4 AND $5 AND period = $6`,
      [schoolId, classId, sessionId, monday, weekDates[4], period]
    );

    const grid = new Map(); // enrollment_id -> { date: status }
    for (const m of marks.rows) {
      const dateKey = m.attendance_date.toISOString().slice(0, 10);
      if (!grid.has(m.enrollment_id)) grid.set(m.enrollment_id, {});
      grid.get(m.enrollment_id)[dateKey] = m.status;
    }

    const students = roster.map((student) => ({
      enrollmentId: student.enrollment_id,
      serial: student.serial,
      firstName: student.first_name,
      lastName: student.last_name,
      registrationNumber: student.registration_number,
      gender: student.gender,
      days: weekDates.reduce((acc, d) => {
        acc[d] = grid.get(student.enrollment_id)?.[d] || null;
        return acc;
      }, {}),
    }));

    const dailyTotals = weekDates.map((date) => {
      const boysPresent = students.filter((s) => (s.gender || '').toLowerCase() === 'male' && ['present', 'late'].includes(s.days[date])).length;
      const girlsPresent = students.filter((s) => (s.gender || '').toLowerCase() === 'female' && ['present', 'late'].includes(s.days[date])).length;
      return { date, boysPresent, girlsPresent, totalPresent: boysPresent + girlsPresent };
    });

    res.status(200).json({
      success: true,
      data: { weekStart: monday, weekEnd: weekDates[4], period, students, dailyTotals },
      count: students.length,
    });
  } catch (error) {
    console.error('❌ [attendance] /week error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Shared builder used by both the JSON broadsheet route and the PDF
// export route below, so the two never drift apart.
async function buildBroadsheet(schoolId, classId, sessionId, term, period) {
  const roster = await loadRoster(schoolId, classId, sessionId);

  const marks = await pool.query(
    `SELECT enrollment_id, attendance_date, status
     FROM attendance_records
     WHERE school_id = $1 AND class_id = $2 AND session_id = $3 AND term = $4 AND period = $5
     ORDER BY attendance_date ASC`,
    [schoolId, classId, sessionId, term, period]
  );

  if (marks.rows.length === 0) {
    return { period, dates: [], students: [], dailyTotals: [] };
  }

  // Distinct, ordered list of dates that actually have records —
  // these become the broadsheet's columns.
  const dateSet = new Set();
  const grid = new Map(); // enrollment_id -> { date: status }
  for (const m of marks.rows) {
    const dateKey = m.attendance_date.toISOString().slice(0, 10);
    dateSet.add(dateKey);
    if (!grid.has(m.enrollment_id)) grid.set(m.enrollment_id, {});
    grid.get(m.enrollment_id)[dateKey] = m.status;
  }
  const dates = Array.from(dateSet).sort();

  const students = roster.map((student) => {
    const days = grid.get(student.enrollment_id) || {};
    const totalPresent = dates.filter((d) => ['present', 'late'].includes(days[d])).length;
    const totalAbsent = dates.filter((d) => days[d] === 'absent').length;
    const totalMarked = dates.filter((d) => !!days[d]).length;
    return {
      enrollmentId: student.enrollment_id,
      serial: student.serial,
      firstName: student.first_name,
      lastName: student.last_name,
      registrationNumber: student.registration_number,
      gender: student.gender,
      days: dates.reduce((acc, d) => {
        acc[d] = days[d] || null;
        return acc;
      }, {}),
      totalPresent,
      totalAbsent,
      percentageAttendance: dates.length > 0 ? Number(((totalPresent / dates.length) * 100).toFixed(1)) : null,
    };
  });

  const dailyTotals = dates.map((date) => {
    const boysPresent = students.filter((s) => (s.gender || '').toLowerCase() === 'male' && ['present', 'late'].includes(s.days[date])).length;
    const girlsPresent = students.filter((s) => (s.gender || '').toLowerCase() === 'female' && ['present', 'late'].includes(s.days[date])).length;
    return { date, boysPresent, girlsPresent, totalPresent: boysPresent + girlsPresent };
  });

  return { period, dates, students, dailyTotals };
}

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/broadsheet/:classId?sessionId=&term=&period=
// Full-term register: every student against EVERY saved date for the
// class/session/term/period — not just one week. Columns are built
// only from dates that actually have marks, so there are never blank
// columns for days nobody took the register. This is the "broadsheet"
// view of the saved attendance records.
// ─────────────────────────────────────────────────────────────
router.get('/broadsheet/:classId', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);
    const term = parseInt(req.query.term);
    const period = req.query.period || 'full_day';

    if (!classId || !sessionId || !term) {
      return res.status(400).json({ success: false, error: 'classId, sessionId, and term are required.' });
    }
    if (![1, 2, 3].includes(term)) {
      return res.status(400).json({ success: false, error: 'term must be 1, 2, or 3.' });
    }
    if (!ATTENDANCE_PERIODS.includes(period)) {
      return res.status(400).json({ success: false, error: `period must be one of: ${ATTENDANCE_PERIODS.join(', ')}` });
    }

    const { dates, students, dailyTotals } = await buildBroadsheet(schoolId, classId, sessionId, term, period);

    res.status(200).json({
      success: true,
      data: { period, dates, students, dailyTotals },
      count: students.length,
    });
  } catch (error) {
    console.error('❌ [attendance] /broadsheet error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/broadsheet/:classId/pdf?sessionId=&term=&period=
// Downloadable PDF version of the broadsheet above — same data,
// rendered as a printable register. Dates are chunked across pages
// (18 columns per page) so the table stays readable no matter how
// many days have been recorded for the term.
// ─────────────────────────────────────────────────────────────
router.get('/broadsheet/:classId/pdf', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);
    const term = parseInt(req.query.term);
    const period = req.query.period || 'full_day';

    if (!classId || !sessionId || !term) {
      return res.status(400).json({ success: false, error: 'classId, sessionId, and term are required.' });
    }
    if (![1, 2, 3].includes(term)) {
      return res.status(400).json({ success: false, error: 'term must be 1, 2, or 3.' });
    }
    if (!ATTENDANCE_PERIODS.includes(period)) {
      return res.status(400).json({ success: false, error: `period must be one of: ${ATTENDANCE_PERIODS.join(', ')}` });
    }

    const { dates, students, dailyTotals } = await buildBroadsheet(schoolId, classId, sessionId, term, period);

    const infoResult = await pool.query(
      `SELECT c.class_name, sch.name AS school_name, COALESCE(ay.session_name, '') AS session_name
       FROM classes c
       JOIN schools sch ON sch.id = c.school_id
       LEFT JOIN academic_years ay ON ay.id = $3
       WHERE c.id = $1 AND c.school_id = $2`,
      [classId, schoolId, sessionId]
    );
    const info = infoResult.rows[0] || {};
    const className = info.class_name || 'Class';
    const termLabel = `Term ${term}`;

    const filename = `${className}_${termLabel}_Broadsheet.pdf`.replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', layout: 'landscape', margin: 28 });
    doc.pipe(res);

    const drawHeader = () => {
      doc.addPage();
      doc.fontSize(15).font('Helvetica-Bold').text(info.school_name || 'School', { align: 'center' });
      doc.fontSize(11).font('Helvetica-Bold').text(`Attendance Broadsheet — ${className}`, { align: 'center' });
      doc.fontSize(9).font('Helvetica').fillColor('#555555').text(
        `${termLabel} · ${info.session_name || ''} · ${period.replace('_', ' ')}`,
        { align: 'center' }
      );
      doc.fillColor('#000000');
      doc.moveDown(0.8);
    };

    if (dates.length === 0) {
      drawHeader();
      doc.fontSize(11).text('No attendance records saved for this term yet.', { align: 'center' });
      doc.end();
      return;
    }

    const nameColWidth = 130;
    const pctColWidth = 34;
    const rowHeight = 16;
    const headerRowHeight = 30;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const dateColWidth = 22;
    const maxDateCols = Math.max(1, Math.floor((usableWidth - nameColWidth - pctColWidth) / dateColWidth));

    // Split the date columns into pages so the table never gets
    // squeezed unreadably thin.
    const datePages = [];
    for (let i = 0; i < dates.length; i += maxDateCols) {
      datePages.push(dates.slice(i, i + maxDateCols));
    }

    const shortDate = (iso) => {
      const [, m, d] = iso.split('-');
      return `${d}/${m}`;
    };
    const codeFor = (status) => {
      const found = ATTENDANCE_LEGEND.find((l) => l.status === status);
      return found ? found.code : (status ? status[0].toUpperCase() : '');
    };

    datePages.forEach((pageDates, pageIndex) => {
      drawHeader();
      let y = doc.y;
      let x = doc.page.margins.left;

      // Header row
      doc.font('Helvetica-Bold').fontSize(8);
      doc.rect(x, y, nameColWidth, headerRowHeight).stroke();
      doc.text('Student', x + 3, y + 10, { width: nameColWidth - 6 });
      let cx = x + nameColWidth;
      pageDates.forEach((d) => {
        doc.rect(cx, y, dateColWidth, headerRowHeight).stroke();
        doc.save();
        doc.rotate(-45, { origin: [cx + dateColWidth / 2, y + headerRowHeight / 2] });
        doc.text(shortDate(d), cx - 8, y + headerRowHeight / 2 - 4, { width: 40 });
        doc.restore();
        cx += dateColWidth;
      });
      doc.rect(cx, y, pctColWidth, headerRowHeight).stroke();
      doc.text('%', cx, y + 10, { width: pctColWidth, align: 'center' });
      y += headerRowHeight;

      // Student rows
      doc.font('Helvetica').fontSize(8);
      students.forEach((student) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          drawHeader();
          y = doc.y;
        }
        x = doc.page.margins.left;
        doc.rect(x, y, nameColWidth, rowHeight).stroke();
        const label = `${student.serial ? student.serial + '. ' : ''}${student.firstName} ${student.lastName}`;
        doc.text(label, x + 3, y + 4, { width: nameColWidth - 6, ellipsis: true });
        cx = x + nameColWidth;
        pageDates.forEach((d) => {
          doc.rect(cx, y, dateColWidth, rowHeight).stroke();
          const status = student.days[d];
          doc.text(status ? codeFor(status) : '—', cx, y + 4, { width: dateColWidth, align: 'center' });
          cx += dateColWidth;
        });
        doc.rect(cx, y, pctColWidth, rowHeight).stroke();
        doc.text(
          student.percentageAttendance !== null ? `${student.percentageAttendance}%` : '—',
          cx, y + 4, { width: pctColWidth, align: 'center' }
        );
        y += rowHeight;
      });

      // Totals row
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        drawHeader();
        y = doc.y;
      }
      x = doc.page.margins.left;
      doc.font('Helvetica-Bold');
      doc.rect(x, y, nameColWidth, rowHeight).stroke();
      doc.text('Total Present', x + 3, y + 4, { width: nameColWidth - 6 });
      cx = x + nameColWidth;
      pageDates.forEach((d) => {
        const totals = dailyTotals.find((t) => t.date === d);
        doc.rect(cx, y, dateColWidth, rowHeight).stroke();
        doc.text(totals ? String(totals.totalPresent) : '—', cx, y + 4, { width: dateColWidth, align: 'center' });
        cx += dateColWidth;
      });
      doc.rect(cx, y, pctColWidth, rowHeight).stroke();

      if (pageIndex < datePages.length - 1) {
        doc.font('Helvetica').fontSize(7).fillColor('#888888')
          .text(`(continued on next page — ${datePages.length - pageIndex - 1} more page(s))`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 4);
        doc.fillColor('#000000');
      }
    });

    doc.end();
  } catch (error) {
    console.error('❌ [attendance] /broadsheet/pdf error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    } else {
      res.end();
    }
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/attendance/summary/:classId?sessionId=&term=&minPercentage=
// Terminal / sessional summary per student: times school opened,
// times present/absent/late/sick, percentage, and whether they meet
// the promotion attendance threshold (default 75%).
// ─────────────────────────────────────────────────────────────
router.get('/summary/:classId', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);
    const term = parseInt(req.query.term);
    const minPercentage = req.query.minPercentage ? parseFloat(req.query.minPercentage) : 75;

    if (!classId || !sessionId || !term) {
      return res.status(400).json({ success: false, error: 'classId, sessionId, and term are required.' });
    }
    if (![1, 2, 3].includes(term)) {
      return res.status(400).json({ success: false, error: 'term must be 1, 2, or 3.' });
    }

    // "Times school opened" = number of distinct (date, period)
    // combinations that HAVE at least one attendance record for this
    // class/term — i.e. sessions actually held and taken register for.
    const sessionsHeldResult = await pool.query(
      `SELECT COUNT(*) FROM (
         SELECT DISTINCT attendance_date, period FROM attendance_records
         WHERE school_id = $1 AND class_id = $2 AND session_id = $3 AND term = $4
       ) t`,
      [schoolId, classId, sessionId, term]
    );
    const sessionsHeld = parseInt(sessionsHeldResult.rows[0].count, 10);

    const roster = await loadRoster(schoolId, classId, sessionId);

    const perStudent = await pool.query(
      `SELECT
         enrollment_id,
         COUNT(*) FILTER (WHERE status = 'present') AS present_count,
         COUNT(*) FILTER (WHERE status = 'late') AS late_count,
         COUNT(*) FILTER (WHERE status = 'absent') AS absent_count,
         COUNT(*) FILTER (WHERE status = 'sick') AS sick_count,
         COUNT(*) FILTER (WHERE status = 'excused') AS excused_count,
         COUNT(*) AS total_marked
       FROM attendance_records
       WHERE school_id = $1 AND class_id = $2 AND session_id = $3 AND term = $4
       GROUP BY enrollment_id`,
      [schoolId, classId, sessionId, term]
    );
    const statsByEnrollment = new Map(perStudent.rows.map((row) => [row.enrollment_id, row]));

    const remarksResult = await pool.query(
      `SELECT enrollment_id, remarks FROM attendance_term_remarks
       WHERE school_id = $1 AND session_id = $2 AND term = $3`,
      [schoolId, sessionId, term]
    );
    const remarksByEnrollment = new Map(remarksResult.rows.map((row) => [row.enrollment_id, row.remarks]));

    const students = roster.map((student) => {
      const stats = statsByEnrollment.get(student.enrollment_id);
      const timesPresent = stats ? parseInt(stats.present_count, 10) + parseInt(stats.late_count, 10) : 0;
      const timesAbsent = stats ? parseInt(stats.absent_count, 10) : 0;
      const percentage = sessionsHeld > 0 ? Number(((timesPresent / sessionsHeld) * 100).toFixed(1)) : null;

      return {
        enrollmentId: student.enrollment_id,
        serial: student.serial,
        firstName: student.first_name,
        lastName: student.last_name,
        registrationNumber: student.registration_number,
        gender: student.gender,
        timesSchoolOpened: sessionsHeld,
        timesPresent,
        timesAbsent,
        timesLate: stats ? parseInt(stats.late_count, 10) : 0,
        timesSick: stats ? parseInt(stats.sick_count, 10) : 0,
        timesExcused: stats ? parseInt(stats.excused_count, 10) : 0,
        percentageAttendance: percentage,
        meetsPromotionRequirement: percentage === null ? null : percentage >= minPercentage,
        remarks: remarksByEnrollment.get(student.enrollment_id) || null,
      };
    });

    res.status(200).json({
      success: true,
      data: { sessionsHeld, minPercentage, students },
      count: students.length,
    });
  } catch (error) {
    console.error('❌ [attendance] /summary error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/attendance/summary/:classId/remarks
// Class teacher's per-student terminal remark ("chronic absenteeism",
// "exemplary punctuality", etc).
// Body: { sessionId, term, enrollmentId, remarks }
// ─────────────────────────────────────────────────────────────
router.put('/summary/:classId/remarks', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const actor = req.attendanceActor;
    const classId = parseInt(req.params.classId);
    const { sessionId, term, enrollmentId, remarks } = req.body;

    if (!sessionId || !term || !enrollmentId) {
      return res.status(400).json({ success: false, error: 'sessionId, term, and enrollmentId are required.' });
    }

    const enrolled = await pool.query(
      `SELECT 1 FROM enrollments WHERE id = $1 AND school_id = $2 AND class_id = $3 AND session_id = $4`,
      [enrollmentId, schoolId, classId, sessionId]
    );
    if (enrolled.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Enrollment not found for this class/session.' });
    }

    const result = await pool.query(
      `INSERT INTO attendance_term_remarks (school_id, enrollment_id, session_id, term, remarks, updated_by_type, updated_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (enrollment_id, session_id, term)
       DO UPDATE SET remarks = EXCLUDED.remarks, updated_by_type = EXCLUDED.updated_by_type,
                      updated_by_staff_id = EXCLUDED.updated_by_staff_id, updated_at = CURRENT_TIMESTAMP
       RETURNING enrollment_id, remarks`,
      [schoolId, enrollmentId, sessionId, term, remarks || null, actor.actorType, actor.staffId]
    );

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ [attendance] /summary/:classId/remarks error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Weekly sign-off — teacher's declaration, principal's oversight,
// ministry inspector's verification. Independent blocks; any of the
// three can be filled in whenever that party is ready.
// ─────────────────────────────────────────────────────────────

// GET /api/attendance/signoff/:classId?sessionId=&term=&weekNumber=
router.get('/signoff/:classId', checkSubscription, requireClassAccess((req) => req.params.classId), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const classId = parseInt(req.params.classId);
    const sessionId = parseInt(req.query.sessionId);
    const term = parseInt(req.query.term);
    const weekNumber = parseInt(req.query.weekNumber);

    if (!sessionId || !term || !weekNumber) {
      return res.status(400).json({ success: false, error: 'sessionId, term, and weekNumber are required.' });
    }

    const result = await pool.query(
      `SELECT * FROM attendance_weekly_signoffs WHERE school_id = $1 AND class_id = $2 AND session_id = $3 AND term = $4 AND week_number = $5`,
      [schoolId, classId, sessionId, term, weekNumber]
    );

    res.status(200).json({ success: true, data: result.rows[0] || null });
  } catch (error) {
    console.error('❌ [attendance] GET /signoff error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /api/attendance/signoff/:classId
// Body: { sessionId, term, weekNumber, role: 'teacher'|'principal'|'inspector', name?, notes? }
// 'teacher' -> the class_teacher assigned to this class (or the owner,
//   standing in as class teacher for classes with no dedicated teacher).
// 'principal' / 'inspector' -> owner or a full (non-class-scoped) admin
//   only; a class_teacher cannot sign off their own register as principal.
router.post(
  '/signoff/:classId',
  checkSubscription,
  requireClassAccess((req) => req.params.classId),
  auditRoute('attendance.weekly_signoff', (req) => ({
    type: 'attendance_signoff',
    id: req.params.classId,
    details: { role: req.body?.role, weekNumber: req.body?.weekNumber },
  })),
  async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const actor = req.attendanceActor;
      const classId = parseInt(req.params.classId);
      const { sessionId, term, weekNumber, role, name, notes } = req.body;

      if (!sessionId || !term || !weekNumber || !role) {
        return res.status(400).json({ success: false, error: 'sessionId, term, weekNumber, and role are required.' });
      }
      if (!['teacher', 'principal', 'inspector'].includes(role)) {
        return res.status(400).json({ success: false, error: "role must be 'teacher', 'principal', or 'inspector'." });
      }
      if ((role === 'principal' || role === 'inspector') && actor.isClassTeacher) {
        return res.status(403).json({
          success: false,
          error: `Only the school owner or an administrator can record the ${role}'s sign-off.`,
        });
      }
      if ((role === 'principal' || role === 'inspector') && !name) {
        return res.status(400).json({ success: false, error: `name is required to record the ${role}'s sign-off.` });
      }

      // Each branch lists its sign-off columns in BOTH the INSERT and
      // the ON CONFLICT DO UPDATE clause. This matters: Postgres only
      // runs DO UPDATE when a conflict actually happens — on a brand
      // new row (first ever sign-off for that week) it's a plain
      // INSERT, so anything left out of the VALUES list would stay
      // NULL instead of being recorded.
      let query;
      let values;
      if (role === 'teacher') {
        query = `
          INSERT INTO attendance_weekly_signoffs
            (school_id, class_id, session_id, term, week_number, teacher_signed_at, teacher_signed_by_type, teacher_signed_by_staff_id)
          VALUES ($1,$2,$3,$4,$5, CURRENT_TIMESTAMP, $6, $7)
          ON CONFLICT (class_id, session_id, term, week_number)
          DO UPDATE SET teacher_signed_at = CURRENT_TIMESTAMP, teacher_signed_by_type = EXCLUDED.teacher_signed_by_type,
                         teacher_signed_by_staff_id = EXCLUDED.teacher_signed_by_staff_id, updated_at = CURRENT_TIMESTAMP
          RETURNING *`;
        values = [schoolId, classId, sessionId, term, weekNumber, actor.actorType, actor.staffId];
      } else if (role === 'principal') {
        query = `
          INSERT INTO attendance_weekly_signoffs
            (school_id, class_id, session_id, term, week_number, principal_signed_at, principal_name, principal_signed_by_staff_id)
          VALUES ($1,$2,$3,$4,$5, CURRENT_TIMESTAMP, $6, $7)
          ON CONFLICT (class_id, session_id, term, week_number)
          DO UPDATE SET principal_signed_at = CURRENT_TIMESTAMP, principal_name = EXCLUDED.principal_name,
                         principal_signed_by_staff_id = EXCLUDED.principal_signed_by_staff_id, updated_at = CURRENT_TIMESTAMP
          RETURNING *`;
        values = [schoolId, classId, sessionId, term, weekNumber, name, actor.staffId];
      } else {
        query = `
          INSERT INTO attendance_weekly_signoffs
            (school_id, class_id, session_id, term, week_number, inspector_signed_at, inspector_name, inspector_notes)
          VALUES ($1,$2,$3,$4,$5, CURRENT_TIMESTAMP, $6, $7)
          ON CONFLICT (class_id, session_id, term, week_number)
          DO UPDATE SET inspector_signed_at = CURRENT_TIMESTAMP, inspector_name = EXCLUDED.inspector_name,
                         inspector_notes = EXCLUDED.inspector_notes, updated_at = CURRENT_TIMESTAMP
          RETURNING *`;
        values = [schoolId, classId, sessionId, term, weekNumber, name, notes || null];
      }

      const result = await pool.query(query, values);

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error('❌ [attendance] POST /signoff error:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  }
);

module.exports = router;
