const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../database/db');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ---------------------------------------------------------
// Login Rate Limiter (Audit Recommendation #5)
// ---------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login attempts per window
  message: { 
    success: false, 
    error: 'Too many login attempts. Please try again in 15 minutes.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper: Generate Token
const generateToken = (schoolId, type, countryId = null) => {
    const payload = {
        id: schoolId,
        schoolId: schoolId,
        type: type
    };
    if (countryId) {
        payload.countryId = countryId;
    }
    return jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
};

// Login
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const result = await pool.query(
            'SELECT id, name, email, password, country FROM schools WHERE email = $1',
            [normalizedEmail]
        );

        const school = result.rows[0];

        if (!school) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, school.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Fetch country_id from countries table based on school's country
        let countryId = null;
        if (school.country) {
            try {
                const countryResult = await pool.query(
                    'SELECT id FROM countries WHERE name = $1 LIMIT 1',
                    [school.country]
                );
                if (countryResult.rows.length > 0) {
                    countryId = countryResult.rows[0].id;
                    console.log(`✓ Country lookup successful: ${school.country} → ID: ${countryId}`);
                } else {
                    console.warn(`⚠️ Country not found in database: ${school.country}`);
                }
            } catch (countryError) {
                console.error('❌ Country lookup error:', countryError.message);
            }
        }

        const token = generateToken(school.id, 'school', countryId);

        console.log(`🔑 School Login: ${school.name} (ID: ${school.id}, Country: ${school.country}, CountryID: ${countryId})`);

        res.json({
            success: true,
            message: 'Login successful',
            data: { // Add this wrapper
                token,
                user: {
                    schoolId: school.id,
                    email: school.email,
                    name: school.name,
                    type: 'school',
                    countryId: countryId
                }
            }
        });

    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ error: 'An unexpected server error occurred' });
    }
});

/**
 * @route   GET /api/auth/countries
 * @desc    Get list of all available countries for school registration
 * @access  Public
 */
router.get('/countries', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name FROM countries ORDER BY name ASC'
        );

        res.json({
            success: true,
            message: 'Countries list retrieved successfully',
            data: result.rows
        });
    } catch (error) {
        console.error('Countries fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch countries list'
        });
    }
});

module.exports = router;
