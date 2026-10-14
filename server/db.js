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

function getOptimizedConnectionString(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // If using Supabase pooler on port 5432 or default, switch to port 6543 (transaction mode)
    // to avoid (EMAXCONNSESSION) max clients reached in session mode error
    if (u.hostname.includes('pooler.supabase.com')) {
      if (u.port === '5432' || !u.port) {
        console.log('[DB] Optimizing Supabase connection: Switching from port 5432 to 6543 (Transaction Pooler).');
        u.port = '6543';
      }
    }
    return u.toString();
  } catch (e) {
    return rawUrl;
  }
}

// Initialize PostgreSQL connection pool if DATABASE_URL is provided
if (process.env.DATABASE_URL) {
  try {
    const connectionString = getOptimizedConnectionString(process.env.DATABASE_URL);
    pgPool = new pg.Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000
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
      console.warn('[DB] Optimized PostgreSQL connection check failed:', pgErr.message);
      try {
        console.log('[DB] Trying fallback connection with raw DATABASE_URL...');
        const fallbackPool = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          max: 5,
          idleTimeoutMillis: 5000,
          connectionTimeoutMillis: 10000
        });
        const client = await fallbackPool.connect();
        await client.query('SELECT 1');
        client.release();
        pgPool = fallbackPool;
        dbMode = 'pg';
        console.log('[DB] Connected to PostgreSQL fallback successfully.');
      } catch (rawErr) {
        console.warn('[DB] PostgreSQL fallback also failed:', rawErr.message);
        console.warn('[DB] Falling back to local SQLite3 database...');
        await initSqlite();
      }
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

    -- ==============================================================================
    -- SALES MODULE TABLES (Central Supabase Mumbai)
    -- ==============================================================================

    -- Sales Leads Table
    CREATE TABLE IF NOT EXISTS sales_leads (
      id SERIAL PRIMARY KEY,
      student_name TEXT,
      parent_name TEXT,
      mobile TEXT,
      email TEXT,
      program TEXT,
      lead_source TEXT,
      status TEXT DEFAULT 'New',
      assigned_to TEXT,
      employee_id TEXT,
      expected_amount NUMERIC DEFAULT 0,
      notes TEXT,
      raw_values JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Sales Deals Table
    CREATE TABLE IF NOT EXISTS sales_deals (
      id SERIAL PRIMARY KEY,
      lead_id INT,
      student_name TEXT,
      program TEXT,
      deal_value NUMERIC DEFAULT 0,
      discount_amount NUMERIC DEFAULT 0,
      final_amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'Open',
      stage TEXT DEFAULT 'Proposal',
      closed_date TIMESTAMP WITH TIME ZONE,
      assigned_to TEXT,
      employee_id TEXT,
      raw_values JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Sales Targets Table
    CREATE TABLE IF NOT EXISTS sales_targets (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      month TEXT NOT NULL,
      target_admissions INT DEFAULT 0,
      target_amount NUMERIC DEFAULT 0,
      achieved_admissions INT DEFAULT 0,
      achieved_amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'Active',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_sales_target_emp_month UNIQUE (employee_id, month)
    );

    -- Sales Activity & Transaction Logs
    CREATE TABLE IF NOT EXISTS sales_logs (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      lead_id INT,
      deal_id INT,
      employee_id TEXT,
      assigned_to TEXT,
      status TEXT,
      details TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Quota & Egress Protection Indexes
    CREATE INDEX IF NOT EXISTS idx_sales_leads_created_at ON sales_leads (created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_leads_status ON sales_leads (status);
    CREATE INDEX IF NOT EXISTS idx_sales_leads_assigned_to ON sales_leads (assigned_to);
    CREATE INDEX IF NOT EXISTS idx_sales_leads_employee_id ON sales_leads (employee_id);

    CREATE INDEX IF NOT EXISTS idx_sales_deals_created_at ON sales_deals (created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_deals_status ON sales_deals (status);
    CREATE INDEX IF NOT EXISTS idx_sales_deals_assigned_to ON sales_deals (assigned_to);
    CREATE INDEX IF NOT EXISTS idx_sales_deals_employee_id ON sales_deals (employee_id);

    CREATE INDEX IF NOT EXISTS idx_sales_targets_emp_month ON sales_targets (employee_id, month);
    CREATE INDEX IF NOT EXISTS idx_sales_targets_status ON sales_targets (status);

    CREATE INDEX IF NOT EXISTS idx_sales_logs_created_at ON sales_logs (created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_logs_status ON sales_logs (status);
    CREATE INDEX IF NOT EXISTS idx_sales_logs_assigned_to ON sales_logs (assigned_to);
    CREATE INDEX IF NOT EXISTS idx_sales_logs_employee_id ON sales_logs (employee_id);
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

    -- ==============================================================================
    -- SALES MODULE TABLES (SQLite Fallback)
    -- ==============================================================================

    CREATE TABLE IF NOT EXISTS sales_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT,
      parent_name TEXT,
      mobile TEXT,
      email TEXT,
      program TEXT,
      lead_source TEXT,
      status TEXT DEFAULT 'New',
      assigned_to TEXT,
      employee_id TEXT,
      expected_amount REAL DEFAULT 0,
      notes TEXT,
      raw_values TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      student_name TEXT,
      program TEXT,
      deal_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      final_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Open',
      stage TEXT DEFAULT 'Proposal',
      closed_date TEXT,
      assigned_to TEXT,
      employee_id TEXT,
      raw_values TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      month TEXT NOT NULL,
      target_admissions INTEGER DEFAULT 0,
      target_amount REAL DEFAULT 0,
      achieved_admissions INTEGER DEFAULT 0,
      achieved_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, month)
    );

    CREATE TABLE IF NOT EXISTS sales_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      lead_id INTEGER,
      deal_id INTEGER,
      employee_id TEXT,
      assigned_to TEXT,
      status TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sales_leads_created_at ON sales_leads (created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_leads_status ON sales_leads (status);
    CREATE INDEX IF NOT EXISTS idx_sales_leads_assigned_to ON sales_leads (assigned_to);
    CREATE INDEX IF NOT EXISTS idx_sales_leads_employee_id ON sales_leads (employee_id);

    CREATE INDEX IF NOT EXISTS idx_sales_deals_created_at ON sales_deals (created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_deals_status ON sales_deals (status);
    CREATE INDEX IF NOT EXISTS idx_sales_deals_assigned_to ON sales_deals (assigned_to);
    CREATE INDEX IF NOT EXISTS idx_sales_deals_employee_id ON sales_deals (employee_id);

    CREATE INDEX IF NOT EXISTS idx_sales_targets_emp_month ON sales_targets (employee_id, month);
    CREATE INDEX IF NOT EXISTS idx_sales_targets_status ON sales_targets (status);

    CREATE INDEX IF NOT EXISTS idx_sales_logs_created_at ON sales_logs (created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_logs_status ON sales_logs (status);
    CREATE INDEX IF NOT EXISTS idx_sales_logs_assigned_to ON sales_logs (assigned_to);
    CREATE INDEX IF NOT EXISTS idx_sales_logs_employee_id ON sales_logs (employee_id);
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
