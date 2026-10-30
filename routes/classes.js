const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');

/**
 * Insert one class for a school, resilient to the `classes` table
 * missing its (school_id, class_name) unique constraint on some live
 * databases (tables created before that constraint existed — CREATE
 * TABLE IF NOT EXISTS is a no-op on an existing table, so it never
 * retroactively gets added). Without this fallback, `ON CONFLICT
 * (school_id, class_name)` fails outright with Postgres error 42P10
 * ("no unique or exclusion constraint matching the ON CONFLICT
 * specification") instead of just skipping the duplicate.
 *
 * Name comparison is case-/whitespace-insensitive so "Primary 4",
 * "primary 4 " etc. are treated as the same class — the exact-match
 * comparison this used to do is what let duplicate rows form in the
 * first place whenever a template name didn't byte-for-byte match
 * what was already stored.
 *
 * Returns the created row, or null if it already existed.
 */
async function insertClassResilient(db, schoolId, className, capacity) {
  const normalized = className.trim();
  try {
    const result = await db.query(
      `INSERT INTO classes (school_id, class_name, capacity)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id, class_name) DO NOTHING
       RETURNING id, school_id, class_name, capacity, created_at`,
      [schoolId, normalized, capacity || 50]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err.code !== '42P10') throw err;
    // No matching unique constraint — fall back to a plain insert,
    // guarded by our own existence check first. Caller is expected to
    // hold the per-school advisory lock (see GET /school below) so
    // this check-then-insert can't race with itself across concurrent
    // requests, which is how duplicate class rows previously slipped
    // through even with this guard in place.
    const existing = await db.query(
      `SELECT id FROM classes WHERE school_id = $1 AND LOWER(TRIM(class_name)) = LOWER($2)`,
      [schoolId, normalized]
    );
    if (existing.rows.length > 0) return null;
    try {
      const plain = await db.query(
        `INSERT INTO classes (school_id, class_name, capacity) VALUES ($1, $2, $3)
         RETURNING id, school_id, class_name, capacity, created_at`,
        [schoolId, normalized, capacity || 50]
      );
      return plain.rows[0];
    } catch (insertErr) {
      if (insertErr.code === '23505') return null; // lost a race, already exists
      throw insertErr;
    }
  }
}

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

/**
 * @route   GET /api/classes/school
 * @desc    This school's OWN instantiated classes (the real `classes`
 *          table — id, class_name, capacity). This is the id space
 *          every write endpoint actually validates against
 *          (enrollments.class_id, students.js, staff.class_id, ...) —
 *          unlike GET /, which returns global_class_templates ids and
 *          should only ever be used for DISPLAY NAMES, never as the
 *          classId sent back to a write endpoint.
 * @access  Private (Authenticated schools only)
 * @query   none — school + country come from the token
 */
