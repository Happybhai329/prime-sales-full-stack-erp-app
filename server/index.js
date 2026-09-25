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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Helper to get cached headers from prime_sync_meta
async function getCachedHeaders(sheetKey) {
  try {
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
async function getMatchedConversionIds() {
  try {
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
// 1. DASHBOARD OVERVIEW & STATS
// ==============================================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const [admCountRes, inqCountRes, canCountRes, progRes, feeRes] =
      await Promise.all([
        query('SELECT COUNT(*) as count FROM prime_admissions'),
        query('SELECT COUNT(*) as count FROM prime_inquiries'),
        query('SELECT COUNT(*) as count FROM prime_cancelled_admissions'),
        query(
          'SELECT program_name FROM prime_academic_programs ORDER BY program_name ASC'
        ),
        query('SELECT fee_type, amount FROM prime_fee_types ORDER BY fee_type ASC')
      ]);

    const activeAdmissions = parseInt(admCountRes.rows[0]?.count || 0, 10);
    const inquiries = parseInt(inqCountRes.rows[0]?.count || 0, 10);
    const cancelled = parseInt(canCountRes.rows[0]?.count || 0, 10);

    const matchedIds = await getMatchedConversionIds();
    const conversionsCount = matchedIds.length;
    const conversionRate = inquiries
      ? Number(((conversionsCount / inquiries) * 100).toFixed(2))
      : 0;

    const programs = progRes.rows.map((r) => r.program_name);
    const feeTypes = feeRes.rows.map((r) => ({
      feeType: r.fee_type,
      amount: parseFloat(r.amount || 0)
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
// 2. FILTERED RECORDS (SUB-50ms FAST QUERY)
// ==============================================================================
app.get('/api/records', async (req, res) => {
  try {
    const tab = req.query.tab || 'admissions';
    const search = String(req.query.search || '').trim().toLowerCase();
    const program = String(req.query.program || 'all').trim();
    const timeFilter = String(req.query.timeFilter || 'all').trim();
    const fromDate = String(req.query.from || '').trim();
    const toDate = String(req.query.to || '').trim();

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

    const headers = await getCachedHeaders(headersKey);

    let sql = `SELECT * FROM ${tableName}`;
    const params = [];
    const whereClauses = [];

    // Conversions tab filter
    if (tab === 'conversions') {
      const matchedIds = await getMatchedConversionIds();
      if (matchedIds.length === 0) {
        return res.json({ headers, rows: [], totalCount: 0 });
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
            ? 'Enquiries'
            : tab === 'cancelled'
              ? 'Cancelled'
              : 'Admissions',
        timestamp: r[dateCol] ? new Date(r[dateCol]).getTime() : null,
        voucherStatus: r.voucher_status,
        voucherPdfLink: r.voucher_pdf_link
      };
    });

    res.json({
      headers,
      rows: formattedRows,
      totalCount: formattedRows.length
    });
  } catch (err) {
    console.error('Error in /api/records:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 3. UPDATE RECORD (INLINE EDIT & OUTBOX WRITE-BACK)
// ==============================================================================
app.put('/api/records/:tab/:rowNumber', async (req, res) => {
  try {
    const { tab, rowNumber } = req.params;
    const { values, ssId, sheetName } = req.body;
    const rowNum = parseInt(rowNumber, 10);

    if (!Array.isArray(values)) {
      return res.status(400).json({ success: false, error: 'values array required' });
    }

    const tableName =
      tab === 'inquiries'
        ? 'prime_inquiries'
        : tab === 'cancelled'
          ? 'prime_cancelled_admissions'
          : 'prime_admissions';

    // Update in local DB immediately for sub-30ms responsiveness
    await query(
      `UPDATE ${tableName} SET raw_values = $1 WHERE row_number = $2`,
      [JSON.stringify(values), rowNum]
    );

    // Queue / async write-back to Google Sheets
    sheets
      .updateRemoteRecord(ssId, sheetName, rowNum, values)
      .catch((err) =>
        console.error(
          `[Outbox] Error syncing update to sheet ${sheetName} row ${rowNum}:`,
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
// 4. CANCEL ADMISSION
// ==============================================================================
app.post('/api/admissions/:rowNumber/cancel', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNumber, 10);

    // 1. Get from admissions
    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1',
      [rowNum]
    );
    if (admRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admission record not found' });
    }

    const record = admRes.rows[0];

    // 2. Insert into cancelled
    await query(
      `INSERT INTO prime_cancelled_admissions (row_number, student_name, father_name, program, cancel_date, raw_values)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
       ON CONFLICT (row_number) DO NOTHING`,
      [
        record.row_number,
        record.student_name,
        record.father_name,
        record.program,
        JSON.stringify(record.raw_values)
      ]
    );

    // 3. Delete from active admissions
    await query('DELETE FROM prime_admissions WHERE row_number = $1', [rowNum]);

    // 4. Async sync with Google Sheets
    sheets
      .cancelRemoteAdmission(rowNum)
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
// 5. VOUCHER PREVIEW & GENERATION
// ==============================================================================
app.get('/api/admissions/:rowNumber/voucher-preview', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNumber, 10);
    const headers = await getCachedHeaders('admissions');

    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1',
      [rowNum]
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
    const headers = await getCachedHeaders('admissions');

    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1',
      [rowNum]
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
      pdfUrl = `/api/admissions/${rowNum}/voucher-download`;
    }

    // Update DB
    await query(
      `UPDATE prime_admissions SET voucher_status = 'Given', voucher_pdf_link = $1 WHERE row_number = $2`,
      [pdfUrl, rowNum]
    );

    // Async write-back to Google Sheets
    sheets
      .updateRemoteVoucherStatus(rowNum, 'Given', pdfUrl)
      .catch((err) =>
        console.error(
          `[Outbox] Error updating voucher status on sheet row ${rowNum}:`,
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
    const headers = await getCachedHeaders('admissions');

    const admRes = await query(
      'SELECT * FROM prime_admissions WHERE row_number = $1',
      [rowNum]
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
    const { status } = req.body;
    const normalizedStatus =
      String(status).toLowerCase() === 'given' ? 'Given' : 'Not Given';

    const admRes = await query(
      'SELECT voucher_pdf_link FROM prime_admissions WHERE row_number = $1',
      [rowNum]
    );
    const pdfUrl = admRes.rows[0]?.voucher_pdf_link || '';

    await query(
      'UPDATE prime_admissions SET voucher_status = $1 WHERE row_number = $2',
      [normalizedStatus, rowNum]
    );

    // Async write-back to Google Sheets
    sheets
      .updateRemoteVoucherStatus(rowNum, normalizedStatus, pdfUrl)
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

    const headers = await getCachedHeaders(headersKey);
    const dbRes = await query(
      `SELECT * FROM ${tableName} WHERE row_number = $1`,
      [rowNum]
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

// Delete individual record row
app.delete('/api/records/:tab/:rowNumber', async (req, res) => {
  try {
    const { tab, rowNumber } = req.params;
    const { ssId, sheetName } = req.body;
    const rowNum = parseInt(rowNumber, 10);

    const tableName =
      tab === 'inquiries'
        ? 'prime_inquiries'
        : tab === 'cancelled'
          ? 'prime_cancelled_admissions'
          : 'prime_admissions';

    await query(`DELETE FROM ${tableName} WHERE row_number = $1`, [rowNum]);

    sheets
      .deleteRemoteRecord(ssId, sheetName, rowNum)
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
    let feeTypes = dbRes.rows.map((r) => ({
      feeType: r.fee_type,
      amount: parseFloat(r.amount || 0)
    }));
    res.json({ success: true, data: feeTypes });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// Public Enquiries list (for Admission Form "Fetch from Enquiry" modal)
app.get('/api/public/enquiries', async (req, res) => {
  try {
    const dbRes = await query('SELECT row_number, student_name, father_name, mobile, program, raw_values FROM prime_inquiries ORDER BY row_number DESC LIMIT 600');
    const headers = await getCachedHeaders('inquiries');
    
    const records = dbRes.rows.map((row) => {
      const vals = row.raw_values || [];
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
    res.json({ success: true, data: records });
  } catch (err) {
    console.error('Error in /api/public/enquiries:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Submit Enquiry Form
app.post('/api/enquiry-form/submit', async (req, res) => {
  try {
    const data = req.body || {};
    const name = String(data.name || '').trim();
    const studentClass = String(data.studentClass || '').trim();
    const fatherNo = String(data.fatherNo || '').trim();

    if (!name || !studentClass || !fatherNo) {
      return res.status(400).json({
        status: 'error',
        message: 'Name, Class, and Father\'s Number are mandatory.'
      });
    }

    const countRes = await query('SELECT COALESCE(MAX(row_number), 0) + 1 AS next_row FROM prime_inquiries');
    const nextRow = parseInt(countRes.rows[0]?.next_row || 1, 10);
    const nowIso = new Date().toISOString();

    const headers = await getCachedHeaders('inquiries');
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
      `INSERT INTO prime_inquiries (row_number, student_name, father_name, mobile, program, inquiry_date, raw_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        nextRow,
        name,
        data.fatherName || '',
        fatherNo,
        studentClass,
        new Date(),
        JSON.stringify(rowValues)
      ]
    );

    // Append to remote Google Sheets asynchronously
    sheets.appendEnquiry(rowValues).catch((err) => {
      console.error('[GoogleSheets] Append enquiry error:', err.message);
    });

    res.json({
      status: 'success',
      sno: nextRow,
      message: `Enquiry Registered Successfully! Allocated S.No: ${nextRow}`
    });
  } catch (err) {
    console.error('Error submitting enquiry form:', err);
    res.status(500).json({ status: 'error', message: 'Database save failed: ' + err.message });
  }
});

// Submit Admission Form
app.post('/api/admission-form/submit', async (req, res) => {
  try {
    const { formData, filesData } = req.body || {};
    if (!formData) {
      return res.status(400).json({ status: 'error', message: 'Missing form data.' });
    }

    const studentName = String(formData.studentName || '').trim();
    const fatherName = String(formData.fatherName || '').trim();
    const studentClass = String(formData.class || '').trim();

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

    // Find highest sequence for prefix
    const countRes = await query('SELECT COALESCE(MAX(row_number), 0) + 1 AS next_row FROM prime_admissions');
    const nextRow = parseInt(countRes.rows[0]?.next_row || 1, 10);
    const candidateId = `${prefix}${String(nextRow).padStart(4, '0')}`;

    const headers = await getCachedHeaders('admissions');
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
      'Student Name': studentName,
      "Father's Name": fatherName,
      'DOB': formData.dob || '',
      'Mobile Numbers': mobileNumbersStr,
      'Email': parentEmail,
      'Parent Email': parentEmail,
      "Mother's Name": formData.motherName || '',
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
      'VoucherPDFLink': ''
    };

    const rowValues = admissionHeaders.map((h) => valuesByHeader[h] != null ? valuesByHeader[h] : '');

    // Insert locally into database immediately
    await query(
      `INSERT INTO prime_admissions (
        row_number, student_name, father_name, program, admission_date,
        start_session, end_session, mobile, registration_fee, tuition_fee,
        other_fees_json, total_amount, discount_percent, scholarship_amount,
        gst_percent, final_cost, installment_details_json, voucher_status,
        voucher_pdf_link, raw_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
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

    // Append to remote Google Sheets asynchronously
    sheets.appendAdmission(rowValues).catch((err) => {
      console.error('[GoogleSheets] Append admission error:', err.message);
    });

    res.json({
      status: 'success',
      success: true,
      studentId: candidateId,
      pdfUrl: `/api/admission-form/pdf/${candidateId}`,
      message: `Admission Submitted Successfully! Student ID: ${candidateId}`
    });
  } catch (err) {
    console.error('Error submitting admission form:', err);
    res.status(500).json({ status: 'error', message: 'Admission save failed: ' + err.message });
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
    const voucherData = buildVoucherData(headers, admRes.rows[0].raw_values, admRes.rows[0].row_number);
    const pdfBuffer = await generateRecordPdfBuffer(voucherData);

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
