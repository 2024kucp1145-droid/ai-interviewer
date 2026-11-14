import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Builds PostgreSQL connection options.
 * Supports:
 * 1. DATABASE_URL (Supabase, Neon, AWS RDS, Railway, Render, etc.)
 * 2. Standard PG environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
 */
export function getPostgresConfig() {
  const databaseUrl = process.env.DATABASE_URL || '';
  
  if (databaseUrl) {
    const isLocalhost = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
    return {
      connectionString: databaseUrl,
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
      max: parseInt(process.env.PG_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }

  const host = process.env.PGHOST || 'localhost';
  const port = parseInt(process.env.PGPORT || '5432', 10);
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || '';
  const database = process.env.PGDATABASE || 'ai_interviewer';
  const isLocal = (host === 'localhost' || host === '127.0.0.1');

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: parseInt(process.env.PG_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };
}

let poolInstance = null;

export function getPostgresPool() {
  if (!poolInstance) {
    const config = getPostgresConfig();
    poolInstance = new Pool(config);

    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client:', err.message);
    });
  }
  return poolInstance;
}

/**
 * Executes a parameterized query and returns result.rows
 */
export async function query(text, params = []) {
  const pool = getPostgresPool();
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    return res.rows;
  } catch (err) {
    console.error(`PostgreSQL query error [${Date.now() - start}ms]:`, err.message, '\nQuery:', text);
    throw err;
  }
}

/**
 * Executes a parameterized query and returns the first row or null
 */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Executes an INSERT / UPDATE / DELETE command and returns affected rowCount
 */
export async function execute(text, params = []) {
  const pool = getPostgresPool();
  const res = await pool.query(text, params);
  return res.rowCount;
}

/**
 * Executes a callback within a managed database transaction
 */
export async function withTransaction(callback) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health check to verify PostgreSQL connectivity
 */
export async function checkPostgresConnection() {
  const start = Date.now();
  try {
    const pool = getPostgresPool();
    const res = await pool.query('SELECT NOW() as now, version() as version');
    return {
      connected: true,
      latencyMs: Date.now() - start,
      serverTime: res.rows[0].now,
      version: res.rows[0].version
    };
  } catch (err) {
    return {
      connected: false,
      latencyMs: Date.now() - start,
      error: err.message
    };
  }
}

/**
 * Initializes the PostgreSQL schema using schema.postgres.sql
 */
export async function initPostgresSchema() {
  const schemaPath = path.resolve(__dirname, 'schema.postgres.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const pool = getPostgresPool();
  await pool.query(sql);
  console.log('✓ PostgreSQL schema initialized successfully');
}
