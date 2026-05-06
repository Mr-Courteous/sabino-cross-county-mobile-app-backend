#!/usr/bin/env node

/**
 * Server/database/backup-db.js
 * 
 * Streams database dump directly to email without disk I/O
 * Perfect for production environments (Railway, Vercel, Docker, etc.)
 * 
 * Triggered by cron job in index.js (runs daily at 12:00 AM UTC)
 */

const { spawn } = require('child_process');
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

function parseDatabaseUrl(url) {
  const match = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):?(\d+)?\/([^?]+)/);
  if (!match) throw new Error('Could not parse DATABASE_URL');
  const [, user, password, host, port = '5432', dbname] = match;
  return { user, password, host, port, dbname };
}

// ─────────────────────────────────────────────
// STREAM DATABASE DUMP → EMAIL
// ─────────────────────────────────────────────

async function dumpAndSendBackup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set in .env.local');

  const { user, password, host, port, dbname } = parseDatabaseUrl(dbUrl);
  const filename = `${dbname}_${getTimestamp()}.sql.gz`;

  log(`Starting stream dump of "${dbname}" from ${host}:${port}...`);

  return new Promise((resolve, reject) => {
    // Spawn pg_dump process
    const pgDump = spawn('pg_dump', [
      '-h', host,
      '-p', port,
      '-U', user,
      '-d', dbname,
      '--no-owner',
      '--no-acl'
    ], {
      env: { ...process.env, PGPASSWORD: password }
    });

    // Compress stream
    const gzip = createGzip();

    // Collect compressed data in memory
    const chunks = [];
    let totalSize = 0;

    gzip.on('data', (chunk) => {
      chunks.push(chunk);
      totalSize += chunk.length;
    });

    gzip.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
      log(`Dump complete → ${sizeMB} MB (compressed)`);

      try {
        await sendBackupEmail(buffer, filename);
        resolve({ filename, size: sizeMB });
      } catch (err) {
        reject(err);
      }
    });

    gzip.on('error', reject);
    pgDump.on('error', reject);

    pgDump.stdout.on('error', reject);
    pgDump.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) log(`[pg_dump] ${msg}`);
    });

    // Pipe: pg_dump stdout → gzip compression
    pgDump.stdout.pipe(gzip);
  });
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
