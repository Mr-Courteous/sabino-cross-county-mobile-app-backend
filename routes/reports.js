const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const authMiddleware = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const OpenAI = require("openai"); // Assuming you use OpenAI for the AI report
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');

// Reuse existing transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'inumiduncourteous@gmail.com',
    pass: 'vvcx njbg cwac kuao', // Note: This should ideally be in .env for production
  },
});

// Use Groq for cost-free, high-speed AI remarks
const openai = new OpenAI({ 
  apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

// Helper function to safely load image from various sources (file path, base64, or URL)
async function tryLoadImage(doc, imageSource, x, y, width, height, imageType = '') {
  if (!imageSource || typeof imageSource !== 'string' || !imageSource.trim()) {
    console.log(`[${imageType}] No image source provided`);
    return false;
  }

  const trimmedSource = imageSource.trim();
  console.log(`[${imageType}] Attempting to load image: ${trimmedSource.substring(0, 100)}...`);

  try {
    // Check if it's a base64 encoded image
    if (trimmedSource.startsWith('data:image/')) {
      console.log(`[${imageType}] Loading base64 image`);
      const base64Data = trimmedSource.split(',')[1];
      if (base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        doc.image(buffer, x, y, { width, height });
        console.log(`[${imageType}] Base64 image loaded successfully`);
        return true;
      }
    }

    // Check if it's a URL (http/https)
    if (trimmedSource.startsWith('http://') || trimmedSource.startsWith('https://')) {
      try {
        console.log(`[${imageType}] Downloading image from URL: ${trimmedSource}`);
        const response = await axios.get(trimmedSource, {
          responseType: 'arraybuffer',
          timeout: 5000 // 5 second timeout
        });

        const buffer = Buffer.from(response.data, 'binary');
        doc.image(buffer, x, y, { width, height });
        console.log(`[${imageType}] URL image downloaded and loaded successfully`);
        return true;
      } catch (urlErr) {
        console.error(`[${imageType}] Failed to download image from URL:`, urlErr.message);
      }
    } else {
      // It's a file path
      const filePath = path.resolve(trimmedSource);
      if (fs.existsSync(filePath)) {
        console.log(`[${imageType}] Loading from file path: ${filePath}`);
        doc.image(filePath, x, y, { width, height });
        console.log(`[${imageType}] File image loaded successfully`);
        return true;
      } else {
        console.warn(`[${imageType}] File does not exist: ${filePath}`);
      }
    }
  } catch (err) {
    console.error(`[${imageType}] Error loading image:`, err.message);
  }

  console.log(`[${imageType}] Image not available`);
  return false;
}

// All report routes require a valid token
router.use(authMiddleware.authenticateToken);

// Helper function to calculate letter grade from numeric score
function calculateGrade(score) {
  const numScore = parseFloat(score);
  if (numScore >= 90) return 'A';
  if (numScore >= 80) return 'B';
  if (numScore >= 70) return 'C';
  if (numScore >= 60) return 'D';
  return 'F';
}




router.post('/email/official-report/:enrollmentId', async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { term, sessionId, email } = req.body;
    const schoolId = req.user?.schoolId;

    // Convert parameters to integers
    const termInt = parseInt(term, 10);
    const sessionIdInt = parseInt(sessionId, 10);

    if (!termInt || !sessionIdInt || isNaN(termInt) || isNaN(sessionIdInt)) {
      return res.status(400).json({ success: false, error: "Term and Session ID must be valid numbers" });
    }

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: "Valid email address is required" });
    }

    console.log(`Emailing report for enrollment: ${enrollmentId}, term: ${termInt}, session: ${sessionIdInt}, school: ${schoolId}, email: ${email}`);

    // 1. FETCH EVERYTHING
    // Includes CA1-4, exam score, and session name
    const dataQuery = `
      SELECT Tap to change photo

        s.first_name, 
        s.last_name, 
        s.photo as photo_url,
        sch.name as school_name,
        pref.logo_url, 
        pref.stamp_url, 
        pref.theme_color, 
        pref.header_text,
        c.display_name as class_name,
        COALESCE(sub.subject_name, 'Unknown Subject') as subject_name,
        COALESCE(sc.ca1_score, 0) as ca1_score,
        COALESCE(sc.ca2_score, 0) as ca2_score,
        COALESCE(sc.ca3_score, 0) as ca3_score,
        COALESCE(sc.ca4_score, 0) as ca4_score,
        COALESCE(sc.exam_score, 0) as exam_score,
        COALESCE(sc.total_score, 0) as total_score,
        COALESCE(sc.teacher_remark, '') as teacher_remark,
        COALESCE(ay.session_name, '') as session_name
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN schools sch ON s.school_id = sch.id
      LEFT JOIN school_preferences pref ON pref.school_id = sch.id
      LEFT JOIN global_class_templates c ON e.class_id = c.id
      LEFT JOIN scores sc ON sc.enrollment_id = e.id
        AND sc.term = $3 
        AND sc.session_id = $4
      LEFT JOIN global_subjects sub ON sc.subject_id = sub.id
      LEFT JOIN academic_years ay ON sc.session_id = ay.id
      WHERE e.id = $1 
        AND e.school_id = $2
        AND sc.id IS NOT NULL
      ORDER BY sub.subject_name ASC
    `;

    // STRICT SECURITY: For student users, verify they own this enrollment
    if (req.user?.type === 'student' && req.user?.studentId) {
      const ownershipCheck = await pool.query(
        'SELECT id FROM enrollments WHERE id = $1 AND student_id = $2 AND school_id = $3',
        [enrollmentId, req.user.studentId, schoolId]
      );

      if (ownershipCheck.rows.length === 0) {
        console.error(`🚨 Security Alert: Student ${req.user.studentId} attempted to access unauthorized enrollment ${enrollmentId}`);
        return res.status(403).json({
          success: false,
          error: "Unauthorized: You can only access your own academic reports."
        });
      }
    }

    const result = await pool.query(dataQuery, [enrollmentId, schoolId, termInt, sessionIdInt]);

    console.log(`Query returned ${result.rows.length} rows`);

    // DEBUGGING: If this returns 0, it means one of the JOINs (like classes or subjects) failed to find a match
    if (result.rows.length === 0) {
      console.log(`No data found. Checking why...`);

      // Debug: Check if enrollment exists
      const enrollmentCheck = await pool.query(
        `SELECT e.id, e.student_id, e.class_id, e.school_id, e.session_id, s.first_name FROM enrollments e 
         JOIN students s ON e.student_id = s.id WHERE e.id = $1 AND e.school_id = $2`,
        [enrollmentId, schoolId]
      );
      console.log(`Enrollment check:`, enrollmentCheck.rows);

      // Debug: Check if scores exist for this term
      const scoresCheck = await pool.query(
        `SELECT COUNT(*) as count FROM scores WHERE enrollment_id = $1 AND term = $2 AND session_id = $3`,
        [enrollmentId, termInt, sessionIdInt]
      );
      console.log(`Scores check (term=${termInt}, session=${sessionIdInt}):`, scoresCheck.rows);

      return res.status(404).json({
        success: false,
        error: "No report data found. Verify that the Enrollment ID belongs to this School and has scores for this specific Term/Session."
      });
    }

    const data = result.rows;
    const pref = data[0];

    // Log what we got from the database
    console.log('\n=== Data Retrieved from Database ===');
    console.log('First row photo_url:', pref.photo_url);
    console.log('First row logo_url:', pref.logo_url);
    console.log('First row stamp_url:', pref.stamp_url);
    console.log('Total rows returned:', data.length);
    console.log('====================================\n');

    // 2. RETRIEVE OR GENERATE UNIQUE AI REMARK
    let aiRemark = "The student continues to show steady progress in their academic pursuits.";
    
    try {
      // Check if a remark already exists for this enrollment + term + session
      const existingRemark = await pool.query(
        `SELECT ai_remark FROM report_remarks 
         WHERE enrollment_id = $1 AND term = $2 AND session_id = $3`,
        [enrollmentId, termInt, sessionIdInt]
      );

      if (existingRemark.rows.length > 0) {
        // Reuse the stored remark for consistency
        aiRemark = existingRemark.rows[0].ai_remark;
        console.log(`ℹ Reusing stored AI remark for Enrollment ${enrollmentId}`);
      } else {
        // Generate new remark with AI (Groq/Llama-3.3)
        console.log(`🤖 Generating new AI remark for Enrollment ${enrollmentId}...`);
        
        // Contextual analysis for AI
        const validScores = data.filter(r => r.total_score > 0);
        const sorted = [...validScores].sort((a, b) => b.total_score - a.total_score);
        const topSubject = sorted.length > 0 ? sorted[0].subject_name : "their studies";
        const strugglingSubject = sorted.length > 1 ? sorted[sorted.length - 1].subject_name : "other areas";
        const performanceSummary = data.map(r => `${r.subject_name}: ${r.total_score}/100`).join(", ");

        const aiCompletion = await openai.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [{
            role: "system",
            content: `You are an expert school principal. Write a unique, VERY concise formal report card remark.
            STRICT RULES:
            - MAX LENGTH: 100 characters total.
            - NEVER use generic phrases like "Good job".
            - Include student name (${pref.first_name}).
            - Mention excellence in ${topSubject} and a target for ${strugglingSubject}.
            - Tone: Sophisticated, professional, but extremely brief.`
          }, {
            role: "user",
            content: `Performance Data: ${performanceSummary}`
          }]
        });

        aiRemark = aiCompletion.choices[0].message.content;

        // Store it for future use (Persistence)
        await pool.query(
          `INSERT INTO report_remarks (enrollment_id, term, session_id, ai_remark)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (enrollment_id, term, session_id) DO UPDATE SET ai_remark = EXCLUDED.ai_remark`,
          [enrollmentId, termInt, sessionIdInt, aiRemark]
        );
        console.log(`✓ New AI remark saved to database.`);
      }
    } catch (err) {
      console.error("AI Remark/Cache Error:", err.message);
      // Fallback remains the default aiRemark initialized above
    }

    // 3. BUILD THE PDF
    // Use autoFirstPage: false to prevent automatic blank pages, add pages manually only when needed
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4' });
    
    // Add first page explicitly
    doc.addPage();
    
    const buffers = [];

    // Collect PDF data in buffer instead of piping to response
    doc.on('data', (chunk) => {
      buffers.push(chunk);
    });

    doc.on('end', async () => {
      try {
        const pdfBuffer = Buffer.concat(buffers);

        // Generate filename
        const studentName = `${pref.first_name} ${pref.last_name}`.replace(/[^a-zA-Z0-9\s]/g, '').trim();
        const className = pref.class_name || 'Class';
        const sessionName = pref.session_name || `Session ${sessionIdInt}`;
        const filename = `${studentName}_${className}_Term${termInt}_${sessionName}.pdf`.replace(/\s+/g, '_');

        // Send email with PDF attachment
        const mailOptions = {
          from: '"School Management System" <inumiduncourteous@gmail.com>',
          to: email,
          subject: `Official Report Card - ${studentName}`,
          html: `
            <div style="font-family: sans-serif; text-align: center; border: 1px solid #ddd; padding: 20px;">
              <h2 style="color: #333;">Official Report Card</h2>
              <p>Your report card for ${studentName} has been generated and attached to this email.</p>
              <p><strong>Student:</strong> ${studentName}</p>
              <p><strong>Class:</strong> ${className}</p>
              <p><strong>Term:</strong> ${termInt}</p>
              <p><strong>Session:</strong> ${sessionName}</p>
              <p style="color: #888; font-size: 12px;">This is an automated email from the School Management System.</p>
            </div>
          `,
          attachments: [{
            filename: filename,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }]
        };

        await transporter.sendMail(mailOptions);

        console.log(`✓ Report emailed successfully to ${email}`);
        res.json({
          success: true,
          message: `Report card has been sent to ${email}`,
          filename: filename
        });

      } catch (emailError) {
        console.error("Email sending failed:", emailError);
        res.status(500).json({
          success: false,
          error: "PDF generated successfully but email sending failed",
          details: emailError.message
        });
      }
    });

    // STRICT VARIABLE ASSIGNMENT - Extract and validate theme color
    console.log('\n=== DEBUG: Database Values ===');
    console.log('DEBUG: Value from DB row pref.theme_color:', pref.theme_color);
    console.log('DEBUG: Type of pref.theme_color:', typeof pref.theme_color);
    console.log('DEBUG: Is pref.theme_color truthy?:', !!pref.theme_color);
    if (pref.theme_color) {
      console.log('DEBUG: After trim():', pref.theme_color.trim());
      console.log('DEBUG: After trim() length:', pref.theme_color.trim().length);
    }

    // Only use fallback if theme_color is null, undefined, or empty after trim
    let themeColor;
    if (pref.theme_color && typeof pref.theme_color === 'string' && pref.theme_color.trim().length > 0) {
      themeColor = pref.theme_color.trim();
      console.log('DEBUG: Using theme color from database:', themeColor);
    } else {
      themeColor = '#2196F3';
      console.log('DEBUG: Using fallback theme color:', themeColor);
    }

    console.log('\n=== Applied Theme Color ===');
    console.log('FINAL Applied theme color:', themeColor);
    console.log('================================\n');

    // Handle errors from PDF generation
    doc.on('error', (err) => {
      console.error("PDF Generation Error:", err);
      doc.destroy();
      res.status(500).json({ success: false, error: err.message });
    });

    // ═══════════════════════════════════════════════════════════════
    // NEW REPORT CARD DESIGN - Clean & Modern
    // ═══════════════════════════════════════════════════════════════
    const schoolName = pref.school_name || "School Name";
    const headerText = (pref.header_text && pref.header_text.trim()) ? pref.header_text : "";

    // Clean white header with colored bottom border
    doc.fillColor('#ffffff').rect(0, 0, 595, 60).fill();
    doc.fillColor(themeColor).rect(0, 55, 595, 5).fill();
    
    // School name on left
    doc.fontSize(22).fillColor('#1a1a1a').font('Helvetica-Bold').text(schoolName, 50, 18);
    doc.fontSize(9).fillColor('#666').font('Helvetica').text(headerText, 50, 42);
    
    // Logo on right
    doc.fillColor('#f5f5f5').rect(500, 8, 50, 44).fill();
    doc.strokeColor('#ddd').lineWidth(1).rect(500, 8, 50, 44).stroke();
    await tryLoadImage(doc, pref.logo_url, 503, 12, 44, 36, 'LOGO');
    
    doc.fillColor('#000000');

    // ═══════════════════════════════════════════════════════════════
    // STUDENT INFO - New Clean Design
    // ═══════════════════════════════════════════════════════════════
    const firstName = pref.first_name || "N/A";
    const lastName = pref.last_name || "N/A";
    const className = pref.class_name || "N/A";
    const sessionName = (pref.session_name && pref.session_name.trim()) ? pref.session_name : `Session ${sessionIdInt}`;
    const admissionNo = pref.admission_number || "N/A";
    
    const infoY = 75;
    
    // Student photo box
    doc.fillColor('#f0f0f0').rect(50, infoY, 55, 55).fill();
    doc.strokeColor(themeColor).lineWidth(2).rect(50, infoY, 55, 55).stroke();
    await tryLoadImage(doc, pref.photo_url, 53, infoY + 3, 49, 49, 'STUDENT_PHOTO');
    
    // Student details
    doc.fontSize(15).fillColor('#1a1a1a').font('Helvetica-Bold').text(`${firstName} ${lastName}`, 115, infoY + 5);
    doc.fontSize(10).fillColor('#555').font('Helvetica').text(`Class: ${className}`, 115, infoY + 25);
    doc.fontSize(10).fillColor('#555').font('Helvetica').text(`Term: ${termInt}  |  ${sessionName}`, 115, infoY + 40);
    doc.fontSize(9).fillColor(themeColor).font('Helvetica-Bold').text(`Adm No: ${admissionNo}`, 115, infoY + 54);
    
    // Reset
    doc.fillColor('#000000');

    // Deduplicate data by subject to prevent duplicate entries
    const uniqueSubjects = {};
    data.forEach(row => {
      const subjectKey = row.subject_name;
      if (!uniqueSubjects[subjectKey]) {
        uniqueSubjects[subjectKey] = row;
      }
    });
    const deduplicatedData = Object.values(uniqueSubjects);

    // ═══════════════════════════════════════════════════════════════
    // SCORES TABLE - New Clean Design
    // ═══════════════════════════════════════════════════════════════
    let tableY = 150;
    const leftX = 50;
    const tableW = 500;
    
    // Header
    doc.fillColor(themeColor).rect(leftX, tableY, tableW, 20).fill();
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
    doc.text('SUBJECT', leftX + 10, tableY + 5, { width: 200 });
    doc.text('C.A.', leftX + 220, tableY + 5, { width: 60, align: 'center' });
    doc.text('EXAM', leftX + 310, tableY + 5, { width: 60, align: 'center' });
    doc.text('TOTAL', leftX + 410, tableY + 5, { width: 80, align: 'center' });
    
    tableY += 20;
    
    // Sort for position
    const sorted = [...deduplicatedData].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    
    // Rows
    doc.fontSize(10);
    deduplicatedData.forEach((row, i) => {
      // Background
      doc.fillColor(i % 2 === 0 ? '#fff' : '#f5f5f5').rect(leftX, tableY, tableW, 18).fill();
      
      const ca = Math.round(
        Number(row.ca1_score || 0) + 
        Number(row.ca2_score || 0) + 
        Number(row.ca3_score || 0) + 
        Number(row.ca4_score || 0)
      );
      const exam = Math.round(Number(row.exam_score || 0));
      const total = ca + exam;
      
      // Text
      doc.fillColor('#222').font('Helvetica').text(row.subject_name || '-', leftX + 10, tableY + 4, { width: 200 });
      doc.text(String(ca), leftX + 220, tableY + 4, { width: 60, align: 'center' });
      doc.text(String(exam), leftX + 310, tableY + 4, { width: 60, align: 'center' });
      doc.font('Helvetica-Bold').text(String(total), leftX + 410, tableY + 4, { width: 80, align: 'center' });
      
      // Line
      doc.strokeColor('#ddd').lineWidth(0.5).moveTo(leftX, tableY + 18).lineTo(leftX + tableW, tableY + 18).stroke();
      
      doc.fillColor('#000').font('Helvetica');
      tableY += 18;
    });
    
    // Border
    doc.strokeColor(themeColor).lineWidth(1).rect(leftX, 150, tableW, tableY - 150).stroke();
    
    doc.fillColor('#000');

    // ═══════════════════════════════════════════════════════════════
    // PRINCIPAL'S COMMENT - New Clean Design
    // ═══════════════════════════════════════════════════════════════
    const remarkY = tableY + 15;
    const remarkText = (aiRemark && aiRemark.trim()) ? aiRemark : "Keep up the good work.";
    
    // Comment box
    doc.fillColor('#f9f9f9').rect(50, remarkY, 500, 50).fill();
    doc.strokeColor(themeColor).lineWidth(1).rect(50, remarkY, 500, 50).stroke();
    
    // Label
    doc.fontSize(10).fillColor(themeColor).font('Helvetica-Bold').text("Principal's Comment", 60, remarkY + 5);
    
    // Comment text
    doc.fontSize(9).fillColor('#444').font('Helvetica').text(remarkText, 60, remarkY + 20, { width: 420 });
    
    // Stamp
    await tryLoadImage(doc, pref.stamp_url, 510, remarkY + 5, 35, 35, 'STAMP');

    // ═══════════════════════════════════════════════════════════════
    // FOOTER - New Clean Design
    // ═══════════════════════════════════════════════════════════════
    const footerY = tableY + 70;
    
    // Divider
    doc.strokeColor(themeColor).lineWidth(2).moveTo(50, footerY).lineTo(550, footerY).stroke();
    
    // Footer text
    doc.fontSize(8).fillColor('#888').text(`Generated: ${new Date().toLocaleDateString()}`, 50, footerY + 8, { align: 'center', width: 500 });
    doc.fontSize(7).fillColor('#aaa').text('School Management System', 50, footerY + 20, { align: 'center', width: 500 });

    // Finalize PDF
    doc.end();

  } catch (error) {
    console.error("PDF Generation Error:", error);
    if (!res.writableEnded) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});
