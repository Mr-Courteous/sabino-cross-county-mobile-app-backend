const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');

// Apply authentication middleware to all score routes
router.use(authMiddleware.authenticateToken);

/**
 * SCORING SYSTEM - ENROLLMENT-BASED EDUCATIONAL DATA MODEL
 * 
 * Architecture:
 * - Enrollment links students to classes per academic session (allows promotions/repeaters)
 * - Scores tied to enrollment_id instead of direct student-class relationship
 * - 4 CA (Continuous Assessment) scores per subject per term
 * - 3 terms per academic session
 * - Multiple academic sessions with full historical tracking
 * - COALESCE usage for partial score updates (independent CA/exam updates)
 * - PostgreSQL Generated Column for automatic total_score calculation
 * 
 * CA Score Breakdown:
 *   - CA1, CA2, CA3, CA4: Individual continuous assessment scores (0-20 each)
 *   - Exam Score: End-of-term examination score (0-40)
 *   - Total: Sum of all CA scores + Exam score = 0-100
 */

/**
 * @route   POST /api/scores/record
 * @desc    Create or update scores with country-based data isolation
 *          Supports both single and bulk score entries
 * @access  Private (Authenticated Teachers)
 * @body    Single: {
 *            enrollment_id: Number,
 *            subject_id: Number,
 *            ca1: Number (0-20),
 *            ca2: Number (0-20),
 *            ca3: Number (0-20),
 *            ca4: Number (0-20),
 *            exam: Number (0-40),
 *            session: String,
 *            term: String
 *          }
 *          Bulk: {
 *            scores: [{ ...above fields }, ...]
 *          }
 */


/**
 * @route   GET /api/scores/sheet
 * @desc    Get all students in a class with their scores for a specific subject and term
 *          Returns pre-populated scores if they exist for the selected criteria
 * @access  Private
 * @query   {
 *            classId: Number (required),
 *            subjectId: Number (required),
 *            sessionId: Number (required - ID from academic_years table),
 *            termId: Number (required - 1, 2, or 3)
 *          }
 */
router.get('/sheet', async (req, res) => {
  try {
    // STRICT SECURITY: Extract schoolId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;
    const { classId, subjectId, sessionId, termId } = req.query;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    // Validate query parameters
    if (!classId || !subjectId || !sessionId || !termId) {
      return res.status(400).json({
        success: false,
        error: 'classId, subjectId, sessionId, and termId are required'
      });
    }

    if (![1, 2, 3].includes(parseInt(termId))) {
      return res.status(400).json({
        success: false,
        error: 'termId must be 1, 2, or 3'
      });
    }

    const query = `
      SELECT 
        s.id as student_id,
        s.first_name,
        s.last_name,
        e.id as enrollment_id,
        COALESCE(sc.id, 0) as score_id,
        COALESCE(sc.ca1_score, NULL) as ca1_score,
        COALESCE(sc.ca2_score, NULL) as ca2_score,
        COALESCE(sc.ca3_score, NULL) as ca3_score,
        COALESCE(sc.ca4_score, NULL) as ca4_score,
        COALESCE(sc.exam_score, NULL) as exam_score
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      LEFT JOIN scores sc ON 
        sc.enrollment_id = e.id 
        AND sc.subject_id = $1
        AND sc.session_id = $2
        AND sc.term = $3
        AND sc.school_id = $5
      WHERE e.class_id = $4 
        AND e.session_id = $2
        AND e.school_id = $5
      ORDER BY s.last_name ASC, s.first_name ASC
    `;

    const result = await pool.query(query, [
      subjectId,      // $1: subject_id
      sessionId,      // $2: academic_session
      termId,         // $3: term
      classId,        // $4: class_id
      schoolId        // $5: school_id
    ]);

    console.log(`✓ Scoring sheet retrieved: ${result.rowCount} students for class=${classId}, subject=${subjectId}, session=${sessionId}, term=${termId}`);

    // Check if no students found
    if (result.rowCount === 0) {
      console.warn(`⚠️ No students found for class=${classId}, session=${sessionId}, term=${termId}`);
      return res.status(404).json({
        success: false,
        error: 'No students found',
        message: `No students are enrolled in this class for this session and term combination. Please verify the class, session, and term selection.`,
        count: 0,
        data: []
      });
    }

    res.json({
      success: true,
      message: `Found ${result.rowCount} students ready for scoring`,
      data: result.rows,
      count: result.rowCount
    });
  } catch (error) {
    console.error('❌ Scoring sheet fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to load scoring sheet. Please try again.'
    });
  }
});



/**
 * @route   POST /api/scores/record
 * @desc    Create or update scores with bulk payload support and UPSERT strategy
 *          All or nothing transaction - if any score fails, entire save is rolled back
 * @access  Private (Authenticated Teachers)
 * @body    Single: {
 *            enrollment_id: Number,
 *            subject_id: Number,
 *            term_id: Number (1-3),
 *            sessionId: Number,
 *            ca1_score: Number (0-20, optional),
 *            ca2_score: Number (0-20, optional),
 *            ca3_score: Number (0-20, optional),
 *            ca4_score: Number (0-20, optional),
 *            exam_score: Number (0-40, optional)
 *          }
 *          Bulk: {
 *            scores: [
 *              { ...above fields },
 *              ...
 *            ]
 *          }
 */
