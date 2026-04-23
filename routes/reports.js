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

    // 2. GENERATE UNIQUE AI INSIGHT
    let aiRemark = "The student has demonstrated effort this term.";
    try {
      // Find highest and lowest subjects for context
      const validScores = data.filter(r => r.total_score > 0);
      const sorted = [...validScores].sort((a, b) => b.total_score - a.total_score);
      const topSubject = sorted.length > 0 ? sorted[0].subject_name : "their studies";
      const strugglingSubject = sorted.length > 1 ? sorted[sorted.length - 1].subject_name : "other areas";

      const performanceSummary = data.map(r => `${r.subject_name}: ${r.total_score}/100`).join(", ");

      const aiCompletion = await openai.chat.completions.create({
        model: "llama3-70b-8192", // Fast and free on Groq
        messages: [{
          role: "system",
          content: `You are an expert school principal. Write a unique, 2-sentence formal report card remark.
          STRICT RULES:
          - NEVER say "Good job", "Keep it up", or "Great effort".
          - Include the student's name (${pref.first_name}).
          - Explicitly mention their excellence in ${topSubject}.
          - Give a specific recommendation for ${strugglingSubject}.
          - Tone: Sophisticated and pedagogical.`
        }, {
          role: "user",
          content: `Performance Data: ${performanceSummary}`
        }]
      });
      aiRemark = aiCompletion.choices[0].message.content;
    } catch (aiErr) {
      console.error("AI Remark failed:", aiErr.message);
    }

    // 3. BUILD THE PDF
    const doc = new PDFDocument();
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

    // Header Branding with theme color background
    const schoolName = pref.school_name || "School Name";
    const headerText = (pref.header_text && pref.header_text.trim()) ? pref.header_text : "";

    // Colored header background
    doc.fillColor(themeColor).rect(0, 0, 595, 75).fill();

    // Left accent bar
    doc.fillColor(themeColor).rect(0, 0, 3, 80).fill();

    // White school name on colored background
    doc.fontSize(24).fillColor('#ffffff').font('Helvetica-Bold').text(schoolName, 110, 15, { align: 'center', width: 390 });
    doc.fontSize(11).fillColor('#f0f0f0').font('Helvetica').text(headerText, 110, 42, { align: 'center', width: 390 });

    // RESET FILL COLOR - Critical to prevent color bleed
    doc.fillColor('#000000');

    // Professional divider line with theme color
    doc.strokeColor(themeColor).lineWidth(3).moveTo(50, 75).lineTo(550, 75).stroke();

    // RESET STROKE COLOR
    doc.strokeColor('#333333');

    // Load Logo AFTER header (so it appears on top of header background)
    console.log('\n=== Loading Images for Report ===');
    console.log('Logo URL:', pref.logo_url ? pref.logo_url.substring(0, 100) : 'NOT PROVIDED');
    console.log('Stamp URL:', pref.stamp_url ? pref.stamp_url.substring(0, 100) : 'NOT PROVIDED');
    console.log('Photo URL:', pref.photo_url ? pref.photo_url.substring(0, 100) : 'NOT PROVIDED');
    console.log('===================================\n');

    // Draw white background for logo area for better visibility
    doc.fillColor('#ffffff').rect(485, 5, 60, 60).fill();
    await tryLoadImage(doc, pref.logo_url, 490, 10, 50, 50, 'LOGO');
    doc.fillColor('#000000');

    // Load Student Photo if available
    await tryLoadImage(doc, pref.photo_url, 50, 80, 60, 60, 'STUDENT_PHOTO');

    // Modern Student Info Card
    const firstName = pref.first_name || "N/A";
    const lastName = pref.last_name || "N/A";
    const className = pref.class_name || "N/A";
    const sessionName = (pref.session_name && pref.session_name.trim()) ? pref.session_name : `Session ${sessionIdInt}`;

    // Info card with theme color left border
    doc.fillColor('#ffffff').rect(120, 80, 380, 60).fill();
    doc.strokeColor('#e0e0e0').lineWidth(1).rect(120, 80, 380, 60).stroke();
    // Left accent border with theme color - makes it very visible
    doc.fillColor(themeColor).rect(120, 80, 4, 60).fill();

    // RESET FILL COLOR
    doc.fillColor('#000000');

    // Student details with theme color for student name to make it unmistakable
    doc.fontSize(14).fillColor(themeColor).font('Helvetica-Bold').text(`${firstName} ${lastName}`, 130, 87);
    doc.fontSize(10).fillColor('#555').font('Helvetica').text(`Class: ${className}`, 130, 105);
    doc.fontSize(10).fillColor('#666').font('Helvetica').text(`Term ${termInt}  •  ${sessionName}`, 130, 118);
    doc.fontSize(9).fillColor('#999').font('Helvetica-Oblique').text(`Report Card`, 130, 130);

    // RESET FILL COLOR
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

    // Scores Table Header - with professional borders
    const tableStartY = 160;
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

    // Header background
    doc.fillColor(themeColor).rect(subjectColX, tableStartY, tableWidth, 25).fill();

    // Header borders with theme color
    doc.strokeColor(themeColor).lineWidth(2);
    doc.rect(subjectColX, tableStartY, tableWidth, 25).stroke();
    // Column separators in header
    doc.moveTo(ca1ColX, tableStartY).lineTo(ca1ColX, tableStartY + 25).stroke();
    doc.moveTo(ca2ColX, tableStartY).lineTo(ca2ColX, tableStartY + 25).stroke();
    doc.moveTo(ca3ColX, tableStartY).lineTo(ca3ColX, tableStartY + 25).stroke();
    doc.moveTo(ca4ColX, tableStartY).lineTo(ca4ColX, tableStartY + 25).stroke();
    doc.moveTo(examColX, tableStartY).lineTo(examColX, tableStartY + 25).stroke();
    doc.moveTo(totalColX, tableStartY).lineTo(totalColX, tableStartY + 25).stroke();

    // Header text
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    doc.text('Subject', subjectColX + 5, tableStartY + 6, { width: 100 });
    doc.text('CA1', ca1ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('CA2', ca2ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('CA3', ca3ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('CA4', ca4ColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('Exam', examColX, tableStartY + 6, { width: colWidth, align: 'center' });
    doc.text('Total', totalColX, tableStartY + 6, { width: colWidth, align: 'center' });

    // RESET COLORS after header
    doc.fillColor('#000000');
    doc.strokeColor('#333333');

    // Scores Table Body
    let tableY = tableStartY + 32;
    doc.font('Helvetica');
    doc.strokeColor('#ddd').lineWidth(0.5);

    deduplicatedData.forEach((row, index) => {
      // Alternating row backgrounds
      if (index % 2 === 0) {
        doc.fillColor('#f9f9f9').rect(subjectColX, tableY - 5, tableWidth, rowHeight).fill();
      }

      // Row bottom border
      doc.strokeColor('#e0e0e0').lineWidth(0.5);
      doc.moveTo(subjectColX, tableY + 13).lineTo(subjectColX + tableWidth, tableY + 13).stroke();

      // Column separators
      doc.moveTo(ca1ColX, tableY - 5).lineTo(ca1ColX, tableY + 13).stroke();
      doc.moveTo(ca2ColX, tableY - 5).lineTo(ca2ColX, tableY + 13).stroke();
      doc.moveTo(ca3ColX, tableY - 5).lineTo(ca3ColX, tableY + 13).stroke();
      doc.moveTo(ca4ColX, tableY - 5).lineTo(ca4ColX, tableY + 13).stroke();
      doc.moveTo(examColX, tableY - 5).lineTo(examColX, tableY + 13).stroke();
      doc.moveTo(totalColX, tableY - 5).lineTo(totalColX, tableY + 13).stroke();

      doc.fillColor('#1a1a1a').fontSize(8);

      const subject = row.subject_name || "N/A";
      const ca1 = (row.ca1_score !== null && row.ca1_score !== undefined) ? row.ca1_score : 0;
      const ca2 = (row.ca2_score !== null && row.ca2_score !== undefined) ? row.ca2_score : 0;
      const ca3 = (row.ca3_score !== null && row.ca3_score !== undefined) ? row.ca3_score : 0;
      const ca4 = (row.ca4_score !== null && row.ca4_score !== undefined) ? row.ca4_score : 0;
      const exam = (row.exam_score !== null && row.exam_score !== undefined) ? row.exam_score : 0;
      const total = (row.total_score !== null && row.total_score !== undefined) ? row.total_score : 0;

      doc.text(subject, subjectColX + 5, tableY, { width: 100 });
      doc.text(ca1.toString(), ca1ColX, tableY, { width: colWidth, align: 'center' });
      doc.text(ca2.toString(), ca2ColX, tableY, { width: colWidth, align: 'center' });
      doc.text(ca3.toString(), ca3ColX, tableY, { width: colWidth, align: 'center' });
      doc.text(ca4.toString(), ca4ColX, tableY, { width: colWidth, align: 'center' });
      doc.text(exam.toString(), examColX, tableY, { width: colWidth, align: 'center' });
      doc.text(total.toString(), totalColX, tableY, { width: colWidth, align: 'center' });

      tableY += rowHeight;
    });

    // Table outer border with theme color
    doc.strokeColor(themeColor).lineWidth(2);
    doc.rect(subjectColX, tableStartY, tableWidth, tableY - tableStartY - 5).stroke();

    // RESET COLORS after table
    doc.fillColor('#000000');
    doc.strokeColor('#333333');

    // AI Remark Section with Modern Styling
    console.log('\n=== Remark Section ===');
    console.log('DEBUG: Theme color being applied to remark box:', themeColor);
    console.log('=====================================\n');

    const remarkY = tableY + 20;
    const remarkText = (aiRemark && aiRemark.trim()) ? aiRemark : "The student has demonstrated effort this term.";

    // Remark box with theme color styling
    doc.fillColor(themeColor).opacity(0.08).rect(50, remarkY, 365, 85).fill();
    doc.fillColor(themeColor).opacity(1);
    doc.strokeColor(themeColor).lineWidth(2).rect(50, remarkY, 365, 85).stroke();

    // RESET FILL COLOR before text
    doc.fillColor('#000000');

    // Remark content
    doc.fontSize(11).fillColor(themeColor).font('Helvetica-Bold').text("Principal's Comment", 60, remarkY + 8);
    doc.fontSize(9).fillColor('#666').font('Helvetica').text("(AI Generated Insight)", 60, remarkY + 22);
    doc.fontSize(10).fillColor('#1a1a1a').font('Helvetica').text(remarkText, 60, remarkY + 35, { width: 345, align: 'left' });

    // School Stamp positioned on the right of the remark box
    await tryLoadImage(doc, pref.stamp_url, 420, remarkY + 15, 35, 35, 'STAMP');

    // RESET COLORS before footer
    doc.fillColor('#000000');
    doc.strokeColor('#333333');


    // Modern Footer with theme color accent
    const footerY = 730;
    doc.strokeColor(themeColor).lineWidth(2).moveTo(50, footerY).lineTo(550, footerY).stroke();
    doc.fontSize(8).fillColor('#999').text(`Generated on ${new Date().toLocaleString()}`, 50, footerY + 8, { align: 'center', width: 500 });
    doc.fontSize(7).fillColor('#bbb').text('This document is automatically generated and certified by the School Management System', 50, footerY + 18, { align: 'center', width: 500 });

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
        (COALESCE(s.ca1_score, 0) + COALESCE(s.ca2_score, 0) + COALESCE(s.ca3_score, 0) + 
         COALESCE(s.ca4_score, 0) + COALESCE(s.exam_score, 0)) as student_total,
        ROUND(AVG(COALESCE(s2.ca1_score, 0) + COALESCE(s2.ca2_score, 0) + COALESCE(s2.ca3_score, 0) + 
                  COALESCE(s2.ca4_score, 0) + COALESCE(s2.exam_score, 0))::NUMERIC, 2) as class_average
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
      SELECT 
        e.id as enrollment_id, 
        st.first_name, 
        st.last_name,
        g.subject_name as subject_name,
        COALESCE(s.ca1_score, 0) as ca1_score,
        COALESCE(s.ca2_score, 0) as ca2_score,
        COALESCE(s.ca3_score, 0) as ca3_score,
        COALESCE(s.ca4_score, 0) as ca4_score,
        COALESCE(s.exam_score, 0) as exam_score,
        (COALESCE(s.ca1_score, 0) + COALESCE(s.ca2_score, 0) + COALESCE(s.ca3_score, 0) + 
         COALESCE(s.ca4_score, 0) + COALESCE(s.exam_score, 0)) as subject_total,
        ROUND(AVG(COALESCE(s2.ca1_score, 0) + COALESCE(s2.ca2_score, 0) + COALESCE(s2.ca3_score, 0) + 
                  COALESCE(s2.ca4_score, 0) + COALESCE(s2.exam_score, 0))::NUMERIC, 2) as subject_class_average,
        RANK() OVER (PARTITION BY e.class_id ORDER BY 
          (COALESCE(s.ca1_score, 0) + COALESCE(s.ca2_score, 0) + COALESCE(s.ca3_score, 0) + 
           COALESCE(s.ca4_score, 0) + COALESCE(s.exam_score, 0)) DESC) as student_rank
      FROM enrollments e
      JOIN students st ON e.student_id = st.id
      LEFT JOIN scores s ON s.enrollment_id = e.id 
                         AND s.term = $3 
                         AND s.session_id = $4
      LEFT JOIN subjects g ON s.subject_id = g.id
      LEFT JOIN enrollments e2 ON e2.class_id = e.class_id 
                               AND e2.session_id = e.session_id
      LEFT JOIN scores s2 ON s2.enrollment_id = e2.id 
                          AND s2.subject_id = s.subject_id 
                          AND s2.term = s.term 
                          AND s2.session_id = s.session_id
      WHERE e.class_id = $1 
        AND e.school_id = $2 
        AND e.session_id = $4
      GROUP BY e.id, st.first_name, st.last_name, g.subject_name, s.ca1_score, s.ca2_score, s.ca3_score, s.ca4_score, s.exam_score, s.subject_id
      ORDER BY st.last_name ASC, st.first_name ASC, g.subject_name;
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
          rank: row.student_rank,
          subjects: [],
          grand_total: 0
        };
        acc.push(student);
      }

      // Add subject if it exists (avoid duplicates from the rank window function)
      if (row.subject_name && !student.subjects.some(subj => subj.subject === row.subject_name)) {
        student.subjects.push({
          subject: row.subject_name,
          ca1_score: row.ca1_score,
          ca2_score: row.ca2_score,
          ca3_score: row.ca3_score,
          ca4_score: row.ca4_score,
          exam_score: row.exam_score,
          subject_total: row.subject_total,
          subject_class_average: row.subject_class_average
        });
        student.grand_total += row.subject_total;
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

module.exports = router;