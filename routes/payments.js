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
  const required = ['FLW_SECRET_KEY', 'FLW_SECRET_HASH', 'FLW_PUBLIC_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing Flutterwave environment variables: ${missing.join(', ')}`);
    console.error('Payment processing will be unavailable until these are configured.');
  } else {
    console.log('✅ Flutterwave payment gateway configured and ready');
  }
};

validateFlutterwaveConfig();

// Constants
const FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com/v3';
const FLUTTERWAVE_TIMEOUT = 15000; // 15 seconds for better reliability
const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Verify transaction directly with Flutterwave
 */
const verifyFlutterwaveTransaction = async (transactionId) => {
  try {
    console.log(`🔍 Verifying transaction ${transactionId} with Flutterwave...`);
    
    const response = await axios.get(
      `${FLUTTERWAVE_BASE_URL}/transactions/${transactionId}/verify`,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: FLUTTERWAVE_TIMEOUT,
      }
    );

    if (response.data.status === 'success') {
      console.log(`✅ Transaction ${transactionId} verified successfully`);
      return { success: true, data: response.data.data };
    }
    
    console.warn(`⚠️ Transaction ${transactionId} verification returned non-success status`);
    return { success: false, error: response.data.message || 'Unknown error' };
  } catch (err) {
    console.error(`❌ Flutterwave verification error for ${transactionId}:`, err.response?.data || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
};

/**
 * Find transaction ID by tx_ref (for hosted payment redirect)
 */
const findTransactionByTxRef = async (tx_ref) => {
  try {
    console.log(`🔍 Looking up transaction by tx_ref: ${tx_ref}`);
    
    const response = await axios.get(
      `${FLUTTERWAVE_BASE_URL}/transactions/search`,
      {
        params: { tx_ref },
        headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
        timeout: FLUTTERWAVE_TIMEOUT,
      }
    );

    const data = response.data.data || response.data;
    
    if (Array.isArray(data) && data.length > 0) {
      const txId = data[0].id || data[0].transaction_id;
      console.log(`✅ Found transaction ID: ${txId} for tx_ref: ${tx_ref}`);
      return txId;
    }
    
    if (data && data.id) {
      console.log(`✅ Found transaction ID: ${data.id}`);
      return data.id;
    }
    
    console.warn(`⚠️ No transaction found for tx_ref: ${tx_ref}`);
    return null;
  } catch (err) {
    console.error(`❌ Error searching transaction by tx_ref:`, err.response?.data || err.message);
    return null;
  }
};

/**
 * Calculate subscription end date based on plan duration
 */
const calculateEndDate = (startDate = new Date(), durationDays = 30) => {
  const end = new Date(startDate);
  end.setDate(end.getDate() + Number(durationDays));
  return end;
};

/**
 * Check if school is registered and active
 */
const validateSchoolForPayment = async (schoolId) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, is_active FROM schools WHERE id = $1`,
      [schoolId]
    );
    
    if (result.rows.length === 0) {
      return { valid: false, error: 'School not found in system' };
    }
    
    const school = result.rows[0];
    
    if (!school.is_active) {
      return { valid: false, error: 'School account is inactive. Contact administrator.' };
    }
    
    console.log(`✅ School ${schoolId} (${school.name}) validated for payment`);
    return { valid: true, school };
  } catch (err) {
    console.error('❌ School validation error:', err.message);
    return { valid: false, error: 'Could not validate school status' };
  }
};

/**
 * Check if transaction already processed (idempotency)
 */
const isTransactionProcessed = async (flutterwaveRef) => {
  try {
    const result = await pool.query(
      `SELECT id FROM school_subscriptions WHERE flutterwave_ref = $1 LIMIT 1`,
      [flutterwaveRef]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error('❌ Idempotency check error:', err.message);
    return false;
  }
};

/**
 * Save payment transaction to database for audit trail
 */
const savePaymentTransaction = async (schoolId, planId, status, flwData, txRef) => {
  try {
    const query = `
      INSERT INTO payment_transactions 
        (school_id, plan_id, flutterwave_ref, tx_ref, status, amount, currency, flw_response, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (flutterwave_ref) DO UPDATE SET 
        status = EXCLUDED.status,
        flw_response = EXCLUDED.flw_response,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(query, [
      schoolId,
      planId,
      flwData?.id || flwData?.transaction_id,
      txRef,
      status,
      flwData?.amount,
      flwData?.currency,
      JSON.stringify(flwData || {})
    ]);

    console.log(`✅ Payment transaction saved: ${result.rows[0].id}`);
    return result.rows[0];
  } catch (err) {
    console.error('❌ Error saving payment transaction:', err.message);
    // Don't fail if we can't save audit log - subscription should still activate
    return null;
  }
};

