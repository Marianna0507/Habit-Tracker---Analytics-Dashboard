require('dotenv').config();
const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Date objects.
// pg's default Date parsing applies local-timezone conversion, which shifts a
// calendar date (no time component) to the wrong day once serialized as UTC.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;