router.post('/record', async (req, res) => {
  const client = await pool.connect();

  try {
    // STRICT SECURITY: Extract schoolId and countryId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;
    const countryId = req.user?.countryId;
    const userId = req.user?.id;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    if (!countryId) {
      return res.status(401).json({
        success: false,
        error: 'Country context missing. Please login again.'
      });
    }

    // Handle both single and bulk score entries
    let scores = req.body.scores ? req.body.scores : [req.body];

    if (!Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'Provide score(s) in correct format'
      });
    }

    console.log(`📝 Processing ${scores.length} score records with UPSERT strategy...`);

    // Validate all scores BEFORE starting transaction
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i];
      const {
        enrollment_id,
        subject_id,
        term_id,
        sessionId,
        ca1_score,
        ca2_score,
        ca3_score,
        ca4_score,
        exam_score
      } = score;

      // Validate required fields
      if (!enrollment_id || !subject_id || !term_id || !sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Score ${i + 1}: enrollment_id, subject_id, term_id, and sessionId are required`
        });
      }

      // Validate term_id is 1, 2, or 3
      if (![1, 2, 3].includes(parseInt(term_id))) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Score ${i + 1}: term_id must be 1, 2, or 3`
        });
      }

      // Validate score ranges (if provided)
      const caScores = [ca1_score, ca2_score, ca3_score, ca4_score];
      for (const ca of caScores) {
        if (ca !== null && ca !== undefined && (ca < 0 || ca > 20)) {
          return res.status(400).json({
            success: false,
            message: 'Validation Error',
            error: `Score ${i + 1}: CA scores must be between 0 and 20`
          });
        }
      }

      if (exam_score !== null && exam_score !== undefined && (exam_score < 0 || exam_score > 40)) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Score ${i + 1}: Exam score must be between 0 and 40`
        });
      }

      console.log(`✓ Score ${i + 1} validation passed (enrollment_id=${enrollment_id}, subject_id=${subject_id}, term_id=${term_id}, sessionId=${sessionId})`);
    }

    // All validations passed, start transaction
    await client.query('BEGIN');
    console.log('🔄 Transaction started');

    const results = [];

    // Process each score with security checks inside transaction
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i];
      const {
        enrollment_id,
        subject_id,
        term_id,
        sessionId,
        ca1_score = null,
        ca2_score = null,
        ca3_score = null,
        ca4_score = null,
        exam_score = null
      } = score;

      // SECURITY: Verify enrollment belongs to the authenticated school
      const enrollmentCheck = await client.query(
        'SELECT id FROM enrollments WHERE id = $1 AND school_id = $2',
        [enrollment_id, schoolId]
      );

      if (enrollmentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error(`❌ Score ${i + 1}: Enrollment not found in school`);
        return res.status(403).json({
          success: false,
          message: 'Unauthorized',
          error: `Score ${i + 1}: Enrollment not found in your school`
        });
      }

      // SECURITY: Verify subject/template belongs to the country
      // const subjectCheck = await client.query(
      //   `SELECT id, display_name, country_id
      //    FROM global_class_templates 
      //    WHERE id = $1 AND country_id = $2`,
      //   [subject_id, countryId]
      // );

      // if (subjectCheck.rows.length === 0) {
      //   await client.query('ROLLBACK');
      //   console.error(`❌ Score ${i + 1}: Subject not found for country`);
      //   return res.status(403).json({
      //     success: false,
      //     message: 'Unauthorized',
      //     error: `Score ${i + 1}: Subject (ID: ${subject_id}) is not available for your country`
      //   });
      // }

      // UPSERT with ON CONFLICT strategy
      const result = await client.query(
        `INSERT INTO scores (
    school_id, enrollment_id, subject_id, session_id, term,
    ca1_score, ca2_score, ca3_score, ca4_score, exam_score, updated_by
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (school_id, enrollment_id, subject_id, session_id, term)
  DO UPDATE SET
    ca1_score = COALESCE(EXCLUDED.ca1_score, scores.ca1_score),
    ca2_score = COALESCE(EXCLUDED.ca2_score, scores.ca2_score),
    ca3_score = COALESCE(EXCLUDED.ca3_score, scores.ca3_score),
    ca4_score = COALESCE(EXCLUDED.ca4_score, scores.ca4_score),
    exam_score = COALESCE(EXCLUDED.exam_score, scores.exam_score),
    updated_by = EXCLUDED.updated_by,
    updated_at = CURRENT_TIMESTAMP
  RETURNING *`,
        [
          schoolId,          // $1
          enrollment_id,     // $2
          subject_id,        // $3
          sessionId,         // $4
          term_id,           // $5
          ca1_score,         // $6
          ca2_score,         // $7
          ca3_score,         // $8
          ca4_score,         // $9
          exam_score,        // $10
          userId             // $11
        ]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error(`❌ Score ${i + 1}: UPSERT failed`);
        return res.status(500).json({
          success: false,
          message: 'Server Error',
          error: `Score ${i + 1}: Failed to save score`
        });
      }

      results.push(result.rows[0]);
      console.log(`✓ Score ${i + 1} upserted: enrollment_id=${enrollment_id}, term=${term_id}, total_score=${result.rows[0].total_score}`);
    }

    // Commit the transaction
    await client.query('COMMIT');
    console.log(`✅ Transaction committed successfully. ${results.length} score(s) saved.`);

    res.status(201).json({
      success: true,
      message: `${results.length} score(s) saved successfully`,
      count: results.length,
      data: results
    });

  } catch (error) {
    // Rollback on any error
    try {
      await client.query('ROLLBACK');
      console.error('❌ Transaction rolled back due to error:', error.message);
    } catch (rollbackError) {
      console.error('❌ Rollback error:', rollbackError.message);
    }

    console.error('Score Record Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });

  } finally {
    client.release();
  }
});

