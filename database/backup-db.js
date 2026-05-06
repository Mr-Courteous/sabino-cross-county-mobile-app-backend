#!/usr/bin/env node

/**
 * Server/database/backup-db.js
 *
 * Streams database dump directly to email without disk I/O
 * Perfect for production environments (Railway, Vercel, Docker, etc.)
 * Uses pg library instead of pg_dump for cross-platform compatibility
 *
 * Triggered by cron job in index.js (runs daily at 12:00 AM UTC)
 */

const { Client } = require('pg');
const { createGzip } = require('zlib');
const nodemailer = require('nodemailer');
const path = require('path');

// Load environment
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] [DB-BACKUP] ${msg}`);
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ─────────────────────────────────────────────
// DATABASE DUMP USING PG LIBRARY
// ─────────────────────────────────────────────

async function dumpDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // For Prisma.io connections
  });

  await client.connect();
  log('Connected to database');

  // Get all tables
  const tablesResult = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  const tables = tablesResult.rows.map(row => row.tablename);
  log(`Found ${tables.length} tables: ${tables.join(', ')}`);

  let dump = `-- Database backup created at ${new Date().toISOString()}\n`;
  dump += `-- Database: ${client.database}\n\n`;

  // Dump each table
  for (const table of tables) {
    log(`Dumping table: ${table}`);

    // Get table structure
    const structureResult = await client.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);

    dump += `-- Table structure for ${table}\n`;
    dump += `DROP TABLE IF EXISTS "${table}" CASCADE;\n`;
    dump += `CREATE TABLE "${table}" (\n`;

    const columns = structureResult.rows;
    columns.forEach((col, index) => {
      const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
      const defaultVal = col.column_default ? ` DEFAULT ${col.column_default}` : '';
      const comma = index < columns.length - 1 ? ',' : '';
      dump += `  "${col.column_name}" ${col.data_type}${nullable}${defaultVal}${comma}\n`;
    });

    dump += `);\n\n`;

    // Get table data
    const dataResult = await client.query(`SELECT * FROM "${table}"`);
    if (dataResult.rows.length > 0) {
      dump += `-- Data for ${table}\n`;
      dump += `INSERT INTO "${table}" VALUES\n`;

      dataResult.rows.forEach((row, index) => {
        const values = Object.values(row).map(value => {
          if (value === null) return 'NULL';
          if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
          if (value instanceof Date) return `'${value.toISOString()}'`;
          return value.toString();
        });
        const comma = index < dataResult.rows.length - 1 ? ',' : ';';
        dump += `(${values.join(', ')})${comma}\n`;
      });
      dump += '\n';
    }
  }

  await client.end();
  log('Database dump completed');
  return dump;
}

// ─────────────────────────────────────────────
// STREAM DATABASE DUMP → EMAIL
// ─────────────────────────────────────────────

async function dumpAndSendBackup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set in .env.local');

  // Extract database name from URL for filename
  const dbNameMatch = dbUrl.match(/\/([^/?]+)/);
  const dbname = dbNameMatch ? dbNameMatch[1] : 'database';
  const filename = `${dbname}_${getTimestamp()}.sql.gz`;

  log(`Starting database dump of "${dbname}"...`);

  try {
    // Get the SQL dump
    const sqlDump = await dumpDatabase();
    const dumpSize = (Buffer.byteLength(sqlDump, 'utf8') / 1024 / 1024).toFixed(2);
    log(`Dump created → ${dumpSize} MB (uncompressed)`);

    // Compress the dump
    const compressed = await new Promise((resolve, reject) => {
      const gzip = createGzip();
      const chunks = [];

      gzip.on('data', chunk => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks)));
      gzip.on('error', reject);

      gzip.write(sqlDump);
      gzip.end();
    });

    const compressedSize = (compressed.length / 1024 / 1024).toFixed(2);
    log(`Compression complete → ${compressedSize} MB`);

    // Send email
    await sendBackupEmail(compressed, filename);
    return { filename, size: compressedSize };

  } catch (error) {
    log(`Error during backup: ${error.message}`);
    throw error;
  }
}

// ─────────────────────────────────────────────
// SEND COMPRESSED BUFFER VIA EMAIL
// ─────────────────────────────────────────────

async function sendBackupEmail(buffer, filename) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    log('Email credentials not set — backup dumped but not sent.');
    return;
  }

  log(`Sending backup via email to ${process.env.EMAIL_USER}...`);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });

  const mailOptions = {
    from: `"Sabino Backup" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: `🗄️ Database Backup: ${filename}`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Database Backup Complete</h2>
        <p>Backup timestamp: <strong>${new Date().toLocaleString()}</strong></p>
        <p>Filename: <strong>${filename}</strong></p>
        <p>File size: <strong>${(buffer.length / 1024 / 1024).toFixed(2)} MB</strong></p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
        <p style="font-size: 12px; color: #666;">
          This is an automated backup from Sabino Edu. No action required.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: filename,
        content: buffer,
        contentType: 'application/gzip',
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    log(`✅ Email sent successfully`);
  } catch (err) {
    log(`❌ Email delivery FAILED: ${err.message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────

async function runBackup() {
  log('Starting backup task...');
  try {
    const { filename, size } = await dumpAndSendBackup();
    log(`✅ Backup process finished successfully (${size} MB)`);
  } catch (err) {
    log(`❌ Backup process FAILED: ${err.message}`);
    // Don't throw — let cron scheduler log this gracefully
  }
}

module.exports = { runBackup };

// If run directly (for testing): node backup-db.js
if (require.main === module) {
  runBackup().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
