const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');
const axios = require('axios');

// ==========================================
// FLUTTERWAVE CONFIGURATION & VALIDATION
// ==========================================

// Validate Flutterwave configuration on startup
const validateFlutterwaveConfig = () => {
  const required = ['FLW_SECRET_KEY', 'FLW_SECRET_HASH'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing Flutterwave environment variables: ${missing.join(', ')}`);
    console.error('Please check your .env file and ensure FLW_SECRET_KEY and FLW_SECRET_HASH are set.');
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Flutterwave configuration incomplete');
    }
  } else {
    console.log('✅ Flutterwave configuration loaded successfully');
  }
};

// Call validation on module load
validateFlutterwaveConfig();

// Constants
const FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com/v3';
const FLUTTERWAVE_TIMEOUT = 10000; // 10 seconds

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Verify Flutterwave transaction with their API
 */
const verifyFlutterwaveTransaction = async (transactionId) => {
  try {
    const response = await axios.get(
      `${FLUTTERWAVE_BASE_URL}/transactions/${transactionId}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: FLUTTERWAVE_TIMEOUT
      }
    );

    return {
      success: response.data.status === 'success',
      data: response.data.data || {},
      error: null
    };
  } catch (error) {
    console.error('❌ Flutterwave verification error:', error.response?.data || error.message);
    return {
      success: false,
      data: null,
      error: error.response?.data?.message || error.message
    };
  }
};

/**
 * Calculate subscription end date based on plan duration
 */
const calculateEndDate = (startDate = new Date(), durationDays) => {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays);
  return endDate;
};

/**
 * Check if a transaction has already been processed (idempotency)
 */
