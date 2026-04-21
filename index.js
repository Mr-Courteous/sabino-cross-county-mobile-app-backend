const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan'); // 1. Import Morgan
require('dotenv').config({ path: path.resolve(__dirname, './.env.local') });

// Routes
const authRouter = require('./routes/auth');
const schoolsRouter = require('./routes/schools');
const academicYearsRouter = require('./routes/academicYears');
const classesRouter = require('./routes/classes');
const preferencesRouter = require('./routes/preferences');
const subscriptionsRouter = require('./routes/subscriptions');
const paymentsRouter = require('./routes/payments');
const studentsRouter = require('./routes/students');
const ScoresRouter = require('./routes/scores');
const subjectsRouter = require('./routes/subjects');
const ReportsRouter = require ('./routes/reports')

const app = express();

// Middleware - CORS first
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// 2. Replace manual logging with Morgan
// 'dev' gives you color-coded status logs and response times
app.use(morgan('dev')); 

// Custom logger for all incoming requests to help debug connectivity
app.use((req, res, next) => {
  console.log(`📡 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method !== 'GET' && Object.keys(req.body).length > 0) {
    console.log('📦 Body Payload:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint - Test API connectivity without auth
app.post('/api/test-message', (req, res) => {
  console.log('✅ [TEST] API is working! Received:', req.body);
  res.json({ 
    success: true, 
    message: 'API connection is working properly!',
    receivedData: req.body
  });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/schools', schoolsRouter);
app.use('/api/academic-years', academicYearsRouter);
app.use('/api/classes', classesRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/students', studentsRouter);
app.use('/api/scores', ScoresRouter);
app.use('/api/subjects', subjectsRouter);
app.use('/api/reports', ReportsRouter); 

// Public data endpoints (subjects, academic sessions, enrollments)
// These are mounted at /api level for broader access
const authenticateToken = require('./middleware/auth').authenticateToken;

/**
 * @route   GET /api/subjects
 * @desc    Get all subjects (national + school custom) filtered by countryId from token
 * @access  Private
 */
// app.get('/api/subjects', authenticateToken, async (req, res) => {
//   try {
//     const pool = require('./database/db');
//     const schoolId = req.user?.schoolId;
//     const countryId = req.user?.countryId;
    
//     if (!schoolId) {
//       return res.status(401).json({ success: false, error: 'Authentication required' });
//     }

//     if (!countryId) {
//       return res.status(401).json({ 
//         success: false, 
//         error: 'Country context required. Please login again.' 
//       });
//     }

//     // Fetch class templates (curriculum) from global_class_templates table
//     // These represent the standard curriculum available for the country
//     const query = `
//       SELECT DISTINCT 
//         id, 
//         display_name as name, 
//         display_name as code,
//         country_id,
//         capacity
//       FROM global_class_templates 
//       WHERE country_id = $1
//       ORDER BY display_name ASC
//     `;
//     const params = [countryId];

//     const result = await pool.query(query, params);
//     res.status(200).json({ 
//       success: true, 
//       data: result.rows,
//       countryId: countryId,
//       message: `Retrieved ${result.rowCount} class templates from global curriculum`
//     });
//   } catch (error) {
//     console.error('Subjects Error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

/**
 * @route   GET /api/academic-sessions
 * @desc    Get all academic sessions for the school
 * @access  Private
 */
app.get('/api/academic-sessions', authenticateToken, async (req, res) => {
  try {
    const pool = require('./database/db');
    
    console.log(`📥 GET /academic-sessions - Fetching all session IDs for User: ${req.user?.id}`);

    // Added 'id' to the selection
    // Removed 'DISTINCT' so each session ID is unique and available for the frontend
    const query = `
      SELECT id, session_name, year_label 
      FROM academic_years 
      ORDER BY year_label DESC
    `;
    
    const result = await pool.query(query);

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Academic Sessions Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

/**
 * @route   GET /api/enrollments
 * @desc    Get students enrolled in a specific class for a session
 * @access  Private
 * @query   { classId: number (required), session: string (required) }
 */
app.get('/api/enrollments', authenticateToken, async (req, res) => {
  try {
    const pool = require('./database/db');
    const schoolId = req.user?.schoolId;
    const countryId = req.user?.countryId;
    const { classId, session } = req.query;

    if (!schoolId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (!classId || !session) {
      return res.status(400).json({
        success: false,
        error: 'classId and session are required'
      });
    }

    // Fetch enrollments with country-based isolation
    const result = await pool.query(
      `SELECT 
        e.id as enrollment_id,
        e.student_id,
        s.first_name,
        s.last_name,
        s.student_number,
        e.class_id,
        c.class_name,
        e.academic_session,
        e.status
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN classes c ON e.class_id = c.id
      WHERE e.school_id = $1 
        AND e.class_id = $2 
        AND e.academic_session = $3
      ORDER BY s.last_name ASC, s.first_name ASC`,
      [schoolId, classId, session]
    );

    res.status(200).json({
      success: true,
      data: result.rows,
      countryId: countryId || null,
      count: result.rowCount
    });
  } catch (error) {
    console.error('Enrollments Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ sabino-server listening on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;