/**
 * 1. SEARCH STUDENTS
 * Uses schoolId from token to filter students.
 * Used for picking a single student to generate a report.
 */
router.get('/search/students', async (req, res) => {
  try {
    const { name } = req.query;
    // STRICT SECURITY: Extract schoolId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search name is required'
      });
    }

    // Get students with their enrollments
    const studentQuery = `
      SELECT DISTINCT 
        e.id as enrollment_id, 
        s.id as student_id,
        s.first_name, 
        s.last_name, 
        g.display_name as class_name,
        e.session_id
      FROM students s
      JOIN enrollments e ON e.student_id = s.id
      JOIN global_class_templates g ON e.class_id = g.id
      WHERE s.school_id = $1 
        AND (s.first_name ILIKE $2 OR s.last_name ILIKE $2)
        AND e.status = 'active'
      ORDER BY s.last_name ASC, s.first_name ASC
      LIMIT 15;
    `;
    const studentResult = await pool.query(studentQuery, [schoolId, `%${name}%`]);

    // For each student, fetch their scores grouped by term
    const studentsWithScores = await Promise.all(
      studentResult.rows.map(async (student) => {
        const scoresQuery = `
          SELECT 
            s.term,
            s.subject_id,
            sub.subject_name,
            s.ca1_score,
            s.ca2_score,
            s.ca3_score,
            s.ca4_score,
            s.exam_score,
            s.total_score,
            s.teacher_remark
          FROM scores s
          LEFT JOIN global_subjects sub ON s.subject_id = sub.id
          WHERE s.enrollment_id = $1
            AND s.session_id = $2
            AND s.school_id = $3
          ORDER BY s.term ASC, sub.subject_name ASC
        `;

        const scoresResult = await pool.query(scoresQuery, [
          student.enrollment_id,
          student.session_id,
          schoolId
        ]);

        // Group scores by term
        const scoresByTerm = {};
        scoresResult.rows.forEach(score => {
          if (!scoresByTerm[score.term]) {
            scoresByTerm[score.term] = [];
          }
          scoresByTerm[score.term].push({
            subject_id: score.subject_id,
            subject_name: score.subject_name,
            ca1_score: score.ca1_score,
            ca2_score: score.ca2_score,
            ca3_score: score.ca3_score,
            ca4_score: score.ca4_score,
            exam_score: score.exam_score,
            total_score: score.total_score,
            teacher_remark: score.teacher_remark
          });
        });

        return {
          ...student,
          scores_by_term: scoresByTerm
        };
      })
    );

    console.log(`✓ Found ${studentsWithScores.length} student(s) with scores grouped by term`);

    res.json({
      success: true,
      data: studentsWithScores,
      count: studentsWithScores.length
    });
  } catch (error) {
    console.error('❌ Student Search Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to search students. Please try again.'
    });
  }
});

