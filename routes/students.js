const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../database/db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const authMiddleware = require('../middleware/auth');
require('dotenv').config();

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'inumiduncourteous@gmail.com',
    pass: 'vsdx pbec uaev zixr',
  },
});

// NOTE: Auth middleware is applied selectively per route
// Student registration and login are public routes

/**
 * =====================================================================
 * STUDENTS & ENROLLMENTS MANAGEMENT
 * =====================================================================
 * 
 * Architecture:
 * - Students are independent entities tied to schools (not to classes)
 * - Enrollments link students to classes for specific academic sessions
 * - Supports promotions, repeaters, and student transfers between classes
 * - Full historical tracking for transcripts and enrollment history
 * - Enrollment status: 'active', 'promoted', 'repeated', 'transferred', 'graduated'
 */

// =====================================================================
// STUDENT SELF-SERVICE ENDPOINTS (PUBLIC & AUTHENTICATED)
// =====================================================================

// Send OTP
router.post('/otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await pool.query(
      `INSERT INTO email_verifications (email, otp_code, expires_at) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO UPDATE 
       SET otp_code = $2, expires_at = $3, is_verified = false`,
      [email, otp, expiresAt]
    );

    const mailOptions = {
      from: '"Student Registry" <inumiduncourteous@gmail.com>',
      to: email,
      subject: "Verify Your Student Email",
      html: `
        <div style="font-family: sans-serif; text-align: center; border: 1px solid #ddd; padding: 20px;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Use the code below to complete your student registration:</p>
          <h1 style="color: #4A90E2; letter-spacing: 5px; font-size: 32px;">${otp}</h1>
          <p style="color: #888;">This code expires in 10 minutes.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Verification code sent successfully"
    });

  } catch (error) {
    console.error("Email/DB Error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required"
      });
    }

    const verifyRes = await pool.query(
      'SELECT * FROM email_verifications WHERE email = $1 AND otp_code = $2 AND expires_at > NOW()',
      [email, otp]
    );

    if (verifyRes.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code"
      });
    }

    await pool.query(
      'UPDATE email_verifications SET is_verified = true WHERE email = $1',
      [email]
    );

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully. Proceed with registration."
    });

  } catch (error) {
    console.error("OTP Verification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify OTP. Please try again later."
    });
  }
});

/**
 * @route   POST /api/students/register
 * @desc    Student self-registration (creates account with password)
 * @access  Public
 * @body    {
 *            firstName: String (required),
 *            lastName: String (required),
 *            email: String (required),
 *            password: String (required),
 *            registrationNumber: String (optional),
 *            phone: String (optional),
 *            dateOfBirth: String (optional, YYYY-MM-DD),
 *            gender: String (optional),
 *            schoolId: Number (required)
 *          }
 */
router.post('/register', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      firstName, lastName, email, password,
      registrationNumber, phone, dateOfBirth, gender, registrationCode
    } = req.body;

    // Validation
    const requiredFields = ['firstName', 'lastName', 'email', 'password', 'registrationCode'];
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({
          success: false,
          error: `${field} is required`,
          missingField: field
        });
      }
    }

    // Verify school exists by registration_code
    const schoolCheck = await client.query(
      'SELECT id, name FROM schools WHERE registration_code = $1',
      [registrationCode]
    );

    if (schoolCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid Registration Code. School not found.'
      });
    }

    const schoolId = schoolCheck.rows[0].id;
    const schoolName = schoolCheck.rows[0].name;

    // Check if email already exists
    const emailCheck = await client.query(
      'SELECT id FROM students WHERE email = $1',
      [email]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Email already registered'
      });
    }

    // Verify email is verified in email_verifications table
    const verificationCheck = await client.query(
      'SELECT is_verified FROM email_verifications WHERE email = $1 AND is_verified = true',
      [email]
    );

    if (verificationCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Email must be verified first. Please complete OTP verification.'
      });
    }

    await client.query('BEGIN');

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate registration number if not provided
    const schoolPrefix = schoolName.substring(0, 3).toUpperCase();
    const finalRegNumber = registrationNumber || `${schoolPrefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Create student
    const studentResult = await client.query(
      `INSERT INTO students (
        school_id, first_name, last_name, email, password_hash,
        registration_number, phone, date_of_birth, gender
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, school_id, first_name, last_name, email, registration_number, phone, date_of_birth, gender, created_at`,
      [schoolId, firstName, lastName, email, passwordHash, finalRegNumber, phone || null, dateOfBirth || null, gender || null]
    );

    // Clean up verification record
    await client.query('DELETE FROM email_verifications WHERE email = $1', [email]);

    await client.query('COMMIT');

    const student = studentResult.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      {
        studentId: student.id,
        schoolId: student.school_id,
        type: 'student'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'Student account created successfully',
      data: {
        student,
        token
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Student Registration Error:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'Registration number or email already exists'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    client.release();
  }
});

/**
 * @route   POST /api/students/login
 * @desc    Student login
 * @access  Public
 * @body    {
 *            email: String (required),
 *            password: String (required)
 *          }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find student by email
    const result = await pool.query(
      `SELECT 
        s.id, s.school_id, s.first_name, s.last_name, s.email, 
        s.registration_number, s.password_hash, s.phone, s.date_of_birth, 
        s.gender, s.photo,
        sc.name as school_name,
        sc.country_id as school_country_id,
        sc.country as school_country_name
      FROM students s
      JOIN schools sc ON s.school_id = sc.id
      WHERE s.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const student = result.rows[0];

    // Check if password_hash exists (for students imported via bulk)
    if (!student.password_hash) {
      return res.status(401).json({
        success: false,
        error: 'Account not activated. Please contact your school administrator.'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, student.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Resolve countryId: prefer school's country_id, otherwise lookup by school's country name
    let resolvedCountryId = student.school_country_id || null;
    if (!resolvedCountryId && student.school_country_name) {
      try {
        const countryLookup = await pool.query(
          'SELECT id FROM countries WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [student.school_country_name.trim()]
        );
        if (countryLookup.rows.length > 0) {
          resolvedCountryId = countryLookup.rows[0].id;
        }
      } catch (err) {
        console.warn('Country lookup failed:', err.message || err);
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        studentId: student.id,
        registrationNumber: student.registration_number,
        schoolId: student.school_id,
        countryId: resolvedCountryId,
        type: 'student'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Remove password_hash from response
    delete student.password_hash;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        student: {
          ...student,
          type: 'student'  // Include type for client-side routing
        },
        token
      }
    });

  } catch (error) {
    console.error('Student Login Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/students/profile
 * @desc    Update student's own profile
 * @access  Private (Student only)
 * @body    {
 *            firstName: String (optional),
 *            lastName: String (optional),
 *            email: String (optional),
 *            phone: String (optional),
 *            dateOfBirth: String (optional),
 *            gender: String (optional),
 *            photo: String (optional),
 *            currentPassword: String (required if changing password),
 *            newPassword: String (optional)
 *          }
 */
/**
 * @route   GET /api/students/me/enrollments
 * @desc    Get logged-in student's enrollment history
 * @access  Private (Student)
 */
router.get('/me/enrollments', authMiddleware.authenticateToken, async (req, res) => {
  try {
    if (req.user?.type !== 'student') {
      return res.status(403).json({ success: false, error: 'This endpoint is for students only' });
    }

    const studentId = req.user.studentId;
    const schoolId = req.user.schoolId;

    const query = `
      SELECT 
        e.id as enrollment_id,
        ay.id as session_id,
        ay.session_name as academic_session,
        e.status as enrollment_status,
        e.class_id,
        c.class_name,
        e.created_at
      FROM enrollments e
      JOIN classes c ON e.class_id = c.id
      JOIN academic_sessions ay ON e.session_id = ay.id
      WHERE e.student_id = $1 AND e.school_id = $2
      ORDER BY ay.session_name DESC, e.created_at DESC`;

    const result = await pool.query(query, [studentId, schoolId]);

    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount
    });
  } catch (error) {
    console.error('My Enrollments Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/me/enrollments/:sessionId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    if (req.user?.type !== 'student') {
      return res.status(403).json({ success: false, error: 'This endpoint is for students only' });
    }

    const { sessionId } = req.params;
    const studentId = req.user.studentId;
    const schoolId = req.user.schoolId;

    const query = `
      SELECT 
        e.id as enrollment_id,
        ay.id as session_id,
        ay.session_name as academic_session,
        e.status as enrollment_status,
        e.class_id,
        c.class_name,
        e.created_at
      FROM enrollments e
      JOIN classes c ON e.class_id = c.id
      JOIN academic_sessions ay ON e.session_id = ay.id
      WHERE e.student_id = $1 AND e.school_id = $2 AND ay.id = $3
      ORDER BY e.created_at DESC`;

    const result = await pool.query(query, [studentId, schoolId, sessionId]);

    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount
    });
  } catch (error) {
    console.error('Session Enrollments Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/profile', authMiddleware.authenticateToken, async (req, res) => {
  const client = await pool.connect();

  try {
    // Verify this is a student token
    if (req.user?.type !== 'student') {
      return res.status(403).json({
        success: false,
        error: 'This endpoint is for students only'
      });
    }

    const studentId = req.user?.studentId;
    const {
      firstName, lastName, email, phone, dateOfBirth,
      gender, photo, currentPassword, newPassword
    } = req.body;

    await client.query('BEGIN');

    // If changing password, verify current password
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password is required to set a new password'
        });
      }

      const studentResult = await client.query(
        'SELECT password_hash FROM students WHERE id = $1',
        [studentId]
      );

      if (studentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Student not found'
        });
      }

      const isValidPassword = await bcrypt.compare(currentPassword, studentResult.rows[0].password_hash);

      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      await client.query(
        'UPDATE students SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newPasswordHash, studentId]
      );
    }

    // Update other fields
    const result = await client.query(
      `UPDATE students SET
       first_name = COALESCE($1, first_name),
       last_name = COALESCE($2, last_name),
       email = COALESCE($3, email),
       phone = COALESCE($4, phone),
       date_of_birth = COALESCE($5, date_of_birth),
       gender = COALESCE($6, gender),
       photo = COALESCE($7, photo),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, school_id, first_name, last_name, email, registration_number, phone, date_of_birth, gender, photo, updated_at`,
      [firstName, lastName, email, phone, dateOfBirth, gender, photo, studentId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Student not found'
      });
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Profile Update Error:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'Email already in use'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    client.release();
  }
});

