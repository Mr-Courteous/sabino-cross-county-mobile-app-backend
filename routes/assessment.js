const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');
const checkSubscription = require('../middleware/checkSubscription');
const { auditRoute } = require('../middleware/auditLog');
const assessment = require('../utils/assessment');

/**
 * Mount in your server entry file:
 *   app.use('/api/assessment', require('./routes/assessment'));
 *
 * A school's result template + grading scale.
 *   GET    /api/assessment/config        current config (default if never customised)
 *   PUT    /api/assessment/config        save a custom template / grading scale
 *   POST   /api/assessment/config/reset  go back to the built-in layout
 *   POST   /api/assessment/apply         re-stamp EXISTING records with the current template
 *
 * Saving a template never changes existing report cards: every score
 * record keeps the template it was saved under until it is edited, or
 * until the school explicitly calls /apply.
 */
router.use(authMiddleware.authenticateToken);
router.use(authMiddleware.requireSchool);

// Class-scoped teachers can read the template (they need it to enter
// scores) but not change it. Owner and full admins can.
const requireConfigEditor = (req, res, next) => {
  if (req.user?.staffRole === 'class_teacher' || req.user?.staffRole === 'subject_teacher') {
    return res.status(403).json({
      success: false,
      error: 'Only the school owner or an admin can change the result template.',
      code: 'CONFIG_EDIT_FORBIDDEN',
    });
  }
  next();
};

const publicConfig = (cfg) => ({
  isCustom: cfg.isCustom,
  version: cfg.version,
  components: cfg.components,
  grading_bands: cfg.grading_bands,
  total_max: cfg.total_max,
});

const defaults = () => {
  const d = assessment.defaultConfig();
  return { components: d.components, grading_bands: d.grading_bands, total_max: d.total_max };
};

router.get('/config', async (req, res) => {
  try {
    const cfg = await assessment.getSchoolConfig(pool, req.user.schoolId);
    res.json({
      success: true,
      data: publicConfig(cfg),
      defaults: defaults(),
      computedSources: assessment.COMPUTED_LABELS,
    });
  } catch (error) {
    console.error('❌ [assessment] get config:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load result template.' });
  }
});

router.put('/config', requireConfigEditor, checkSubscription,
  auditRoute('assessment.config_updated', (req, body) => ({ type: 'assessment_config', id: null, details: { version: body?.data?.version } })),
  async (req, res) => {
    try {
      const check = assessment.validateConfig(req.body);
      if (!check.ok) {
        return res.status(400).json({ success: false, error: check.errors[0], errors: check.errors });
      }
      const { components, grading_bands } = check.config;

      const r = await pool.query(
        `INSERT INTO assessment_configs (school_id, components, grading_bands, version, updated_by)
         VALUES ($1, $2::jsonb, $3::jsonb, 1, $4)
         ON CONFLICT (school_id) DO UPDATE SET
           components = EXCLUDED.components,
           grading_bands = EXCLUDED.grading_bands,
           version = assessment_configs.version + 1,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP
         RETURNING components, grading_bands, version`,
        [req.user.schoolId, JSON.stringify(components), JSON.stringify(grading_bands), req.user.id || req.user.staffId || null]
      );
      const row = r.rows[0];
      res.json({
        success: true,
        message: 'Result template saved. Existing report cards are unchanged until they are edited or you apply the new template to them.',
        data: publicConfig({
          isCustom: true,
          version: row.version,
          components: row.components,
          grading_bands: row.grading_bands,
          total_max: assessment.totalMaxOf(row.components),
        }),
      });
    } catch (error) {
      console.error('❌ [assessment] save config:', error.message);
      res.status(500).json({ success: false, error: 'Failed to save result template.' });
    }
  });

router.post('/config/reset', requireConfigEditor, checkSubscription,
  auditRoute('assessment.config_reset', () => ({ type: 'assessment_config', id: null })),
  async (req, res) => {
    try {
      await pool.query('DELETE FROM assessment_configs WHERE school_id = $1', [req.user.schoolId]);
      res.json({
        success: true,
        message: 'Back to the standard layout. Existing report cards are unchanged.',
        data: publicConfig(assessment.defaultConfig()),
      });
    } catch (error) {
      console.error('❌ [assessment] reset config:', error.message);
      res.status(500).json({ success: false, error: 'Failed to reset result template.' });
    }
  });

/**
 * Re-stamp existing records with the CURRENT template.
 * body: { confirm: true, classId?, sessionId?, term? }  (scope it to a
 * class/session/term wherever possible)
 */
router.post('/apply', requireConfigEditor, checkSubscription,
  auditRoute('assessment.config_applied', (req, body) => ({ type: 'assessment_config', id: null, details: { updated: body?.updated, scope: req.body } })),
  async (req, res) => {
    try {
      const { confirm, classId, sessionId, term } = req.body || {};
      if (confirm !== true) {
        return res.status(400).json({
          success: false,
          error: 'Send confirm: true. This rewrites how existing report cards are laid out and graded.',
        });
      }
      if (term !== undefined && ![1, 2, 3].includes(Number(term))) {
        return res.status(400).json({ success: false, error: 'term must be 1, 2 or 3' });
      }
      const cfg = await assessment.getSchoolConfig(pool, req.user.schoolId);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await assessment.applyConfigToExisting(client, req.user.schoolId, cfg, {
          classId: classId ? Number(classId) : undefined,
          sessionId: sessionId ? Number(sessionId) : undefined,
          term: term ? Number(term) : undefined,
        });
        await client.query('COMMIT');
        res.json({ success: true, updated, message: `${updated} score record(s) now follow the current template.` });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ [assessment] apply config:', error.message);
      res.status(500).json({ success: false, error: 'Failed to apply result template.' });
    }
  });

module.exports = router;