// Require authentication for all payment endpoints
router.use(authMiddleware.authenticateToken);

/**
 * @route   GET /api/payments/status
 * @desc    Check if school can process premium payments
 * @auth    Required
 */
router.get('/status', async (req, res) => {
  const schoolId = req.user?.schoolId;

  if (!schoolId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const validation = await validateSchoolForPayment(schoolId);
    
    if (!validation.valid) {
      return res.status(403).json({ success: false, message: validation.error });
    }

    res.json({
      success: true,
      message: 'School is eligible for premium transactions',
      school: {
        id: validation.school.id,
        name: validation.school.name,
        email: validation.school.email
      },
      paymentGateway: 'flutterwave',
      publicKey: process.env.FLW_PUBLIC_KEY
    });
  } catch (err) {
    console.error('❌ Payment status check error:', err.message);
    res.status(500).json({ success: false, message: 'Could not verify payment eligibility' });
  }
});

/**
 * @route POST /api/payments/initiate
 * @desc  Create Flutterwave payment link for selected plan
 * @auth  Required
 * @body  { plan_id: number }
 */
router.post('/initiate', async (req, res) => {
  const { plan_id } = req.body;
  const schoolId = req.user?.schoolId;

  // Validate input
  if (!plan_id || isNaN(plan_id)) {
    return res.status(400).json({ success: false, message: 'Valid plan_id is required' });
  }

  if (!schoolId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    // Step 1: Validate school is registered and active
    const validation = await validateSchoolForPayment(schoolId);
    if (!validation.valid) {
      return res.status(403).json({ success: false, message: validation.error });
    }

    // Step 2: Fetch plan details
    const planResult = await pool.query(
      `SELECT id, name, price, duration_days, description FROM subscription_plans WHERE id = $1`,
      [plan_id]
    );

    if (planResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Selected plan not found' });
    }

    const plan = planResult.rows[0];
    const amount = Number(plan.price);

    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid plan price' });
    }

    // Step 3: Generate unique transaction reference
    const tx_ref = `school_${schoolId}_plan_${plan_id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Step 4: Build redirect URL
    const redirectBase = process.env.PAYMENT_REDIRECT_BASE || process.env.APP_URL || 'http://localhost:19006';
    const redirect_url = `${redirectBase}/payments/verify?tx_ref=${encodeURIComponent(tx_ref)}&plan_id=${plan_id}`;

    console.log(`💳 Initiating payment: School ${schoolId}, Plan ${plan.name} (₦${amount})`);

    // Step 5: Create payment link via Flutterwave
    const payload = {
      tx_ref,
      amount: amount.toString(),
      currency: process.env.DEFAULT_CURRENCY || 'NGN',
      redirect_url,
      customer: {
        email: validation.school.email || `school_${schoolId}@sabino-academy.local`,
        name: validation.school.name,
      },
      meta: { 
        school_id: schoolId, 
        plan_id,
        plan_name: plan.name,
        duration_days: plan.duration_days
      },
      title: `Sabino Academy - ${plan.name} Subscription`,
      description: `${plan.duration_days}-day access to premium features`,
    };

    const flwRes = await axios.post(
      `${FLUTTERWAVE_BASE_URL}/payme`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: FLUTTERWAVE_TIMEOUT,
      }
    );

    if (!flwRes.data.data || !flwRes.data.data.link) {
      console.error('❌ Flutterwave did not return a payment link:', flwRes.data);
      return res.status(500).json({ success: false, message: 'Failed to generate payment link from Flutterwave' });
    }

    const paymentLink = flwRes.data.data.link;

    // Save initial transaction record
    await savePaymentTransaction(schoolId, plan_id, PAYMENT_STATUS.PENDING, null, tx_ref);

    console.log(`✅ Payment link generated for tx_ref: ${tx_ref}`);

    res.json({
      success: true,
      message: 'Payment link created successfully',
      data: {
        link: paymentLink,
        tx_ref,
        amount,
        currency: payload.currency,
        plan: {
          id: plan.id,
          name: plan.name,
          duration_days: plan.duration_days
        }
      }
    });

  } catch (err) {
    console.error('❌ Payment initiation error:', err.response?.data || err.message);
    const errorMsg = err.response?.data?.message || 'Failed to create payment link. Please try again.';
    res.status(500).json({ success: false, message: errorMsg });
  }
});

/**
 * @route POST /api/payments/verify
 * @desc  Verify payment and activate subscription
 * @auth  Required
 * @body  { transaction_id?: string, tx_ref?: string, plan_id?: number }
 */
router.post('/verify', async (req, res) => {
  const { transaction_id, tx_ref, plan_id } = req.body;
  const schoolId = req.user?.schoolId;

  if (!schoolId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  if (!transaction_id && !tx_ref) {
    return res.status(400).json({ success: false, message: 'transaction_id or tx_ref is required' });
  }

  try {
    // Step 1: Validate school
    const validation = await validateSchoolForPayment(schoolId);
    if (!validation.valid) {
      return res.status(403).json({ success: false, message: validation.error });
    }

    // Step 2: Resolve transaction ID if only tx_ref provided
    let txId = transaction_id;
    if (!txId && tx_ref) {
      console.log(`🔍 Looking up transaction for tx_ref: ${tx_ref}`);
      txId = await findTransactionByTxRef(tx_ref);
      
      if (!txId) {
        return res.status(404).json({ 
          success: false, 
          message: 'Transaction not found. Please check your transaction reference and try again.' 
        });
      }
    }

    // Step 3: Verify with Flutterwave
    const verifyResult = await verifyFlutterwaveTransaction(txId);
    
    if (!verifyResult.success) {
      await savePaymentTransaction(schoolId, plan_id, PAYMENT_STATUS.FAILED, null, tx_ref);
      return res.status(400).json({ 
        success: false, 
        message: `Payment verification failed: ${verifyResult.error}` 
      });
    }

    const flwData = verifyResult.data;

    // Step 4: Check transaction status
    if (flwData.status !== 'successful') {
      await savePaymentTransaction(schoolId, plan_id, PAYMENT_STATUS.FAILED, flwData, tx_ref);
      return res.status(400).json({ 
        success: false, 
        message: `Payment not successful. Status: ${flwData.status}` 
      });
    }

    // Step 5: Get Flutterwave reference
    const flutterwaveRef = flwData.id || flwData.transaction_id || txId;

    // Step 6: Idempotency check
    const alreadyProcessed = await isTransactionProcessed(flutterwaveRef);
    if (alreadyProcessed) {
      console.log(`⚠️ Transaction ${flutterwaveRef} already processed (idempotent)`);
      return res.status(200).json({ 
        success: true, 
        message: 'Subscription already activated for this transaction' 
      });
    }

    // Step 7: Determine plan ID
    let planIdToUse = plan_id;
    if (!planIdToUse && flwData.meta?.plan_id) {
      planIdToUse = flwData.meta.plan_id;
    }

    if (!planIdToUse) {
      return res.status(400).json({ 
        success: false, 
        message: 'Plan ID missing. Please provide plan_id in request or ensure it was included in payment metadata.' 
      });
    }

    // Step 8: Fetch plan duration
    const planResult = await pool.query(
      `SELECT id, duration_days, name FROM subscription_plans WHERE id = $1`,
      [planIdToUse]
    );

    if (planResult.rows.length === 0) {
      await savePaymentTransaction(schoolId, planIdToUse, PAYMENT_STATUS.FAILED, flwData, tx_ref);
      return res.status(400).json({ success: false, message: 'Plan not found in system' });
    }

    const plan = planResult.rows[0];
    const durationDays = plan.duration_days || 30;

    // Step 9: Calculate subscription dates
    const startDate = new Date();
    const endDate = calculateEndDate(startDate, durationDays);

    // Step 10: Activate subscription
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

    const subResult = await pool.query(query, [schoolId, planIdToUse, startDate, endDate, flutterwaveRef]);

    // Step 11: Save successful transaction
    await savePaymentTransaction(schoolId, planIdToUse, PAYMENT_STATUS.COMPLETED, flwData, tx_ref);

    console.log(`✅ Subscription activated: School ${schoolId}, Plan ${plan.name} (${durationDays} days)`);

    res.json({
      success: true,
      message: 'Payment verified and subscription activated successfully',
      data: {
        subscription: {
          id: subResult.rows[0].id,
          schoolId: subResult.rows[0].school_id,
          planId: subResult.rows[0].plan_id,
          status: subResult.rows[0].status,
          startDate: subResult.rows[0].start_date,
          endDate: subResult.rows[0].end_date,
          daysActive: durationDays
        },
        transaction: {
          id: flutterwaveRef,
          amount: flwData.amount,
          currency: flwData.currency,
          status: 'successful'
        }
      }
    });

  } catch (err) {
    console.error('❌ Payment verification error:', err.response?.data || err.message);
    res.status(500).json({ 
      success: false, 
      message: 'Internal error during payment verification. Your payment is being processed. Please contact support if you do not receive confirmation within 24 hours.' 
    });
  }
});

module.exports = router;