// =====================================================================
// ADMIN STUDENT MANAGEMENT ENDPOINTS (Require Admin Authentication)
// =====================================================================

/**
 * @route   POST /api/students/bulk
 * @desc    Bulk create students for the authenticated school with automatic enrollment
 * @access  Private
 * @body    {
 *            students: [
 *              {
 *                firstName: String,
 *                lastName: String,
 *                email: String (optional),
 *                phone: String (optional),
 *                dateOfBirth: String (optional, YYYY-MM-DD),
 *                classId: Number (required for auto-enrollment),
 *                studentNumber: String (optional, auto-generated using school name prefix),
 *                gender: String (optional)
 *              }
 *            ],
 *            academicSession: String (required, e.g., "2023/2024")
 *          }
 */
router.post('/bulk', authMiddleware.authenticateToken, async (req, res) => {
  const client = await pool.connect();

  try {
    // STRICT SECURITY: Extract schoolId and countryId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;
    const countryId = req.user?.countryId;
    const { students, academicSession } = req.body; // e.g., "2044/2045"

    if (!schoolId) {
      return res.status(401).json({ success: false, error: 'Authentication context missing. Please login again.' });
    }

    if (!countryId) {
      return res.status(401).json({ success: false, error: 'Country context missing. Please login again.' });
    }

    if (!students || !Array.isArray(students)) {
      return res.status(400).json({ success: false, error: 'Invalid students list' });
    }

    if (!academicSession) {
      return res.status(400).json({ success: false, error: 'Academic session required (e.g., "2023/2024")' });
    }

    await client.query('BEGIN');

    // Get school name for registration number prefix
    const schoolLookup = await client.query(
      'SELECT name FROM schools WHERE id = $1 LIMIT 1',
      [schoolId]
    );

    if (schoolLookup.rows.length === 0) {
      throw new Error('School not found.');
    }

    const schoolName = schoolLookup.rows[0].name;
    const schoolPrefix = schoolName.substring(0, 3).toUpperCase();

    // 1. Convert the session string "2044/2045" into the actual database ID
    // academic_years is a global table (not school-specific)
    const sessionLookup = await client.query(
      'SELECT id FROM academic_years WHERE session_name = $1 LIMIT 1',
      [academicSession]
    );

    if (sessionLookup.rows.length === 0) {
      throw new Error(`Academic session "${academicSession}" not found. Please ensure the session exists in your school.`);
    }

    const sessionId = sessionLookup.rows[0].id;
    const results = [];

    for (const [index, s] of students.entries()) {
      if (!s.firstName || !s.lastName || !s.classId) {
        throw new Error(`Row ${index + 1}: Name and Class ID are required.`);
      }

      // Verify classId belongs to this school (the class should already exist in classes table)
      const classCheck = await client.query(
        'SELECT id FROM global_class_templates WHERE id = $1',
        [s.classId]
      );

      // if (classCheck.rows.length === 0) {
      //   throw new Error(`Row ${index + 1}: Class ID ${s.classId} is invalid or does not belong to your school.`);
      // }

      // Create Student with auto-generated password "1234567890"
      const studentNum = s.studentNumber || `${schoolPrefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const defaultPassword = '1234567890';
      const passwordHash = await bcrypt.hash(defaultPassword, 10);

      const studentInsert = await client.query(
        `INSERT INTO students (school_id, first_name, last_name, email, phone, date_of_birth, registration_number, gender, password_hash) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [schoolId, s.firstName, s.lastName, s.email || null, s.phone || null, s.dateOfBirth || null, studentNum, s.gender || null, passwordHash]
      );

      const studentId = studentInsert.rows[0].id;

      // 2. Insert Enrollment with the school's actual class_id (from classes table)
      // using the session_id (from academic_sessions table)
      const enrollmentInsert = await client.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, session_id, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [schoolId, studentId, s.classId, sessionId]
      );

      results.push({
        name: `${s.firstName} ${s.lastName}`,
        studentId: studentId,
        enrollmentId: enrollmentInsert.rows[0].id,
        classId: s.classId
      });
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: `Successfully created and enrolled ${results.length} students`,
      count: results.length,
      data: results
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Bulk Processing Error:", error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});
/**
 * @route   POST /api/students
 * @desc    Create a single student with automatic enrollment
 * @access  Private
 * @body    {
 *            firstName: String (required),
 *            lastName: String (required),
 *            classId: Number (required for auto-enrollment),
 *            email: String (optional),
 *            registrationNumber: String (optional),
 *            gender: String (optional),
 *            dateOfBirth: String (optional),
 *            phone: String (optional),
 *            photo: String (optional)
 *          }
 */


router.post('/', authMiddleware.authenticateToken, async (req, res) => {
  const client = await pool.connect();

  try {
    const schoolId = req.user?.schoolId;
    const {
      firstName, lastName, email, registrationNumber,
      gender, dateOfBirth, phone, photo, classId
    } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'First and Last names are required'
      });
    }

    // if (!classId) {
    //   return res.status(400).json({ 
    //     success: false, 
    //     message: 'Validation Error', 
    //     error: 'classId is required for automatic enrollment' 
    //   });
    // }

    // Begin transaction
    await client.query('BEGIN');

    const finalRegNumber = registrationNumber || `STU-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Insert student
    const studentResult = await client.query(
      `INSERT INTO students (
        school_id, first_name, last_name, email, 
        registration_number, gender, date_of_birth, phone, photo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [schoolId, firstName, lastName, email || null, finalRegNumber,
        gender || null, dateOfBirth || null, phone || null, photo || null]
    );

    const student = studentResult.rows[0];

    // Verify class belongs to school
    const classCheck = await client.query(
      'SELECT id FROM classes WHERE id = $1 AND school_id = $2',
      [classId, schoolId]
    );

    // if (classCheck.rows.length === 0) {
    //   await client.query('ROLLBACK');
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Unauthorized',
    //     error: 'Class not found in your school'
    //   });
    // }

    // Get school's active session
    const sessionResult = await client.query(
      'SELECT id FROM academic_sessions WHERE school_id = $1 AND is_active = true LIMIT 1',
      [schoolId]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Configuration Error',
        error: 'No active academic session found for your school. Please set up an active session first.'
      });
    }

    const sessionId = sessionResult.rows[0].id;

    // Auto-enroll student in their class for active session
    const enrollmentResult = await client.query(
      `INSERT INTO enrollments (
        school_id, student_id, class_id, session_id, status
      ) VALUES ($1, $2, $3, $4, 'active')
      RETURNING *`,
      [schoolId, student.id, classId, sessionId]
    );

    const enrollment = enrollmentResult.rows[0];

    // Commit transaction
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Student created and auto-enrolled successfully',
      data: {
        student,
        enrollment
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Single Create Error:", error.message);
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Conflict',
        error: 'Duplicate registration number detected.'
      });
    }
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  } finally {
    client.release();
  }
});

