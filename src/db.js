const { Pool } = require('pg');

// Reads DATABASE_URL from your .env file (local) or from Railway's
// environment variables automatically once deployed.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Railway requires SSL
});

module.exports = pool;
