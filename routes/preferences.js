const express = require('express');
const router = express.Router();
const pool = require('../database/db'); // Adjusted to match your file structure
const authMiddleware = require('../middleware/auth');
const multer = require('multer');
const { put } = require('@vercel/blob');
 
// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Apply authentication to all routes in this file
router.use(authMiddleware.authenticateToken);

/**
 * @route   GET /api/preferences/test/blob-config
 * @desc    Diagnostic endpoint - check Blob configuration
 */
router.get('/test/blob-config', async (req, res) => {
    const hasBlobToken = !!process.env.BLOB_READ_WRITE_TOKEN;
    const tokenLength = process.env.BLOB_READ_WRITE_TOKEN?.length || 0;
    res.json({
        success: true,
        blobConfigured: hasBlobToken,
        tokenLength,
        environment: process.env.NODE_ENV,
        message: hasBlobToken ? '✅ Blob is configured' : '❌ Blob token missing'
    });
});

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
router.post('/:schoolId', upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'stamp', maxCount: 1 }
]), async (req, res) => {
    const { schoolId } = req.params;

    console.log('🔍 POST /preferences/:schoolId - Request received');
    console.log('📦 req.body:', req.body);
    console.log('📁 req.files:', req.files);

    // Security check: Verify ownership
    if (req.user.schoolId !== parseInt(schoolId)) {
        return res.status(403).json({ error: "Unauthorized access" });
    }

    // Validate schoolId is a valid number
    if (isNaN(schoolId)) {
        return res.status(400).json({ error: "Invalid school ID" });
    }

    let {
        theme_color,
        logo_url,
        stamp_url,
        header_text
    } = req.body;

    // Validate and sanitize inputs
    theme_color = theme_color || '#2196F3';
    header_text = (header_text && String(header_text).trim()) || '';

    // Handle file uploads if present
    try {
        if (req.files) {
            // Upload Logo
            if (req.files['logo'] && req.files['logo'][0]) {
                console.log('📸 Uploading logo to Vercel Blob...');
                const logoFile = req.files['logo'][0];

                // Check buffer is not empty
                if (!logoFile.buffer || logoFile.buffer.length === 0) {
                    return res.status(400).json({
                        error: "Logo file is empty. Please select a valid image file."
                    });
                }

                console.log('Logo file details:', {
                    originalname: logoFile.originalname,
                    mimetype: logoFile.mimetype,
                    size: logoFile.size,
                    bufferLength: logoFile.buffer.length,
                    bufferStart: logoFile.buffer.slice(0, 20).toString('hex')
                });

                // Validate file size (max 5MB)
                const MAX_SIZE = 5 * 1024 * 1024;
                if (logoFile.size > MAX_SIZE || logoFile.buffer.length > MAX_SIZE) {
                    return res.status(400).json({
                        error: "Logo file is too large. Maximum size is 5MB."
                    });
                }

                // Validate MIME type
                const validMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
                if (!validMimeTypes.includes(logoFile.mimetype)) {
                    return res.status(400).json({
                        error: "Invalid logo file type. Must be PNG, JPEG, or WebP."
                    });
                }

                const cleanFileName = logoFile.originalname.replace(/\s+/g, '-');
                const uniqueFileName = `school-${schoolId}-logo-${Date.now()}-${cleanFileName}`;
                console.log('🔄 Uploading to Vercel Blob with filename:', uniqueFileName);
                console.log('Buffer being sent to Blob:', logoFile.buffer.length, 'bytes');
                
                try {
                    const blob = await put(uniqueFileName, logoFile.buffer, {
                        access: 'public',
                        token: process.env.BLOB_READ_WRITE_TOKEN
                    });
                    logo_url = blob.url;
                    console.log('✅ Logo uploaded successfully to:', logo_url);
                    console.log('Logo blob object:', { url: blob.url, size: logoFile.size });
                } catch (blobErr) {
                    console.error('❌ Blob upload failed:', blobErr.message);
                    console.error('Blob error details:', {
                        message: blobErr.message,
                        code: blobErr.code,
                        status: blobErr.status
                    });
                    throw new Error(`Logo upload to blob failed: ${blobErr.message}`);
                }
            }

            // Upload Stamp
            if (req.files['stamp'] && req.files['stamp'][0]) {
                console.log('📸 Uploading stamp to Vercel Blob...');
                const stampFile = req.files['stamp'][0];

                // Validate file size (max 5MB)
                const MAX_SIZE = 5 * 1024 * 1024;
                if (stampFile.size > MAX_SIZE) {
                    return res.status(400).json({
                        error: "Stamp file is too large. Maximum size is 5MB."
                    });
                }

                console.log('Stamp file details:', {
                    originalname: stampFile.originalname,
                    mimetype: stampFile.mimetype,
                    size: stampFile.size
                });

                // Validate MIME type
                const validMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
                if (!validMimeTypes.includes(stampFile.mimetype)) {
                    return res.status(400).json({
                        error: "Invalid stamp file type. Must be PNG, JPEG, or WebP."
                    });
                }

                const cleanFileName = stampFile.originalname.replace(/\s+/g, '-');
                const uniqueFileName = `school-${schoolId}-stamp-${Date.now()}-${cleanFileName}`;
                console.log('🔄 Uploading to Vercel Blob with filename:', uniqueFileName);
                
                try {
                    const blob = await put(uniqueFileName, stampFile.buffer, {
                        access: 'public',
                        token: process.env.BLOB_READ_WRITE_TOKEN
                    });
                    stamp_url = blob.url;
                    console.log('✅ Stamp uploaded successfully to:', stamp_url);
                    console.log('Stamp blob object:', { url: blob.url, size: stampFile.size });
                } catch (blobErr) {
                    console.error('❌ Blob upload failed:', blobErr.message);
                    console.error('Blob error details:', {
                        message: blobErr.message,
                        code: blobErr.code,
                        status: blobErr.status
                    });
                    throw new Error(`Stamp upload to blob failed: ${blobErr.message}`);
                }
            }
        } else {
            console.log('ℹ️ No files detected in request');
        }

        console.log('💾 Saving to database with values:', {
            schoolId,
            theme_color,
            logo_url: logo_url || null,
            stamp_url: stamp_url || null,
            header_text
        });

        // Upsert into database: Insert if new, else update existing fields
        // CASE logic: If new value is NULL, keep old value; otherwise use new value
        const query = `
            INSERT INTO school_preferences 
                (school_id, theme_color, logo_url, stamp_url, header_text)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (school_id) 
            DO UPDATE SET 
                theme_color = CASE WHEN EXCLUDED.theme_color IS NOT NULL THEN EXCLUDED.theme_color ELSE school_preferences.theme_color END,
                logo_url = CASE WHEN EXCLUDED.logo_url IS NOT NULL THEN EXCLUDED.logo_url ELSE school_preferences.logo_url END,
                stamp_url = CASE WHEN EXCLUDED.stamp_url IS NOT NULL THEN EXCLUDED.stamp_url ELSE school_preferences.stamp_url END,
                header_text = CASE WHEN EXCLUDED.header_text IS NOT NULL THEN EXCLUDED.header_text ELSE school_preferences.header_text END,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            schoolId,
            theme_color,
            logo_url || null,
            stamp_url || null,
            header_text || null
        ];

        const result = await pool.query(query, values);

        console.log('✅ Database update successful');
        console.log('Returned row:', result.rows[0]);
        console.log('Logo URL saved:', result.rows[0]?.logo_url);
        console.log('Stamp URL saved:', result.rows[0]?.stamp_url);

        res.status(200).json({
            success: true,
            message: "Preferences updated successfully",
            data: result.rows[0],
            debug: {
                uploadedFiles: {
                    logo: !!req.files?.['logo'],
                    stamp: !!req.files?.['stamp']
                },
                savedUrls: {
                    logo_url: result.rows[0]?.logo_url || null,
                    stamp_url: result.rows[0]?.stamp_url || null
                }
            }
        });
    } catch (err) {
        console.error("❌ Error updating preferences:", err);
        console.error("Error stack:", err.stack);

        // Check for Vercel Blob token error
        if (err.message.includes('token') || err.message.includes('BLOB')) {
            return res.status(500).json({
                error: "Image upload service error. Please contact administrator.",
                details: "Vercel Blob configuration issue"
            });
        }

        res.status(500).json({
            error: "Internal server error",
            details: err.message
        });
    }
});

module.exports = router;