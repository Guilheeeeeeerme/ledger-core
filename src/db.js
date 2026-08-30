const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ledger:ledger@localhost:5432/ledger'
});

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Runs a unit of work on one checked-out connection and guarantees that no
 * partial database state survives a thrown error.
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
