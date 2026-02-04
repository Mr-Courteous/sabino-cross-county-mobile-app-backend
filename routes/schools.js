const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
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
      from: '"School Registry" <your-email@gmail.com>',
      to: email,
      subject: "Verify Your School Email",
      html: `
        <div style="font-family: sans-serif; text-align: center; border: 1px solid #ddd; padding: 20px;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Use the code below to complete your school registration:</p>
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

// Create school
router.post('/', async (req, res) => {
  try {
    const { name, address, country, phone, email, school_type, password } = req.body;

    if (!name || !email || !password || !school_type) {
      return res.status(400).json({ success: false, message: "All required fields must be filled" });
    }

    const emailVerified = await pool.query(
      'SELECT is_verified FROM email_verifications WHERE email = $1 AND is_verified = true',
      [email]
    );

    if (emailVerified.rows.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Email must be verified first. Please complete OTP verification." 
      });
    }

    const schoolExists = await pool.query('SELECT id FROM schools WHERE email = $1', [email]);
    if (schoolExists.rows.length > 0) {
      return res.status(400).json({ success: false, message: "A school with this email is already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const registrationCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const logoPath = (req.files && req.files.logo) ? req.files.logo[0].path : null;
    const stampPath = (req.files && req.files.stamp) ? req.files.stamp[0].path : null;

    const result = await pool.query(
      `INSERT INTO schools (
        registration_code, name, address, country, 
        phone, email, password, school_type, logo, stamp
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING id, registration_code, name, email, school_type`,
      [
        registrationCode,
        name,
        address || null,
        country || null,
        phone || null,
        email,
        hashedPassword,
        school_type,
        logoPath,
        stampPath
      ]
    );

    const school = result.rows[0];

    // Auto-create default academic session for immediate use
    const currentYear = new Date().getFullYear();
    const defaultSessionName = `${currentYear}/${currentYear + 1}`;
    
    try {
      await pool.query(
        `INSERT INTO academic_sessions (school_id, session_name, is_active)
         VALUES ($1, $2, $3)
         ON CONFLICT (school_id, session_name) DO UPDATE
         SET is_active = $3`,
        [school.id, defaultSessionName, true]
      );
      console.log(`✓ Default academic session created for school: ${defaultSessionName}`);
    } catch (sessionError) {
      console.error("Warning: Failed to create default academic session:", sessionError);
      // Don't fail the school registration if session creation fails
    }

    // Look up country_id from countries table based on country name
    let countryId = null;
    if (country) {
      try {
        const countryResult = await pool.query(
          'SELECT id FROM countries WHERE name = $1 LIMIT 1',
          [country]
        );
        if (countryResult.rows.length > 0) {
          countryId = countryResult.rows[0].id;
          console.log(`✓ Country ID ${countryId} found for: ${country}`);

          // Auto-initialize classes from global templates for this country
          try {
            const templates = await pool.query(
              `SELECT id, class_code, class_name, form_teacher, capacity 
               FROM global_class_templates 
               WHERE country_id = $1
               ORDER BY class_code ASC`,
              [countryId]
            );

            if (templates.rows.length > 0) {
              // Insert each template as a class for this school
              let classesCreated = 0;
              for (const template of templates.rows) {
                try {
                  await pool.query(
                    `INSERT INTO classes (school_id, class_name, form_teacher, capacity)
                     VALUES ($1, $2, $3, $4)`,
                    [school.id, template.class_name, template.form_teacher || null, template.capacity || 50]
                  );
                  classesCreated++;
                } catch (classError) {
                  // Skip if class already exists
                  if (classError.code !== '23505') {
                    console.error(`Error creating class ${template.class_name}:`, classError);
                  }
                }
              }
              console.log(`✓ Initialized ${classesCreated} classes from global templates for country ${country}`);
            }
          } catch (templateError) {
            console.error("Warning: Failed to initialize classes from global templates:", templateError);
            // Don't fail registration if template initialization fails
          }
        } else {
          console.log(`Warning: Country not found: ${country}`);
        }
      } catch (countryLookupError) {
        console.error("Warning: Failed to lookup country:", countryLookupError);
        // Don't fail registration if country lookup fails
      }
    }

    await pool.query('DELETE FROM email_verifications WHERE email = $1', [email]);
    await pool.query('INSERT INTO school_preferences (school_id) VALUES ($1)', [school.id]);

    const token = jwt.sign(
      { 
        schoolId: school.id, 
        email: school.email, 
        name: school.name,
        countryId: countryId
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // UPDATED RESPONSE STRUCTURE FOR CONSISTENCY
    return res.status(201).json({
      success: true,
      message: 'School registered successfully',
      data: {
        token, // Token is now inside data
        user: { // User object mirrors the login structure
          schoolId: school.id,
          email: school.email,
          name: school.name,
          registration_code: school.registration_code,
          type: 'school',
          countryId: countryId
        }
      }
    });

  } catch (error) {
    console.error("Registration Error:", error);
    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again later.",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Get user schools (requires auth)
router.get('/', authMiddleware.authenticateToken, async (req, res) => {
  try {
    // STRICT SECURITY: Extract userId ONLY from token, never from req.body or req.query
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication context missing. Please login again.' 
      });
    }

    const result = await pool.query(
      'SELECT * FROM schools WHERE owner_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({
      schools: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current school details using token
router.get('/me', authMiddleware.authenticateToken, async (req, res) => {
  try {
    // STRICT SECURITY: Extract schoolId ONLY from token, never from req.body or req.query
    // The authenticateToken middleware attaches the decoded token to req.user
    // In your generateToken function, you stored schoolId as 'id'
    const schoolId = req.user?.id;

    if (!schoolId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication context missing. Please login again.' 
      });
    }

    const result = await pool.query(
      `SELECT 
        id, 
        registration_code, 
        name, 
        address, 
        country, 
        phone, 
        email, 
        school_type, 
        logo, 
        stamp,
        created_at
      FROM schools 
      WHERE id = $1`,
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'School record not found' 
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Fetch school profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error retrieving profile' 
    });
  }
});

// Update school (requires auth)
router.put('/:schoolId', authMiddleware.authenticateToken, authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { name, address, city, state, country, phone, email } = req.body;

    const result = await pool.query(
      `UPDATE schools SET 
       name = COALESCE($1, name), 
       address = COALESCE($2, address), 
       city = COALESCE($3, city), 
       state = COALESCE($4, state), 
       country = COALESCE($5, country), 
       phone = COALESCE($6, phone), 
       email = COALESCE($7, email), 
       updated_at = CURRENT_TIMESTAMP 
       WHERE id = $8 
       RETURNING *`,
      [name, address, city, state, country, phone, email, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json({
      message: 'School updated successfully',
      school: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete school (requires auth)
router.delete('/:schoolId', authMiddleware.authenticateToken, authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    const { schoolId } = req.params;

    const result = await pool.query(
      'DELETE FROM schools WHERE id = $1 RETURNING id',
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json({ message: 'School deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
