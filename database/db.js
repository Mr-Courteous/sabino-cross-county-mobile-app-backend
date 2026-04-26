const { Pool } = require('pg');
const path = require('path');

// NOTE: You used '.env.local' in your snippet. 
// Ensure your file is named exactly that, or change this to '.env'
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('prisma.io');

const pool = new Pool({
  // This is the fix: It uses the long connection string if it exists
  connectionString: process.env.DATABASE_URL,

  // If DATABASE_URL is missing, it falls back to your old individual settings
  host: process.env.DATABASE_URL ? undefined : (process.env.DB_HOST || 'localhost'),
  port: process.env.DATABASE_URL ? undefined : (process.env.DB_PORT || 5432),
  database: process.env.DATABASE_URL ? undefined : (process.env.DB_NAME || 'sabino_schools'),
  user: process.env.DATABASE_URL ? undefined : (process.env.DB_USER || 'postgres'),
  password: process.env.DATABASE_URL ? undefined : (process.env.DB_PASSWORD || ''),
  
  // SSL configuration - Required for many cloud DBs like Supabase/Neon/Render
  ssl: isProduction ? { rejectUnauthorized: false } : false,

  // ---------------------------------------------------------
  // POOLING CONFIGURATION (Audit Recommendation #11)
  // ---------------------------------------------------------
  max: 20,                // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds if connection cannot be established
});

console.log('\n🗄️  [DB] Attempting connection...');
console.log(`📊 [DB] Mode: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
if (process.env.DATABASE_URL) {
    console.log('📡 [DB] Using Cloud Connection String');
} else {
    console.log('🏠 [DB] Using Localhost Configuration');
    console.log(`   Host: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`   Port: ${process.env.DB_PORT || 5432}`);
    console.log(`   Database: ${process.env.DB_NAME || 'sabino_schools'}`);
}

pool.on('connect', () => {
  console.log('✅ [DB] Connected to PostgreSQL successfully\n');
});

pool.on('error', (err) => {
  console.error('\n❌ [DB] Unexpected error on idle client:', {
    code: err.code,
    message: err.message,
  });
});

module.exports = pool;