/**
 * @route   GET /api/students
 * @desc    Fetch all students for the authenticated school with current enrollment info
 * @access  Private
 * @query   sessionId (optional) - Filter by specific session; defaults to active session
 */
// router.get('/', async (req, res) => {
//   try {
//     const schoolId = req.user?.schoolId;
//     const { sessionId } = req.query;

//     let params = [schoolId];
//     let sessionIdValue = sessionId;

//     // If no sessionId provided, fetch the active session
//     if (!sessionIdValue) {
//       const sessionResult = await pool.query(
//         'SELECT id FROM academic_sessions WHERE school_id = $1 AND is_active = true LIMIT 1',
//         [schoolId]
//       );
//       if (sessionResult.rows.length > 0) {
//         sessionIdValue = sessionResult.rows[0].id;
//       }
//     }

//     params.push(sessionIdValue);

//     // JOIN students with enrollments to include enrollment_id and class info
//     const result = await pool.query(
//       `SELECT 
//         s.id,
//         s.school_id,
//         s.first_name,
//         s.last_name,
//         s.email,
//         s.registration_number,
//         s.date_of_birth,
//         s.gender,
//         s.phone,
//         s.photo,
//         e.id as enrollment_id,
//         e.class_id,
//         e.session_id,
//         e.status as enrollment_status,
//         c.class_name
//        FROM students s
//        LEFT JOIN enrollments e ON s.id = e.student_id AND e.school_id = $1
//        LEFT JOIN classes c ON e.class_id = c.id
//        WHERE s.school_id = $1 
//        ${sessionIdValue ? 'AND e.session_id = $2' : ''}
//        ORDER BY s.last_name ASC, s.first_name ASC`, 
//       sessionIdValue ? params : [schoolId]
//     );