/**
 * 2. GET CLASS LIST
 * Uses countryId from token to show allowed class templates.
 * Retrieves all available classes for the user's country.
 */
router.get('/list/classes', async (req, res) => {
  try {
    // STRICT SECURITY: Extract countryId ONLY from token, never from req.body or req.query
    const countryId = req.user?.countryId;

    if (!countryId) {
      return res.status(401).json({
        success: false,
        error: 'Country context missing. Please login again.'
      });
    }

    // Get available class templates for this country from global_class_templates
    const query = `
      SELECT id, display_name 
      FROM global_class_templates
      WHERE country_id = $1
      ORDER BY display_name ASC;
    `;
    const result = await pool.query(query, [countryId]);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('❌ Class List Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 3. GENERATE SINGLE STUDENT REPORT
 * Includes class average for each subject using window functions
 * for comparative analysis across the class
 */
router.get('/data/student/:enrollmentId', async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { term, sessionId } = req.query;
    // STRICT SECURITY: Extract schoolId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    if (!enrollmentId || !term || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'enrollmentId, term, and sessionId are required'
      });
    }

    // STRICT SECURITY: For student users, verify they own this enrollment
    if (req.user?.type === 'student' && req.user?.studentId) {
      const ownershipCheck = await pool.query(
        'SELECT id FROM enrollments WHERE id = $1 AND student_id = $2 AND school_id = $3',
        [enrollmentId, req.user.studentId, schoolId]
      );

      if (ownershipCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: "Unauthorized: You can only access your own academic records."
        });
      }
    }

    const query = `
      SELECT 
        g.subject_name as subject_name,
        COALESCE(s.ca1_score, 0) as ca1_score,
        COALESCE(s.ca2_score, 0) as ca2_score,
        COALESCE(s.ca3_score, 0) as ca3_score,
        COALESCE(s.ca4_score, 0) as ca4_score,
        COALESCE(s.exam_score, 0) as exam_score,
        ROUND(COALESCE(s.ca1_score, 0) + COALESCE(s.ca2_score, 0) + COALESCE(s.ca3_score, 0) + 
         COALESCE(s.ca4_score, 0) + COALESCE(s.exam_score, 0)) as student_total,
        ROUND(AVG(COALESCE(s2.ca1_score, 0) + COALESCE(s2.ca2_score, 0) + COALESCE(s2.ca3_score, 0) + 
                  COALESCE(s2.ca4_score, 0) + COALESCE(s2.exam_score, 0))::NUMERIC, 0) as class_average
      FROM scores s
      JOIN global_subjects g ON s.subject_id = g.id
      JOIN enrollments e ON s.enrollment_id = e.id
      JOIN enrollments e2 ON e2.class_id = e.class_id AND e2.session_id = e.session_id
      LEFT JOIN scores s2 ON s2.enrollment_id = e2.id 
                          AND s2.subject_id = s.subject_id 
                          AND s2.term = s.term 
                          AND s2.session_id = s.session_id
      WHERE s.enrollment_id = $1 
        AND e.school_id = $2 
        AND s.term = $3 
        AND s.session_id = $4
      GROUP BY g.subject_name, s.ca1_score, s.ca2_score, s.ca3_score, s.ca4_score, s.exam_score, s.subject_id
      ORDER BY g.subject_name;
    `;

    const result = await pool.query(query, [enrollmentId, schoolId, term, sessionId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No scores found for this student in the specified term and session'
      });
    }

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Student Report Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 4. GENERATE CLASS-WIDE REPORTS
 * Includes student ranking by total scores using RANK() window function
 * Adds subject-level averages for class comparison
 */
