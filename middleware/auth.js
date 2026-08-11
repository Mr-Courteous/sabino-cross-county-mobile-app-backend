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

  if (req.user.type !== 'student' && req.user.type !== 'school') {
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

// HELPER: getTeacherClassScope
//
// A school-type token can now carry two extra, additive claims set at
// login by routes/staff-onboarding/auth.js:
//   - staffRole: the staff member's actual job title ('admin' |
//     'class_teacher' | ...) — distinct from `role`, which stays the
//     existing owner/admin PERMISSION tier and must not change meaning.
//   - classId: the single class a 'class_teacher' is assigned to, if any.
//
// Returns the classId a request must be confined to, or null if the
// account is unrestricted (the owner, a full admin, or a class_teacher
// with no class assigned yet). Tokens issued before this feature has
// neither claim, so they fall through to null (unrestricted) — no
// behaviour change for existing sessions until they log in again.
// ─────────────────────────────────────────────────────────────
exports.getTeacherClassScope = (req) => {
  if (req.user?.type !== 'school') return null;
  if (req.user?.staffRole === 'class_teacher' && req.user?.classId) {
    return req.user.classId;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE: enforceClassScope(getRequestedClassId)
//
// For write routes that create/modify something tied to a specific
// class (creating a student, enrolling a student, ...). If the
// logged-in account is a class-scoped teacher, the class the request
// is acting on MUST match their assigned class, or it's rejected.
// Owners, full admins, and teachers with no class assigned pass
// straight through unchanged.
//
// `getRequestedClassId(req)` returns the classId this specific request
// touches (usually from req.body). If it returns null/undefined — the
// route can't tell us which class is involved — a scoped teacher is
// rejected (fail closed) rather than silently allowed school-wide
// access; an unrestricted account is unaffected either way.
//
// Usage:
//   router.post('/', ..., authMiddleware.enforceClassScope(req => req.body.classId), handler)
// ─────────────────────────────────────────────────────────────
exports.enforceClassScope = (getRequestedClassId) => (req, res, next) => {
  const scopedClassId = exports.getTeacherClassScope(req);
  if (!scopedClassId) return next();

  const requestedClassId = getRequestedClassId(req);
  if (requestedClassId === null || requestedClassId === undefined || requestedClassId === '') {
    return res.status(403).json({
      success: false,
      error: 'Your account is restricted to your assigned class. Specify a class to continue.',
      code: 'CLASS_SCOPE_REQUIRED',
    });
  }

  if (Number(requestedClassId) !== Number(scopedClassId)) {
    return res.status(403).json({
      success: false,
      error: 'You can only do this for your assigned class.',
      code: 'CLASS_SCOPE_VIOLATION',
    });
  }

  next();
};

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// MIDDLEWARE 5: requireOwner
// Added for the staff/admin hierarchy (routes/staff-onboarding).
//
// A school's JWT can now come from two places:
//   - the original owner account (routes/auth.js login)          -> req.user.role is absent or 'owner'
//   - an additional admin account (routes/staff-onboarding/auth) -> req.user.role === 'admin', req.user.staffId set
//
// Both carry type: 'school' and the same schoolId, so every existing
// requireSchool-protected route continues to work unchanged for admins
// too (by design — admins can read/write students, scores, classes,
// reports, etc. same as the owner). Two categories are owner-only:
//   1. Destructive actions (delete student/enrollment/score/school,
//      clear a cached AI remark).
//   2. Managing other admin accounts (create, invite, revoke invite,
//      deactivate, reactivate, delete — see routes/staff-onboarding/management.js).
// Use this ON TOP OF requireSchool (or requireSchool via authRouter's
// own authenticateToken) for any route in either category.
//
// Usage:
//   router.delete('/:id', authMiddleware.authenticateToken, authMiddleware.requireSchool, authMiddleware.requireOwner, handler)
// ─────────────────────────────────────────────────────────────
exports.requireOwner = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
      code: 'NOT_AUTHENTICATED'
    });
  }

  // Tokens issued before this feature (or the owner's own login) have no
  // `role` field / role 'owner' — treat that as the owner. Only an
  // explicit role of 'admin' is restricted.
  if (req.user.type === 'school' && req.user.role === 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Only the school owner can perform this action.',
      message: 'Your admin account does not have permission to do this. Ask the school owner.',
      code: 'OWNER_ONLY'
    });
  }

  next();
};