/**
 * @route   POST /api/scores/bulk-upsert
 * @desc    Bulk create/update scores with COALESCE for partial updates
 *          Allows updating any combination of CA scores or exam independently
 *          without overwriting other score components
 * @access  Private (Authenticated Teachers)
 * @body    {
 *            scores: [
 *              {
 *                enrollmentId: Number,
 *                subjectId: Number,
 *                academicSession: String,
 *                term: Number,
 *                ca1Score: Number (optional),
 *                ca2Score: Number (optional),
 *                ca3Score: Number (optional),
 *                ca4Score: Number (optional),
 *                examScore: Number (optional),
 *                teacherRemark: String (optional)
 *              },
 *              ...more records
 *            ]
 *          }
 */
router.post('/bulk-upsert', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { scores } = req.body;

    if (!scores || !Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'Scores must be a non-empty array'
      });
    }

    // Validate all scores before processing
    for (let i = 0; i < scores.length; i++) {
      const score = scores[i];
      if (!score.enrollmentId || !score.subjectId || !score.academicSession || !score.term) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Score at index ${i} is missing required fields (enrollmentId, subjectId, academicSession, term)`
        });
      }

      if (![1, 2, 3].includes(score.term)) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Term at index ${i} must be 1, 2, or 3`
        });
      }

      if (!/^\d{4}\/\d{4}$/.test(score.academicSession)) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Academic session at index ${i} must be in format YYYY/YYYY`
        });
      }

      // Validate score ranges
      const caScores = [score.ca1Score, score.ca2Score, score.ca3Score, score.ca4Score];
      for (const ca of caScores) {
        if (ca !== null && ca !== undefined && (ca < 0 || ca > 20)) {
          return res.status(400).json({
            success: false,
            message: 'Validation Error',
            error: `CA score at index ${i} must be between 0 and 20`
          });
        }
      }

      if (score.examScore !== null && score.examScore !== undefined && (score.examScore < 0 || score.examScore > 40)) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Exam score at index ${i} must be between 0 and 40`
        });
      }
    }

    // Build bulk insert query with COALESCE for partial updates
    const values = [];
    const placeholders = scores.map((score, i) => {
      const offset = i * 12;

      values.push(
        schoolId,
        score.enrollmentId,
        score.subjectId,
        score.academicSession,
        score.term,
        score.ca1Score || null,
        score.ca2Score || null,
        score.ca3Score || null,
        score.ca4Score || null,
        score.examScore || null,
        score.teacherRemark || null,
        req.user.id
      );

      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`;
    }).join(',');

    const query = `
      INSERT INTO scores (
        school_id, enrollment_id, subject_id, academic_session, term,
        ca1_score, ca2_score, ca3_score, ca4_score, exam_score,
        teacher_remark, updated_by
      ) VALUES ${placeholders}
      ON CONFLICT (school_id, enrollment_id, subject_id, academic_session, term)
      DO UPDATE SET
        ca1_score = COALESCE(EXCLUDED.ca1_score, scores.ca1_score),
        ca2_score = COALESCE(EXCLUDED.ca2_score, scores.ca2_score),
        ca3_score = COALESCE(EXCLUDED.ca3_score, scores.ca3_score),
        ca4_score = COALESCE(EXCLUDED.ca4_score, scores.ca4_score),
        exam_score = COALESCE(EXCLUDED.exam_score, scores.exam_score),
        teacher_remark = COALESCE(EXCLUDED.teacher_remark, scores.teacher_remark),
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`;

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: `Successfully upserted ${result.rowCount} score records`,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error('Bulk Upsert Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

// =====================================================================
// 2. SCORE RETRIEVAL & VIEWING
// =====================================================================

/**
 * @route   GET /api/scores/class-sheet
 * @desc    Get all scores for a class in a specific subject and term (for bulk editing)
 *          Uses enrollments to properly retrieve student data
 * @access  Private
 * @query   {
 *            classId: Number (required),
 *            subjectId: Number (required),
 *            academicSession: String (required, e.g., "2024/2025"),
 *            term: Number (required, 1-3)
 *          }
 */
router.get('/class-sheet', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { classId, subjectId, academicSession, term } = req.query;

    if (!classId || !subjectId || !academicSession || !term) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'classId, subjectId, academicSession, and term are required'
      });
    }

    if (![1, 2, 3].includes(parseInt(term))) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'Term must be 1, 2, or 3'
      });
    }

    const query = `
      SELECT
        s.id as student_id,
        s.first_name,
        s.last_name,
        s.registration_number,
        e.id as enrollment_id,
        COALESCE(sc.ca1_score, NULL) as ca1_score,
        COALESCE(sc.ca2_score, NULL) as ca2_score,
        COALESCE(sc.ca3_score, NULL) as ca3_score,
        COALESCE(sc.ca4_score, NULL) as ca4_score,
        COALESCE(sc.exam_score, NULL) as exam_score,
        COALESCE(sc.total_score, 0) as total_score,
        sc.teacher_remark,
        sc.id as score_id,
        sc.updated_at
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      LEFT JOIN scores sc ON e.id = sc.enrollment_id
        AND sc.subject_id = $2
        AND sc.academic_session = $3
        AND sc.term = $4
        AND sc.school_id = $1
      WHERE e.class_id = $5 AND e.school_id = $1 AND e.academic_session = $3
      ORDER BY s.last_name ASC, s.first_name ASC`;

    const result = await pool.query(query, [schoolId, subjectId, academicSession, term, classId]);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      message: `Retrieved ${result.rowCount} student records`,
      data: result.rows
    });

  } catch (error) {
    console.error('Class Sheet Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scores/student/:studentId
 * @desc    Get all scores for a specific student across all subjects, sessions and terms
 *          Shows complete transcript with historical data
 * @access  Private
 * @query   {
 *            academicSession: String (optional, filter by specific session)
 *          }
 */
router.get('/student/:studentId', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { studentId } = req.params;
    const { academicSession } = req.query;

    // Verify student belongs to school
    const studentCheck = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND school_id = $2',
      [studentId, schoolId]
    );

    if (studentCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
        error: 'Student not found in your school'
      });
    }

    let query = `
      SELECT
        sc.id,
        e.id as enrollment_id,
        sc.subject_id,
        sc.academic_session,
        sc.term,
        sc.ca1_score,
        sc.ca2_score,
        sc.ca3_score,
        sc.ca4_score,
        sc.exam_score,
        sc.total_score,
        sc.teacher_remark,
        sc.updated_at,
        c.class_name,
        e.status as enrollment_status
      FROM scores sc
      JOIN enrollments e ON sc.enrollment_id = e.id
      JOIN classes c ON e.class_id = c.id
      WHERE e.student_id = $1 AND sc.school_id = $2`;

    const params = [studentId, schoolId];

    if (academicSession) {
      query += ` AND sc.academic_session = $3`;
      params.push(academicSession);
    }

    query += ` ORDER BY sc.academic_session DESC, sc.term DESC`;

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      message: `Retrieved transcript for ${result.rowCount} score records`,
      data: result.rows
    });

  } catch (error) {
    console.error('Student Scores Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scores/term-summary
 * @desc    Get summary of scores for all students in a class for a term
 * @access  Private
 * @query   {
 *            classId: Number (required),
 *            academicSession: String (required),
 *            term: Number (required, 1-3)
 *          }
 */
router.get('/term-summary', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { classId, academicSession, term } = req.query;

    if (!classId || !academicSession || !term) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'classId, academicSession, and term are required'
      });
    }

    const query = `
      SELECT
        s.id as student_id,
        s.first_name,
        s.last_name,
        s.registration_number,
        COUNT(DISTINCT sc.subject_id) as subjects_entered,
        ROUND(AVG(sc.total_score), 2) as average_score,
        MAX(sc.total_score) as highest_score,
        MIN(sc.total_score) as lowest_score,
        COUNT(CASE WHEN sc.total_score >= 50 THEN 1 END) as passed_subjects,
        COUNT(CASE WHEN sc.total_score < 50 THEN 1 END) as failed_subjects
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      LEFT JOIN scores sc ON e.id = sc.enrollment_id
        AND sc.academic_session = $2
        AND sc.term = $3
        AND sc.school_id = $1
      WHERE e.class_id = $4 AND e.school_id = $1 AND e.academic_session = $2
      GROUP BY s.id, s.first_name, s.last_name, s.registration_number
      ORDER BY s.last_name ASC, s.first_name ASC`;

    const result = await pool.query(query, [schoolId, academicSession, term, classId]);

    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error('Term Summary Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

// =====================================================================
// 3. STUDENT SELF-SERVICE GRADES
// =====================================================================

/**
 * @route   GET /api/scores/my-grades
 * @desc    Get logged-in student's grades for a specific term and session
 * @access  Private (Student)
 * @query   {
 *            term: Number (required, 1-3),
 *            sessionId: Number (required)
 *          }
 */
router.get('/my-grades', async (req, res) => {
  try {
    if (req.user?.type !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'This endpoint is for students only'
      });
    }

    const studentId = req.user.studentId;
    const schoolId = req.user.schoolId;
    const { term, sessionId } = req.query;

    if (!term || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'term and sessionId are required'
      });
    }

    const query = `
      SELECT 
        s.id as score_id,
        sub.subject_name,
        sub.subject_code,
        s.ca1_score,
        s.ca2_score,
        s.ca3_score,
        s.ca4_score,
        s.exam_score,
        s.total_score,
        s.teacher_remark,
        e.id as enrollment_id,
        c.class_name
      FROM scores s
      JOIN enrollments e ON s.enrollment_id = e.id
      JOIN subjects sub ON s.subject_id = sub.id
      JOIN classes c ON e.class_id = c.id
      WHERE e.student_id = $1 
        AND e.school_id = $2 
        AND s.term = $3 
        AND e.session_id = $4
      ORDER BY sub.subject_name ASC`;

    const result = await pool.query(query, [studentId, schoolId, term, sessionId]);

    // Calculate Summary Stats if grades exist
    let summary = null;
    if (result.rows.length > 0) {
      const enrollmentId = result.rows[0].enrollment_id;

      const summaryQuery = `
        WITH ClassTotals AS (
          SELECT 
            en.id as enrollment_id,
            SUM(sc.total_score) as student_total_score
          FROM enrollments en
          JOIN scores sc ON en.id = sc.enrollment_id
          WHERE en.class_id = (SELECT class_id FROM enrollments WHERE id = $1)
            AND sc.term = $2
            AND en.session_id = $3
          GROUP BY en.id
        ),
        Ranked AS (
          SELECT 
            enrollment_id,
            student_total_score,
            RANK() OVER (ORDER BY student_total_score DESC) as position,
            COUNT(*) OVER() as total_students
          FROM ClassTotals
        )
        SELECT 
          position, 
          total_students, 
          student_total_score,
          (SELECT AVG(total_score) FROM scores WHERE enrollment_id = $1 AND term = $2) as average_score,
          (SELECT COUNT(*) FROM scores WHERE enrollment_id = $1 AND term = $2 AND total_score >= 50) as subjects_passed,
          (SELECT COUNT(*) FROM scores WHERE enrollment_id = $1 AND term = $2 AND total_score < 50) as subjects_failed
        FROM Ranked
        WHERE enrollment_id = $1`;

      const summaryResult = await pool.query(summaryQuery, [enrollmentId, term, sessionId]);
      if (summaryResult.rows.length > 0) {
        summary = summaryResult.rows[0];
      }
    }

    res.json({
      success: true,
      data: result.rows,
      summary: summary,
      count: result.rowCount
    });

  } catch (error) {
    console.error('My Grades Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================================
// 4. REPORT CARD GENERATION
// =====================================================================

/**
 * @route   GET /api/scores/report-card/single/:enrollmentId
 * @desc    Generate report card data for a single student in a session
 * @access  Private
 * @query   {
 *            academicSession: String (required, e.g., "2024/2025"),
 *            term: Number (required, 1-3)
 *          }
 */
router.get('/report-card/single/:enrollmentId', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { enrollmentId } = req.params;
    const { academicSession, term } = req.query;

    if (!academicSession || !term) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'academicSession and term are required'
      });
    }

    if (![1, 2, 3].includes(parseInt(term))) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'Term must be 1, 2, or 3'
      });
    }

    // Verify enrollment and get student details
    const enrollmentQuery = `
      SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.registration_number,
        s.gender,
        s.date_of_birth,
        c.class_name,
        e.id as enrollment_id,
        e.academic_session
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN classes c ON e.class_id = c.id
      WHERE e.id = $1 AND e.school_id = $2`;

    // Student security check: Students can only see their own report
    const ownershipParams = [enrollmentId, schoolId];
    let extraOwnershipClause = '';
    if (req.user?.type === 'student') {
      extraOwnershipClause = ' AND s.id = $3';
      ownershipParams.push(req.user.studentId);
    }

    const enrollmentResult = await pool.query(enrollmentQuery + extraOwnershipClause, ownershipParams);

    if (enrollmentResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
        error: 'Enrollment not found in your school'
      });
    }

    const enrollment = enrollmentResult.rows[0];

    // Get all scores for the student in the specified term
    const scoresQuery = `
      SELECT
        sc.id as score_id,
        sc.subject_id,
        sub.subject_name,
        sub.subject_code,
        sc.ca1_score,
        sc.ca2_score,
        sc.ca3_score,
        sc.ca4_score,
        sc.exam_score,
        sc.total_score,
        sc.teacher_remark,
        CASE
          WHEN sc.total_score >= 70 THEN 'A'
          WHEN sc.total_score >= 60 THEN 'B'
          WHEN sc.total_score >= 50 THEN 'C'
          WHEN sc.total_score >= 40 THEN 'D'
          WHEN sc.total_score >= 30 THEN 'E'
          ELSE 'F'
        END as grade,
        CASE
          WHEN sc.total_score >= 70 THEN 'Excellent'
          WHEN sc.total_score >= 60 THEN 'Very Good'
          WHEN sc.total_score >= 50 THEN 'Good'
          WHEN sc.total_score >= 40 THEN 'Fair'
          WHEN sc.total_score >= 30 THEN 'Poor'
          ELSE 'Very Poor'
        END as performance
      FROM scores sc
      LEFT JOIN subjects sub ON sc.subject_id = sub.id
      WHERE sc.enrollment_id = $1
        AND sc.academic_session = $2
        AND sc.term = $3
        AND sc.school_id = $4
      ORDER BY sub.subject_name ASC`;

    const scoresResult = await pool.query(scoresQuery, [enrollmentId, academicSession, term, schoolId]);

    // Calculate overall statistics
    let totalScoreSum = 0;
    let subjectCount = scoresResult.rows.length;
    let passedCount = 0;

    scoresResult.rows.forEach(score => {
      totalScoreSum += score.total_score || 0;
      if (score.total_score >= 50) passedCount++;
    });

    const overallAverage = subjectCount > 0 ? (totalScoreSum / subjectCount).toFixed(2) : 0;

    res.status(200).json({
      success: true,
      data: {
        student: {
          id: enrollment.id,
          enrollmentId: enrollment.enrollment_id,
          firstName: enrollment.first_name,
          lastName: enrollment.last_name,
          registrationNumber: enrollment.registration_number,
          gender: enrollment.gender,
          dateOfBirth: enrollment.date_of_birth,
          className: enrollment.class_name
        },
        termInfo: {
          academicSession,
          term: parseInt(term)
        },
        subjects: scoresResult.rows,
        summary: {
          totalSubjects: subjectCount,
          subjectsPassed: passedCount,
          subjectsFailed: subjectCount - passedCount,
          overallAverage: parseFloat(overallAverage),
          totalScore: totalScoreSum,
          performanceRating: parseFloat(overallAverage) >= 70 ? 'Excellent' :
            parseFloat(overallAverage) >= 60 ? 'Very Good' :
              parseFloat(overallAverage) >= 50 ? 'Good' :
                parseFloat(overallAverage) >= 40 ? 'Fair' : 'Poor'
        }
      }
    });

  } catch (error) {
    console.error('Report Card Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/scores/report-cards/bulk
 * @desc    Generate report cards for multiple students at once
 * @access  Private
 * @body    {
 *            enrollmentIds: [Number, ...],
 *            academicSession: String (required, e.g., "2024/2025"),
 *            term: Number (required, 1-3)
 *          }
 */
router.post('/report-cards/bulk', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { enrollmentIds, academicSession, term } = req.body;

    if (!enrollmentIds || !Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'enrollmentIds must be a non-empty array'
      });
    }

    if (!academicSession || !term) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'academicSession and term are required'
      });
    }

    if (![1, 2, 3].includes(parseInt(term))) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'Term must be 1, 2, or 3'
      });
    }

    // Get enrollment details for all requested enrollments
    const enrollmentQuery = `
      SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.registration_number,
        s.gender,
        s.date_of_birth,
        c.class_name,
        e.id as enrollment_id
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN classes c ON e.class_id = c.id
      WHERE e.id = ANY($1::int[]) AND e.school_id = $2`;

    const enrollmentResult = await pool.query(enrollmentQuery, [enrollmentIds, schoolId]);

    if (enrollmentResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
        error: 'No enrollments found in your school'
      });
    }

    // Get scores for all enrollments
    const scoresQuery = `
      SELECT
        sc.enrollment_id,
        sc.subject_id,
        sub.subject_name,
        sub.subject_code,
        sc.ca1_score,
        sc.ca2_score,
        sc.ca3_score,
        sc.ca4_score,
        sc.exam_score,
        sc.total_score,
        sc.teacher_remark,
        CASE
          WHEN sc.total_score >= 70 THEN 'A'
          WHEN sc.total_score >= 60 THEN 'B'
          WHEN sc.total_score >= 50 THEN 'C'
          WHEN sc.total_score >= 40 THEN 'D'
          WHEN sc.total_score >= 30 THEN 'E'
          ELSE 'F'
        END as grade,
        CASE
          WHEN sc.total_score >= 70 THEN 'Excellent'
          WHEN sc.total_score >= 60 THEN 'Very Good'
          WHEN sc.total_score >= 50 THEN 'Good'
          WHEN sc.total_score >= 40 THEN 'Fair'
          WHEN sc.total_score >= 30 THEN 'Poor'
          ELSE 'Very Poor'
        END as performance
      FROM scores sc
      LEFT JOIN subjects sub ON sc.subject_id = sub.id
      WHERE sc.enrollment_id = ANY($1::int[])
        AND sc.academic_session = $2
        AND sc.term = $3
        AND sc.school_id = $4
      ORDER BY sc.enrollment_id, sub.subject_name ASC`;

    const scoresResult = await pool.query(scoresQuery, [enrollmentIds, academicSession, term, schoolId]);

    // Group scores by enrollment
    const scoresByEnrollment = {};
    scoresResult.rows.forEach(score => {
      if (!scoresByEnrollment[score.enrollment_id]) {
        scoresByEnrollment[score.enrollment_id] = [];
      }
      scoresByEnrollment[score.enrollment_id].push(score);
    });

    // Build report cards
    const reportCards = enrollmentResult.rows.map(enrollment => {
      const enrollmentScores = scoresByEnrollment[enrollment.enrollment_id] || [];
      let totalScoreSum = 0;
      let passedCount = 0;

      enrollmentScores.forEach(score => {
        totalScoreSum += score.total_score || 0;
        if (score.total_score >= 50) passedCount++;
      });

      const overallAverage = enrollmentScores.length > 0 ? (totalScoreSum / enrollmentScores.length).toFixed(2) : 0;

      return {
        student: {
          id: enrollment.id,
          enrollmentId: enrollment.enrollment_id,
          firstName: enrollment.first_name,
          lastName: enrollment.last_name,
          registrationNumber: enrollment.registration_number,
          gender: enrollment.gender,
          dateOfBirth: enrollment.date_of_birth,
          className: enrollment.class_name
        },
        termInfo: {
          academicSession,
          term: parseInt(term)
        },
        subjects: enrollmentScores,
        summary: {
          totalSubjects: enrollmentScores.length,
          subjectsPassed: passedCount,
          subjectsFailed: enrollmentScores.length - passedCount,
          overallAverage: parseFloat(overallAverage),
          totalScore: totalScoreSum,
          performanceRating: parseFloat(overallAverage) >= 70 ? 'Excellent' :
            parseFloat(overallAverage) >= 60 ? 'Very Good' :
              parseFloat(overallAverage) >= 50 ? 'Good' :
                parseFloat(overallAverage) >= 40 ? 'Fair' : 'Poor'
        }
      };
    });

    res.status(200).json({
      success: true,
      count: reportCards.length,
      message: `Generated ${reportCards.length} report cards`,
      data: reportCards
    });

  } catch (error) {
    console.error('Bulk Report Cards Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/scores/report-cards/class-summary
 * @desc    Get a summary report for an entire class
 * @access  Private
 * @query   {
 *            classId: Number (required),
 *            academicSession: String (required),
 *            term: Number (required, 1-3)
 *          }
 */
router.get('/report-cards/class-summary', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { classId, academicSession, term } = req.query;

    if (!classId || !academicSession || !term) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'classId, academicSession, and term are required'
      });
    }

    const query = `
      SELECT
        s.id as student_id,
        s.first_name,
        s.last_name,
        s.registration_number,
        COUNT(DISTINCT sc.subject_id) as total_subjects,
        ROUND(AVG(sc.total_score), 2) as class_average,
        MAX(sc.total_score) as highest_score,
        MIN(sc.total_score) as lowest_score,
        COUNT(CASE WHEN sc.total_score >= 50 THEN 1 END) as passed_subjects,
        COUNT(CASE WHEN sc.total_score < 50 THEN 1 END) as failed_subjects,
        CASE
          WHEN AVG(sc.total_score) >= 70 THEN 'Excellent'
          WHEN AVG(sc.total_score) >= 60 THEN 'Very Good'
          WHEN AVG(sc.total_score) >= 50 THEN 'Good'
          WHEN AVG(sc.total_score) >= 40 THEN 'Fair'
          ELSE 'Poor'
        END as overall_performance
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      LEFT JOIN scores sc ON e.id = sc.enrollment_id
        AND sc.academic_session = $2
        AND sc.term = $3
        AND sc.school_id = $1
      WHERE e.class_id = $4 AND e.school_id = $1 AND e.academic_session = $2
      GROUP BY s.id, s.first_name, s.last_name, s.registration_number
      ORDER BY AVG(sc.total_score) DESC NULLS LAST`;

    const result = await pool.query(query, [schoolId, academicSession, term, classId]);

    // Calculate class-wide statistics
    const classStats = {
      totalStudents: result.rows.length,
      averagePerformance: 0,
      topPerformer: result.rows[0] || null,
      classAverage: 0
    };

    if (result.rows.length > 0) {
      const validScores = result.rows.filter(r => r.class_average !== null);
      if (validScores.length > 0) {
        classStats.classAverage = (validScores.reduce((sum, r) => sum + parseFloat(r.class_average), 0) / validScores.length).toFixed(2);
        classStats.averagePerformance = parseFloat(classStats.classAverage) >= 70 ? 'Excellent' :
          parseFloat(classStats.classAverage) >= 60 ? 'Very Good' :
            parseFloat(classStats.classAverage) >= 50 ? 'Good' :
              parseFloat(classStats.classAverage) >= 40 ? 'Fair' : 'Poor';
      }
    }

    res.status(200).json({
      success: true,
      data: {
        classStats,
        students: result.rows
      }
    });

  } catch (error) {
    console.error('Class Summary Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

// =====================================================================
// 4. SCORE MANAGEMENT & ANALYSIS
// =====================================================================

/**
 * @route   GET /api/scores/analytics/subject
 * @desc    Get analytics for a specific subject
 * @access  Private
 * @query   {
 *            subjectId: Number (required),
 *            academicSession: String (required),
 *            term: Number (required, 1-3),
 *            classId: Number (optional, for specific class)
 *          }
 */
router.get('/analytics/subject', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { subjectId, academicSession, term, classId } = req.query;

    if (!subjectId || !academicSession || !term) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'subjectId, academicSession, and term are required'
      });
    }

    let query = `
      SELECT
        COUNT(DISTINCT sc.enrollment_id) as total_students,
        ROUND(AVG(sc.total_score), 2) as average_score,
        MAX(sc.total_score) as highest_score,
        MIN(sc.total_score) as lowest_score,
        ROUND(STDDEV(sc.total_score), 2) as score_variance,
        COUNT(CASE WHEN sc.total_score >= 70 THEN 1 END) as excellent,
        COUNT(CASE WHEN sc.total_score >= 60 AND sc.total_score < 70 THEN 1 END) as very_good,
        COUNT(CASE WHEN sc.total_score >= 50 AND sc.total_score < 60 THEN 1 END) as good,
        COUNT(CASE WHEN sc.total_score >= 40 AND sc.total_score < 50 THEN 1 END) as fair,
        COUNT(CASE WHEN sc.total_score >= 30 AND sc.total_score < 40 THEN 1 END) as poor,
        COUNT(CASE WHEN sc.total_score < 30 THEN 1 END) as very_poor
      FROM scores sc
      WHERE sc.subject_id = $1 AND sc.academic_session = $2 AND sc.term = $3 AND sc.school_id = $4`;

    const params = [subjectId, academicSession, term, schoolId];

    if (classId) {
      query += ` AND sc.enrollment_id IN (SELECT id FROM enrollments WHERE class_id = $5)`;
      params.push(classId);
    }

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('Subject Analytics Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

// =====================================================================
// 5. SCORE UPDATES & DELETIONS
// =====================================================================

/**
 * @route   DELETE /api/scores/:scoreId
 * @desc    Delete a specific score record
 * @access  Private (with authorization check)
 */
router.delete('/:scoreId', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { scoreId } = req.params;

    const result = await pool.query(
      'DELETE FROM scores WHERE id = $1 AND school_id = $2 RETURNING id',
      [scoreId, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Not Found',
        error: 'Score record not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Score record deleted successfully'
    });

  } catch (error) {
    console.error('Delete Score Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/scores/:scoreId
 * @desc    Update a specific score record with partial updates support
 *          Uses COALESCE to only update provided fields
 * @access  Private
 * @body    {
 *            ca1Score: Number (optional),
 *            ca2Score: Number (optional),
 *            ca3Score: Number (optional),
 *            ca4Score: Number (optional),
 *            examScore: Number (optional),
 *            teacherRemark: String (optional)
 *          }
 */
router.put('/:scoreId', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { scoreId } = req.params;
    const {
      ca1Score,
      ca2Score,
      ca3Score,
      ca4Score,
      examScore,
      teacherRemark
    } = req.body;

    // Validate score ranges if provided
    const scores = { ca1Score, ca2Score, ca3Score, ca4Score };
    for (const [key, value] of Object.entries(scores)) {
      if (value !== null && value !== undefined && (value < 0 || value > 20)) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `${key} must be between 0 and 20`
        });
      }
    }

    if (examScore !== null && examScore !== undefined && (examScore < 0 || examScore > 40)) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'Exam score must be between 0 and 40'
      });
    }

    // Update with COALESCE to preserve existing values
    const result = await pool.query(
      `UPDATE scores SET
        ca1_score = COALESCE($1::DECIMAL, ca1_score),
        ca2_score = COALESCE($2::DECIMAL, ca2_score),
        ca3_score = COALESCE($3::DECIMAL, ca3_score),
        ca4_score = COALESCE($4::DECIMAL, ca4_score),
        exam_score = COALESCE($5::DECIMAL, exam_score),
        teacher_remark = COALESCE($6, teacher_remark),
        updated_by = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND school_id = $9
      RETURNING *`,
      [
        ca1Score, ca2Score, ca3Score, ca4Score, examScore,
        teacherRemark, req.user.id, scoreId, schoolId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Not Found',
        error: 'Score record not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Score record updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update Score Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

module.exports = router;