//     return res.status(200).json({
//       success: true,
//       count: result.rowCount,
//       data: result.rows
//     });

//   } catch (error) {
//     console.error("Fetch Error:", error.message);
//     return res.status(500).json({ success: false, message: "Failed to fetch students", error: error.message });
//   }
// });





/**
 * @route   GET /api/students
 * @desc    Get all students registered to the authenticated school
 * @access  Private
 */
router.get('/', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(401).json({ success: false, message: "Unauthorized: No school ID found in token" });
    }

    // This query selects ALL students belonging to the school.
    // It LEFT JOINs enrollments so that even students NOT YET enrolled still show up.
    const query = `
      SELECT 
        s.id,
        s.first_name,
        s.last_name,
        s.registration_number,
        s.gender,
        s.email,
        s.phone,
        e.id as enrollment_id,
        e.status as enrollment_status,
        e.class_id,
        gct.display_name as class_name,
        ay.year_label as academic_session
      FROM students s
      LEFT JOIN enrollments e ON s.id = e.student_id AND e.school_id = s.school_id
      LEFT JOIN global_class_templates gct ON e.class_id = gct.id
      LEFT JOIN academic_years ay ON e.session_id = ay.id
      WHERE s.school_id = $1
      ORDER BY s.last_name ASC, s.first_name ASC
    `;

    const result = await pool.query(query, [schoolId]);

    return res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error("Fetch All Students Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch student list",
      error: error.message
    });
  }
});
/**
 * @route   GET /api/students/:studentId
 * @desc    Fetch a specific student's details with enrollment history
 * @access  Private
 */