router.get('/data/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const { term, sessionId } = req.query;
    // STRICT SECURITY: Extract schoolId ONLY from token, never from req.body or req.query
    const schoolId = req.user?.schoolId;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication context missing. Please login again.'
      });
    }

    if (!classId || !term || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'classId, term, and sessionId are required'
      });
    }

    const query = `
      WITH StudentTotals AS (
        SELECT 
          e.id as enrollment_id,
          st.id as student_id,
          st.first_name,
          st.last_name,
          SUM(
            COALESCE(s.ca1_score, 0) + 
            COALESCE(s.ca2_score, 0) + 
            COALESCE(s.ca3_score, 0) + 
            COALESCE(s.ca4_score, 0) + 
            COALESCE(s.exam_score, 0)
          ) as aggregate_total
        FROM enrollments e
        JOIN students st ON e.student_id = st.id
        LEFT JOIN scores s ON s.enrollment_id = e.id 
                           AND s.term = $3 
                           AND s.session_id = $4
                           AND s.school_id = $2
        WHERE e.class_id = $1 
          AND e.school_id = $2 
          AND e.session_id = $4
        GROUP BY e.id, st.id
      ),
      RankedStudents AS (
        SELECT 
          *
        FROM StudentTotals
      )
      SELECT 
        r.*,
        g.subject_name,
        COALESCE(s.ca1_score, 0) as ca1_score,
        COALESCE(s.ca2_score, 0) as ca2_score,
        COALESCE(s.ca3_score, 0) as ca3_score,
        COALESCE(s.ca4_score, 0) as ca4_score,
        COALESCE(s.exam_score, 0) as exam_score,
        ROUND(
          COALESCE(s.ca1_score, 0) + 
          COALESCE(s.ca2_score, 0) + 
          COALESCE(s.ca3_score, 0) + 
          COALESCE(s.ca4_score, 0) + 
          COALESCE(s.exam_score, 0)
        ) as subject_total,
        ROUND(AVG(
          COALESCE(s2.ca1_score, 0) + 
          COALESCE(s2.ca2_score, 0) + 
          COALESCE(s2.ca3_score, 0) + 
          COALESCE(s2.ca4_score, 0) + 
          COALESCE(s2.exam_score, 0)
        ) OVER (PARTITION BY s.subject_id), 2) as subject_class_average
      FROM RankedStudents r
      LEFT JOIN scores s ON s.enrollment_id = r.enrollment_id 
                         AND s.term = $3 
                         AND s.session_id = $4
                         AND s.school_id = $2
      LEFT JOIN global_subjects g ON s.subject_id = g.id
      LEFT JOIN scores s2 ON s2.subject_id = s.subject_id 
                          AND s2.term = $3 
                          AND s2.session_id = $4
                          AND s2.school_id = $2
      ORDER BY r.aggregate_total DESC, g.subject_name ASC;
    `;

    const result = await pool.query(query, [classId, schoolId, term, sessionId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No students or scores found for this class in the specified term and session'
      });
    }

    // Group rows into student objects with nested subjects array
    const grouped = result.rows.reduce((acc, row) => {
      // Find or create student object
      let student = acc.find(s => s.enrollment_id === row.enrollment_id);

      if (!student) {
        student = {
          enrollment_id: row.enrollment_id,
          name: `${row.first_name} ${row.last_name}`,
          subjects: [],
          grand_total: Math.round(row.aggregate_total || 0)
        };
        acc.push(student);
      }

      // Add subject if it exists
      if (row.subject_name && !student.subjects.some(subj => subj.subject === row.subject_name)) {
        student.subjects.push({
          subject: row.subject_name,
          subject_name: row.subject_name,
          ca1_score: row.ca1_score,
          ca2_score: row.ca2_score,
          ca3_score: row.ca3_score,
          ca4_score: row.ca4_score,
          exam_score: row.exam_score,
          subject_total: row.subject_total,
          total_score: row.subject_total,
          subject_class_average: row.subject_class_average
        });
      }

      return acc;
    }, []);

    res.json({
      success: true,
      data: grouped,
      count: grouped.length,
      message: `Retrieved data for ${grouped.length} student(s) in class`
    });
  } catch (error) {
    console.error('❌ Class Report Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================================
// REMARK REGENERATION (Admin Only)
// =====================================================================

/**
 * @route   POST /api/reports/regenerate-remark/:enrollmentId
 * @desc    Admin-only: Delete cached AI remark and immediately generate a fresh one
 * @access  Private (School Admin — type: 'school')
 * @body    { term: number, sessionId: number }
 */
router.post('/regenerate-remark/:enrollmentId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { term, sessionId } = req.body;

    if (!term || !sessionId) {
      return res.status(400).json({ success: false, error: 'Both term and sessionId are required.' });
    }

    if (req.user.type !== 'school') {
      return res.status(403).json({ success: false, error: 'Unauthorized. Only school administrators can regenerate remarks.' });
    }

    const termInt = parseInt(term);
    const sessionIdInt = parseInt(sessionId);
    const schoolId = req.user.schoolId;

    // 1. Fetch student + scores data
    const result = await pool.query(`
      SELECT 
        s.first_name, s.last_name,
        sub.subject_name,
        COALESCE(sc.ca1_score, 0) + COALESCE(sc.ca2_score, 0) + 
        COALESCE(sc.ca3_score, 0) + COALESCE(sc.ca4_score, 0) + 
        COALESCE(sc.exam_score, 0) AS total_score
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN scores sc ON sc.enrollment_id = e.id AND sc.term = $3 AND sc.session_id = $4
      JOIN global_subjects sub ON sc.subject_id = sub.id
      WHERE e.id = $1 AND e.school_id = $2
      ORDER BY sub.subject_name ASC
    `, [enrollmentId, schoolId, termInt, sessionIdInt]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No score data found for this enrollment, term, and session.' });
    }

    const pref = result.rows[0];
    const data = result.rows;

    // 2. Generate fresh AI remark
    const validScores = data.filter(r => r.total_score > 0);
    const sorted = [...validScores].sort((a, b) => b.total_score - a.total_score);
    const topSubject = sorted.length > 0 ? sorted[0].subject_name : 'their studies';
    const strugglingSubject = sorted.length > 1 ? sorted[sorted.length - 1].subject_name : 'other areas';
    const performanceSummary = data.map(r => `${r.subject_name}: ${r.total_score}/100`).join(', ');

    const aiCompletion = await openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'system',
        content: `You are an expert school principal. Write a VERY concise formal report card remark.
        STRICT RULES:
        - MAX LENGTH: 100 characters total.
        - NEVER use generic phrases like "Good job".
        - Include student name (${pref.first_name}).
        - Mention excellence in ${topSubject} and a target for ${strugglingSubject}.
        - Tone: Sophisticated, professional, but extremely brief.`
      }, {
        role: 'user',
        content: `Performance Data: ${performanceSummary}`
      }]
    });

    const newRemark = aiCompletion.choices[0].message.content;

    // 3. Delete old remark (if any) and save new one
    await pool.query(
      `INSERT INTO report_remarks (enrollment_id, term, session_id, ai_remark)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (enrollment_id, term, session_id) DO UPDATE SET ai_remark = EXCLUDED.ai_remark`,
      [enrollmentId, termInt, sessionIdInt, newRemark]
    );

    console.log(`✅ Remark regenerated for Enrollment ${enrollmentId}, Term ${termInt}, Session ${sessionIdInt}`);

    res.json({
      success: true,
      message: 'Report remark has been successfully regenerated.',
      remark: newRemark
    });

  } catch (error) {
    console.error('❌ Remark Regeneration Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   DELETE /api/reports/remark/:enrollmentId
 * @desc    Admin-only: Clear cached AI remark to force fresh regeneration
 *          on the next report card email/download request.
 * @access  Private (School Admin only — type: 'school')
 * @body    { term: number, sessionId: number }
 */
router.delete('/remark/:enrollmentId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { term, sessionId } = req.body;

    // Validate required params
    if (!term || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Both term and sessionId are required in the request body.'
      });
    }

    // Security: Only school admins may clear remarks
    if (req.user.type !== 'school') {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized. Only school administrators can regenerate AI remarks.'
      });
    }

    const termInt = parseInt(term);
    const sessionIdInt = parseInt(sessionId);

    const result = await pool.query(
      `DELETE FROM report_remarks
       WHERE enrollment_id = $1 AND term = $2 AND session_id = $3`,
      [enrollmentId, termInt, sessionIdInt]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'No cached remark found for this enrollment, term, and session.'
      });
    }

    console.log(`🗑️  Remark cleared for Enrollment ${enrollmentId}, Term ${termInt}, Session ${sessionIdInt}`);

    res.json({
      success: true,
      message: 'Remark cleared. A fresh AI remark will be generated on the next report request.'
    });

  } catch (error) {
    console.error('❌ Remark Regeneration Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================================
// PDF PREVIEW ENDPOINTS (Returns base64 for frontend rendering)
// =====================================================================

/**
 * @route   GET /api/reports/preview/official-report/:enrollmentId
 * @desc    Generate PDF preview without emailing - returns base64 encoded PDF
 * @access  Private
 * @query   term, sessionId
 */
router.get('/preview/official-report/:enrollmentId', async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { term, sessionId } = req.query;
    const schoolId = req.user?.schoolId;

    // Convert parameters to integers
    const termInt = parseInt(term, 10);
    const sessionIdInt = parseInt(sessionId, 10);

    if (!termInt || !sessionIdInt || isNaN(termInt) || isNaN(sessionIdInt)) {
      return res.status(400).json({ success: false, error: "Term and Session ID must be valid numbers" });
    }

    console.log(`Generating PDF preview for enrollment: ${enrollmentId}, term: ${termInt}, session: ${sessionIdInt}`);

    // 1. FETCH DATA - Same as email route
    const dataQuery = `
      SELECT 
        s.first_name, 
        s.last_name, 
        s.photo as photo_url,
        sch.name as school_name,
        pref.logo_url, 
        pref.stamp_url, 
        pref.theme_color, 
        pref.header_text,
        c.display_name as class_name,
        COALESCE(sub.subject_name, 'Unknown Subject') as subject_name,
        COALESCE(sc.ca1_score, 0) as ca1_score,
        COALESCE(sc.ca2_score, 0) as ca2_score,
        COALESCE(sc.ca3_score, 0) as ca3_score,
        COALESCE(sc.ca4_score, 0) as ca4_score,
        COALESCE(sc.exam_score, 0) as exam_score,
        COALESCE(sc.total_score, 0) as total_score,
        COALESCE(sc.teacher_remark, '') as teacher_remark,
        COALESCE(ay.session_name, '') as session_name
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN schools sch ON s.school_id = sch.id
      LEFT JOIN school_preferences pref ON pref.school_id = sch.id
      LEFT JOIN global_class_templates c ON e.class_id = c.id
      LEFT JOIN scores sc ON sc.enrollment_id = e.id
        AND sc.term = $3 
        AND sc.session_id = $4
      LEFT JOIN global_subjects sub ON sc.subject_id = sub.id
      LEFT JOIN academic_years ay ON sc.session_id = ay.id
      WHERE e.id = $1 
        AND e.school_id = $2
        AND sc.id IS NOT NULL
      ORDER BY sub.subject_name ASC
    `;

    const result = await pool.query(dataQuery, [enrollmentId, schoolId, termInt, sessionIdInt]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No report data found for this enrollment, term, and session."
      });
    }

    const data = result.rows;
    const pref = data[0];

    // 2. GET AI REMARK - Same as email route
    let aiRemark = "The student continues to show steady progress in their academic pursuits.";
    
    try {
      const existingRemark = await pool.query(
        `SELECT ai_remark FROM report_remarks 
         WHERE enrollment_id = $1 AND term = $2 AND session_id = $3`,
        [enrollmentId, termInt, sessionIdInt]
      );

      if (existingRemark.rows.length > 0) {
        aiRemark = existingRemark.rows[0].ai_remark;
      }
    } catch (err) {
      console.error("AI Remark retrieval error:", err.message);
    }

    // 3. BUILD PDF - Same logic as email route but collect as base64
    // Use autoFirstPage: false to prevent automatic blank pages
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4' });
    
    // Add first page explicitly
    doc.addPage();
    
    const buffers = [];

    doc.on('data', (chunk) => {
      buffers.push(chunk);
    });

    doc.on('end', async () => {
      try {
        const pdfBuffer = Buffer.concat(buffers);
        const base64Pdf = pdfBuffer.toString('base64');

        res.json({
          success: true,
          pdfBase64: base64Pdf,
          fileName: `Report_${pref.first_name}_${pref.last_name}_Term${termInt}.pdf`.replace(/\s+/g, '_')
        });
      } catch (err) {
        console.error("PDF preview generation error:", err);
        res.status(500).json({ success: false, error: "Failed to generate PDF" });
      }
    });

    // Generate PDF using same logic as email route
    let themeColor = '#2563EB';
    if (pref.theme_color && typeof pref.theme_color === 'string' && pref.theme_color.trim().length > 0) {
      themeColor = pref.theme_color.trim();
    }

    // Add page header, student info, scores table (same as email route)
    doc.fontSize(16).font('Helvetica-Bold').fillColor(themeColor).text('OFFICIAL REPORT CARD', 50, 30);
    doc.fontSize(10).fillColor('#666').font('Helvetica').text(`${pref.school_name || 'School'}`, 50, 50);

    // Add student info
    doc.fontSize(14).fillColor(themeColor).font('Helvetica-Bold').text(`${pref.first_name} ${pref.last_name}`, 50, 100);
    doc.fontSize(10).fillColor('#555').font('Helvetica').text(`Class: ${pref.class_name}`, 50, 120);
    doc.fontSize(10).fillColor('#666').font('Helvetica').text(`Term ${termInt} • ${pref.session_name}`, 50, 135);

    // Deduplicate data by subject
    const uniqueSubjects = {};
    data.forEach(row => {
      const subjectKey = row.subject_name;
      if (!uniqueSubjects[subjectKey]) {
        uniqueSubjects[subjectKey] = row;
      }
    });
    const deduplicatedData = Object.values(uniqueSubjects);

    // Add scores table
    const tableStartY = 165;
    const subjectColX = 50;
    const ca1ColX = 160;
    const ca2ColX = 210;
    const ca3ColX = 260;
    const ca4ColX = 310;
    const examColX = 360;
    const totalColX = 410;
    const colWidth = 45;
    const tableWidth = 415;
    const rowHeight = 18;

    // Header
    doc.fillColor(themeColor).rect(subjectColX, tableStartY, tableWidth, 25).fill();
    doc.strokeColor(themeColor).lineWidth(2);
    doc.rect(subjectColX, tableStartY, tableWidth, 25).stroke();

    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    doc.text('Subject', subjectColX + 5, tableStartY + 6, { width: 100 });
    doc.text('CA1', ca1ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('CA2', ca2ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('CA3', ca3ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('CA4', ca4ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('Exam', examColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('Total', totalColX, tableStartY + 6, { width: colWidth, align: 'center' });

    // Body
    let tableY = tableStartY + 32;
    doc.font('Helvetica');
    doc.strokeColor('#ddd').lineWidth(0.5);

    deduplicatedData.forEach((row, index) => {
      if (index % 2 === 0) {
        doc.fillColor('#f9f9f9').rect(subjectColX, tableY - 5, tableWidth, rowHeight).fill();
      }

      doc.strokeColor('#e0e0e0').lineWidth(0.5);
      doc.moveTo(subjectColX, tableY + 13).lineTo(subjectColX + tableWidth, tableY + 13).stroke();
      doc.moveTo(ca1ColX, tableY - 5).lineTo(ca1ColX, tableY + 13).stroke();
      doc.moveTo(ca2ColX, tableY - 5).lineTo(ca2ColX, tableY + 13).stroke();
      doc.moveTo(ca3ColX, tableY - 5).lineTo(ca3ColX, tableY + 13).stroke();
      doc.moveTo(ca4ColX, tableY - 5).lineTo(ca4ColX, tableY + 13).stroke();
      doc.moveTo(examColX, tableY - 5).lineTo(examColX, tableY + 13).stroke();
      doc.moveTo(totalColX, tableY - 5).lineTo(totalColX, tableY + 13).stroke();

      doc.fillColor('#000').fontSize(9);
      doc.text(row.subject_name.substring(0, 15), subjectColX + 5, tableY - 3);
      doc.text(String(row.ca1_score), ca1ColX, tableY - 3, { width: colWidth, align: 'center' });
      doc.text(String(row.ca2_score), ca2ColX, tableY - 3, { width: colWidth, align: 'center' });
      doc.text(String(row.ca3_score), ca3ColX, tableY - 3, { width: colWidth, align: 'center' });
      doc.text(String(row.ca4_score), ca4ColX, tableY - 3, { width: colWidth, align: 'center' });
      doc.text(String(row.exam_score), examColX, tableY - 3, { width: colWidth, align: 'center' });
      doc.text(String(row.total_score), totalColX, tableY - 3, { width: colWidth, align: 'center' });

      tableY += rowHeight;
    });

    // Add AI remark
    doc.fontSize(10).fillColor('#333').font('Helvetica-Bold').text('Principal\'s Remark:', 50, tableY + 20);
    doc.fontSize(9).fillColor('#555').font('Helvetica').text(aiRemark, 50, tableY + 40, { width: 450 });

    doc.end();

  } catch (error) {
    console.error('❌ PDF Preview Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   GET /api/reports/preview/student-grades/:enrollmentId
 * @desc    Generate student grades PDF preview - returns base64 encoded PDF
 * @access  Private (Student)
 * @query   term, sessionId
 */
router.get('/preview/student-grades/:enrollmentId', async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const { term, sessionId } = req.query;
    const studentId = req.user?.studentId;

    const termInt = parseInt(term, 10);
    const sessionIdInt = parseInt(sessionId, 10);

    if (!termInt || !sessionIdInt) {
      return res.status(400).json({ success: false, error: "Term and sessionId are required" });
    }

    // Security: Student can only preview their own grades
    const ownershipCheck = await pool.query(
      'SELECT id FROM enrollments WHERE id = $1 AND student_id = $2',
      [enrollmentId, studentId]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    // Fetch grades data
    const query = `
      SELECT 
        s.first_name, s.last_name, s.photo,
        sch.name as school_name,
        c.display_name as class_name,
        pref.theme_color,
        pref.logo_url,
        sub.subject_name,
        sc.ca1_score, sc.ca2_score, sc.ca3_score, sc.ca4_score, sc.exam_score, sc.total_score,
        ay.session_name
      FROM enrollments e
      JOIN students s ON e.student_id = s.id
      JOIN schools sch ON s.school_id = sch.id
      LEFT JOIN school_preferences pref ON pref.school_id = sch.id
      LEFT JOIN global_class_templates c ON e.class_id = c.id
      LEFT JOIN scores sc ON sc.enrollment_id = e.id AND sc.term = $3 AND sc.session_id = $4
      LEFT JOIN global_subjects sub ON sc.subject_id = sub.id
      LEFT JOIN academic_years ay ON sc.session_id = ay.id
      WHERE e.id = $1 AND sc.id IS NOT NULL
      ORDER BY sub.subject_name ASC
    `;

    const result = await pool.query(query, [enrollmentId, termInt, sessionIdInt]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "No grade data found" });
    }

    const data = result.rows;
    const student = data[0];

    // Generate PDF
    // Use autoFirstPage: false to prevent automatic blank pages
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A4' });
    
    // Add first page explicitly
    doc.addPage();
    
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', async () => {
      try {
        const pdfBuffer = Buffer.concat(buffers);
        const base64Pdf = pdfBuffer.toString('base64');

        res.json({
          success: true,
          pdfBase64: base64Pdf,
          fileName: `Grades_${student.first_name}_${student.last_name}_Term${termInt}.pdf`.replace(/\s+/g, '_')
        });
      } catch (err) {
        res.status(500).json({ success: false, error: "Failed to generate PDF" });
      }
    });

    let themeColor = '#2563EB';
    if (student.theme_color && student.theme_color.trim()) {
      themeColor = student.theme_color.trim();
    }

    // Build PDF
    doc.fontSize(16).font('Helvetica-Bold').fillColor(themeColor).text('ACADEMIC GRADES', 50, 30);
    doc.fontSize(10).fillColor('#666').font('Helvetica').text(student.school_name, 50, 50);
    doc.fontSize(14).fillColor(themeColor).font('Helvetica-Bold').text(`${student.first_name} ${student.last_name}`, 50, 100);
    doc.fontSize(10).fillColor('#555').font('Helvetica').text(`Class: ${student.class_name}`, 50, 120);
    doc.fontSize(10).text(`Term ${termInt} • ${student.session_name}`, 50, 135);

    // Deduplicate by subject
    const uniqueGrades = {};
    data.forEach(row => {
      if (!uniqueGrades[row.subject_name]) {
        uniqueGrades[row.subject_name] = row;
      }
    });
    const grades = Object.values(uniqueGrades);

    // Scores table
    const tableY = 165;
    doc.fillColor(themeColor).rect(50, tableY, 415, 25).fill();
    doc.strokeColor(themeColor).lineWidth(2).rect(50, tableY, 415, 25).stroke();
    doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold');
    doc.text('Subject', 60, tableY + 6);
    doc.text('CA1', 160, tableY + 6, { width: 45, align: 'center' });
    doc.text('CA2', 210, tableY + 6, { width: 45, align: 'center' });
    doc.text('CA3', 260, tableY + 6, { width: 45, align: 'center' });
    doc.text('CA4', 310, tableY + 6, { width: 45, align: 'center' });
    doc.text('Exam', 360, tableY + 6, { width: 45, align: 'center' });
    doc.text('Total', 410, tableY + 6, { width: 45, align: 'center' });

    let rowY = tableY + 32;
    doc.font('Helvetica').fillColor('#000').fontSize(9);
    grades.forEach((grade, idx) => {
      if (idx % 2 === 0) {
        doc.fillColor('#f9f9f9').rect(50, rowY - 5, 415, 18).fill();
        doc.fillColor('#000');
      }
      doc.text(grade.subject_name.substring(0, 15), 60, rowY - 3);
      doc.text(String(grade.ca1_score || 0), 160, rowY - 3, { width: 45, align: 'center' });
      doc.text(String(grade.ca2_score || 0), 210, rowY - 3, { width: 45, align: 'center' });
      doc.text(String(grade.ca3_score || 0), 260, rowY - 3, { width: 45, align: 'center' });
      doc.text(String(grade.ca4_score || 0), 310, rowY - 3, { width: 45, align: 'center' });
      doc.text(String(grade.exam_score || 0), 360, rowY - 3, { width: 45, align: 'center' });
      doc.text(String(grade.total_score || 0), 410, rowY - 3, { width: 45, align: 'center' });
      rowY += 18;
    });

    doc.end();

  } catch (error) {
    console.error('❌ Student Grades Preview Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
