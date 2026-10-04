// ─────────────────────────────────────────────────────────────
// routes/superadmin/middleware.js
// Superadmin tokens are signed with their OWN secret and carry type
// 'superadmin', so they can never be used on school/student routes
// (middleware/auth.js rejects unknown types) and vice-versa.
// The admin row is re-read on every request, so deactivating an admin
// or changing a role takes effect immediately — no waiting for expiry.
// ─────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const TOKEN_TTL = '8h';

function signToken(admin) {
  return jwt.sign({ sub: admin.id, type: 'superadmin' }, process.env.SUPERADMIN_JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// The only paths an admin on a temporary password may still call.
const ALLOWED_WHILE_TEMP_PASSWORD = new Set(['/auth/me', '/auth/change-password']);

async function requireSuperadmin(req, res, next) {
  try {
    if (!process.env.SUPERADMIN_JWT_SECRET) {
      console.error('FATAL: SUPERADMIN_JWT_SECRET is not set.');
      return res.status(500).json({ success: false, error: 'Server configuration error.' });
    }
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Sign in to continue.', code: 'NO_TOKEN' });
    }
    let decoded;
    try {
      decoded = jwt.verify(header.slice(7), process.env.SUPERADMIN_JWT_SECRET);
    } catch (err) {
      const expired = err.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        error: expired ? 'Session expired. Sign in again.' : 'Invalid session. Sign in again.',
        code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      });
    }
    if (decoded.type !== 'superadmin') {
      return res.status(401).json({ success: false, error: 'Invalid session.', code: 'TOKEN_INVALID' });
    }

    const { rows } = await pool.query(
      'SELECT id, email, name, role, is_active, must_change_password FROM superadmins WHERE id = $1',
      [decoded.sub]
    );
    const admin = rows[0];
    if (!admin || !admin.is_active) {
      return res.status(401).json({ success: false, error: 'This account is no longer active.', code: 'ACCOUNT_DISABLED' });
    }
    if (admin.must_change_password && !ALLOWED_WHILE_TEMP_PASSWORD.has(req.path)) {
      return res.status(403).json({ success: false, error: 'Set a new password to continue.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    req.admin = admin;
    next();
  } catch (err) {
    console.error('[superadmin] auth error:', err.message);
    res.status(500).json({ success: false, error: 'Could not verify your session.' });
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.admin?.role)) {
    return res.status(403).json({ success: false, error: 'Your role does not allow this action.', code: 'FORBIDDEN_ROLE' });
  }
  next();
};

module.exports = { signToken, requireSuperadmin, requireRole };
