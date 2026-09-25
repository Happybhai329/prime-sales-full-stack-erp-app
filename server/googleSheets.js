import { google } from 'googleapis';
import stream from 'stream';
import dotenv from 'dotenv';

dotenv.config();

const ADMISSION_SS_ID = process.env.ADMISSION_DB_ID || '1StEreMtS9_mbt4Np-T0J4WK5ILwDqyxmtqwxw8ZebOA';
const INQUIRY_SS_ID = process.env.INQUIRY_DB_ID || '1Ddk1iVPuvYJehDIh3HRIIqqdc2QwJiGoq0LLmp4R_7c';
const VOUCHER_FOLDER_ID = process.env.VOUCHER_FOLDER_ID || '1kfTAPzMOi8wM8o4AmgUrbQm8AqTAH7cN';
const VOUCHER_LOGO_DRIVE_FILE_ID = process.env.VOUCHER_LOGO_DRIVE_FILE_ID || '1esJQL-6fNQRAHdd9NWQB0lgTP7xyTx3r';

const ADMISSIONS_SHEET_NAME = 'Admissions';
const CANCELLED_SHEET_NAME = 'Cancelled';
const INQUIRY_SHEET_NAME = 'Enquiries';
const PROGRAM_SHEET_NAME = 'academic_program';
const FEES_SHEET_NAME = 'feestype';

const VOUCHER_STATUS_HEADER = 'VoucherStatus';
const VOUCHER_PDF_LINK_HEADER = 'VoucherPDFLink';

function getPrivateKey() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  return rawKey.replace(/\\n/g, '\n');
}

let authClient = null;
let sheetsApi = null;
let driveApi = null;

export function getGoogleClients() {
  if (sheetsApi && driveApi) {
    return { sheets: sheetsApi, drive: driveApi };
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = getPrivateKey();

  if (!clientEmail || !privateKey) {
    throw new Error('Google Service Account credentials missing in environment variables.');
  }

  authClient = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });

  sheetsApi = google.sheets({ version: 'v4', auth: authClient });
  driveApi = google.drive({ version: 'v3', auth: authClient });

  return { sheets: sheetsApi, drive: driveApi };
}

/**
 * Fetches raw values from a specified sheet in a spreadsheet
 */
async function getSheetValues(spreadsheetId, sheetName) {
  const { sheets } = getGoogleClients();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:ZZ`
    });

    const rows = res.data.values || [];
    if (rows.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = (rows[0] || []).map((h) => String(h || '').trim());
    const dataRows = rows.slice(1).map((row, idx) => ({
      rowNumber: idx + 2,
      values: headers.map((_, colIdx) => (row[colIdx] != null ? String(row[colIdx]) : '')),
      ssId: spreadsheetId,
      sheetName
    }));

    return { headers, rows: dataRows };
  } catch (err) {
    // If sheet doesn't exist, handle gracefully
    console.warn(`[GoogleSheets] Warning fetching ${sheetName} from ${spreadsheetId}:`, err.message);
    return { headers: [], rows: [] };
  }
}

/**
 * Ensures VoucherStatus and VoucherPDFLink columns exist in the Admissions sheet
 */
export async function ensureVoucherColumns() {
  const { sheets } = getGoogleClients();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: ADMISSION_SS_ID,
      range: `${ADMISSIONS_SHEET_NAME}!1:1`
    });

    const headers = (res.data.values && res.data.values[0]) || [];
    let modified = false;

    if (!headers.includes(VOUCHER_STATUS_HEADER)) {
      headers.push(VOUCHER_STATUS_HEADER);
      modified = true;
    }
    if (!headers.includes(VOUCHER_PDF_LINK_HEADER)) {
      headers.push(VOUCHER_PDF_LINK_HEADER);
      modified = true;
    }

    if (modified) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: ADMISSION_SS_ID,
        range: `${ADMISSIONS_SHEET_NAME}!1:1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [headers] }
      });
      console.log('[GoogleSheets] Ensured Voucher columns in Admissions sheet.');
    }
    return headers;
  } catch (err) {
    console.error('[GoogleSheets] ensureVoucherColumns error:', err.message);
    return [];
  }
}

export async function fetchRemoteAdmissions() {
  await ensureVoucherColumns();
  return getSheetValues(ADMISSION_SS_ID, ADMISSIONS_SHEET_NAME);
}

export async function fetchRemoteInquiries() {
  return getSheetValues(INQUIRY_SS_ID, INQUIRY_SHEET_NAME);
}

export async function fetchRemoteCancelled() {
  return getSheetValues(ADMISSION_SS_ID, CANCELLED_SHEET_NAME);
}

export async function fetchRemotePrograms() {
  return getSheetValues(ADMISSION_SS_ID, PROGRAM_SHEET_NAME);
}

export async function fetchRemoteFeeTypes() {
  return getSheetValues(ADMISSION_SS_ID, FEES_SHEET_NAME);
}

/**
 * Updates an entire row in Google Sheets
 */
