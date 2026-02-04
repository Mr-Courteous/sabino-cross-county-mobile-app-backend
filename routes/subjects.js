const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const authMiddleware = require('../middleware/auth');
require('dotenv').config();




/**
 * @route   GET /api/subjects/search
 * @desc    Search the global subject library by keyword
 * @access  Private (Authenticated users only)
 */
router.get('/search', async (req, res) => {
  try {
    // STRICT SECURITY: Extract countryId ONLY from token, never from req.body or req.query
    const countryId = req.user?.countryId;
    const { keyword } = req.query;

    if (!countryId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Country context missing. Please login again.' 
      });
    }

    const query = `
      SELECT id, name, category 
      FROM global_subjects
      WHERE country_id = $1 
      AND name ILIKE $2 
      LIMIT 20
    `;
    
    // ILIKE %keyword% finds the exact word anywhere in the name
    const result = await pool.query(query, [countryId, `%${keyword}%`]);
    
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports=router;