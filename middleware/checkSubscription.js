const pool = require('../database/db');

/**
 * Middleware to enforce that a school has an active (completed) subscription.
 * Returns 402 Payment Required when payment is missing or expired.
 */
const checkSubscription = async (req, res, next) => {
  try {
    const schoolId = req.user?.id;

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
      return res.status(404).json({
        success: false,
        error: 'School account not found.'
      });
    }

    const { payment_status, subscription_expiry } = result.rows[0];

    if (payment_status !== 'completed') {
      return res.status(402).json({
        success: false,
        error: 'Payment required. Please complete your subscription to access this resource.'
      });
    }

    if (subscription_expiry) {
      const expiryDate = new Date(subscription_expiry);
      if (expiryDate <= new Date()) {
        // Mark as expired for future requests
        await pool.query('UPDATE schools SET payment_status = $1 WHERE id = $2', ['expired', schoolId]);

        return res.status(402).json({
          success: false,
          error: 'Subscription has expired. Please renew to continue using the service.'
        });
      }
    }

    next();
  } catch (error) {
    console.error('Subscription middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Unable to verify subscription status. Please try again later.'
    });
  }
};

module.exports = checkSubscription;