export async function updateRemoteRecord(ssId, sheetName, rowNumber, values) {
  const { sheets } = getGoogleClients();
  const range = `${sheetName}!A${rowNumber}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: ssId || ADMISSION_SS_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values]
    }
  });

  return { success: true };
}

/**
 * Atomically cancels an admission in Google Sheets:
 * Appends row to Cancelled sheet, then deletes the row from Admissions.
 */
export async function cancelRemoteAdmission(rowNumber) {
  const { sheets } = getGoogleClients();

  // 1. Get row from Admissions
  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMISSION_SS_ID,
    range: `${ADMISSIONS_SHEET_NAME}!A${rowNumber}:ZZ${rowNumber}`
  });

  const rowValues = (getRes.data.values && getRes.data.values[0]) || [];
  if (rowValues.length === 0) {
    throw new Error(`Row ${rowNumber} not found in ${ADMISSIONS_SHEET_NAME}`);
  }

  // 2. Append row to Cancelled sheet
  await sheets.spreadsheets.values.append({
    spreadsheetId: ADMISSION_SS_ID,
    range: `${CANCELLED_SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowValues]
    }
  });

  // 3. Find sheetId for Admissions sheet to delete dimension
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: ADMISSION_SS_ID
  });
  const admSheet = meta.data.sheets.find(
    (s) => s.properties.title === ADMISSIONS_SHEET_NAME
  );

  if (!admSheet) {
    throw new Error('Admissions sheet not found metadata.');
  }

  const sheetId = admSheet.properties.sheetId;

  // 4. Delete the row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ADMISSION_SS_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }
      ]
    }
  });

  return { success: true };
}

/**
 * Updates VoucherStatus and VoucherPDFLink in Admissions sheet
 */
export async function updateRemoteVoucherStatus(rowNumber, status, pdfUrl) {
  const { sheets } = getGoogleClients();

  // Find column indexes
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMISSION_SS_ID,
    range: `${ADMISSIONS_SHEET_NAME}!1:1`
  });

  const headers = (headerRes.data.values && headerRes.data.values[0]) || [];
  const statusIdx = headers.indexOf(VOUCHER_STATUS_HEADER);
  const pdfIdx = headers.indexOf(VOUCHER_PDF_LINK_HEADER);

  if (statusIdx === -1 || pdfIdx === -1) {
    await ensureVoucherColumns();
  }

  const updates = [];
  if (statusIdx !== -1) {
    const colLetter = String.fromCharCode(65 + statusIdx);
    updates.push({
      range: `${ADMISSIONS_SHEET_NAME}!${colLetter}${rowNumber}`,
      values: [[status]]
    });
  }

  if (pdfIdx !== -1 && pdfUrl != null) {
    const colLetter = String.fromCharCode(65 + pdfIdx);
    updates.push({
      range: `${ADMISSIONS_SHEET_NAME}!${colLetter}${rowNumber}`,
      values: [[pdfUrl]]
    });
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ADMISSION_SS_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    });
  }

  return { success: true };
}

/**
 * Adds an item to academic_program or feestype
 */
export async function addRemoteSetupItem(sheetName, values) {
  const { sheets } = getGoogleClients();

  await sheets.spreadsheets.values.append({
    spreadsheetId: ADMISSION_SS_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [values]
    }
  });

  return { success: true };
}

/**
 * Deletes a row from academic_program or feestype
 */
export async function deleteRemoteSetupItem(sheetName, rowNumber) {
  const { sheets } = getGoogleClients();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: ADMISSION_SS_ID
  });
  const targetSheet = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );

  if (!targetSheet) {
    throw new Error(`Sheet ${sheetName} not found.`);
  }

  const sheetId = targetSheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ADMISSION_SS_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }
      ]
    }
  });

  return { success: true };
}

/**
 * Permanently deletes a record row from any sheet
 */
export async function deleteRemoteRecord(ssId, sheetName, rowNumber) {
  const { sheets } = getGoogleClients();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: ssId || ADMISSION_SS_ID
  });
  const targetSheet = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );

  if (!targetSheet) {
    throw new Error(`Sheet ${sheetName} not found.`);
  }

  const sheetId = targetSheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ssId || ADMISSION_SS_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }
      ]
    }
  });

  return { success: true };
}

/**
 * Uploads a generated voucher PDF to Google Drive in VOUCHER_FOLDER_ID
 */
export async function uploadVoucherPdf(fileName, pdfBuffer) {
  const { drive } = getGoogleClients();

  const bufferStream = new stream.PassThrough();
  bufferStream.end(pdfBuffer);

  const fileMetadata = {
    name: fileName,
    parents: [VOUCHER_FOLDER_ID]
  };

  const media = {
    mimeType: 'application/pdf',
    body: bufferStream
  };

  const file = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink, webContentLink'
  });

  // Share file with anyone with link so it's directly accessible
  try {
    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
  } catch (permErr) {
    console.warn('[GoogleDrive] Could not set public permission on voucher file:', permErr.message);
  }

  const pdfUrl = file.data.webViewLink || `https://drive.google.com/file/d/${file.data.id}/view`;
  return { id: file.data.id, pdfUrl };
}

/**
 * Appends a new enquiry row to Google Sheets 'Enquiries'
 */
export async function appendEnquiry(rowValues) {
  const { sheets } = getGoogleClients();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: INQUIRY_SS_ID,
    range: `${INQUIRY_SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowValues]
    }
  });
  return res.data;
}

/**
 * Appends a new admission row to Google Sheets 'Admissions'
 */
export async function appendAdmission(rowValues) {
  const { sheets } = getGoogleClients();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: ADMISSION_SS_ID,
    range: `${ADMISSIONS_SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowValues]
    }
  });
  return res.data;
}