const isTransactionProcessed = async (flutterwaveRef) => {
  try {
    const result = await pool.query(
      'SELECT id FROM school_subscriptions WHERE flutterwave_ref = $1',
      [flutterwaveRef]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('❌ Error checking transaction idempotency:', error.message);
    return false;
  }
};

// ==========================================
// PUBLIC ROUTES
// ==========================================

/**
 * @route   GET /api/subscriptions/plans
 * @desc    Fetch available plans for the pricing page
 */
router.get('/plans', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, price, duration_days, features FROM subscription_plans ORDER BY price ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Error fetching plans:', error.message);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

// ==========================================
// WEBHOOK (NO AUTH MIDDLEWARE HERE)
// ==========================================

/**
 * @route   POST /api/subscriptions/webhook
 * @desc    Listens for payment notifications from Flutterwave
 * @security Uses Flutterwave signature verification
 */
router.post('/webhook', async (req, res) => {
  // Verify webhook signature
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== process.env.FLW_SECRET_HASH) {
    console.warn('⚠️ Unauthorized webhook attempt with invalid signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;

  // Validate webhook payload structure
  if (!payload || !payload.event || !payload.data) {
    console.warn('⚠️ Invalid webhook payload structure');
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    // Only process successful charges
    if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
      const { id: transactionId, meta, customer } = payload.data;
      
      // Validate metadata contains required school_id
      if (!meta || !meta.school_id) {
        console.warn('⚠️ Webhook missing school_id in metadata');
        return res.status(400).json({ error: 'Missing school_id in metadata' });
      }

      const schoolId = meta.school_id;

      // Check idempotency - prevent duplicate processing
      const alreadyProcessed = await isTransactionProcessed(transactionId);
      if (alreadyProcessed) {
        console.log(`ℹ️ Transaction ${transactionId} already processed, skipping`);
        return res.status(200).json({ message: 'Already processed' });
      }

      // Get the plan to know the duration
      const planResult = await pool.query(
        'SELECT duration_days FROM subscription_plans WHERE id = $1',
        [meta.plan_id]
      );

      if (planResult.rows.length === 0) {
        console.error(`❌ Plan not found: ${meta.plan_id}`);
        return res.status(400).json({ error: 'Plan not found' });
      }

      const planDurationDays = planResult.rows[0].duration_days;
      const startDate = new Date();
      const endDate = calculateEndDate(startDate, planDurationDays);

      // Update or insert subscription with transaction integrity
      const query = `
        INSERT INTO school_subscriptions 
          (school_id, plan_id, status, start_date, end_date, auto_renew, flutterwave_ref, created_at, updated_at)
        VALUES ($1, $2, 'active', $3, $4, true, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (school_id) 
        DO UPDATE SET 
          plan_id = EXCLUDED.plan_id,
          status = 'active',
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          flutterwave_ref = EXCLUDED.flutterwave_ref,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `;

      await pool.query(query, [schoolId, meta.plan_id, startDate, endDate, transactionId]);
      
      console.log(`✅ Subscription activated for school ${schoolId} via transaction ${transactionId}`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Webhook processing error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ==========================================
// PROTECTED ROUTES (Requires Authentication)
// ==========================================
router.use(authMiddleware.authenticateToken);

/**
 * @route   POST /api/subscriptions/verify
 * @desc    Verify transaction immediately after frontend checkout
 * @auth    Required (Authentication token)
 */
router.post('/verify', async (req, res) => {
  const { transaction_id, plan_id } = req.body;
  const schoolId = req.user.schoolId;

  // Validate inputs
  if (!transaction_id || transaction_id.trim() === '') {
    return res.status(400).json({ success: false, message: 'Transaction ID is required' });
  }

  if (!plan_id || isNaN(plan_id)) {
    return res.status(400).json({ success: false, message: 'Valid Plan ID is required' });
  }

  try {
    // 1. Verify plan exists and get duration
    const planResult = await pool.query(
      'SELECT id, duration_days FROM subscription_plans WHERE id = $1',
      [plan_id]
    );

    if (planResult.rows.length === 0) {
      console.warn(`⚠️ Plan ${plan_id} not found for school ${schoolId}`);
      return res.status(400).json({ success: false, message: 'Selected plan not found' });
    }

    const { duration_days } = planResult.rows[0];

    // 2. Verify with Flutterwave API
    const verifyResult = await verifyFlutterwaveTransaction(transaction_id);

    if (!verifyResult.success) {
      console.warn(`⚠️ Payment verification failed for school ${schoolId}: ${verifyResult.error}`);
      return res.status(400).json({ 
        success: false, 
        message: verifyResult.error || 'Payment verification failed. Please try again.'
      });
    }

    const flwData = verifyResult.data;

    // 3. Additional verification - ensure transaction status
    if (flwData.status !== 'successful') {
      console.warn(`⚠️ Transaction status is not successful: ${flwData.status}`);
      return res.status(400).json({ 
        success: false, 
        message: `Transaction status: ${flwData.status}. Please contact support.`
      });
    }

    // 4. Check idempotency
    const alreadyProcessed = await isTransactionProcessed(transaction_id);
    if (alreadyProcessed) {
      console.log(`ℹ️ Transaction ${transaction_id} already processed`);
      return res.status(200).json({ 
        success: true, 
        message: 'Subscription already updated for this transaction',
        isRetry: true 
      });
    }

    // 5. Calculate subscription period
    const startDate = new Date();
    const endDate = calculateEndDate(startDate, duration_days);

    // 6. Update/Insert subscription in database
    const query = `
      INSERT INTO school_subscriptions 
        (school_id, plan_id, status, start_date, end_date, auto_renew, flutterwave_ref, created_at, updated_at)
      VALUES ($1, $2, 'active', $3, $4, true, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (school_id) 
      DO UPDATE SET 
        plan_id = EXCLUDED.plan_id,
        status = 'active',
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        flutterwave_ref = EXCLUDED.flutterwave_ref,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(query, [schoolId, plan_id, startDate, endDate, transaction_id]);

    console.log(`✅ Subscription activated via transaction: School ${schoolId} - Plan ${plan_id}`);

    res.json({
      success: true,
      message: 'Subscription activated successfully',
      subscription: {
        id: result.rows[0].id,
        schoolId: result.rows[0].school_id,
        planId: result.rows[0].plan_id,
        status: result.rows[0].status,
        startDate: result.rows[0].start_date,
        endDate: result.rows[0].end_date,
        autoRenew: result.rows[0].auto_renew
      }
    });

  } catch (error) {
    console.error('❌ Verification error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error during verification. Please contact support.' 
    });
  }
});

/**
 * @route   GET /api/subscriptions/status
 * @desc    Check current subscription status
 * @auth    Required (Authentication token)
 */
router.get('/status', async (req, res) => {
  const schoolId = req.user.schoolId;

  try {
    const result = await pool.query(
      `SELECT ss.*, sp.name as plan_name, sp.price, sp.duration_days
       FROM school_subscriptions ss
       JOIN subscription_plans sp ON ss.plan_id = sp.id
       WHERE ss.school_id = $1
       ORDER BY ss.updated_at DESC
       LIMIT 1`,
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        success: true,
        status: 'inactive', 
        message: 'No active subscription',
        plan: null,
        expiresAt: null
      });
    }

    const sub = result.rows[0];
    const now = new Date();
    const endDate = new Date(sub.end_date);
    const isExpired = endDate < now;
    const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

    res.json({
      success: true,
      status: isExpired ? 'expired' : 'active',
      plan: {
        name: sub.plan_name,
        price: sub.price,
        duration: sub.duration_days
      },
      subscriptionDetails: {
        startDate: sub.start_date,
        endDate: sub.end_date,
        daysRemaining: Math.max(0, daysRemaining),
        autoRenew: sub.auto_renew
      }
    });

  } catch (error) {
    console.error('❌ Error fetching subscription status:', error.message);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch subscription status'
    });
  }
});

/**
 * @route   POST /api/subscriptions/cancel
 * @desc    Cancel subscription (set auto_renew to false)
 * @auth    Required (Authentication token)
 */
router.post('/cancel', async (req, res) => {
  const schoolId = req.user.schoolId;

  try {
    const result = await pool.query(
      `UPDATE school_subscriptions 
       SET auto_renew = false, updated_at = CURRENT_TIMESTAMP
       WHERE school_id = $1 AND status = 'active'
       RETURNING *;`,
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No active subscription found to cancel' 
      });
    }

    console.log(`✅ Subscription cancelled for school ${schoolId}`);

    res.json({
      success: true,
      message: 'Subscription cancelled. It will not auto-renew at the end date.',
      subscription: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error cancelling subscription:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to cancel subscription' 
    });
  }
});

module.exports = router;