router.get('/school', async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    const countryId = req.user?.countryId;
    const effectiveCountryId = (countryId === 22 ? 1 : countryId);

    if (!schoolId) {
      return res.status(401).json({ success: false, error: 'Authentication context missing. Please login again.' });
    }

    let result = await pool.query(
      `SELECT id, class_name, capacity FROM classes WHERE school_id = $1 AND archived_at IS NULL ORDER BY class_name ASC`,
      [schoolId]
    );

    // Seed (or top up) this school's classes from that country's templates
    // so the picker always reflects the full curriculum. Previously this
    // only ran when the school had ZERO classes, so a school that already
    // had a couple of rows (partial seed, manual creation before the full
    // template set existed, a country-lookup hiccup at signup, etc.) would
    // stay stuck on those few rows forever. Now we always diff against the
    // template list and insert whatever's missing — insertClassResilient
    // is already ON CONFLICT DO NOTHING, so existing classes are untouched.
    //
    // This whole check-then-insert phase runs inside a per-school
    // advisory lock. Without it, two requests landing close together
    // (e.g. two screens both loading /api/classes/school on mount)
    // could both see the class as "missing" and both insert it — on a
    // database missing the (school_id, class_name) unique constraint
    // (see insertClassResilient above) there was nothing to stop that,
    // which is exactly how duplicate "Primary 4"-type rows formed:
    // different students ended up enrolled against different
    // duplicate class ids that all display the same name.
    if (countryId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [schoolId]);

        // Includes archived classes and the original template name of
        // renamed ones, so a class the school renamed or removed is not
        // silently re-created from the template.
        const current = await client.query(
          `SELECT id, class_name, origin_name FROM classes WHERE school_id = $1`,
          [schoolId]
        );
        const templates = await client.query(
          `SELECT display_name, capacity FROM global_class_templates WHERE country_id = $1 ORDER BY display_name ASC`,
          [effectiveCountryId]
        );
        // Case-/whitespace-insensitive comparison — an exact-match Set
        // here is what previously let a template re-seed itself every
        // single load whenever the stored name differed by casing or
        // stray whitespace from the template's display_name.
        const existingNames = new Set();
        current.rows.forEach((r) => {
          existingNames.add(r.class_name.trim().toLowerCase());
          if (r.origin_name) existingNames.add(r.origin_name.trim().toLowerCase());
        });
        const missingTemplates = templates.rows.filter(
          (t) => !existingNames.has(t.display_name.trim().toLowerCase())
        );

        for (const template of missingTemplates) {
          await insertClassResilient(client, schoolId, template.display_name, template.capacity);
        }

        await client.query('COMMIT');
      } catch (seedErr) {
        await client.query('ROLLBACK');
        console.error('❌ Class seeding error (non-fatal, returning existing classes):', seedErr.message);
      } finally {
        client.release();
      }

      result = await pool.query(
        `SELECT id, class_name, capacity FROM classes WHERE school_id = $1 AND archived_at IS NULL ORDER BY class_name ASC`,
        [schoolId]
      );
    }

    res.status(200).json({ success: true, data: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('❌ School Classes Error:', error);
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

    // Shared library + this school's own subjects (never another school's).
    let query = 'SELECT id, subject_name as name, category, education_level, (school_id IS NOT NULL) AS is_custom FROM global_subjects WHERE (school_id IS NULL OR school_id = $1)';
    let params = [schoolId];

    if (level) {
      query += ' AND education_level = $2';
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
        const created = await insertClassResilient(client, schoolId, template.display_name, template.capacity);

        if (created) {
          createdClasses.push(created);
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
        const created = await insertClassResilient(client, schoolId, template.display_name, template.capacity);
        if (created) {
          createdClasses.push(created);
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

/**
 * Class management (add / rename / archive).
 *   POST   /api/classes/school        { className, capacity? }
 *   PUT    /api/classes/school/:id    { className?, capacity? }
 *   DELETE /api/classes/school/:id    archives; 409 while active students are enrolled
 * Classes are archived rather than deleted so past report cards survive,
 * and so the template top-up in GET /school never brings them back.
 */
const requireClassEditor = (req, res, next) => {
  if (req.user?.type !== 'school') {
    return res.status(403).json({ success: false, error: 'School accounts only.' });
  }
  if (req.user?.staffRole === 'class_teacher' || req.user?.staffRole === 'subject_teacher') {
    return res.status(403).json({ success: false, error: 'Only the school owner or an admin can manage classes.' });
  }
  next();
};
const cleanClassName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);

router.post('/school', requireClassEditor, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const name = cleanClassName(req.body?.className);
    if (!name) return res.status(400).json({ success: false, error: 'Class name is required.' });
    const capacity = Math.min(Math.max(parseInt(req.body?.capacity, 10) || 50, 1), 1000);

    const existing = await pool.query(
      `SELECT id, archived_at FROM classes WHERE school_id = $1 AND LOWER(TRIM(class_name)) = LOWER($2)`,
      [schoolId, name]
    );
    if (existing.rows.length) {
      if (existing.rows[0].archived_at) { // bring an archived class back
        const back = await pool.query(
          `UPDATE classes SET archived_at = NULL, capacity = $2 WHERE id = $1 RETURNING id, class_name, capacity`,
          [existing.rows[0].id, capacity]
        );
        return res.status(200).json({ success: true, data: back.rows[0], restored: true });
      }
      return res.status(409).json({ success: false, error: `A class named "${name}" already exists.` });
    }
    const created = await insertClassResilient(pool, schoolId, name, capacity);
    if (!created) return res.status(409).json({ success: false, error: `A class named "${name}" already exists.` });
    res.status(201).json({ success: true, data: { id: created.id, class_name: created.class_name, capacity: created.capacity } });
  } catch (error) {
    console.error('❌ Create Class Error:', error);
    res.status(500).json({ success: false, error: 'Failed to create class.' });
  }
});

router.put('/school/:id', requireClassEditor, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const current = await pool.query('SELECT id, class_name, origin_name FROM classes WHERE id = $1 AND school_id = $2', [req.params.id, schoolId]);
    if (!current.rows.length) return res.status(404).json({ success: false, error: 'Class not found.' });

    const sets = []; const params = [];
    if (req.body?.className !== undefined) {
      const name = cleanClassName(req.body.className);
      if (!name) return res.status(400).json({ success: false, error: 'Class name cannot be empty.' });
      const clash = await pool.query(
        `SELECT id FROM classes WHERE school_id = $1 AND LOWER(TRIM(class_name)) = LOWER($2) AND id <> $3`,
        [schoolId, name, req.params.id]
      );
      if (clash.rows.length) return res.status(409).json({ success: false, error: `A class named "${name}" already exists.` });
      params.push(name); sets.push(`class_name = $${params.length}`);
      // Remember the template name this class came from (first rename only).
      if (!current.rows[0].origin_name && current.rows[0].class_name !== name) {
        params.push(current.rows[0].class_name); sets.push(`origin_name = $${params.length}`);
      }
    }
    if (req.body?.capacity !== undefined) {
      params.push(Math.min(Math.max(parseInt(req.body.capacity, 10) || 50, 1), 1000)); sets.push(`capacity = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update.' });
    params.push(req.params.id, schoolId);
    const result = await pool.query(
      `UPDATE classes SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND school_id = $${params.length}
       RETURNING id, class_name, capacity`,
      params
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, error: 'A class with that name already exists.' });
    console.error('❌ Update Class Error:', error);
    res.status(500).json({ success: false, error: 'Failed to update class.' });
  }
});

router.delete('/school/:id', requireClassEditor, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const active = await pool.query(
      `SELECT COUNT(*)::int AS n FROM enrollments WHERE class_id = $1 AND school_id = $2 AND status = 'active'`,
      [req.params.id, schoolId]
    );
    if (active.rows[0].n > 0) {
      return res.status(409).json({
        success: false,
        error: `${active.rows[0].n} active student(s) are enrolled in this class. Move them first.`,
        code: 'CLASS_IN_USE',
      });
    }
    const result = await pool.query(
      `UPDATE classes SET archived_at = CURRENT_TIMESTAMP WHERE id = $1 AND school_id = $2 AND archived_at IS NULL RETURNING id`,
      [req.params.id, schoolId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Class not found.' });
    res.json({ success: true, message: 'Class archived.' });
  } catch (error) {
    console.error('❌ Archive Class Error:', error);
    res.status(500).json({ success: false, error: 'Failed to archive class.' });
  }
});

module.exports = router;
