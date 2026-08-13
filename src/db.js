require('dotenv').config();
const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Date objects.
// pg's default Date parsing applies local-timezone conversion, which shifts a
// calendar date (no time component) to the wrong day once serialized as UTC.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

// Render's managed Postgres requires TLS on every connection (internal or
// external) but its cert isn't in Node's default trust store, hence
// rejectUnauthorized: false. Local Docker Postgres has no SSL configured
// at all, so this only applies when PGSSL is explicitly set.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
