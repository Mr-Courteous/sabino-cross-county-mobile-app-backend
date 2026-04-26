const jwt = require('jsonwebtoken');
require('dotenv').config();

exports.authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Also check query params for token (useful for file downloads)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;

    // STRICT SECURITY: Extract countryId ONLY from JWT payload
    // Do NOT accept countryId from query params, body, or any other source
    if (user.countryId) {
      req.user.countryId = user.countryId;
    }

    next();
  });
};

exports.checkSchoolOwnership = async (req, res, next) => {
  try {
    const pool = require('../database/db');
    const { schoolId } = req.params;

    const result = await pool.query(
      'SELECT owner_id FROM schools WHERE id = $1',
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'School not found' });
    }

    if (result.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
