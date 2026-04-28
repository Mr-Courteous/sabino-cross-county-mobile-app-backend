const pool = require('../database/db');

const checkSubscription = async (req, res, next) => {
  try {
    // Both school and student tokens now carry schoolId for consistency
    const schoolId = req.user?.schoolId || req.user?.id;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please login to continue.'
      });
    }

    const result = await pool.query(
      'SELECT payment_status, subscription_expiry FROM schools WHERE id = $1',
      [schoolId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'School account not found.' });
    }

    const { payment_status, subscription_expiry } = result.rows[0];
    const now = new Date();

    // Step 1: Must be a paid status (completed OR grace_period)
    const paidStatuses = ['completed', 'grace_period'];
    if (!paidStatuses.includes(payment_status)) {
      return res.status(402).json({
        success: false,
        error: 'Subscription required.',
        message: 'Please subscribe via the Sabino app to access this feature.',
        paymentStatus: payment_status
      });
    }

    // Step 2: Null expiry is a data problem — never trust it
    if (!subscription_expiry) {
      console.warn(`🚨 [checkSubscription] Missing expiry for school ${schoolId}`);
      return res.status(402).json({
        success: false,
        error: 'Subscription data incomplete.',
        message: 'Open the app and tap "Restore Purchases" to fix this.',
        paymentStatus: payment_status
      });
    }

    // Step 3: Check if actually expired
    const expiryDate = new Date(subscription_expiry);
    if (expiryDate <= now) {
      // Auto-correct status in DB in case EXPIRATION webhook was delayed
      await pool.query(
        `UPDATE schools SET payment_status = 'expired', updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1 AND payment_status != 'expired'`,
        [schoolId]
      );
      return res.status(402).json({
        success: false,
        error: 'Subscription expired.',
        message: 'Your subscription has expired. Please renew via the Sabino app.',
        paymentStatus: 'expired'
      });
    }

    // All good — attach subscription info so route handlers can use it
    const daysRemaining = Math.ceil((expiryDate - now) / 86400000);
    req.subscription = {
      status: payment_status,
      expiresAt: expiryDate.toISOString(),
      daysRemaining,
      expiringSoon: daysRemaining <= 7   // frontend can show a renewal banner
    };

    return next();

  } catch (error) {
    console.error('[checkSubscription] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Unable to verify subscription status. Please try again.'
    });
  }
};

module.exports = checkSubscription;