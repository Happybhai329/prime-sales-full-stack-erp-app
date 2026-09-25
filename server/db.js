import pg from 'pg';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let dbMode = 'none'; // 'pg' or 'sqlite'
let pgPool = null;
let sqliteDb = null;

// Initialize PostgreSQL connection pool if DATABASE_URL is provided
if (process.env.DATABASE_URL) {
  try {
    const connectionString = process.env.DATABASE_URL;
    pgPool = new pg.Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000
    });

    pgPool.on('error', (err) => {
      console.error('[DB] Unexpected PG client error:', err.message);
    });
  } catch (err) {
    console.warn('[DB] Failed to instantiate PG pool, will use SQLite:', err.message);
    pgPool = null;
  }
}

function initSqlite() {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(DATA_DIR, 'sales_dashboard.db');
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('[DB] SQLite connection failed:', err);
        return reject(err);
      }
      console.log(`[DB] Using local SQLite database at: ${dbPath}`);
      dbMode = 'sqlite';
      resolve(sqliteDb);
    });
  });
}

/**
 * Executes a SQL query across PostgreSQL or SQLite fallback
 * Automatically transforms $1, $2 parameter placeholders into ? for SQLite.
 */
export async function query(sql, params = []) {
  if (dbMode === 'pg' && pgPool) {
    try {
      const res = await pgPool.query(sql, params);
      return res;
    } catch (err) {
      console.error('[DB:PG Query Error]', err.message, 'Query:', sql.slice(0, 100));
      throw err;
    }
  }

  // SQLite fallback execution
  if (!sqliteDb) {
    await initSqlite();
  }

  return new Promise((resolve, reject) => {
    // Transform $1, $2, ... placeholders to ?
    let paramIndex = 1;
    const transformedSql = sql.replace(/\$\d+/g, () => '?');

    const cleanSql = transformedSql.trim();
    const isSelect = cleanSql.toUpperCase().startsWith('SELECT') || cleanSql.toUpperCase().startsWith('PRAGMA');

    if (isSelect) {
      sqliteDb.all(transformedSql, params, (err, rows) => {
        if (err) return reject(err);
        // Normalize rows: parse JSON strings in raw_values if needed
        const normalizedRows = (rows || []).map((row) => {
          if (row.raw_values && typeof row.raw_values === 'string') {
            try {
              row.raw_values = JSON.parse(row.raw_values);
            } catch (e) {}
          }
          return row;
        });
        resolve({ rows: normalizedRows, rowCount: normalizedRows.length });
      });
    } else {
      sqliteDb.run(transformedSql, params, function (err) {
        if (err) return reject(err);
        resolve({
          rows: [],
          rowCount: this.changes,
          lastID: this.lastID
        });
      });
    }
  });
}

/**
 * Initializes database schemas, tables, and indexes on startup
 */
export async function initDatabase() {
  console.log('[DB] Testing primary database connection...');

  // Try PostgreSQL first
  if (pgPool) {
    try {
      const client = await pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      dbMode = 'pg';
      console.log('[DB] Connected to PostgreSQL (Supabase) successfully.');
    } catch (pgErr) {
      console.warn('[DB] PostgreSQL connection check failed:', pgErr.message);
      console.warn('[DB] Falling back to local SQLite3 database...');
      await initSqlite();
    }
  } else {
    await initSqlite();
  }

  console.log(`[DB] Active Database Engine: ${dbMode.toUpperCase()}`);

  if (dbMode === 'pg') {
    await initPostgresSchema();
  } else {
    await initSqliteSchema();
  }
}