router.get('/:studentId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { studentId } = req.params;

    const result = await pool.query(
      `SELECT * FROM students WHERE id = $1 AND school_id = $2`,
      [studentId, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found or unauthorized' });
    }

    // Get enrollment history for this student
    const enrollmentResult = await pool.query(
      `SELECT 
          e.id as enrollment_id,
          s.session_name as academic_session,
          e.status,
          c.class_name,
          e.created_at,
          e.updated_at
        FROM enrollments e
        JOIN classes c ON e.class_id = c.id
        JOIN academic_sessions s ON e.session_id = s.id
        WHERE e.student_id = $1 AND e.school_id = $2
        ORDER BY s.session_name DESC`,
      [studentId, schoolId]
    );

    res.json({
      success: true,
      data: {
        student: result.rows[0],
        enrollmentHistory: enrollmentResult.rows
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Fetch failed', error: error.message });
  }
});

/**
 * @route   PUT /api/students/:studentId
 * @desc    Update student details
 * @access  Private
 */
router.put('/:studentId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { studentId } = req.params;
    const data = req.body;

    const result = await pool.query(
      `UPDATE students SET
       first_name = COALESCE($1, first_name),
       last_name = COALESCE($2, last_name),
       email = COALESCE($3, email),
       registration_number = COALESCE($4, registration_number),
       date_of_birth = COALESCE($5, date_of_birth),
       gender = COALESCE($6, gender),
       phone = COALESCE($7, phone),
       photo = COALESCE($8, photo),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 AND school_id = $10
       RETURNING *`,
      [
        data.firstName, data.lastName, data.email, data.registrationNumber,
        data.dateOfBirth, data.gender, data.phone, data.photo,
        studentId, schoolId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Student not found or unauthorized' });
    }

    res.json({
      success: true,
      message: 'Student updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Update Error:", error.message);
    res.status(500).json({ success: false, message: 'Update failed', error: error.message });
  }
});

/**
 * @route   DELETE /api/students/:studentId
 * @desc    Remove a student record (cascades to enrollments & scores)
 * @access  Private
 */
router.delete('/:studentId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { studentId } = req.params;

    const result = await pool.query(
      'DELETE FROM students WHERE id = $1 AND school_id = $2 RETURNING id',
      [studentId, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found or unauthorized' });
    }

    res.json({ success: true, message: 'Student record deleted successfully' });
  } catch (error) {
    console.error("Delete Error:", error.message);
    res.status(500).json({ success: false, message: 'Delete failed', error: error.message });
  }
});

// =====================================================================
// ENROLLMENT MANAGEMENT ENDPOINTS
// =====================================================================

/**
 * @route   POST /api/students/enrollments/create
 * @desc    Create or update an enrollment record (assign student to class for a session)
 * @access  Private
 * @body    {
 *            studentId: Number,
 *            classId: Number,
 *            sessionId: Number (ID from academic_sessions table),
 *            status: String (optional: "active", "promoted", "repeated", "transferred", "graduated")
 *          }
 */
router.post('/enrollments/create', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { studentId, classId, sessionId, status = 'active' } = req.body;

    // Validation
    if (!studentId || !classId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'studentId, classId, and sessionId are required'
      });
    }

    const validStatuses = ['active', 'promoted', 'repeated', 'transferred', 'graduated'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: `Status must be one of: ${validStatuses.join(', ')}`
      });
    }

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

    // Verify class belongs to school
    const classCheck = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND school_id = $2',
      [classId, schoolId]
    );

    if (classCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
        error: 'Class not found in your school'
      });
    }

    // Verify academic session belongs to school
    const sessionCheck = await pool.query(
      'SELECT id FROM academic_sessions WHERE id = $1 AND school_id = $2',
      [sessionId, schoolId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
        error: 'Academic session not found in your school'
      });
    }

    // Upsert enrollment record
    const result = await pool.query(
      `INSERT INTO enrollments (
        school_id, student_id, class_id, session_id, status
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (school_id, student_id, class_id, session_id)
      DO UPDATE SET
        status = $5,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [schoolId, studentId, classId, sessionId, status]
    );

    res.status(201).json({
      success: true,
      message: 'Enrollment record saved successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Enrollment Create Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/students/enrollments/bulk
 * @desc    Bulk create enrollments for multiple students
 * @access  Private
 * @body    {
 *            enrollments: [
 *              {
 *                studentId: Number,
 *                classId: Number,
 *                sessionId: Number (ID from academic_sessions table),
 *                status: String (optional)
 *              },
 *              ...more enrollments
 *            ]
 *          }
 */
router.post('/enrollments/bulk', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { enrollments } = req.body;

    if (!enrollments || !Array.isArray(enrollments) || enrollments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'Enrollments must be a non-empty array'
      });
    }

    // Validate all enrollments before processing
    for (let i = 0; i < enrollments.length; i++) {
      const enrollment = enrollments[i];
      if (!enrollment.studentId || !enrollment.classId || !enrollment.sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Enrollment at index ${i} is missing required fields (studentId, classId, sessionId)`
        });
      }
    }

    // Build bulk insert query
    const values = [];
    const placeholders = enrollments.map((enrollment, i) => {
      const offset = i * 5;
      const status = enrollment.status || 'active';

      values.push(
        schoolId,
        enrollment.studentId,
        enrollment.classId,
        enrollment.sessionId,
        status
      );

      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    }).join(',');

    const query = `
      INSERT INTO enrollments (
        school_id, student_id, class_id, session_id, status
      ) VALUES ${placeholders}
      ON CONFLICT (school_id, student_id, class_id, session_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`;

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: `Successfully created/updated ${result.rowCount} enrollment records`,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error('Bulk Enrollment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/students/enrollments/class/:classId
 * @desc    Get all enrollments for a specific class in an academic session
 * @access  Private
 * @query   {
 *            sessionId: Number (required, ID from academic_sessions table)
 *          }
 */
router.get('/enrollments/class/:classId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { classId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'sessionId query parameter is required'
      });
    }

    const result = await pool.query(
      `SELECT
        e.id as enrollment_id,
        e.student_id,
        s.first_name,
        s.last_name,
        s.registration_number,
        a.session_name as academic_session,
        e.status,
        e.created_at,
        e.updated_at
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN academic_sessions a ON e.session_id = a.id
      WHERE e.class_id = $1 AND e.school_id = $2 AND e.session_id = $3
      ORDER BY s.last_name ASC, s.first_name ASC`,
      [classId, schoolId, sessionId]
    );

    res.status(200).json({
      success: true,
      count: result.rowCount,
      message: `Retrieved ${result.rowCount} enrollments for the class`,
      data: result.rows
    });

  } catch (error) {
    console.error('Class Enrollments Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/students/:studentId/enrollments
 * @desc    Get all enrollments for a specific student (complete enrollment history)
 * @access  Private
 */
router.get('/:studentId/enrollments', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { studentId } = req.params;

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

    const result = await pool.query(
      `SELECT
        e.id as enrollment_id,
        a.session_name as academic_session,
        e.status,
        c.id as class_id,
        c.class_name,
        e.created_at,
        e.updated_at
      FROM enrollments e
      JOIN classes c ON e.class_id = c.id
      JOIN academic_sessions a ON e.session_id = a.id
      WHERE e.student_id = $1 AND e.school_id = $2
      ORDER BY a.session_name DESC`,
      [studentId, schoolId]
    );

    res.status(200).json({
      success: true,
      count: result.rowCount,
      message: `Retrieved ${result.rowCount} enrollment records for student`,
      data: result.rows
    });

  } catch (error) {
    console.error('Student Enrollments Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/students/enrollments/:enrollmentId
 * @desc    Update an enrollment record (change status or class)
 * @access  Private
 * @body    {
 *            classId: Number (optional),
 *            status: String (optional)
 *          }
 */
router.put('/enrollments/:enrollmentId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { enrollmentId } = req.params;
    const { classId, status } = req.body;

    if (!classId && !status) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'At least one of classId or status must be provided'
      });
    }

    if (status) {
      const validStatuses = ['active', 'promoted', 'repeated', 'transferred', 'graduated'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Validation Error',
          error: `Status must be one of: ${validStatuses.join(', ')}`
        });
      }
    }

    // Verify enrollment belongs to school
    const enrollmentCheck = await pool.query(
      'SELECT * FROM enrollments WHERE id = $1 AND school_id = $2',
      [enrollmentId, schoolId]
    );

    if (enrollmentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Not Found',
        error: 'Enrollment record not found'
      });
    }

    const currentEnrollment = enrollmentCheck.rows[0];

    // Build update query
    let query = 'UPDATE enrollments SET ';
    const params = [];
    let paramIndex = 1;

    if (classId) {
      // Verify new class belongs to school
      const classCheck = await pool.query(
        'SELECT id FROM classes WHERE id = $1 AND school_id = $2',
        [classId, schoolId]
      );

      if (classCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized',
          error: 'Class not found in your school'
        });
      }

      query += `class_id = $${paramIndex}, `;
      params.push(classId);
      paramIndex++;
    }

    if (status) {
      query += `status = $${paramIndex}, `;
      params.push(status);
      paramIndex++;
    }

    query += `updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} AND school_id = $${paramIndex + 1} RETURNING *`;
    params.push(enrollmentId, schoolId);

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      message: 'Enrollment record updated successfully',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update Enrollment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/students/enrollments/:enrollmentId
 * @desc    Delete an enrollment record (cascades to associated scores)
 * @access  Private
 */
