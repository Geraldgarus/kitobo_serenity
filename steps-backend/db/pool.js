const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

process.on('SIGINT',  () => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', () => pool.end().then(() => process.exit(0)));

module.exports = pool;