async function initPostgresSchema() {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS prime_admissions (
      row_number INT PRIMARY KEY,
      student_name TEXT,
      father_name TEXT,
      program TEXT,
      admission_date TIMESTAMP,
      start_session TEXT,
      end_session TEXT,
      mobile TEXT,
      registration_fee NUMERIC,
      tuition_fee NUMERIC,
      other_fees_json TEXT,
      total_amount NUMERIC,
      discount_percent NUMERIC,
      scholarship_amount NUMERIC,
      gst_percent NUMERIC,
      final_cost NUMERIC,
      installment_details_json TEXT,
      voucher_status TEXT DEFAULT 'Not Given',
      voucher_pdf_link TEXT DEFAULT '',
      raw_values JSONB
    );

    CREATE TABLE IF NOT EXISTS prime_inquiries (
      row_number INT PRIMARY KEY,
      student_name TEXT,
      father_name TEXT,
      mobile TEXT,
      program TEXT,
      inquiry_date TIMESTAMP,
      raw_values JSONB
    );

    CREATE TABLE IF NOT EXISTS prime_cancelled_admissions (
      row_number INT PRIMARY KEY,
      student_name TEXT,
      father_name TEXT,
      program TEXT,
      cancel_date TIMESTAMP,
      raw_values JSONB
    );

    CREATE TABLE IF NOT EXISTS prime_academic_programs (
      id SERIAL PRIMARY KEY,
      program_name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prime_fee_types (
      id SERIAL PRIMARY KEY,
      fee_type TEXT UNIQUE NOT NULL,
      amount NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS prime_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_adm_student ON prime_admissions (student_name);
    CREATE INDEX IF NOT EXISTS idx_adm_mobile ON prime_admissions (mobile);
    CREATE INDEX IF NOT EXISTS idx_adm_program ON prime_admissions (program);
    CREATE INDEX IF NOT EXISTS idx_adm_date ON prime_admissions (admission_date);

    CREATE INDEX IF NOT EXISTS idx_inq_student ON prime_inquiries (student_name);
    CREATE INDEX IF NOT EXISTS idx_inq_mobile ON prime_inquiries (mobile);
    CREATE INDEX IF NOT EXISTS idx_inq_date ON prime_inquiries (inquiry_date);
  `;

  await query(schemaSql);
  console.log('[DB] PostgreSQL schema initialized successfully.');
}

async function initSqliteSchema() {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS prime_admissions (
      row_number INTEGER PRIMARY KEY,
      student_name TEXT,
      father_name TEXT,
      program TEXT,
      admission_date TEXT,
      start_session TEXT,
      end_session TEXT,
      mobile TEXT,
      registration_fee REAL,
      tuition_fee REAL,
      other_fees_json TEXT,
      total_amount REAL,
      discount_percent REAL,
      scholarship_amount REAL,
      gst_percent REAL,
      final_cost REAL,
      installment_details_json TEXT,
      voucher_status TEXT DEFAULT 'Not Given',
      voucher_pdf_link TEXT DEFAULT '',
      raw_values TEXT
    );

    CREATE TABLE IF NOT EXISTS prime_inquiries (
      row_number INTEGER PRIMARY KEY,
      student_name TEXT,
      father_name TEXT,
      mobile TEXT,
      program TEXT,
      inquiry_date TEXT,
      raw_values TEXT
    );

    CREATE TABLE IF NOT EXISTS prime_cancelled_admissions (
      row_number INTEGER PRIMARY KEY,
      student_name TEXT,
      father_name TEXT,
      program TEXT,
      cancel_date TEXT,
      raw_values TEXT
    );

    CREATE TABLE IF NOT EXISTS prime_academic_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prime_fee_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fee_type TEXT UNIQUE NOT NULL,
      amount REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS prime_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_adm_student ON prime_admissions (student_name);
    CREATE INDEX IF NOT EXISTS idx_adm_mobile ON prime_admissions (mobile);
    CREATE INDEX IF NOT EXISTS idx_adm_program ON prime_admissions (program);
    CREATE INDEX IF NOT EXISTS idx_adm_date ON prime_admissions (admission_date);

    CREATE INDEX IF NOT EXISTS idx_inq_student ON prime_inquiries (student_name);
    CREATE INDEX IF NOT EXISTS idx_inq_mobile ON prime_inquiries (mobile);
    CREATE INDEX IF NOT EXISTS idx_inq_date ON prime_inquiries (inquiry_date);
  `;

  // SQLite multiple statements execution
  return new Promise((resolve, reject) => {
    sqliteDb.exec(schemaSql, (err) => {
      if (err) {
        console.error('[DB] Failed to initialize SQLite schema:', err);
        return reject(err);
      }
      console.log('[DB] SQLite schema initialized successfully.');
      resolve();
    });
  });
}

export function getDbMode() {
  return dbMode;
}