router.delete('/enrollments/:enrollmentId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const { enrollmentId } = req.params;

    const result = await pool.query(
      'DELETE FROM enrollments WHERE id = $1 AND school_id = $2 RETURNING id',
      [enrollmentId, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Not Found',
        error: 'Enrollment record not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Enrollment record deleted successfully'
    });

  } catch (error) {
    console.error('Delete Enrollment Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
});


/**
 * @route   POST /api/students/self-enroll
 * @desc    Allows a logged-in student to enroll themselves for a specific session
 * @access  Private (Student only)
 */
router.post('/self-enroll', authMiddleware.authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. Security Check: Ensure the user is a student
    if (req.user?.type !== 'student') {
      return res.status(403).json({ success: false, error: 'Only students can perform self-enrollment.' });
    }

    const studentId = req.user.studentId;
    const schoolId = req.user.schoolId;
    const { academicSession, classId } = req.body;

    if (!academicSession || !classId) {
      return res.status(400).json({ success: false, error: 'Academic session and Class ID are required.' });
    }

    await client.query('BEGIN');

    // 2. Lookup Academic Year/Session from global academic_years table
    const sessionLookup = await client.query(
      'SELECT id FROM academic_years WHERE session_name = $1 LIMIT 1',
      [academicSession]
    );

    if (sessionLookup.rows.length === 0) {
      throw new Error(`Academic session "${academicSession}" not found.`);
    }

    const sessionId = sessionLookup.rows[0].id;

    // 3. Verify Class exists (global template)
    const classCheck = await client.query(
      'SELECT id FROM global_class_templates WHERE id = $1',
      [classId]
    );

    if (classCheck.rows.length === 0) {
      throw new Error('The selected class is not valid.');
    }

    // 4. Check for Duplicate Enrollment
    // Prevent the student from enrolling in the same session twice
    const duplicateCheck = await client.query(
      'SELECT id FROM enrollments WHERE student_id = $1 AND session_id = $2',
      [studentId, sessionId]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new Error(`You are already enrolled for the ${academicSession} session.`);
    }

    // 5. Perform Enrollment
    const enrollmentInsert = await client.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, session_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [schoolId, studentId, classId, sessionId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `Successfully enrolled in session ${academicSession}`,
      enrollmentId: enrollmentInsert.rows[0].id
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Self-Enrollment Error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;