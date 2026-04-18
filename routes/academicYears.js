const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware.authenticateToken);

// Get all academic years
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, year_label FROM academic_years ORDER BY year_label DESC'
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Academic Years Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
