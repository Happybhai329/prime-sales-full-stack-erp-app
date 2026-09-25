import { query, getDbMode } from './db.js';
import * as sheets from './googleSheets.js';
import {
  normalizeKey,
  findIndexByMatchers,
  getValueByHeaderName,
  parseNumber
} from './voucherGenerator.js';

let syncState = {
  status: 'idle', // 'idle' | 'syncing' | 'error' | 'success'
  lastSyncTime: null,
  lastError: null,
  stats: {
    admissions: 0,
    inquiries: 0,
    cancelled: 0,
    conversions: 0,
    conversionRate: 0
  }
};

let syncInterval = null;

// Conversion matching identifier normalizers matching code.gs
export function normalizeStudentId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeStudentName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractRecordIdentifiers(headers, values) {
  const identifiers = [];

  const studentId = normalizeStudentId(
    getValueByHeaderName(headers, values, 'Student ID', [
      { include: ['student', 'id'] },
      { include: ['student', 'code'] },
      { include: ['roll', 'number'] },
      { include: ['roll', 'no'] },
      { include: ['registration', 'number'] },
      { include: ['registration', 'no'] }
    ])
  );

  const mobile = normalizePhone(
    getValueByHeaderName(headers, values, 'Mobile', [
      { include: ['student', 'mobile'] },
      { include: ['student', 'phone'] },
      { include: ['parent', 'mobile'] },
      { include: ['parent', 'phone'] },
      { include: ['mobile'], exclude: ['parent', 'whatsapp', 'alternate'] },
      { include: ['phone'], exclude: ['parent', 'alternate'] },
      { include: ['whatsapp'] },
      { include: ['contact', 'number'] },
      { include: ['contact'] }
    ])
  );

  const name = normalizeStudentName(
    getValueByHeaderName(headers, values, 'Student Name', [
      { include: ['student', 'name'] },
      { include: ['name'], exclude: ['father', 'mother', 'parent'] }
    ])
  );

  if (studentId) identifiers.push(`id:${studentId}`);
  if (mobile) identifiers.push(`mobile:${mobile}`);
  if (name) identifiers.push(`name:${name}`);

  return [...new Set(identifiers)];
}

function parseFlexibleDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();

  let match = text.match(
    /^(\d{2})[\/.-](\d{2})[\/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (match) {
    let hours = Number(match[4] || 0);
    const minutes = Number(match[5] || 0);
    const seconds = Number(match[6] || 0);
    const meridiem = String(match[7] || '').toUpperCase();

    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;

    const d = new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      hours,
      minutes,
      seconds
    );
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

/**
 * High speed multi-row chunked batch ingestion into local database
 */
export async function triggerSync() {
  if (syncState.status === 'syncing') {
    return { success: false, message: 'Sync already in progress' };
  }

  syncState.status = 'syncing';
  console.log('[SyncEngine] Starting full inbound sync from Google Spreadsheets...');

  try {
    const startTime = Date.now();

    // Fetch all remote sheets in parallel
    const [admissionsData, inquiriesData, cancelledData, programsData, feesData] =
      await Promise.all([
        sheets.fetchRemoteAdmissions(),
        sheets.fetchRemoteInquiries(),
        sheets.fetchRemoteCancelled(),
        sheets.fetchRemotePrograms(),
        sheets.fetchRemoteFeeTypes()
      ]);

    console.log(
      `[SyncEngine] Fetched: ${admissionsData.rows.length} admissions, ${inquiriesData.rows.length} inquiries, ${cancelledData.rows.length} cancelled.`
    );

    // Save headers metadata
    await query(
      `INSERT INTO prime_sync_meta (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      ['admissions_headers', JSON.stringify(admissionsData.headers)]
    );
    await query(
      `INSERT INTO prime_sync_meta (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      ['inquiries_headers', JSON.stringify(inquiriesData.headers)]
    );
    await query(
      `INSERT INTO prime_sync_meta (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      ['cancelled_headers', JSON.stringify(cancelledData.headers)]
    );

    // Multi-row batch insert helper with onConflict support
    async function batchInsert(tableName, columns, rowsData, onConflict = '') {
      if (!rowsData || rowsData.length === 0) return;
      const chunkSize = Math.max(1, Math.floor(1000 / columns.length));
      for (let i = 0; i < rowsData.length; i += chunkSize) {
        const chunk = rowsData.slice(i, i + chunkSize);
        const valuePlaceholders = [];
        const params = [];
        chunk.forEach((row) => {
          const placeholders = row.map((val) => {
            params.push(val);
            return `$${params.length}`;
          });
          valuePlaceholders.push(`(${placeholders.join(', ')})`);
        });
        const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${valuePlaceholders.join(', ')} ${onConflict}`;
        await query(sql, params);
      }
    }

    // 1. Ingest Academic Programs (deduplicated)
    await query('DELETE FROM prime_academic_programs');
    const programSet = new Set();
    programsData.rows.forEach((r) => {
      const name = String(r.values[0] || '').trim();
      if (name) programSet.add(name);
    });
    const programRows = Array.from(programSet).map((name) => [name]);
    if (programRows.length > 0) {
      await batchInsert(
        'prime_academic_programs',
        ['program_name'],
        programRows,
        'ON CONFLICT (program_name) DO NOTHING'
      );
    }

    // 2. Ingest Fee Types (deduplicated)
    await query('DELETE FROM prime_fee_types');
    const feeMap = new Map();
    feesData.rows.forEach((r) => {
      const feeType = String(r.values[0] || '').trim();
      const amount = parseNumber(r.values[1]) || 0;
      if (feeType) feeMap.set(feeType, amount);
    });
    const feeRows = Array.from(feeMap.entries()).map(([k, v]) => [k, v]);
    if (feeRows.length > 0) {
      await batchInsert(
        'prime_fee_types',
        ['fee_type', 'amount'],
        feeRows,
        'ON CONFLICT (fee_type) DO UPDATE SET amount = EXCLUDED.amount'
      );
    }

    // 3. Ingest Inquiries in batches
    await query('DELETE FROM prime_inquiries');
    const inqHeaders = inquiriesData.headers;
    const inquiryInsertRows = inquiriesData.rows.map((row) => {
      const studentName = String(
        getValueByHeaderName(inqHeaders, row.values, 'Student Name', [
          { include: ['name'], exclude: ['father', 'mother'] }
        ]) || ''
      ).trim();
      const fatherName = String(
        getValueByHeaderName(inqHeaders, row.values, "Father's Name", [
          { include: ['father'] }
        ]) || ''
      ).trim();
      const mobile = normalizePhone(
        getValueByHeaderName(inqHeaders, row.values, 'Mobile', [
          { include: ['mobile'] },
          { include: ['phone'] },
          { include: ['contact'] }
        ])
      );
      const program = String(
        getValueByHeaderName(inqHeaders, row.values, 'Program', [
          { include: ['program'] },
          { include: ['course'] }
        ]) || ''
      ).trim();
      const inquiryDate = parseFlexibleDate(
        getValueByHeaderName(inqHeaders, row.values, 'Date', [
          { include: ['date'] },
          { include: ['timestamp'] }
        ])
      );

      return [
        row.rowNumber,
        studentName,
        fatherName,
        mobile,
        program,
        inquiryDate,
        JSON.stringify(row.values)
      ];
    });

    await batchInsert(
      'prime_inquiries',
      [
        'row_number',
        'student_name',
        'father_name',
        'mobile',
        'program',
        'inquiry_date',
        'raw_values'
      ],
      inquiryInsertRows
    );

    // 4. Ingest Admissions in batches
    await query('DELETE FROM prime_admissions');
    const admHeaders = admissionsData.headers;
    const admissionInsertRows = admissionsData.rows.map((row) => {
      const studentName = String(
        getValueByHeaderName(admHeaders, row.values, 'Student Name', [
          { include: ['student', 'name'] },
          { include: ['name'], exclude: ['father', 'mother', 'parent'] }
        ]) || ''
      ).trim();

      const fatherName = String(
        getValueByHeaderName(admHeaders, row.values, "Father's Name", [
          { include: ['father', 'name'] },
          { include: ['parent', 'name'] }
        ]) || ''
      ).trim();

      const program = String(
        getValueByHeaderName(admHeaders, row.values, 'Program', [
          { include: ['program'] },
          { include: ['course'] }
        ]) || ''
      ).trim();

      const admissionDate = parseFlexibleDate(
        getValueByHeaderName(admHeaders, row.values, 'Date of Application', [
          { include: ['date', 'of', 'application'] },
          { include: ['admission', 'date'] },
          { include: ['date'], exclude: ['cancel', 'due', 'payment', 'last'] }
        ])
      );

      const startSession = String(
        getValueByHeaderName(admHeaders, row.values, 'Start Session', [{ include: ['start', 'session'] }]) || ''
      ).trim();
      const endSession = String(
        getValueByHeaderName(admHeaders, row.values, 'End Session', [{ include: ['end', 'session'] }]) || ''
      ).trim();
      const mobile = normalizePhone(
        getValueByHeaderName(admHeaders, row.values, 'Mobile Numbers', [
          { include: ['mobile'] },
          { include: ['phone'] },
          { include: ['contact'] }
        ])
      );

      const regFee = parseNumber(getValueByHeaderName(admHeaders, row.values, 'Registration Fee', [{ include: ['registration', 'fee'] }])) || 0;
      const tuitionFee = parseNumber(getValueByHeaderName(admHeaders, row.values, 'Tuition Fee', [{ include: ['tuition', 'fee'] }])) || 0;
      const otherFeesJson = String(getValueByHeaderName(admHeaders, row.values, 'Other Fees (JSON)', [{ include: ['other', 'fees'] }]) || '');
      const totalAmount = parseNumber(getValueByHeaderName(admHeaders, row.values, 'Total Amount', [{ include: ['total', 'amount'] }])) || 0;
      const discountPercent = parseNumber(getValueByHeaderName(admHeaders, row.values, 'Discount (%)', [{ include: ['discount'] }])) || 0;
      const scholarship = parseNumber(getValueByHeaderName(admHeaders, row.values, 'Scholarship Amount', [{ include: ['scholarship'] }])) || 0;
      const gstPercent = parseNumber(getValueByHeaderName(admHeaders, row.values, 'GST (%)', [{ include: ['gst'] }])) || 0;
      const finalCost = parseNumber(getValueByHeaderName(admHeaders, row.values, 'Final Cost', [{ include: ['final', 'cost'] }])) || 0;
      const installmentDetailsJson = String(getValueByHeaderName(admHeaders, row.values, 'Installment Details (JSON)', [{ include: ['installment'] }]) || '');

      const voucherStatus = String(getValueByHeaderName(admHeaders, row.values, 'VoucherStatus', [{ include: ['voucherstatus'] }]) || 'Not Given').trim();
      const voucherPdfLink = String(getValueByHeaderName(admHeaders, row.values, 'VoucherPDFLink', [{ include: ['voucherpdflink'] }]) || '').trim();

      return [
        row.rowNumber,
        studentName,
        fatherName,
        program,
        admissionDate,
        startSession,
        endSession,
        mobile,
        regFee,
        tuitionFee,
        otherFeesJson,
        totalAmount,
        discountPercent,
        scholarship,
        gstPercent,
        finalCost,
        installmentDetailsJson,
        voucherStatus,
        voucherPdfLink,
        JSON.stringify(row.values)
      ];
    });

    await batchInsert(
      'prime_admissions',
      [
        'row_number',
        'student_name',
        'father_name',
        'program',
        'admission_date',
        'start_session',
        'end_session',
        'mobile',
        'registration_fee',
        'tuition_fee',
        'other_fees_json',
        'total_amount',
        'discount_percent',
        'scholarship_amount',
        'gst_percent',
        'final_cost',
        'installment_details_json',
        'voucher_status',
        'voucher_pdf_link',
        'raw_values'
      ],
      admissionInsertRows
    );

    // 5. Ingest Cancelled in batches
    await query('DELETE FROM prime_cancelled_admissions');
    const canHeaders = cancelledData.headers;
    const cancelledInsertRows = cancelledData.rows.map((row) => {
      const studentName = String(
        getValueByHeaderName(canHeaders, row.values, 'Student Name', [{ include: ['student', 'name'] }, { include: ['name'] }]) || ''
      ).trim();
      const fatherName = String(
        getValueByHeaderName(canHeaders, row.values, "Father's Name", [{ include: ['father'] }]) || ''
      ).trim();
      const program = String(
        getValueByHeaderName(canHeaders, row.values, 'Program', [{ include: ['program'] }]) || ''
      ).trim();
      const cancelDate = parseFlexibleDate(
        getValueByHeaderName(canHeaders, row.values, 'Cancellation Date', [{ include: ['cancel'] }, { include: ['date'] }])
      );

      return [
        row.rowNumber,
        studentName,
        fatherName,
        program,
        cancelDate,
        JSON.stringify(row.values)
      ];
    });

    await batchInsert(
      'prime_cancelled_admissions',
      [
        'row_number',
        'student_name',
        'father_name',
        'program',
        'cancel_date',
        'raw_values'
      ],
      cancelledInsertRows
    );

    // 6. Run Conversion Matching Algorithm
    const inquiryIdentitySet = new Set();
    inquiriesData.rows.forEach((row) => {
      extractRecordIdentifiers(inqHeaders, row.values).forEach((id) =>
        inquiryIdentitySet.add(id)
      );
    });

    const matchedAdmissionRows = admissionsData.rows.filter((row) => {
      const identifiers = extractRecordIdentifiers(admHeaders, row.values);
      return identifiers.length && identifiers.some((id) => inquiryIdentitySet.has(id));
    });

    const totalInquiries = inquiriesData.rows.length;
    const conversionRate = totalInquiries
      ? Number(((matchedAdmissionRows.length / totalInquiries) * 100).toFixed(2))
      : 0;

    const matchedRowNumbers = matchedAdmissionRows.map((r) => r.rowNumber);
    await query(
      `INSERT INTO prime_sync_meta (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      ['matched_conversions', JSON.stringify(matchedRowNumbers)]
    );

    const elapsedMs = Date.now() - startTime;
    console.log(
      `[SyncEngine] Inbound sync completed in ${elapsedMs}ms. Conversions: ${matchedAdmissionRows.length} (${conversionRate}%).`
    );

    syncState = {
      status: 'success',
      lastSyncTime: new Date().toISOString(),
      lastError: null,
      stats: {
        admissions: admissionsData.rows.length,
        inquiries: inquiriesData.rows.length,
        cancelled: cancelledData.rows.length,
        conversions: matchedAdmissionRows.length,
        conversionRate
      }
    };

    return { success: true, elapsedMs, stats: syncState.stats };
  } catch (err) {
    console.error('[SyncEngine] Sync error:', err);
    syncState.status = 'error';
    syncState.lastError = err.message;
    return { success: false, error: err.message };
  }
}

/**
 * Starts automatic 15-minute background sync
 */
export function startBackgroundSync() {
  if (syncInterval) clearInterval(syncInterval);
  // Initial sync immediately after boot
  setTimeout(() => {
    triggerSync().catch((err) => console.error('[SyncEngine] Boot sync error:', err.message));
  }, 1000);

  // Repeat every 15 minutes (15 * 60 * 1000 ms)
  syncInterval = setInterval(() => {
    console.log('[SyncEngine] Running scheduled 15-minute sync...');
    triggerSync().catch((err) => console.error('[SyncEngine] Scheduled sync error:', err.message));
  }, 15 * 60 * 1000);
}

export function getSyncStatus() {
  return syncState;
}
