const express = require('express');
const router = express.Router();
const pool = require('../database/db');
require('dotenv').config();

const ADMIN_SECRET = process.env.ADMIN_NOTIFICATION_SECRET;

// ─── Simple admin key check (same pattern as adminNotifications.js) ───────
function adminAuth(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

const VALID_PAYMENT_STATUSES = ['pending', 'completed', 'grace_period', 'expired'];

router.use(adminAuth);

/**
 * @route   POST /api/admin/login
 * @desc    Validate the admin secret entered on the login screen
 * @header  x-admin-secret
 */
router.post('/login', (req, res) => {
    // If we got past adminAuth middleware, the secret is valid
    res.json({ success: true, message: 'Logged in' });
});

/**
 * @route   GET /api/admin/stats
 * @desc    Dashboard overview numbers
 */
router.get('/stats', async (req, res) => {
    try {
        const [schoolsCount, paidCount, expiredCount, pendingCount, studentsCount, devicesCount] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS count FROM schools'),
            pool.query("SELECT COUNT(*)::int AS count FROM schools WHERE payment_status IN ('completed','grace_period')"),
            pool.query("SELECT COUNT(*)::int AS count FROM schools WHERE payment_status = 'expired'"),
            pool.query("SELECT COUNT(*)::int AS count FROM schools WHERE payment_status = 'pending'"),
            pool.query('SELECT COUNT(*)::int AS count FROM students'),
            pool.query('SELECT COUNT(*)::int AS count FROM device_tokens'),
        ]);

        res.json({
            success: true,
            data: {
                totalSchools: schoolsCount.rows[0].count,
                paidSchools: paidCount.rows[0].count,
                expiredSchools: expiredCount.rows[0].count,
                pendingSchools: pendingCount.rows[0].count,
                totalStudents: studentsCount.rows[0].count,
                registeredDevices: devicesCount.rows[0].count,
            }
        });
    } catch (err) {
        console.error('❌ Admin stats error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
    }
});

/**
 * @route   GET /api/admin/schools
 * @desc    List all schools (the "users" of the platform) with search/filter/pagination
 * @query   search, status, page, limit
 */
router.get('/schools', async (req, res) => {
    try {
        const { search = '', status = '', page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
        const offset = (pageNum - 1) * limitNum;

        const conditions = [];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`);
        }

        if (status && VALID_PAYMENT_STATUSES.includes(status)) {
            params.push(status);
            conditions.push(`payment_status = $${params.length}`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS count FROM schools ${whereClause}`,
            params
        );

        params.push(limitNum);
        params.push(offset);

        const result = await pool.query(
            `SELECT id, name, email, phone, school_type, country, payment_status,
                    subscription_expiry, created_at, updated_at
             FROM schools
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: countResult.rows[0].count,
                totalPages: Math.ceil(countResult.rows[0].count / limitNum)
            }
        });
    } catch (err) {
        console.error('❌ Admin list schools error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch schools' });
    }
});

/**
 * @route   GET /api/admin/schools/:id
 * @desc    Get full detail for one school, including its students count
 */
router.get('/schools/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const schoolResult = await pool.query('SELECT * FROM schools WHERE id = $1', [id]);

        if (schoolResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'School not found' });
        }

        const studentsResult = await pool.query(
            'SELECT COUNT(*)::int AS count FROM students WHERE school_id = $1',
            [id]
        );

        res.json({
            success: true,
            data: {
                ...schoolResult.rows[0],
                password: undefined,
                studentsCount: studentsResult.rows[0].count
            }
        });
    } catch (err) {
        console.error('❌ Admin get school error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch school' });
    }
});

/**
 * @route   PATCH /api/admin/schools/:id/payment-status
 * @desc    Manually mark a school as paid / unpaid (pending) / expired / grace_period
 * @body    { status: 'completed' | 'pending' | 'expired' | 'grace_period', expiryDate?: ISODateString }
 */
router.patch('/schools/:id/payment-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, expiryDate } = req.body;

        if (!status || !VALID_PAYMENT_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `status must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}`
            });
        }

        const schoolCheck = await pool.query('SELECT id, name FROM schools WHERE id = $1', [id]);
        if (schoolCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'School not found' });
        }

        let result;
        if (status === 'completed' || status === 'grace_period') {
            // Default to 30 days from now if no expiry supplied, when making paid
            const newExpiry = expiryDate
                ? new Date(expiryDate)
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

            result = await pool.query(
                `UPDATE schools SET payment_status = $1, subscription_expiry = $2, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3 RETURNING id, name, email, payment_status, subscription_expiry`,
                [status, newExpiry, id]
            );
        } else if (status === 'expired') {
            result = await pool.query(
                `UPDATE schools SET payment_status = 'expired', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 RETURNING id, name, email, payment_status, subscription_expiry`,
                [id]
            );
        } else {
            // pending / unpaid — clear expiry too
            result = await pool.query(
                `UPDATE schools SET payment_status = 'pending', subscription_expiry = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 RETURNING id, name, email, payment_status, subscription_expiry`,
                [id]
            );
        }

        console.log(`🛠️ Admin set school ${id} (${schoolCheck.rows[0].name}) payment_status -> ${status}`);

        res.json({
            success: true,
            message: `School marked as ${status}`,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('❌ Admin update payment status error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to update payment status' });
    }
});

/**
 * @route   DELETE /api/admin/schools/:id
 * @desc    Permanently delete a school account (admin override)
 */
router.delete('/schools/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM schools WHERE id = $1 RETURNING id, name', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'School not found' });
        }

        console.log(`🗑️ Admin deleted school ${id} (${result.rows[0].name})`);
        res.json({ success: true, message: 'School deleted' });
    } catch (err) {
        console.error('❌ Admin delete school error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to delete school. It may have related records (students, classes, etc).' });
    }
});

/**
 * @route   GET /api/admin/students
 * @desc    List all students across all schools, with search/filter/pagination
 * @query   search, schoolId, page, limit
 */
router.get('/students', async (req, res) => {
    try {
        const { search = '', schoolId = '', page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
        const offset = (pageNum - 1) * limitNum;

        const conditions = [];
        const params = [];

        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.email ILIKE $${params.length})`);
        }

        if (schoolId) {
            params.push(schoolId);
            conditions.push(`s.school_id = $${params.length}`);
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS count FROM students s ${whereClause}`,
            params
        );

        params.push(limitNum);
        params.push(offset);

        const result = await pool.query(
            `SELECT s.id, s.first_name, s.last_name, s.email, s.school_id, sc.name AS school_name,
                    s.created_at
             FROM students s
             LEFT JOIN schools sc ON sc.id = s.school_id
             ${whereClause}
             ORDER BY s.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: countResult.rows[0].count,
                totalPages: Math.ceil(countResult.rows[0].count / limitNum)
            }
        });
    } catch (err) {
        console.error('❌ Admin list students error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch students' });
    }
});

module.exports = router;