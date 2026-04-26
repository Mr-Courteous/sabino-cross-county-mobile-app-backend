const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware.authenticateToken);

// Get all classes for authenticated school
router.get('/', async (req, res) => {
  try {
    // STRICT SECURITY: Extract schoolId and countryId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;
    const countryId = req.user?.countryId;
    // If the requesting country is "Others" (id 22), fallback to Nigeria (id 1)
    const effectiveCountryId = (countryId === 22 ? 1 : countryId);

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    if (!countryId) {
      return res.status(401).json({
        success: false,
        error: 'Country context missing. Please login again.'
      });
    }

    console.log(`📥 GET /classes - Request by School: ${schoolId} for Country: ${countryId} (effective: ${effectiveCountryId})`);

    // Removed school_id from SELECT and WHERE because it doesn't exist in this table
    const query = `
      SELECT id, country_id, display_name, capacity 
      FROM global_class_templates 
      WHERE country_id = $1 
      ORDER BY display_name ASC
    `;
    const params = [effectiveCountryId];

    const result = await pool.query(query, params);

    console.log(`✓ Retrieved ${result.rows.length} global templates for country ${countryId}`);

    res.status(200).json({
      success: true,
      data: result.rows,
      countryId: countryId,
      effectiveCountryId: effectiveCountryId,
      count: result.rows.length
    });
  } catch (error) {
    console.error('❌ Classes Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Get all subjects (classes) for authenticated school with country-based curriculum support
router.get('/subjects', async (req, res) => {
  try {
    // We still authenticate the user, but we don't filter the data by their IDs
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    // Optional: Let the frontend filter by level (e.g., /subjects?level=Primary)
    const { level } = req.query;

    let query = 'SELECT id, subject_name as name, category, education_level FROM global_subjects';
    let params = [];

    if (level) {
      query += ' WHERE education_level = $1';
      params.push(level);
    }

    query += ' ORDER BY education_level ASC, subject_name ASC';

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      message: "Retrieved global subject templates"
    });
  } catch (error) {
    console.error('❌ Global Subjects Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

/**
 * @route   POST /api/classes/initialize-from-templates
 * @desc    Initialize school classes from global templates based on country
 * @desc    Maps display_name from global_class_templates to class_name in classes table
 * @access  Private (Authenticated schools only)
 * @body    None - uses countryId from JWT token ONLY
 */
router.post('/initialize-from-templates', async (req, res) => {
  const client = await pool.connect();

  try {
    // STRICT SECURITY: Extract schoolId and countryId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;
    const countryId = req.user?.countryId;
    const effectiveCountryId = (countryId === 22 ? 1 : countryId);

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    if (!countryId) {
      return res.status(401).json({
        success: false,
        error: 'Country context missing. Please login again.'
      });
    }

    console.log(`📥 Initializing classes from templates - SchoolId: ${schoolId}, CountryId: ${countryId} (effective: ${effectiveCountryId})`);

    // Fetch global class templates for this country
    const templates = await client.query(
      `SELECT id, display_name, capacity 
       FROM global_class_templates 
       WHERE country_id = $1
       ORDER BY display_name ASC`,
      [effectiveCountryId]
    );

    if (templates.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No class templates found for country_id ${effectiveCountryId}`
      });
    }

    console.log(`✓ Found ${templates.rows.length} global templates for country ${countryId}`);

    // Start transaction to insert all classes
    await client.query('BEGIN');

    const createdClasses = [];
    let duplicateCount = 0;

    // Insert each template as a class for this school
    // Maps display_name → class_name and uses ON CONFLICT to prevent duplicates
    for (const template of templates.rows) {
      try {
        const result = await client.query(
          `INSERT INTO classes (school_id, class_name, capacity)
           VALUES ($1, $2, $3)
           ON CONFLICT (school_id, class_name) DO NOTHING
           RETURNING id, school_id, class_name, capacity, created_at`,
          [schoolId, template.display_name, template.capacity || 50]
        );

        if (result.rows.length > 0) {
          createdClasses.push(result.rows[0]);
          console.log(`✓ Created class: ${template.display_name}`);
        } else {
          duplicateCount++;
          console.log(`⚠️ Class already exists (skipped): ${template.display_name}`);
        }
      } catch (innerError) {
        console.error(`❌ Error creating class ${template.display_name}:`, innerError.message);
        throw innerError;
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log(`✅ Class initialization complete: ${createdClasses.length} created, ${duplicateCount} skipped (already existed)`);

    res.status(201).json({
      success: true,
      message: `${createdClasses.length} classes initialized from global templates (${duplicateCount} already existed)`,
      data: {
        created: createdClasses.length,
        duplicates: duplicateCount,
        classes: createdClasses
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Initialize Classes Error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

/**
 * @route   POST /api/classes/initialize
 * @desc    Legacy endpoint - maintained for backward compatibility
 * @access  Private (Authenticated schools only)
 * @body    None - uses countryId from JWT token ONLY (NOT from body)
 * @deprecated Use POST /initialize-from-templates instead
 */
router.post('/initialize', async (req, res) => {
  const client = await pool.connect();

  try {
    // STRICT SECURITY: Extract schoolId and countryId ONLY from token, NEVER from req.body
    const schoolId = req.user?.schoolId;
    const countryId = req.user?.countryId;
    const effectiveCountryId = (countryId === 22 ? 1 : countryId);

    if (!schoolId) {
      return res.status(401).json({ success: false, error: 'Authentication context missing. Please login again.' });
    }

    if (!countryId) {
      return res.status(401).json({
        success: false,
        error: 'Country context missing. Please login again.'
      });
    }

    // Check if global_class_templates table exists and fetch templates
    const templates = await client.query(
      `SELECT id, display_name, capacity 
       FROM global_class_templates 
       WHERE country_id = $1
       ORDER BY display_name ASC`,
      [effectiveCountryId]
    );

    if (templates.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No class templates found for country_id ${effectiveCountryId}`
      });
    }

    // Start transaction to insert all classes
    await client.query('BEGIN');

    const createdClasses = [];

    // Insert each template as a class for this school
    for (const template of templates.rows) {
      try {
        const result = await client.query(
          `INSERT INTO classes (school_id, class_name, capacity)
           VALUES ($1, $2, $3)
           ON CONFLICT (school_id, class_name) DO NOTHING
           RETURNING id, school_id, class_name, capacity, created_at`,
          [schoolId, template.display_name, template.capacity || 50]
        );
        if (result.rows.length > 0) {
          createdClasses.push(result.rows[0]);
        }
      } catch (innerError) {
        // Skip classes that already exist (UNIQUE constraint on school_id, class_name)
        if (innerError.code !== '23505') {
          throw innerError;
        }
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `${createdClasses.length} classes initialized from global templates`,
      data: createdClasses
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Initialize Classes Error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
