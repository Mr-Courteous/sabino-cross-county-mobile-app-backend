const express = require('express');
const router = express.Router();
const pool = require('../database/db'); // Adjusted to match your file structure
const authMiddleware = require('../middleware/auth');

// Apply authentication to all routes in this file
router.use(authMiddleware.authenticateToken);

/**
 * @route   GET /api/preferences/:schoolId
 * @desc    Fetch existing school preferences for the frontend form
 */
router.get('/:schoolId', async (req, res) => {
    try {
        const { schoolId } = req.params;

        // Security check: Ensure the school can only see their own preferences
        if (req.user.schoolId !== parseInt(schoolId)) {
            return res.status(403).json({ error: "Unauthorized access" });
        }

        const result = await pool.query(
            'SELECT * FROM school_preferences WHERE school_id = $1',
            [schoolId]
        );

        if (result.rows.length === 0) {
            // Return defaults if no preferences have been set yet
            return res.status(200).json({
                success: true,
                data: {
                    school_id: schoolId,
                    theme_color: '#2196F3',
                    logo_url: null,
                    stamp_url: null,
                    report_footer_text: '',
                    show_attendance: false
                }
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("Error fetching preferences:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   POST /api/preferences/:schoolId
 * @desc    Update or Create (Upsert) school preferences
 */
router.post('/:schoolId', async (req, res) => {
    const { schoolId } = req.params;
    
    // Security check: Verify ownership
    if (req.user.schoolId !== parseInt(schoolId)) {
        return res.status(403).json({ error: "Unauthorized access" });
    }

    const { 
        theme_color, 
        logo_url, 
        stamp_url, 
        header_text // Renamed from report_footer_text
    } = req.body;

    try {
        // Now using 5 columns and 5 values ($1 to $5)
        const query = `
            INSERT INTO school_preferences 
                (school_id, theme_color, logo_url, stamp_url, header_text)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (school_id) 
            DO UPDATE SET 
                theme_color = EXCLUDED.theme_color,
                logo_url = EXCLUDED.logo_url,
                stamp_url = EXCLUDED.stamp_url,
                header_text = EXCLUDED.header_text,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            schoolId, 
            theme_color || '#2196F3', 
            logo_url, 
            stamp_url, 
            header_text
        ];

        const result = await pool.query(query, values);

        res.status(200).json({
            success: true,
            message: "Preferences updated successfully",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("Error updating preferences:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;