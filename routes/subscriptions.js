const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');

// Get subscription plans (public)
router.get('/plans', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subscription_plans ORDER BY price');
    res.json({ plans: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.use(authMiddleware.authenticateToken);

// Create subscription plan (admin only)
router.post('/plans', async (req, res) => {
  try {
    const { name, description, price, durationDays, features } = req.body;

    if (!name || !price || !durationDays) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      'INSERT INTO subscription_plans (name, description, price, duration_days, features) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description || null, price, durationDays, features || null]
    );

    res.status(201).json({
      message: 'Subscription plan created',
      plan: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Subscribe school to a plan
router.post('/:schoolId/subscribe', authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    // STRICT SECURITY: Extract schoolId ONLY from token, not from URL params
    const tokenSchoolId = req.user?.schoolId;
    const { schoolId } = req.params;
    const { planId } = req.body;

    // Verify that the schoolId in the token matches the URL param (defense in depth)
    if (tokenSchoolId !== parseInt(schoolId)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Unauthorized: School ID mismatch' 
      });
    }

    if (!planId) {
      return res.status(400).json({ error: 'Plan ID is required' });
    }

    const planResult = await pool.query(
      'SELECT * FROM subscription_plans WHERE id = $1',
      [planId]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = planResult.rows[0];
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.duration_days);

    await pool.query(
      'UPDATE school_subscriptions SET status = $1 WHERE school_id = $2 AND status = $3',
      ['inactive', schoolId, 'active']
    );

    const result = await pool.query(
      'INSERT INTO school_subscriptions (school_id, plan_id, status, start_date, end_date, auto_renew) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [schoolId, planId, 'active', startDate, endDate, true]
    );

    res.status(201).json({
      message: 'Subscription created successfully',
      subscription: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get school subscription
router.get('/:schoolId/current', authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    // STRICT SECURITY: Extract schoolId ONLY from token, not from URL params
    const tokenSchoolId = req.user?.schoolId;
    const { schoolId } = req.params;

    // Verify that the schoolId in the token matches the URL param (defense in depth)
    if (tokenSchoolId !== parseInt(schoolId)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Unauthorized: School ID mismatch' 
      });
    }

    const result = await pool.query(
      `SELECT ss.*, sp.name, sp.features FROM school_subscriptions ss
       LEFT JOIN subscription_plans sp ON ss.plan_id = sp.id
       WHERE ss.school_id = $1 AND ss.status = $2
       ORDER BY ss.created_at DESC
       LIMIT 1`,
      [schoolId, 'active']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active subscription' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel subscription
router.put('/:schoolId/:subscriptionId/cancel', authMiddleware.checkSchoolOwnership, async (req, res) => {
  try {
    // STRICT SECURITY: Extract schoolId ONLY from token, not from URL params
    const tokenSchoolId = req.user?.schoolId;
    const { schoolId, subscriptionId } = req.params;

    // Verify that the schoolId in the token matches the URL param (defense in depth)
    if (tokenSchoolId !== parseInt(schoolId)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Unauthorized: School ID mismatch' 
      });
    }

    const result = await pool.query(
      'UPDATE school_subscriptions SET status = $1 WHERE id = $2 AND school_id = $3 RETURNING *',
      ['cancelled', subscriptionId, schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    res.json({
      message: 'Subscription cancelled',
      subscription: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
