const jwt = require('jsonwebtoken');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────
// HELPER: Extract token from request
// Supports: Authorization header (Bearer) only.
// NOTE: Query param token (?token=...) was removed intentionally.
// It poses a security risk — tokens in URLs appear in server logs,
// browser history, and referrer headers. Use Authorization header only.
// ─────────────────────────────────────────────────────────────
const extractToken = (req) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE 1: authenticateToken
// Use on ANY route that requires a logged-in user (school or student).
// Sets req.user to the decoded JWT payload.
//
// School token payload:  { id, schoolId, type: 'school', countryId, email, name }
// Student token payload: { studentId, schoolId, type: 'student' }
//
// Usage:
//   router.get('/route', authMiddleware.authenticateToken, handler)
// ─────────────────────────────────────────────────────────────
exports.authenticateToken = (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access denied. No token provided.',
      message: 'Please login to access this resource.'
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set.');
    return res.status(500).json({
      success: false,
      error: 'Server configuration error.'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      // Distinguish between expired and just invalid — helpful for frontend
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Session expired.',
          message: 'Your session has expired. Please login again.',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(403).json({
        success: false,
        error: 'Invalid token.',
        message: 'Your session is invalid. Please login again.',
        code: 'TOKEN_INVALID'
      });
    }

    // Validate that the token has a recognised type
    if (!decoded.type || !['school', 'student'].includes(decoded.type)) {
      return res.status(403).json({
        success: false,
        error: 'Invalid token type.',
        code: 'TOKEN_INVALID'
      });
    }

    // Attach full decoded payload to req.user
    // School tokens:  req.user.id, req.user.schoolId, req.user.type = 'school'
    // Student tokens: req.user.studentId, req.user.schoolId, req.user.type = 'student'
    req.user = decoded;

    next();
  });
};

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE 2: requireSchool
// Use on routes that should only be accessed by school accounts.
// Must be placed AFTER authenticateToken.
//
// Usage:
//   router.get('/route', authMiddleware.authenticateToken, authMiddleware.requireSchool, handler)
// ─────────────────────────────────────────────────────────────
exports.requireSchool = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
      code: 'NOT_AUTHENTICATED'
    });
  }

  if (req.user.type !== 'school') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. This resource is for school accounts only.',
      code: 'WRONG_ACCOUNT_TYPE'
    });
  }

  next();
};

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE 3: requireStudent
// Use on routes that should only be accessed by student accounts.
// Must be placed AFTER authenticateToken.
//
// Usage:
//   router.get('/route', authMiddleware.authenticateToken, authMiddleware.requireStudent, handler)
// ─────────────────────────────────────────────────────────────
exports.requireStudent = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
      code: 'NOT_AUTHENTICATED'
    });
  }

  if (req.user.type !== 'student') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. This resource is for student accounts only.',
      code: 'WRONG_ACCOUNT_TYPE'
    });
  }

  next();
};

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE 4: checkSchoolOwnership
// Use on routes where a school is acting on a specific schoolId param.
// Confirms the token's schoolId matches the :schoolId in the URL.
// Must be placed AFTER authenticateToken.
//
// Usage:
//   router.put('/:schoolId', authMiddleware.authenticateToken, authMiddleware.checkSchoolOwnership, handler)
// ─────────────────────────────────────────────────────────────
exports.checkSchoolOwnership = async (req, res, next) => {
  try {
    const pool = require('../database/db');
    const { schoolId } = req.params;

    if (!schoolId) {
      return res.status(400).json({
        success: false,
        error: 'School ID is required in the URL.'
      });
    }

    const result = await pool.query(
      'SELECT id FROM schools WHERE id = $1',
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'School not found.'
      });
    }

    // req.user.id is the school's DB id from the token (set during registration/login)
    if (String(req.user.id) !== String(schoolId)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. You can only modify your own school account.',
        code: 'OWNERSHIP_MISMATCH'
      });
    }

    next();
  } catch (error) {
    console.error('[checkSchoolOwnership] Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to verify school ownership.'
    });
  }
};