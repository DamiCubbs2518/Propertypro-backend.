const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

const client = new Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function test() {
  try {
    await client.connect();

    const result = await client.query(`
      SELECT
        current_database(),
        current_schema(),
        (
          SELECT COUNT(*)
          FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ) AS table_count
    `);

    console.log(result.rows[0]);
  } catch (error) {
    console.error('DB TEST FAILED:', error.message);
  } finally {
    await client.end();
  }
}

test();
