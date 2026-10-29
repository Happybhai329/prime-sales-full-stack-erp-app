import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { initDatabase, query } from './db.js';
import * as sheets from './googleSheets.js';
import {
  triggerSync,
  startBackgroundSync,
  getSyncStatus
} from './syncEngine.js';
import {
  buildVoucherData,
  buildVoucherFileName,
  generateVoucherPdfBuffer,
  generateRecordPdfBuffer
} from './voucherGenerator.js';
import {
  sendEnquiryWelcomeEmail,
  sendAdmissionConfirmationEmail
} from './mailer.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==============================================================================
// HEALTH CHECK ROUTES (For UptimeRobot, Render Liveness, & Heartbeats)
// ==============================================================================
app.get(['/health', '/api/health', '/ping'], async (req, res) => {
  if (req.query.deep === '1') {
    try {
      await query('SELECT 1');
      return res.status(200).json({
        status: 'ok',
        database: 'connected',
        service: 'The Prime Classes Sales Backend',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return res.status(503).json({
        status: 'degraded',
        database: 'error: ' + err.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  res.status(200).json({
    status: 'ok',
    service: 'The Prime Classes Sales Backend',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.head(['/health', '/api/health', '/ping'], (req, res) => {
  res.status(200).end();
});

// Helper to resolve effective academic session
async function getEffectiveSession(requestedSession) {
  if (requestedSession && String(requestedSession).trim()) {
    const sName = String(requestedSession).trim();
    try {
      const res = await query('SELECT * FROM prime_sessions WHERE name = $1', [sName]);
      if (res.rows.length > 0) return res.rows[0];
    } catch (e) {}
  }
  // Try current active session
  try {
    const curRes = await query('SELECT * FROM prime_sessions WHERE is_current = true LIMIT 1');
    if (curRes.rows.length > 0) return curRes.rows[0];
  } catch (e) {}
  // Fallback to first session or default 2026
  try {
    const anyRes = await query('SELECT * FROM prime_sessions ORDER BY id ASC LIMIT 1');
    if (anyRes.rows.length > 0) return anyRes.rows[0];
  } catch (e) {}

  return {
    name: '2026',
    is_current: true,
    admissions_sheet_name: 'Admissions',
    inquiries_sheet_name: 'Enquiries',
    cancelled_sheet_name: 'Cancelled'
  };
}

// Helper to get cached headers from prime_sync_meta
async function getCachedHeaders(sheetKey, sessionName = '') {
  try {
    if (sessionName) {
      const sRes = await query('SELECT value FROM prime_sync_meta WHERE key = $1', [
        `${sheetKey}_headers_${sessionName}`
      ]);
      if (sRes.rows.length > 0) {
        return JSON.parse(sRes.rows[0].value);
      }
    }
    const res = await query('SELECT value FROM prime_sync_meta WHERE key = $1', [
      `${sheetKey}_headers`
    ]);
    if (res.rows.length > 0) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (e) {}
  return [];
}

// Helper to get matched conversion row numbers
async function getMatchedConversionIds(sessionName = '') {
  try {
    if (sessionName) {
      const sRes = await query('SELECT value FROM prime_sync_meta WHERE key = $1', [
        `matched_conversions_${sessionName}`
      ]);
      if (sRes.rows.length > 0) {
        return JSON.parse(sRes.rows[0].value);
      }
    }
    const res = await query(
      "SELECT value FROM prime_sync_meta WHERE key = 'matched_conversions'"
    );
    if (res.rows.length > 0) {
      return JSON.parse(res.rows[0].value);
    }
  } catch (e) {}
  return [];
}

// ==============================================================================
// 1. DASHBOARD OVERVIEW & STATS (SESSION AWARE)
// ==============================================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const sessionObj = await getEffectiveSession(req.query.session);
    const sName = sessionObj.name;

    const [admCountRes, inqCountRes, canCountRes, progRes, feeRes, sessionsRes] =
      await Promise.all([
        query('SELECT COUNT(*) as count FROM prime_admissions WHERE session_name = $1', [sName]),
        query('SELECT COUNT(*) as count FROM prime_inquiries WHERE session_name = $1', [sName]),
        query('SELECT COUNT(*) as count FROM prime_cancelled_admissions WHERE session_name = $1', [sName]),
        query('SELECT program_name FROM prime_academic_programs ORDER BY program_name ASC'),
        query('SELECT fee_type, amount FROM prime_fee_types ORDER BY fee_type ASC'),
        query('SELECT * FROM prime_sessions ORDER BY id ASC')
      ]);

    const activeAdmissions = parseInt(admCountRes.rows[0]?.count || 0, 10);
    const inquiries = parseInt(inqCountRes.rows[0]?.count || 0, 10);
    const cancelled = parseInt(canCountRes.rows[0]?.count || 0, 10);

    const matchedIds = await getMatchedConversionIds(sName);
    const conversionsCount = matchedIds.length;
    const conversionRate = inquiries
      ? Number(((conversionsCount / inquiries) * 100).toFixed(2))
      : 0;

    const programs = progRes.rows.map((r) => r.program_name);
    const feeTypes = feeRes.rows.map((r) => ({
      feeType: r.fee_type,
      amount: parseFloat(r.amount || 0),
      fees: parseFloat(r.amount || 0)
    }));

    res.json({
      success: true,
      stats: {
        active: activeAdmissions,
        inquiries,
        cancelled,
        conversions: conversionsCount,
        conversionRate
      },
      sessions: sessionsRes.rows,
      selectedSession: sName,
      currentSession: sessionsRes.rows.find((s) => s.is_current)?.name || '2026',
      programs,
      feeTypes,
      sync: getSyncStatus()
    });
  } catch (err) {
    console.error('Error in /api/dashboard:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 1B. ACADEMIC SESSIONS MANAGEMENT API
// ==============================================================================
app.get('/api/sessions', async (req, res) => {
  try {
    const sRes = await query('SELECT * FROM prime_sessions ORDER BY id ASC');
    const currentSession = sRes.rows.find((s) => s.is_current)?.name || '2026';
    res.json({ success: true, sessions: sRes.rows, currentSession });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const rawName = String(req.body.name || '').trim();
    if (!rawName) {
      return res.status(400).json({ success: false, message: 'Session name is required (e.g. 2027 or 2027-2028).' });
    }
    const cleanName = rawName.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanName) {
      return res.status(400).json({ success: false, message: 'Invalid session name. Use numbers or alphanumeric names.' });
    }

    const isCurrent = Boolean(req.body.isCurrent);

    // Check if session name already exists
    const existing = await query('SELECT * FROM prime_sessions WHERE LOWER(name) = LOWER($1)', [cleanName]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: `Session "${cleanName}" already exists.` });
    }

    // Provision dedicated Google Sheet tabs
    console.log(`[Sessions] Provisioning Google Sheet tabs for new session "${cleanName}"...`);
    const sheetConfig = await sheets.createSessionSheets(cleanName);

    if (isCurrent) {
      await query('UPDATE prime_sessions SET is_current = false');
    }

    const insertRes = await query(
      `INSERT INTO prime_sessions (name, is_current, admissions_sheet_name, inquiries_sheet_name, cancelled_sheet_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [cleanName, isCurrent, sheetConfig.admissionsSheet, sheetConfig.inquiriesSheet, sheetConfig.cancelledSheet]
    );

    const newSession = insertRes.rows[0];

    // Trigger sync for new session tabs
    setTimeout(() => {
      triggerSync().catch((e) => console.warn('Post-session-creation sync warning:', e.message));
    }, 500);

    res.json({
      success: true,
      session: newSession,
      message: `Academic Session "${cleanName}" created successfully with dedicated Google Sheet tabs!`
    });
  } catch (err) {
    console.error('Error creating academic session:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/sessions/:name/set-current', async (req, res) => {
  try {
    const name = req.params.name;
    await query('UPDATE prime_sessions SET is_current = false');
    const updateRes = await query('UPDATE prime_sessions SET is_current = true WHERE name = $1 RETURNING *', [name]);
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Session "${name}" not found.` });
    }
    res.json({ success: true, session: updateRes.rows[0], message: `Session "${name}" set as current active session.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 2. FILTERED RECORDS (SUB-50ms FAST QUERY, SESSION AWARE)
// ==============================================================================
app.get('/api/records', async (req, res) => {
  try {
    const tab = req.query.tab || 'admissions';
    const search = String(req.query.search || '').trim().toLowerCase();
    const program = String(req.query.program || 'all').trim();
    const timeFilter = String(req.query.timeFilter || 'all').trim();
    const fromDate = String(req.query.from || '').trim();
    const toDate = String(req.query.to || '').trim();

    const sessionObj = await getEffectiveSession(req.query.session);
    const sName = sessionObj.name;

    let tableName = 'prime_admissions';
    let headersKey = 'admissions';

    if (tab === 'inquiries') {
      tableName = 'prime_inquiries';
      headersKey = 'inquiries';
    } else if (tab === 'cancelled') {
      tableName = 'prime_cancelled_admissions';
      headersKey = 'cancelled';
    } else if (tab === 'conversions') {
      tableName = 'prime_admissions';
      headersKey = 'admissions';
    }

    const headers = await getCachedHeaders(headersKey, sName);

    let sql = `SELECT * FROM ${tableName}`;
    const params = [];
    const whereClauses = [];

    // Filter by academic session
    params.push(sName);
    whereClauses.push(`session_name = $${params.length}`);

    // Conversions tab filter
    if (tab === 'conversions') {
      const matchedIds = await getMatchedConversionIds(sName);
      if (matchedIds.length === 0) {
        return res.json({ headers, rows: [], totalCount: 0, session: sName });
      }
      params.push(matchedIds);
      // In PG we use = ANY($1), in SQLite fallback we can use IN (...)
      const dbIsPg = getSyncStatus().status !== 'sqlite';
      whereClauses.push(
        dbIsPg
          ? `row_number = ANY($${params.length})`
          : `row_number IN (${matchedIds.join(',')})`
      );
    }

    // Program filter
    if (program && program !== 'all') {
      params.push(program);
      whereClauses.push(`LOWER(program) = LOWER($${params.length})`);
    }

    // Date range filters
    const dateCol =
      tab === 'inquiries'
        ? 'inquiry_date'
        : tab === 'cancelled'
          ? 'cancel_date'
          : 'admission_date';

    if (fromDate) {
      params.push(`${fromDate}T00:00:00.000Z`);
      whereClauses.push(`${dateCol} >= $${params.length}`);
    }

    if (toDate) {
      params.push(`${toDate}T23:59:59.999Z`);
      whereClauses.push(`${dateCol} <= $${params.length}`);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ' ORDER BY row_number ASC';

    const dbRes = await query(sql, params);
    let rows = dbRes.rows || [];

    // Client search filter (or in-memory for rich JSON/subfields)
    if (search) {
      rows = rows.filter((r) => {
        const student = (r.student_name || '').toLowerCase();
        const father = (r.father_name || '').toLowerCase();
        const mobile = (r.mobile || '').toLowerCase();
        const prog = (r.program || '').toLowerCase();
        const raw = JSON.stringify(r.raw_values || '').toLowerCase();
        return (
          student.includes(search) ||
          father.includes(search) ||
          mobile.includes(search) ||
          prog.includes(search) ||
          raw.includes(search)
        );
      });
    }

    // Time filter presets (weekly, monthly, yearly)
    if (timeFilter !== 'all') {
      const now = new Date();
      rows = rows.filter((r) => {
        const val = r[dateCol];
        if (!val) return true;
        const d = new Date(val);
        if (isNaN(d.getTime())) return true;

        if (timeFilter === 'weekly') return now - d < 7 * 24 * 60 * 60 * 1000;
        if (timeFilter === 'monthly')
          return (
            d.getMonth() === now.getMonth() &&
            d.getFullYear() === now.getFullYear()
          );
        if (timeFilter === 'yearly') return d.getFullYear() === now.getFullYear();
        return true;
      });
    }

    // Format output matching original Google Apps Script row format
    const formattedRows = rows.map((r) => {
      let rawArr = [];
      if (Array.isArray(r.raw_values)) {
        rawArr = r.raw_values;
      } else if (typeof r.raw_values === 'string') {
        try {
          rawArr = JSON.parse(r.raw_values);
        } catch (e) {}
      }

      return {
        rowNumber: r.row_number,
        values: rawArr,
        ssId:
          tab === 'inquiries'
            ? process.env.INQUIRY_DB_ID
            : process.env.ADMISSION_DB_ID,
        sheetName:
          tab === 'inquiries'
            ? sessionObj.inquiries_sheet_name
            : tab === 'cancelled'
              ? sessionObj.cancelled_sheet_name
              : sessionObj.admissions_sheet_name,
        session: sName,
        timestamp: r[dateCol] ? new Date(r[dateCol]).getTime() : null,
        voucherStatus: r.voucher_status,
        voucherPdfLink: r.voucher_pdf_link
      };
    });

    const totalCount = formattedRows.length;
    let paginatedRows = formattedRows;

    const limitParam = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const offsetParam = req.query.offset ? Math.max(0, parseInt(req.query.offset, 10)) : 0;

    if (limitParam && limitParam > 0) {
      paginatedRows = formattedRows.slice(offsetParam, offsetParam + limitParam);
    }

    res.json({
      headers,
      rows: paginatedRows,
      totalCount,
      session: sName
    });
  } catch (err) {
    console.error('Error in /api/records:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 3. UPDATE RECORD (INLINE EDIT & OUTBOX WRITE-BACK, SESSION AWARE)
// ==============================================================================
app.put('/api/records/:tab/:rowNumber', async (req, res) => {
  try {
    const { tab, rowNumber } = req.params;
    const { values, ssId, sheetName, session } = req.body;
    const rowNum = parseInt(rowNumber, 10);

    const sessionObj = await getEffectiveSession(session);
    const sName = sessionObj.name;

    if (!Array.isArray(values)) {
      return res.status(400).json({ success: false, error: 'values array required' });
    }

    const tableName =
      tab === 'inquiries'
        ? 'prime_inquiries'
        : tab === 'cancelled'
          ? 'prime_cancelled_admissions'
          : 'prime_admissions';

    // Update in DB immediately
    await query(
      `UPDATE ${tableName} SET raw_values = $1 WHERE row_number = $2 AND session_name = $3`,
      [JSON.stringify(values), rowNum, sName]
    );

    // Queue / async write-back to Google Sheets
    const targetSheet = sheetName || (tab === 'inquiries' ? sessionObj.inquiries_sheet_name : tab === 'cancelled' ? sessionObj.cancelled_sheet_name : sessionObj.admissions_sheet_name);
    sheets
      .updateRemoteRecord(ssId, targetSheet, rowNum, values)
      .catch((err) =>
        console.error(
          `[Outbox] Error syncing update to sheet ${targetSheet} row ${rowNum}:`,
          err.message
        )
      );

    res.json({ success: true, message: 'Record updated successfully' });
  } catch (err) {
    console.error('Error updating record:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 4. CANCEL ADMISSION (SESSION AWARE)
// ==============================================================================
app.post('/api/admissions/:rowNumber/cancel', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNumber, 10);
    const sessionObj = await getEffectiveSession(req.body.session || req.query.session);
    const sName = sessionObj.name;

    // 1. Get from admissions
    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1 AND session_name = $2',
      [rowNum, sName]
    );
    if (admRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admission record not found' });
    }

    const record = admRes.rows[0];

    // 2. Insert into cancelled
    await query(
      `INSERT INTO prime_cancelled_admissions (session_name, row_number, student_name, father_name, program, cancel_date, raw_values)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)
       ON CONFLICT (session_name, row_number) DO UPDATE SET cancel_date = CURRENT_TIMESTAMP`,
      [
        sName,
        record.row_number,
        record.student_name,
        record.father_name,
        record.program,
        JSON.stringify(record.raw_values)
      ]
    );

    // 3. Delete from active admissions
    await query('DELETE FROM prime_admissions WHERE row_number = $1 AND session_name = $2', [rowNum, sName]);

    // 4. Async sync with Google Sheets
    sheets
      .cancelRemoteAdmission(rowNum, sessionObj.admissions_sheet_name, sessionObj.cancelled_sheet_name)
      .catch((err) =>
        console.error(
          `[Outbox] Error executing cancelAdmission on row ${rowNum}:`,
          err.message
        )
      );

    res.json({ success: true, message: 'Admission moved to Cancelled Log' });
  } catch (err) {
    console.error('Error cancelling admission:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 5. VOUCHER PREVIEW & GENERATION (SESSION AWARE)
// ==============================================================================
app.get('/api/admissions/:rowNumber/voucher-preview', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNumber, 10);
    const sessionObj = await getEffectiveSession(req.query.session);
    const sName = sessionObj.name;
    const headers = await getCachedHeaders('admissions', sName);

    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1 AND session_name = $2',
      [rowNum, sName]
    );
    if (admRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    const row = admRes.rows[0];
    const values = Array.isArray(row.raw_values)
      ? row.raw_values
      : JSON.parse(row.raw_values || '[]');

    const voucherData = buildVoucherData(headers, values);

    res.json({
      success: true,
      voucherData,
      pdfUrl: row.voucher_pdf_link || '',
      status: row.voucher_status || (row.voucher_pdf_link ? 'Given' : 'Not Given')
    });
  } catch (err) {
    console.error('Error fetching voucher preview:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admissions/:rowNumber/voucher', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNumber, 10);
    const sessionObj = await getEffectiveSession(req.body.session || req.query.session);
    const sName = sessionObj.name;
    const headers = await getCachedHeaders('admissions', sName);

    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1 AND session_name = $2',
      [rowNum, sName]
    );
    if (admRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    const row = admRes.rows[0];
    const values = Array.isArray(row.raw_values)
      ? row.raw_values
      : JSON.parse(row.raw_values || '[]');

    const voucherData = buildVoucherData(headers, values);
    const fileName = buildVoucherFileName(voucherData);

    // Generate high-resolution PDF buffer
    const pdfBuffer = await generateVoucherPdfBuffer(voucherData);

    // Upload to Google Drive
    let pdfUrl = row.voucher_pdf_link || '';
    try {
      const uploadRes = await sheets.uploadVoucherPdf(fileName, pdfBuffer);
      pdfUrl = uploadRes.pdfUrl;
      console.log(`[Voucher] Uploaded voucher PDF to Google Drive: ${pdfUrl}`);
    } catch (uploadErr) {
      console.warn('[Voucher] Google Drive upload failed, generating local URL fallback:', uploadErr.message);
      pdfUrl = `/api/admissions/${rowNum}/voucher-download?session=${encodeURIComponent(sName)}`;
    }

    // Update DB
    await query(
      `UPDATE prime_admissions SET voucher_status = 'Given', voucher_pdf_link = $1 WHERE row_number = $2 AND session_name = $3`,
      [pdfUrl, rowNum, sName]
    );

    // Async write-back to Google Sheets
    sheets
      .updateRemoteVoucherStatus(rowNum, 'Given', pdfUrl, sessionObj.admissions_sheet_name)
      .catch((err) =>
        console.error(
          `[Outbox] Error updating voucher status on sheet ${sessionObj.admissions_sheet_name} row ${rowNum}:`,
          err.message
        )
      );

    res.json({
      success: true,
      voucherData,
      pdfUrl,
      fileName,
      status: 'Given'
    });
  } catch (err) {
    console.error('Error generating voucher:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download voucher PDF directly
app.get('/api/admissions/:rowNumber/voucher-download', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNumber, 10);
    const sessionObj = await getEffectiveSession(req.query.session);
    const sName = sessionObj.name;
    const headers = await getCachedHeaders('admissions', sName);

    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1 AND session_name = $2',
      [rowNum, sName]
    );
    if (admRes.rows.length === 0) {
      return res.status(404).send('Record not found');
    }

    const row = admRes.rows[0];
    const values = Array.isArray(row.raw_values)
      ? row.raw_values
      : JSON.parse(row.raw_values || '[]');

    const voucherData = buildVoucherData(headers, values);
    const fileName = buildVoucherFileName(voucherData);
    const pdfBuffer = await generateVoucherPdfBuffer(voucherData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error downloading voucher PDF:', err);
    res.status(500).send('Failed to generate PDF');
  }
});

// Update voucher status (Given / Not Given)
app.put('/api/admissions/:rowNumber/voucher-status', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNumber, 10);
    const { status, session } = req.body;
    const sessionObj = await getEffectiveSession(session || req.query.session);
    const sName = sessionObj.name;
    const normalizedStatus =
      String(status).toLowerCase() === 'given' ? 'Given' : 'Not Given';

    const admRes = await query(
      'SELECT voucher_pdf_link FROM prime_admissions WHERE row_number = $1 AND session_name = $2',
      [rowNum, sName]
    );
    const pdfUrl = admRes.rows[0]?.voucher_pdf_link || '';

    await query(
      'UPDATE prime_admissions SET voucher_status = $1 WHERE row_number = $2 AND session_name = $3',
      [normalizedStatus, rowNum, sName]
    );

    // Async write-back to Google Sheets
    sheets
      .updateRemoteVoucherStatus(rowNum, normalizedStatus, pdfUrl, sessionObj.admissions_sheet_name)
      .catch((err) =>
        console.error('[Outbox] Voucher status update error:', err.message)
      );

    res.json({ success: true, status: normalizedStatus, pdfUrl });
  } catch (err) {
    console.error('Error updating voucher status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Single record form PDF
app.get('/api/records/:tab/:rowNumber/pdf', async (req, res) => {
  try {
    const { tab, rowNumber } = req.params;
    const rowNum = parseInt(rowNumber, 10);
    const sessionObj = await getEffectiveSession(req.query.session);
    const sName = sessionObj.name;

    const tableName =
      tab === 'inquiries'
        ? 'prime_inquiries'
        : tab === 'cancelled'
          ? 'prime_cancelled_admissions'
          : 'prime_admissions';

    const headersKey =
      tab === 'inquiries'
        ? 'inquiries'
        : tab === 'cancelled'
          ? 'cancelled'
          : 'admissions';

    const headers = await getCachedHeaders(headersKey, sName);
    const dbRes = await query(
      `SELECT * FROM ${tableName} WHERE row_number = $1 AND session_name = $2`,
      [rowNum, sName]
    );
    if (dbRes.rows.length === 0) {
      return res.status(404).send('Record not found');
    }

    const row = dbRes.rows[0];
    const values = Array.isArray(row.raw_values)
      ? row.raw_values
      : JSON.parse(row.raw_values || '[]');

    const pdfBuffer = await generateRecordPdfBuffer(tab.toUpperCase(), headers, values);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${row.student_name || 'Student'}_Record.pdf"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating record form PDF:', err);
    res.status(500).send('Failed to generate record PDF');
  }
});

// ==============================================================================
// 6. SETUP MASTERS (PROGRAMS & FEE TYPES)
// ==============================================================================
app.post('/api/setup/:sheetName', async (req, res) => {
  try {
    const { sheetName } = req.params;
    const { values } = req.body;

    if (!Array.isArray(values) || values.length === 0) {
      return res.status(400).json({ success: false, error: 'Values array required' });
    }

    if (sheetName === 'academic_program') {
      const progName = values[0];
      await query(
        'INSERT INTO prime_academic_programs (program_name) VALUES ($1) ON CONFLICT (program_name) DO NOTHING',
        [progName]
      );
    } else if (sheetName === 'feestype') {
      const feeType = values[0];
      const amount = parseFloat(values[1] || 0);
      await query(
        'INSERT INTO prime_fee_types (fee_type, amount) VALUES ($1, $2) ON CONFLICT (fee_type) DO UPDATE SET amount = EXCLUDED.amount',
        [feeType, amount]
      );
    }

    // Async write-back
    sheets
      .addRemoteSetupItem(sheetName, values)
      .catch((err) => console.error('[Outbox] Add setup item error:', err.message));

    res.json({ success: true, message: 'Setup item added' });
  } catch (err) {
    console.error('Error adding setup item:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/setup/:sheetName/:idOrRow', async (req, res) => {
  try {
    const { sheetName, idOrRow } = req.params;
    const rowNum = parseInt(idOrRow, 10);

    if (sheetName === 'academic_program') {
      await query('DELETE FROM prime_academic_programs WHERE id = $1', [rowNum]);
    } else if (sheetName === 'feestype') {
      await query('DELETE FROM prime_fee_types WHERE id = $1', [rowNum]);
    }

    // Async write-back
    sheets
      .deleteRemoteSetupItem(sheetName, rowNum)
      .catch((err) => console.error('[Outbox] Delete setup item error:', err.message));

    res.json({ success: true, message: 'Setup item deleted' });
  } catch (err) {
    console.error('Error deleting setup item:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete individual record row (session aware)
app.delete('/api/records/:tab/:rowNumber', async (req, res) => {
  try {
    const { tab, rowNumber } = req.params;
    const { ssId, sheetName, session } = req.body;
    const rowNum = parseInt(rowNumber, 10);
    const sessionObj = await getEffectiveSession(session || req.query.session);
    const sName = sessionObj.name;

    const tableName =
      tab === 'inquiries'
        ? 'prime_inquiries'
        : tab === 'cancelled'
          ? 'prime_cancelled_admissions'
          : 'prime_admissions';

    await query(`DELETE FROM ${tableName} WHERE row_number = $1 AND session_name = $2`, [rowNum, sName]);

    const targetSheet = sheetName || (tab === 'inquiries' ? sessionObj.inquiries_sheet_name : tab === 'cancelled' ? sessionObj.cancelled_sheet_name : sessionObj.admissions_sheet_name);
    sheets
      .deleteRemoteRecord(ssId, targetSheet, rowNum)
      .catch((err) => console.error('[Outbox] Delete remote record error:', err.message));

    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 7. SYNC MANAGEMENT
// ==============================================================================
app.get('/api/sync/status', (req, res) => {
  res.json({ success: true, sync: getSyncStatus() });
});

app.post('/api/sync/trigger', async (req, res) => {
  try {
    const result = await triggerSync();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 8. PUBLIC PORTALS & SUBMISSION ENDPOINTS (ENQUIRY & ADMISSION)
// ==============================================================================

function getStudentClassCode(className) {
  const norm = String(className || '').toUpperCase().trim();
  if (norm.includes('RIMC')) return 'RM';
  if (norm.includes('RMS')) return 'RS';
  if (norm.includes('SAINIK')) return 'SS';
  if (norm.includes('NDA')) return 'ND';
  if (norm.includes('6')) return '06';
  if (norm.includes('7')) return '07';
  if (norm.includes('8')) return '08';
  if (norm.includes('9')) return '09';
  if (norm.includes('10')) return '10';
  if (norm.includes('11')) return '11';
  if (norm.includes('12')) return '12';
  return 'PR';
}

// Serve Enquiry Form
app.get('/enquiry-form', (req, res) => {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'enquiry-form.html'),
    path.join(__dirname, '..', 'public', 'enquiry-form.html')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return res.sendFile(c);
  }
  res.status(404).send('Enquiry Form template not found.');
});

// Serve Admission Form
app.get('/admission-form', (req, res) => {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'admission-form.html'),
    path.join(__dirname, '..', 'public', 'admission-form.html')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return res.sendFile(c);
  }
  res.status(404).send('Admission Form template not found.');
});

// Public Academic Programs dropdown
app.get('/api/public/programs', async (req, res) => {
  try {
    const dbRes = await query('SELECT program_name FROM prime_academic_programs ORDER BY program_name ASC');
    let programs = dbRes.rows.map((r) => r.program_name);
    if (!programs.length) {
      programs = [
        'RIMC Foundation',
        'RMS Cadets',
        'Sainik School Entrance',
        'NDA Foundation',
        'Class 6th Foundation',
        'Class 9th Foundation'
      ];
    }
    res.json({ success: true, data: programs });
  } catch (err) {
    res.json({
      success: true,
      data: ['RIMC Foundation', 'RMS Cadets', 'Sainik School Entrance', 'NDA Foundation']
    });
  }
});

// Public Fee Types dropdown
app.get('/api/public/fee-types', async (req, res) => {
  try {
    const dbRes = await query('SELECT fee_type, amount FROM prime_fee_types ORDER BY fee_type ASC');
    let feeTypes = (dbRes && dbRes.rows ? dbRes.rows : []).map((r) => ({
      feeType: r.fee_type,
      amount: parseFloat(r.amount || 0),
      fees: parseFloat(r.amount || 0)
    }));

    // Fallback: If DB table is empty, fetch live from Google Sheets
    if (feeTypes.length === 0) {
      try {
        const remote = await sheets.fetchRemoteFeeTypes();
        if (remote && remote.rows && remote.rows.length > 0) {
          const feeMap = new Map();
          remote.rows.forEach((r) => {
            const type = String(r.values[0] || '').trim();
            const amt = parseFloat(r.values[1] || 0) || 0;
            if (type && !feeMap.has(type)) {
              feeMap.set(type, amt);
            }
          });
          feeTypes = Array.from(feeMap.entries()).map(([feeType, amount]) => ({
            feeType,
            amount,
            fees: amount
          }));

          // Persist in background to database
          for (const item of feeTypes) {
            query(
              'INSERT INTO prime_fee_types (fee_type, amount) VALUES ($1, $2) ON CONFLICT (fee_type) DO UPDATE SET amount = EXCLUDED.amount',
              [item.feeType, item.amount]
            ).catch(() => {});
          }
        }
      } catch (remoteErr) {
        console.warn('[FeeTypes Remote Fallback Warning]', remoteErr.message);
      }
    }

    res.json({ success: true, data: feeTypes });
  } catch (err) {
    try {
      const remote = await sheets.fetchRemoteFeeTypes();
      if (remote && remote.rows && remote.rows.length > 0) {
        const feeMap = new Map();
        remote.rows.forEach((r) => {
          const type = String(r.values[0] || '').trim();
          const amt = parseFloat(r.values[1] || 0) || 0;
          if (type && !feeMap.has(type)) feeMap.set(type, amt);
        });
        const feeTypes = Array.from(feeMap.entries()).map(([feeType, amount]) => ({
          feeType,
          amount,
          fees: amount
        }));
        return res.json({ success: true, data: feeTypes });
      }
    } catch (e) {}
    res.json({ success: true, data: [] });
  }
});

// Public Enquiries list (for Admission Form "Fetch from Enquiry" modal, session aware)
app.get('/api/public/enquiries', async (req, res) => {
  try {
    const sessionObj = await getEffectiveSession(req.query.session);
    const sName = sessionObj.name;

    const dbRes = await query(
      'SELECT row_number, student_name, father_name, mobile, program, raw_values FROM prime_inquiries WHERE session_name = $1 ORDER BY row_number DESC LIMIT 600',
      [sName]
    );
    const cachedHeaders = await getCachedHeaders('inquiries', sName);
    const headers = cachedHeaders && cachedHeaders.length > 0 ? cachedHeaders : [
      'Timestamp', 'S.No.', 'Date', 'Student Name', 'Class', 'Date of Birth',
      'Category', 'Father Name', 'Father No.', 'Parent Email', 'Mother Name', 'Mother No.',
      'Father Occupation', 'Complete Address', 'Present School', 'Prime Feedback',
      'Source', 'Discount (Scholarship)', 'Notes'
    ];
    
    const records = dbRes.rows.map((row) => {
      const vals = Array.isArray(row.raw_values)
        ? row.raw_values
        : (typeof row.raw_values === 'string' ? JSON.parse(row.raw_values || '[]') : []);

      const getValue = (h) => {
        const idx = headers.indexOf(h);
        return idx !== -1 && vals[idx] != null ? String(vals[idx]).trim() : '';
      };
      return {
        studentName: row.student_name || getValue('Student Name'),
        className: getValue('Class'),
        dob: getValue('Date of Birth'),
        category: getValue('Category'),
        fatherName: row.father_name || getValue('Father Name'),
        fatherNo: row.mobile || getValue('Father No.'),
        parentEmail: getValue('Parent Email'),
        motherName: getValue('Mother Name'),
        motherNo: getValue('Mother No.'),
        occupation: getValue('Father Occupation'),
        completeAddress: getValue('Complete Address'),
        school: getValue('Present School'),
        discountScholarship: getValue('Discount (Scholarship)')
      };
    });
    res.json({ success: true, data: records, session: sName });
  } catch (err) {
    console.error('Error in /api/public/enquiries:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Submit Enquiry Form (session aware)
app.post('/api/enquiry-form/submit', async (req, res) => {
  try {
    const data = req.body || {};
    const name = String(data.name || '').trim();
    const studentClass = String(data.studentClass || '').trim();
    const fatherNo = String(data.fatherNo || '').trim();
    const sessionObj = await getEffectiveSession(data.session);
    const sName = sessionObj.name;

    if (!name || !studentClass || !fatherNo) {
      return res.status(400).json({
        status: 'error',
        message: 'Name, Class, and Father\'s Number are mandatory.'
      });
    }

    const countRes = await query(
      'SELECT COALESCE(MAX(row_number), 0) + 1 AS next_row FROM prime_inquiries WHERE session_name = $1',
      [sName]
    );
    const nextRow = parseInt(countRes.rows[0]?.next_row || 1, 10);
    const nowIso = new Date().toISOString();

    const headers = await getCachedHeaders('inquiries', sName);
    const inquiryHeaders = headers.length > 0 ? headers : [
      'Timestamp', 'S.No.', 'Date', 'Student Name', 'Class', 'Date of Birth',
      'Category', 'Father Name', 'Father No.', 'Parent Email', 'Mother Name', 'Mother No.',
      'Father Occupation', 'Complete Address', 'Present School', 'Prime Feedback',
      'Source', 'Discount (Scholarship)', 'Notes'
    ];

    const valuesByHeader = {
      'Timestamp': new Date().toLocaleString('en-IN'),
      'S.No.': String(nextRow),
      'Date': data.date || nowIso.split('T')[0],
      'Student Name': name,
      'Class': studentClass,
      'Date of Birth': data.dob || '',
      'Category': data.category || '',
      'Father Name': data.fatherName || '',
      'Father No.': fatherNo,
      'Parent Email': data.email || '',
      'Mother Name': data.motherName || '',
      'Mother No.': data.motherNo || '',
      'Father Occupation': data.fatherOccupation || '',
      'Complete Address': data.address || '',
      'Present School': data.school || '',
      'Prime Feedback': data.feedback || '',
      'Source': data.source || '',
      'Discount (Scholarship)': data.discount || '',
      'Notes': data.notes || ''
    };

    const rowValues = inquiryHeaders.map((h) => valuesByHeader[h] != null ? valuesByHeader[h] : '');

    // Insert locally into database immediately
    await query(
      `INSERT INTO prime_inquiries (session_name, row_number, student_name, father_name, mobile, program, inquiry_date, raw_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_name, row_number) DO UPDATE SET
        student_name = EXCLUDED.student_name,
        father_name = EXCLUDED.father_name,
        mobile = EXCLUDED.mobile,
        program = EXCLUDED.program,
        inquiry_date = EXCLUDED.inquiry_date,
        raw_values = EXCLUDED.raw_values`,
      [
        sName,
        nextRow,
        name,
        data.fatherName || '',
        fatherNo,
        studentClass,
        new Date(),
        JSON.stringify(rowValues)
      ]
    );

    // Send authentic Welcome Email in background
    if (data.email) {
      sendEnquiryWelcomeEmail(data.email, name).catch((mailErr) => {
        console.warn('[Enquiry] Welcome email warning:', mailErr.message);
      });
    }

    // Append to remote Google Sheets asynchronously (safe error isolation)
    sheets.appendEnquiry(rowValues, sessionObj.inquiries_sheet_name).catch((err) => {
      console.warn(`[GoogleSheets] Append enquiry warning on ${sessionObj.inquiries_sheet_name}:`, err.message);
    });

    res.json({
      status: 'success',
      sno: nextRow,
      session: sName,
      message: `Enquiry Registered Successfully in Session ${sName}! Allocated S.No: ${nextRow}`
    });
  } catch (err) {
    console.error('Error submitting enquiry form:', err);
    res.status(500).json({ status: 'error', message: 'Database save failed: ' + err.message });
  }
});

// Submit Admission Form (session aware)
app.post('/api/admission-form/submit', async (req, res) => {
  try {
    const { formData, filesData } = req.body || {};
    if (!formData) {
      return res.status(400).json({ status: 'error', message: 'Missing form data.' });
    }

    const studentName = String(formData.studentName || '').trim();
    const fatherName = String(formData.fatherName || '').trim();
    const studentClass = String(formData.class || '').trim();
    const sessionObj = await getEffectiveSession(formData.session);
    const sName = sessionObj.name;

    if (!studentName || !fatherName || !studentClass) {
      return res.status(400).json({
        status: 'error',
        message: 'Student Name, Father Name, and Class are mandatory.'
      });
    }

    // Generate Unique Student ID
    const appDate = formData.applicationDate ? new Date(formData.applicationDate) : new Date();
    const yearYY = String(appDate.getFullYear()).slice(-2);
    const monthMM = String(appDate.getMonth() + 1).padStart(2, '0');
    const classCode = getStudentClassCode(studentClass);
    const prefix = `${yearYY}${monthMM}${classCode}`;

    // Find highest sequence for prefix in this session
    const countRes = await query(
      'SELECT COALESCE(MAX(row_number), 0) + 1 AS next_row FROM prime_admissions WHERE session_name = $1',
      [sName]
    );
    const nextRow = parseInt(countRes.rows[0]?.next_row || 1, 10);
    const candidateId = `${prefix}${String(nextRow).padStart(4, '0')}`;

    const headers = await getCachedHeaders('admissions', sName);
    const admissionHeaders = headers.length > 0 ? headers : [
      'Student Name', "Father's Name", "Mother's Name", 'Timestamp', 'StudentsId',
      'Start Session', 'End Session', 'Date of Application', 'DOB', 'Mobile Numbers',
      'Email', 'Category', "Father's Occupation", 'Defence Service', 'Job Description',
      'Class', 'Present School', 'Aadhaar Card', 'DOB Certificate', 'Domicile',
      'Student Photo', 'Caste Certificate', 'Service Certificate', 'Program',
      'Registration Fee', 'Tuition Fee', 'Other Fees (JSON)', 'Installment Details (JSON)',
      'Total Amount', 'Discount (%)', 'Scholarship Amount', 'GST (%)', 'Final Cost',
      'Terms Agreement', 'Advance Check', 'VoucherPDFLink', 'VoucherStatus', 'Caste',
      'Parent Email', 'Complete Address'
    ];

    const parentEmail = formData.parentEmail || formData.email || '';
    const mobileNumbersStr = typeof formData.mobileNumbers === 'string'
      ? formData.mobileNumbers
      : JSON.stringify(formData.mobileNumbers || []);

    const valuesByHeader = {
      'Timestamp': new Date().toLocaleString('en-IN'),
      'StudentsId': candidateId,
      'Start Session': formData.startSession || '',
      'End Session': formData.endSession || '',
      'Date of Application': formData.applicationDate || new Date().toISOString().split('T')[0],
      'Application Date': formData.applicationDate || new Date().toISOString().split('T')[0],
      'Student Name': studentName,
      "Father's Name": fatherName,
      'Father Name': fatherName,
      'DOB': formData.dob || '',
      'Mobile Numbers': mobileNumbersStr,
      'Mobile Number': mobileNumbersStr,
      'Email': parentEmail,
      'Parent Email': parentEmail,
      "Mother's Name": formData.motherName || '',
      'Mother Name': formData.motherName || '',
      'Category': formData.caste || '',
      'Caste': formData.caste || '',
      "Father's Occupation": formData.fatherOccupation || '',
      'Defence Service': formData.defenceService || '',
      'Job Description': formData.jobDescription || '',
      'Class': studentClass,
      'Present School': formData.presentSchool || '',
      'Complete Address': formData.completeAddress || '',
      'Program': formData.program || '',
      'Registration Fee': formData.registrationFee || 0,
      'Tuition Fee': formData.tuitionFee || 0,
      'Other Fees (JSON)': typeof formData.feeDetails === 'string' ? formData.feeDetails : JSON.stringify(formData.feeDetails || []),
      'Installment Details (JSON)': typeof formData.installmentDetails === 'string' ? formData.installmentDetails : JSON.stringify(formData.installmentDetails || []),
      'Total Amount': formData.totalAmount || 0,
      'Discount (%)': formData.discountPercent || 0,
      'Scholarship Amount': formData.scholarshipAmount || 0,
      'GST (%)': formData.gstPercent || 0,
      'Final Cost': formData.finalCost || 0,
      'Terms Agreement': formData.termsAgreement || 'Agreed',
      'Advance Check': formData.advanceCheck || '',
      'VoucherStatus': 'Not Given',
      'VoucherPDFLink': '',
      'Student Photo': '',
      'Aadhaar Card': '',
      'Aadhaar': '',
      'DOB Certificate': '',
      'Domicile': '',
      'Caste Certificate': '',
      'Service Certificate': ''
    };

    const rowValues = admissionHeaders.map((h) => valuesByHeader[h] != null ? valuesByHeader[h] : '');

    // Insert locally into database immediately
    await query(
      `INSERT INTO prime_admissions (
        session_name, row_number, student_name, father_name, program, admission_date,
        start_session, end_session, mobile, registration_fee, tuition_fee,
        other_fees_json, total_amount, discount_percent, scholarship_amount,
        gst_percent, final_cost, installment_details_json, voucher_status,
        voucher_pdf_link, raw_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (session_name, row_number) DO UPDATE SET
        student_name = EXCLUDED.student_name,
        father_name = EXCLUDED.father_name,
        program = EXCLUDED.program,
        admission_date = EXCLUDED.admission_date,
        start_session = EXCLUDED.start_session,
        end_session = EXCLUDED.end_session,
        mobile = EXCLUDED.mobile,
        registration_fee = EXCLUDED.registration_fee,
        tuition_fee = EXCLUDED.tuition_fee,
        other_fees_json = EXCLUDED.other_fees_json,
        total_amount = EXCLUDED.total_amount,
        discount_percent = EXCLUDED.discount_percent,
        scholarship_amount = EXCLUDED.scholarship_amount,
        gst_percent = EXCLUDED.gst_percent,
        final_cost = EXCLUDED.final_cost,
        installment_details_json = EXCLUDED.installment_details_json,
        voucher_status = EXCLUDED.voucher_status,
        voucher_pdf_link = EXCLUDED.voucher_pdf_link,
        raw_values = EXCLUDED.raw_values`,
      [
        sName,
        nextRow,
        studentName,
        fatherName,
        formData.program || '',
        new Date(),
        formData.startSession || '',
        formData.endSession || '',
        mobileNumbersStr,
        parseFloat(formData.registrationFee || 0),
        parseFloat(formData.tuitionFee || 0),
        valuesByHeader['Other Fees (JSON)'],
        parseFloat(formData.totalAmount || 0),
        parseFloat(formData.discountPercent || 0),
        parseFloat(formData.scholarshipAmount || 0),
        parseFloat(formData.gstPercent || 0),
        parseFloat(formData.finalCost || 0),
        valuesByHeader['Installment Details (JSON)'],
        'Not Given',
        '',
        JSON.stringify(rowValues)
      ]
    );

    // Send authentic Admission Confirmation Email in background
    if (parentEmail) {
      sendAdmissionConfirmationEmail(parentEmail, {
        studentName,
        studentId: candidateId,
        className: studentClass,
        program: formData.program
      }).catch((mailErr) => {
        console.warn('[Admission] Confirmation email warning:', mailErr.message);
      });
    }

    // Async process: Upload student files to Google Drive, update row & Google Sheets
    (async () => {
      try {
        let updatedRowValues = [...rowValues];
        if (filesData && Object.keys(filesData).length > 0) {
          const fileUrls = await sheets.uploadStudentFiles(studentName, candidateId, filesData);
          if (fileUrls.photo) valuesByHeader['Student Photo'] = fileUrls.photo;
          if (fileUrls.aadhaar) {
            valuesByHeader['Aadhaar Card'] = fileUrls.aadhaar;
            valuesByHeader['Aadhaar'] = fileUrls.aadhaar;
          }
          if (fileUrls.dobCert) valuesByHeader['DOB Certificate'] = fileUrls.dobCert;
          if (fileUrls.domicile) valuesByHeader['Domicile'] = fileUrls.domicile;
          if (fileUrls.casteCert) valuesByHeader['Caste Certificate'] = fileUrls.casteCert;
          if (fileUrls.serviceCert) valuesByHeader['Service Certificate'] = fileUrls.serviceCert;

          updatedRowValues = admissionHeaders.map((h) => valuesByHeader[h] != null ? valuesByHeader[h] : '');
          await query('UPDATE prime_admissions SET raw_values = $1 WHERE row_number = $2 AND session_name = $3', [
            JSON.stringify(updatedRowValues),
            nextRow,
            sName
          ]);
        }

        // Append to remote Google Sheets tab for this session
        await sheets.appendAdmission(updatedRowValues, sessionObj.admissions_sheet_name);
        console.log(`[GoogleSheets] Appended admission for ${candidateId} (${studentName}) on ${sessionObj.admissions_sheet_name}`);
      } catch (asyncErr) {
        console.warn('[Admission] Background Drive/Sheets task warning:', asyncErr.message);
      }
    })();

    res.json({
      status: 'success',
      success: true,
      studentId: candidateId,
      session: sName,
      pdfUrl: `/api/admission-form/pdf/${candidateId}`,
      emailSent: Boolean(parentEmail),
      message: `Admission Submitted Successfully in Session ${sName}! Student ID: ${candidateId}`
    });
  } catch (err) {
    console.error('Error submitting admission form:', err);
    res.status(500).json({ status: 'error', message: 'Admission save failed: ' + err.message });
  }
});

// ==============================================================================
// 8.2. ADMISSION RENEWAL APIS
// ==============================================================================

// Search previous admissions across sessions for renewal
app.get('/api/admissions/search-previous', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json({ success: true, admissions: [] });
    }

    const searchPattern = `%${q}%`;
    const searchRes = await query(
      `SELECT row_number, session_name, student_name, father_name, mobile, program,
              admission_date, start_session, end_session, registration_fee, tuition_fee,
              other_fees_json, total_amount, discount_percent, scholarship_amount,
              gst_percent, final_cost, installment_details_json, voucher_status,
              voucher_pdf_link, raw_values
       FROM prime_admissions
       WHERE student_name ILIKE $1
          OR father_name ILIKE $1
          OR mobile ILIKE $1
          OR CAST(raw_values AS text) ILIKE $1
       ORDER BY row_number DESC
       LIMIT 50`,
      [searchPattern]
    );

    res.json({ success: true, admissions: searchRes.rows });
  } catch (err) {
    console.error('Error in /api/admissions/search-previous:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Renew student admission into target session with editable details
app.post('/api/admissions/renew', async (req, res) => {
  try {
    const body = req.body || {};
    const {
      targetSession,
      oldSession,
      oldRowNumber,
      studentName,
      fatherName,
      motherName,
      dob,
      mobile,
      email,
      caste,
      fatherOccupation,
      defenceService,
      jobDescription,
      studentClass,
      presentSchool,
      completeAddress,
      program,
      startSession,
      endSession,
      registrationFee,
      tuitionFee,
      otherFees,
      installmentDetails,
      totalAmount,
      discountPercent,
      scholarshipAmount,
      gstPercent,
      finalCost,
      termsAgreement
    } = body;

    if (!targetSession || !studentName || !studentClass) {
      return res.status(400).json({
        success: false,
        error: 'Target session, Student Name, and Class are mandatory for renewal.'
      });
    }

    const targetSessionObj = await getEffectiveSession(targetSession);
    const targetSName = targetSessionObj.name;

    // Allocate next row_number in target session
    const nextRowRes = await query(
      'SELECT COALESCE(MAX(row_number), 0) + 1 AS next_row FROM prime_admissions WHERE session_name = $1',
      [targetSName]
    );
    const nextRow = parseInt(nextRowRes.rows[0]?.next_row || 1, 10);

    // Generate renewed student ID
    const appDate = new Date();
    const yearYY = String(appDate.getFullYear()).slice(-2);
    const monthMM = String(appDate.getMonth() + 1).padStart(2, '0');
    const classCode = getStudentClassCode(studentClass);
    const prefix = `${yearYY}${monthMM}${classCode}`;
    const renewedStudentId = `${prefix}${String(nextRow).padStart(4, '0')}`;

    // Get headers for target session
    const headers = await getCachedHeaders('admissions', targetSName);
    const admissionHeaders = headers.length > 0 ? headers : [
      'Student Name', "Father's Name", "Mother's Name", 'Timestamp', 'StudentsId',
      'Start Session', 'End Session', 'Date of Application', 'DOB', 'Mobile Numbers',
      'Email', 'Category', "Father's Occupation", 'Defence Service', 'Job Description',
      'Class', 'Present School', 'Aadhaar Card', 'DOB Certificate', 'Domicile',
      'Student Photo', 'Caste Certificate', 'Service Certificate', 'Program',
      'Registration Fee', 'Tuition Fee', 'Other Fees (JSON)', 'Installment Details (JSON)',
      'Total Amount', 'Discount (%)', 'Scholarship Amount', 'GST (%)', 'Final Cost',
      'Terms Agreement', 'Advance Check', 'VoucherPDFLink', 'VoucherStatus', 'Caste',
      'Parent Email', 'Complete Address'
    ];

    const mobileStr = typeof mobile === 'string' && (mobile.startsWith('[') || mobile.includes(','))
      ? mobile
      : JSON.stringify([mobile].filter(Boolean));

    const otherFeesJson = typeof otherFees === 'string' ? otherFees : JSON.stringify(otherFees || []);
    const installmentsJson = typeof installmentDetails === 'string'
      ? installmentDetails
      : JSON.stringify(installmentDetails || { installments: [] });

    const valuesByHeader = {
      'Timestamp': new Date().toLocaleString('en-IN'),
      'StudentsId': renewedStudentId,
      'Start Session': startSession || `${targetSName}-04-01`,
      'End Session': endSession || `${parseInt(targetSName, 10) + 1 || ''}-03-31`,
      'Date of Application': new Date().toISOString().split('T')[0],
      'Application Date': new Date().toISOString().split('T')[0],
      'Student Name': studentName,
      "Father's Name": fatherName || '',
      'Father Name': fatherName || '',
      'DOB': dob || '',
      'Mobile Numbers': mobileStr,
      'Mobile Number': mobileStr,
      'Email': email || '',
      'Parent Email': email || '',
      "Mother's Name": motherName || '',
      'Mother Name': motherName || '',
      'Category': caste || '',
      'Caste': caste || '',
      "Father's Occupation": fatherOccupation || '',
      'Defence Service': defenceService || '',
      'Job Description': jobDescription || '',
      'Class': studentClass,
      'Present School': presentSchool || '',
      'Complete Address': completeAddress || '',
      'Program': program || '',
      'Registration Fee': registrationFee || 0,
      'Tuition Fee': tuitionFee || 0,
      'Other Fees (JSON)': otherFeesJson,
      'Installment Details (JSON)': installmentsJson,
      'Total Amount': totalAmount || 0,
      'Discount (%)': discountPercent || 0,
      'Scholarship Amount': scholarshipAmount || 0,
      'GST (%)': gstPercent || 0,
      'Final Cost': finalCost || 0,
      'Terms Agreement': termsAgreement || 'Agreed (Renewed)',
      'Advance Check': '',
      'VoucherStatus': 'Not Given',
      'VoucherPDFLink': '',
      'Student Photo': '',
      'Aadhaar Card': '',
      'DOB Certificate': '',
      'Domicile': '',
      'Caste Certificate': '',
      'Service Certificate': ''
    };

    // If renewing from an existing record, preserve documents/photos if available
    if (oldRowNumber && oldSession) {
      try {
        const oldAdm = await query(
          'SELECT raw_values FROM prime_admissions WHERE row_number = $1 AND session_name = $2',
          [oldRowNumber, oldSession]
        );
        if (oldAdm.rows.length > 0) {
          const oldVals = Array.isArray(oldAdm.rows[0].raw_values)
            ? oldAdm.rows[0].raw_values
            : JSON.parse(oldAdm.rows[0].raw_values || '[]');
          const oldHeaders = await getCachedHeaders('admissions', oldSession);
          ['Student Photo', 'Aadhaar Card', 'DOB Certificate', 'Domicile', 'Caste Certificate', 'Service Certificate'].forEach(docField => {
            const idx = oldHeaders.indexOf(docField);
            if (idx !== -1 && oldVals[idx]) {
              valuesByHeader[docField] = oldVals[idx];
            }
          });
        }
      } catch (copyErr) {
        console.warn('[Renew] Could not copy prior docs:', copyErr.message);
      }
    }

    const rowValues = admissionHeaders.map(h => valuesByHeader[h] != null ? valuesByHeader[h] : '');

    // Insert into prime_admissions
    await query(
      `INSERT INTO prime_admissions (
        session_name, row_number, student_name, father_name, program, admission_date,
        start_session, end_session, mobile, registration_fee, tuition_fee,
        other_fees_json, total_amount, discount_percent, scholarship_amount,
        gst_percent, final_cost, installment_details_json, voucher_status,
        voucher_pdf_link, raw_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (session_name, row_number) DO UPDATE SET
        student_name = EXCLUDED.student_name,
        father_name = EXCLUDED.father_name,
        program = EXCLUDED.program,
        admission_date = EXCLUDED.admission_date,
        raw_values = EXCLUDED.raw_values`,
      [
        targetSName,
        nextRow,
        studentName,
        fatherName || '',
        program || '',
        new Date(),
        startSession || '',
        endSession || '',
        mobileStr,
        parseFloat(registrationFee || 0),
        parseFloat(tuitionFee || 0),
        otherFeesJson,
        parseFloat(totalAmount || 0),
        parseFloat(discountPercent || 0),
        parseFloat(scholarshipAmount || 0),
        parseFloat(gstPercent || 0),
        parseFloat(finalCost || 0),
        installmentsJson,
        'Not Given',
        '',
        JSON.stringify(rowValues)
      ]
    );

    // Append to remote Google Sheets tab for target session
    sheets
      .appendAdmission(rowValues, targetSessionObj.admissions_sheet_name)
      .catch((sheetErr) => {
        console.warn(`[GoogleSheets] Append renewed admission error on ${targetSessionObj.admissions_sheet_name}:`, sheetErr.message);
      });

    // Send Renewal Confirmation Email if email provided
    if (email) {
      sendAdmissionConfirmationEmail(email, {
        studentName,
        studentId: renewedStudentId,
        className: studentClass,
        program: `${program || ''} (Renewed for Session ${targetSName})`
      }).catch(mailErr => console.warn('[Renew Email Warning]:', mailErr.message));
    }

    res.json({
      success: true,
      message: `Student ${studentName} successfully renewed for Academic Session ${targetSName}!`,
      newStudentId: renewedStudentId,
      newRowNumber: nextRow,
      session: targetSName
    });
  } catch (err) {
    console.error('Error in /api/admissions/renew:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admission PDF / Acknowledgment generator
app.get('/api/admission-form/pdf/:studentId', async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE raw_values::text LIKE $1 OR student_name ILIKE $2 LIMIT 1',
      [`%${studentId}%`, `%${studentId}%`]
    );

    if (admRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student admission record not found.' });
    }

    const headers = await getCachedHeaders('admissions');
    const rawVal = admRes.rows[0].raw_values;
    const values = Array.isArray(rawVal)
      ? rawVal
      : typeof rawVal === 'string'
        ? JSON.parse(rawVal)
        : [];

    const pdfBuffer = await generateRecordPdfBuffer('ADMISSIONS', headers, values);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="The_Prime_Classes_Admission_${studentId}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating admission PDF:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 8.5. SALES MANAGEMENT API (PAGINATED & INDEXED QUOTA/EGRESS SAFE)
// ==============================================================================

// GET /api/sales/reps - Fetch sales staff from central employees / prime_employees table
app.get('/api/sales/reps', async (req, res) => {
  try {
    let empRes;
    try {
      empRes = await query(
        `SELECT employee_id, name, department, role, status
         FROM prime_employees
         WHERE department ILIKE '%sales%' OR role ILIKE '%sales%' OR role ILIKE '%telecaller%'
         ORDER BY name ASC
         LIMIT 100`
      );
      if (!empRes.rows || empRes.rows.length === 0) {
        empRes = await query(
          `SELECT employee_id, name, department, role, status
           FROM prime_employees
           ORDER BY name ASC
           LIMIT 100`
        );
      }
    } catch (e) {
      // Fallback to employees table
      empRes = await query(
        `SELECT id, emp_id AS employee_id, name, department, role, status
         FROM employees
         WHERE department ILIKE '%sales%' OR role ILIKE '%sales%' OR role ILIKE '%telecaller%'
         ORDER BY name ASC
         LIMIT 100`
      );
      if (!empRes.rows || empRes.rows.length === 0) {
        empRes = await query(
          `SELECT id, emp_id AS employee_id, name, department, role, status
           FROM employees
           ORDER BY name ASC
           LIMIT 100`
        );
      }
    }
    res.json({ success: true, reps: empRes ? empRes.rows : [] });
  } catch (err) {
    res.json({ success: true, reps: [] });
  }
});

// GET /api/sales/leads - Paginated Leads with Egress & Quota Protection
app.get('/api/sales/leads', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = req.query.offset !== undefined ? Math.max(0, parseInt(req.query.offset, 10)) : (page - 1) * limit;

    const status = String(req.query.status || '').trim();
    const assignedTo = String(req.query.assigned_to || '').trim();
    const employeeId = String(req.query.employee_id || '').trim();
    const fromDate = String(req.query.from || '').trim();
    const toDate = String(req.query.to || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();

    const where = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (assignedTo && assignedTo !== 'all') {
      params.push(assignedTo);
      where.push(`assigned_to = $${params.length}`);
    }
    if (employeeId && employeeId !== 'all') {
      params.push(employeeId);
      where.push(`employee_id = $${params.length}`);
    }
    if (fromDate) {
      params.push(`${fromDate}T00:00:00.000Z`);
      where.push(`created_at >= $${params.length}`);
    }
    if (toDate) {
      params.push(`${toDate}T23:59:59.999Z`);
      where.push(`created_at <= $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(student_name ILIKE $${params.length} OR mobile ILIKE $${params.length} OR parent_name ILIKE $${params.length})`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*) as total FROM sales_leads ${whereClause}`, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const queryParams = [...params, limit, offset];
    const limitIdx = queryParams.length - 1;
    const offsetIdx = queryParams.length;

    const rowsRes = await query(
      `SELECT * FROM sales_leads ${whereClause} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams
    );

    res.json({
      success: true,
      data: rowsRes.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching sales leads:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sales/leads - Create Lead & Log
app.post('/api/sales/leads', async (req, res) => {
  try {
    const {
      student_name, parent_name, mobile, email, program,
      lead_source, status = 'New', assigned_to, employee_id,
      expected_amount = 0, notes, raw_values
    } = req.body;

    const insertRes = await query(
      `INSERT INTO sales_leads
       (student_name, parent_name, mobile, email, program, lead_source, status, assigned_to, employee_id, expected_amount, notes, raw_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        student_name, parent_name, mobile, email, program,
        lead_source, status, assigned_to, employee_id,
        expected_amount, notes, raw_values ? JSON.stringify(raw_values) : null
      ]
    );

    const lead = insertRes.rows[0];

    // Log action
    query(
      `INSERT INTO sales_logs (action, lead_id, employee_id, assigned_to, status, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['CREATE_LEAD', lead.id, employee_id, assigned_to, status, `Created lead for ${student_name || 'student'}`]
    ).catch(() => {});

    res.json({ success: true, lead });
  } catch (err) {
    console.error('Error creating sales lead:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sales/deals - Paginated Deals with Egress & Quota Protection
app.get('/api/sales/deals', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = req.query.offset !== undefined ? Math.max(0, parseInt(req.query.offset, 10)) : (page - 1) * limit;

    const status = String(req.query.status || '').trim();
    const stage = String(req.query.stage || '').trim();
    const assignedTo = String(req.query.assigned_to || '').trim();
    const employeeId = String(req.query.employee_id || '').trim();

    const where = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (stage && stage !== 'all') {
      params.push(stage);
      where.push(`stage = $${params.length}`);
    }
    if (assignedTo && assignedTo !== 'all') {
      params.push(assignedTo);
      where.push(`assigned_to = $${params.length}`);
    }
    if (employeeId && employeeId !== 'all') {
      params.push(employeeId);
      where.push(`employee_id = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*) as total FROM sales_deals ${whereClause}`, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const queryParams = [...params, limit, offset];
    const limitIdx = queryParams.length - 1;
    const offsetIdx = queryParams.length;

    const rowsRes = await query(
      `SELECT * FROM sales_deals ${whereClause} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams
    );

    res.json({
      success: true,
      data: rowsRes.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching sales deals:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sales/deals - Create Deal & Log
app.post('/api/sales/deals', async (req, res) => {
  try {
    const {
      lead_id, student_name, program, deal_value = 0,
      discount_amount = 0, final_amount = 0, status = 'Open',
      stage = 'Proposal', closed_date, assigned_to, employee_id, raw_values
    } = req.body;

    const insertRes = await query(
      `INSERT INTO sales_deals
       (lead_id, student_name, program, deal_value, discount_amount, final_amount, status, stage, closed_date, assigned_to, employee_id, raw_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        lead_id, student_name, program, deal_value,
        discount_amount, final_amount, status, stage,
        closed_date, assigned_to, employee_id,
        raw_values ? JSON.stringify(raw_values) : null
      ]
    );

    const deal = insertRes.rows[0];

    query(
      `INSERT INTO sales_logs (action, deal_id, employee_id, assigned_to, status, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['CREATE_DEAL', deal.id, employee_id, assigned_to, status, `Created deal ₹${final_amount} for ${student_name}`]
    ).catch(() => {});

    res.json({ success: true, deal });
  } catch (err) {
    console.error('Error creating sales deal:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sales/targets - Target Tracking
app.get('/api/sales/targets', async (req, res) => {
  try {
    const employeeId = String(req.query.employee_id || '').trim();
    const month = String(req.query.month || '').trim();
    const status = String(req.query.status || 'Active').trim();

    const where = [];
    const params = [];

    if (employeeId) {
      params.push(employeeId);
      where.push(`employee_id = $${params.length}`);
    }
    if (month) {
      params.push(month);
      where.push(`month = $${params.length}`);
    }
    if (status && status !== 'all') {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const resRows = await query(
      `SELECT * FROM sales_targets ${whereClause} ORDER BY month DESC, employee_id ASC LIMIT 100`,
      params
    );

    res.json({ success: true, targets: resRows.rows });
  } catch (err) {
    console.error('Error fetching sales targets:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sales/targets - Set or Update Monthly Target
app.post('/api/sales/targets', async (req, res) => {
  try {
    const {
      employee_id, employee_name, month,
      target_admissions = 0, target_amount = 0,
      achieved_admissions = 0, achieved_amount = 0,
      status = 'Active'
    } = req.body;

    if (!employee_id || !month) {
      return res.status(400).json({ success: false, message: 'employee_id and month are required' });
    }

    const upsertRes = await query(
      `INSERT INTO sales_targets
       (employee_id, employee_name, month, target_admissions, target_amount, achieved_admissions, achieved_amount, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (employee_id, month) DO UPDATE SET
         target_admissions = EXCLUDED.target_admissions,
         target_amount = EXCLUDED.target_amount,
         achieved_admissions = EXCLUDED.achieved_admissions,
         achieved_amount = EXCLUDED.achieved_amount,
         employee_name = COALESCE(EXCLUDED.employee_name, sales_targets.employee_name),
         status = EXCLUDED.status,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        employee_id, employee_name, month,
        target_admissions, target_amount,
        achieved_admissions, achieved_amount,
        status
      ]
    );

    res.json({ success: true, target: upsertRes.rows[0] });
  } catch (err) {
    console.error('Error setting sales target:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sales/logs - Paginated Audit Activity Logs
app.get('/api/sales/logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const offset = (page - 1) * limit;

    const employeeId = String(req.query.employee_id || '').trim();
    const assignedTo = String(req.query.assigned_to || '').trim();
    const status = String(req.query.status || '').trim();

    const where = [];
    const params = [];

    if (employeeId) {
      params.push(employeeId);
      where.push(`employee_id = $${params.length}`);
    }
    if (assignedTo) {
      params.push(assignedTo);
      where.push(`assigned_to = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const countRes = await query(`SELECT COUNT(*) as total FROM sales_logs ${whereClause}`, params);
    const total = parseInt(countRes.rows[0]?.total || 0, 10);

    const queryParams = [...params, limit, offset];
    const limitIdx = queryParams.length - 1;
    const offsetIdx = queryParams.length;

    const rowsRes = await query(
      `SELECT * FROM sales_logs ${whereClause} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      queryParams
    );

    res.json({
      success: true,
      logs: rowsRes.rows,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Error fetching sales logs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 9. STATIC ASSETS & SPA ROUTING (RENDER READY)
// ==============================================================================
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send(
      '<h1>The Prime Classes Backend API is Live</h1><p>Vite frontend is not built yet. Run <code>npm run build</code>.</p>'
    );
  });
}

// Start Server & Sync
async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`[Express] Server running on http://localhost:${PORT}`);
      // Launch background sync scheduler
      startBackgroundSync();
    });
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

startServer();
