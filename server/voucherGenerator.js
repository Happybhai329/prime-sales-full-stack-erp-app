import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGO_PATH = path.join(__dirname, 'assets', 'tpc-logo.png');
const FALLBACK_LOGO_PATH = path.join(__dirname, 'assets', 'tpc-logo.jpg');

export function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseNumber(value) {
  const cleaned = String(value == null ? '' : value)
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '')
    .trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundVoucherCurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function formatVoucherCurrency(value) {
  const rounded = roundVoucherCurrency(value);
  const isInteger = Math.abs(rounded % 1) < 1e-9;
  try {
    return `\u20B9${rounded.toLocaleString('en-IN', {
      minimumFractionDigits: isInteger ? 0 : 2,
      maximumFractionDigits: 2
    })}`;
  } catch (error) {
    return `\u20B9${isInteger ? rounded.toFixed(0) : rounded.toFixed(2)}`;
  }
}

export function formatVoucherPercent(value) {
  const rounded = roundVoucherCurrency(value || 0);
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}%`;
}

export function formatVoucherDate(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  match = text.match(/^(\d{2})[-.](\d{2})[-.](\d{4})$/);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return text;
}

export function findIndexByMatchers(headers, matchers) {
  const normalizedHeaders = headers.map(normalizeKey);
  for (let i = 0; i < matchers.length; i++) {
    const include = (matchers[i].include || []).map(normalizeKey).filter(Boolean);
    const exclude = (matchers[i].exclude || []).map(normalizeKey).filter(Boolean);
    const idx = normalizedHeaders.findIndex((header) =>
      include.every((token) => header.indexOf(token) !== -1) &&
      exclude.every((token) => header.indexOf(token) === -1)
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

export function getValueByHeaderName(headers, values, headerName, matchers) {
  const normalizedHeaderName = normalizeKey(headerName);
  const exactIndex = headers.findIndex((h) => normalizeKey(h) === normalizedHeaderName);
  if (exactIndex !== -1) return values[exactIndex];
  if (matchers && matchers.length) {
    const idx = findIndexByMatchers(headers, matchers);
    return idx === -1 ? '' : values[idx];
  }
  return '';
}

export function findObjectValue(obj, matchers) {
  if (!obj || typeof obj !== 'object') return '';
  const keys = Object.keys(obj);
  const idx = findIndexByMatchers(keys, matchers);
  return idx === -1 ? '' : obj[keys[idx]];
}

function parseJsonSafely(rawValue) {
  const text = String(rawValue == null ? '' : rawValue).trim();
  if (!text) return { ok: true, value: null, text };
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch (error) {
    return { ok: false, value: null, text, error: error.message };
  }
}

function extractJsonItems(parsedValue, preferredArrayKeys) {
  if (Array.isArray(parsedValue)) return parsedValue;
  if (parsedValue && typeof parsedValue === 'object') {
    for (let i = 0; i < preferredArrayKeys.length; i++) {
      const key = preferredArrayKeys[i];
      if (Array.isArray(parsedValue[key])) return parsedValue[key];
    }
    return [parsedValue];
  }
  const amount = parseNumber(parsedValue);
  return amount == null ? [] : [{ amount }];
}

export function parseOtherFeesForVoucher(rawValue) {
  const parsed = parseJsonSafely(rawValue);
  if (!parsed.ok) {
    return { items: [], total: 0, valid: false, rawText: parsed.text };
  }

  const items = extractJsonItems(parsed.value, ['otherFees', 'fees', 'items'])
    .map((item, index) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const amount = roundVoucherCurrency(
          parseNumber(
            findObjectValue(item, [
              { include: ['amount'] },
              { include: ['fee', 'amount'] },
              { include: ['price'] },
              { include: ['value'] },
              { include: ['cost'] },
              { include: ['total'], exclude: ['discount', 'gst', 'tax'] }
            ])
          ) || 0
        );
        const label =
          String(
            findObjectValue(item, [
              { include: ['fee', 'type'] },
              { include: ['type'] },
              { include: ['fee'], exclude: ['amount', 'price', 'value', 'cost', 'total'] },
              { include: ['name'] },
              { include: ['label'] },
              { include: ['description'] }
            ]) || ''
          ).trim() || `Other Fee ${index + 1}`;

        return {
          label,
          amount,
          amountDisplay: formatVoucherCurrency(amount)
        };
      }

      const amount = roundVoucherCurrency(parseNumber(item) || 0);
      return {
        label: `Other Fee ${index + 1}`,
        amount,
        amountDisplay: formatVoucherCurrency(amount)
      };
    })
    .filter((item) => item.label || item.amount);

  return {
    items,
    total: roundVoucherCurrency(items.reduce((sum, item) => sum + item.amount, 0)),
    valid: true,
    rawText: parsed.text
  };
}

export function parseInstallmentsForVoucher(rawValue) {
  const parsed = parseJsonSafely(rawValue);
  if (!parsed.ok) return [];

  return extractJsonItems(parsed.value, ['installments', 'items'])
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const amountValue = parseNumber(
        findObjectValue(item, [
          { include: ['amount'] },
          { include: ['installment', 'amount'] },
          { include: ['fee'], exclude: ['type'] },
          { include: ['value'] }
        ])
      );
      const amount = roundVoucherCurrency(amountValue || 0);

      return {
        date: formatVoucherDate(
          findObjectValue(item, [
            { include: ['due', 'date'] },
            { include: ['date'], exclude: ['actual', 'payment', 'paid'] },
            { include: ['installment', 'date'] }
          ])
        ),
        amount,
        amountDisplay: amountValue == null ? '' : formatVoucherCurrency(amount)
      };
    })
    .filter((item) => item.date || item.amountDisplay);
}

/**
 * Builds standard financial and profile voucher data
 */
export function buildVoucherData(headers, values) {
  const studentName = String(
    getValueByHeaderName(headers, values, 'Student Name', [
      { include: ['student', 'name'] },
      { include: ['name'], exclude: ['father', 'mother', 'parent'] }
    ]) || ''
  ).trim();

  const fatherName = String(
    getValueByHeaderName(headers, values, "Father's Name", [
      { include: ['father', 'name'] },
      { include: ['parent', 'name'] }
    ]) || ''
  ).trim();

  const program = String(
    getValueByHeaderName(headers, values, 'Program', [
      { include: ['program'] },
      { include: ['course'] }
    ]) || ''
  ).trim();

  const startSession = String(
    getValueByHeaderName(headers, values, 'Start Session', [
      { include: ['start', 'session'] }
    ]) || ''
  ).trim();

  const endSession = String(
    getValueByHeaderName(headers, values, 'End Session', [
      { include: ['end', 'session'] }
    ]) || ''
  ).trim();

  const mobileNumber = String(
    getValueByHeaderName(headers, values, 'Mobile Numbers', [
      { include: ['mobile'] },
      { include: ['phone'] },
      { include: ['contact', 'number'] }
    ]) || ''
  ).trim();

  const admissionDate = formatVoucherDate(
    getValueByHeaderName(headers, values, 'Date of Application', [
      { include: ['date', 'of', 'application'] },
      { include: ['admission', 'date'] },
      { include: ['date'], exclude: ['due', 'payment', 'dob'] }
    ])
  );

  const registrationFee = roundVoucherCurrency(
    parseNumber(
      getValueByHeaderName(headers, values, 'Registration Fee', [
        { include: ['registration', 'fee'] }
      ])
    ) || 0
  );

  const tuitionFee = roundVoucherCurrency(
    parseNumber(
      getValueByHeaderName(headers, values, 'Tuition Fee', [
        { include: ['tuition', 'fee'] }
      ])
    ) || 0
  );

  const otherFees = parseOtherFeesForVoucher(
    getValueByHeaderName(headers, values, 'Other Fees (JSON)', [
      { include: ['other', 'fees'] },
      { include: ['other', 'fee'] }
    ])
  );

  const totalAmountFromSheet = parseNumber(
    getValueByHeaderName(headers, values, 'Total Amount', [
      { include: ['total', 'amount'] },
      { include: ['total'], exclude: ['discount', 'gst', 'final'] }
    ])
  );

  const totalAmount = roundVoucherCurrency(
    totalAmountFromSheet != null
      ? totalAmountFromSheet
      : registrationFee + tuitionFee + otherFees.total
  );

  const discountPercent = roundVoucherCurrency(
    parseNumber(
      getValueByHeaderName(headers, values, 'Discount (%)', [
        { include: ['discount'] }
      ])
    ) || 0
  );

  const discountAmount = roundVoucherCurrency((totalAmount * discountPercent) / 100);

  const scholarshipAmount = roundVoucherCurrency(
    parseNumber(
      getValueByHeaderName(headers, values, 'Scholarship Amount', [
        { include: ['scholarship', 'amount'] },
        { include: ['scholarship'] }
      ])
    ) || 0
  );

  const amountAfterDiscount = roundVoucherCurrency(
    Math.max(totalAmount - discountAmount, 0)
  );

  const amountAfterScholarship = roundVoucherCurrency(
    Math.max(amountAfterDiscount - scholarshipAmount, 0)
  );

  const gstPercent = roundVoucherCurrency(
    parseNumber(
      getValueByHeaderName(headers, values, 'GST (%)', [
        { include: ['gst'] }
      ])
    ) || 0
  );

  let gstAmount = roundVoucherCurrency((amountAfterScholarship * gstPercent) / 100);

  const finalCostFromSheet = parseNumber(
    getValueByHeaderName(headers, values, 'Final Cost', [
      { include: ['final', 'cost'] },
      { include: ['final', 'amount'] },
      { include: ['payable'] }
    ])
  );

  if (finalCostFromSheet != null && gstPercent === 0) {
    gstAmount = roundVoucherCurrency(
      Math.max(finalCostFromSheet - amountAfterScholarship, 0)
    );
  }

  const calculatedFinalPayable = roundVoucherCurrency(amountAfterScholarship + gstAmount);
  const finalPayable = roundVoucherCurrency(
    finalCostFromSheet != null ? finalCostFromSheet : calculatedFinalPayable
  );

  const session = [startSession, endSession].filter(Boolean).join(' - ');

  const installments = parseInstallmentsForVoucher(
    getValueByHeaderName(headers, values, 'Installment Details (JSON)', [
      { include: ['installment', 'details'] },
      { include: ['installment'] }
    ])
  );

  return {
    studentName,
    fatherName,
    program,
    courseName: program,
    admissionDate,
    session,
    startSession,
    endSession,
    mobileNumber,
    parentMobileNumber: mobileNumber,
    registrationFee,
    tuitionFee,
    otherFees: otherFees.total,
    otherFeesBreakdown: otherFees.items,
    otherFeesJsonValid: otherFees.valid,
    totalAmount,
    totalAmountSource: totalAmountFromSheet != null ? 'sheet' : 'calculated',
    discountPercent,
    discountAmount,
    scholarshipAmount,
    amountAfterDiscount,
    amountAfterScholarship,
    gstPercent,
    gstAmount,
    finalPayable,
    finalCost: finalPayable,
    finalCostSource: finalCostFromSheet != null ? 'sheet' : 'calculated',
    installments,
    totalFee: totalAmount,
    discount: discountAmount,
    feesAfterDiscount: amountAfterDiscount,
    display: {
      registrationFee: formatVoucherCurrency(registrationFee),
      tuitionFee: formatVoucherCurrency(tuitionFee),
      otherFees: formatVoucherCurrency(otherFees.total),
      totalAmount: formatVoucherCurrency(totalAmount),
      discountAmount: formatVoucherCurrency(discountAmount),
      discountPercent: formatVoucherPercent(discountPercent),
      scholarshipAmount: formatVoucherCurrency(scholarshipAmount),
      gstAmount: formatVoucherCurrency(gstAmount),
      gstPercent: formatVoucherPercent(gstPercent),
      finalPayable: formatVoucherCurrency(finalPayable)
    }
  };
}

export function buildVoucherFileName(data) {
  const student = String(data.studentName || 'Student').trim().toUpperCase();
  const father = String(data.fatherName || '').trim().toUpperCase();
  const uniqueSuffix = data.admissionDate
    ? ` ${String(data.admissionDate).replace(/\//g, '-')}`
    : data.parentMobileNumber
      ? ` ${String(data.parentMobileNumber).trim()}`
      : '';
  const baseName = father
    ? `${student} S.O ${father}${uniqueSuffix} voucher.pdf`
    : `${student}${uniqueSuffix} voucher.pdf`;
  return baseName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Generates institutional A4 Fee Voucher PDF as a Buffer using PDFKit
 */
export async function generateVoucherPdfBuffer(voucherData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const purpleColor = '#5b21b6';
    const greenColor = '#16a34a';
    const darkColor = '#0f172a';
    const grayText = '#475569';
    const blueHeader = '#ede9fe';
    const yellowHeader = '#fef3c7';
    const borderColor = '#cbd5e1';

    const pageWidth = 595.28;
    const margin = 36;
    const contentWidth = pageWidth - margin * 2; // ~523pt

    // --- 1. PRESTIGIOUS INSTITUTIONAL HEADER ---
    let logoPath = fs.existsSync(LOGO_PATH) ? LOGO_PATH : fs.existsSync(FALLBACK_LOGO_PATH) ? FALLBACK_LOGO_PATH : null;
    let logoDrawn = false;

    if (logoPath) {
      try {
        doc.image(logoPath, margin, margin, { width: 68, height: 68 });
        logoDrawn = true;
      } catch (e) {
        console.warn('Failed to embed logo in PDFKit:', e.message);
      }
    }

    const titleLeft = logoDrawn ? margin + 80 : margin;

    doc
      .fontSize(22)
      .fillColor(purpleColor)
      .font('Helvetica-Bold')
      .text('THE PRIME CLASSES', titleLeft, margin + 2);

    doc
      .fontSize(9.5)
      .fillColor(greenColor)
      .font('Helvetica-Bold')
      .text('RIMC  |  RMS  |  SAINIK SCHOOL  |  FOUNDATION ACADEMY', titleLeft, margin + 28);

    doc
      .fontSize(10.5)
      .fillColor(darkColor)
      .font('Helvetica-Bold')
      .text('OFFICIAL ADMISSION & FEE RECEIPT VOUCHER', titleLeft, margin + 44);

    doc
      .fontSize(8)
      .fillColor(grayText)
      .font('Helvetica')
      .text("Premier Defense & Academic Preparation Institute  *  Let's Think, Let's Learn", titleLeft, margin + 58);

    // Decorative double stripe separator
    doc.moveTo(margin, margin + 74).lineTo(pageWidth - margin, margin + 74).strokeColor(purpleColor).lineWidth(2).stroke();
    doc.moveTo(margin, margin + 77).lineTo(pageWidth - margin, margin + 77).strokeColor(greenColor).lineWidth(1).stroke();

    let curY = margin + 88;

    // Helper table drawing functions
    function drawSectionHeader(title, bgColor, textColor = '#1e1b4b') {
      doc.rect(margin, curY, contentWidth, 20).fillColor(bgColor).fill();
      doc.rect(margin, curY, contentWidth, 20).strokeColor(borderColor).lineWidth(0.5).stroke();
      doc
        .fontSize(10)
        .fillColor(textColor)
        .font('Helvetica-Bold')
        .text(title, margin + 8, curY + 5);
      curY += 20;
    }

    function drawTableRow(label, value, isBold = false, customBg = null, isFinal = false) {
      const rowHeight = 19;
      if (customBg) {
        doc.rect(margin, curY, contentWidth, rowHeight).fillColor(customBg).fill();
      }

      // Cell borders
      doc.rect(margin, curY, contentWidth, rowHeight).strokeColor(borderColor).lineWidth(0.5).stroke();
      doc.moveTo(margin + contentWidth * 0.42, curY).lineTo(margin + contentWidth * 0.42, curY + rowHeight).stroke();

      doc
        .fontSize(9)
        .fillColor(isFinal ? '#854d0e' : grayText)
        .font(isBold || isFinal ? 'Helvetica-Bold' : 'Helvetica')
        .text(label, margin + 8, curY + 4.5);

      doc
        .fontSize(9)
        .fillColor(isFinal ? '#854d0e' : darkColor)
        .font(isBold || isFinal ? 'Helvetica-Bold' : 'Helvetica')
        .text(String(value || '-'), margin + contentWidth * 0.42 + 8, curY + 4.5, {
          width: contentWidth * 0.56 - 16,
          align: 'left'
        });

      curY += rowHeight;
    }

    // --- 2. CANDIDATE & ENROLLMENT PARTICULARS ---
    drawSectionHeader('1. CANDIDATE & ADMISSION INFORMATION', blueHeader, purpleColor);
    drawTableRow('STUDENT NAME', (voucherData.studentName || '-').toUpperCase(), true);
    drawTableRow("FATHER'S NAME", (voucherData.fatherName || '-').toUpperCase(), true);
    drawTableRow('ACADEMIC PROGRAM / WING', (voucherData.program || '-').toUpperCase(), false);
    drawTableRow('DATE OF ADMISSION', voucherData.admissionDate || '-', false);
    if (voucherData.session) {
      drawTableRow('ENROLLMENT SESSION', voucherData.session, false);
    }
    if (voucherData.mobileNumber) {
      drawTableRow('REGISTERED CONTACT NUMBER', voucherData.mobileNumber, false);
    }

    curY += 10;

    // --- 3. ITEMISED FEE STRUCTURE & DEDUCTIONS ---
    drawSectionHeader('2. INSTITUTIONAL FEE STRUCTURE & BREAKUP', blueHeader, purpleColor);
    drawTableRow('REGISTRATION FEE', voucherData.display.registrationFee);
    drawTableRow('TUITION FEE', voucherData.display.tuitionFee);

    if (voucherData.otherFees > 0) {
      drawTableRow('OTHER ADDITIONAL FEES', voucherData.display.otherFees);
      if (voucherData.otherFeesBreakdown && voucherData.otherFeesBreakdown.length > 0) {
        const breakdownStr = voucherData.otherFeesBreakdown.map((b) => `${b.label}: ${b.amountDisplay}`).join('  |  ');
        drawTableRow('OTHER FEES BREAKDOWN', breakdownStr);
      }
    }

    drawTableRow('GROSS TOTAL AMOUNT', voucherData.display.totalAmount, true);

    if (voucherData.discountAmount > 0) {
      drawTableRow(`MERIT DISCOUNT (${voucherData.display.discountPercent})`, `- ${voucherData.display.discountAmount}`);
    }
    if (voucherData.scholarshipAmount > 0) {
      drawTableRow('SCHOLARSHIP CONCESSION', `- ${voucherData.display.scholarshipAmount}`);
    }
    if (voucherData.gstAmount > 0) {
      drawTableRow(`APPLICABLE GST (${voucherData.display.gstPercent})`, `+ ${voucherData.display.gstAmount}`);
    }

    drawTableRow('NET PAYABLE AMOUNT (FINAL)', voucherData.display.finalPayable, true, '#fef9c3', true);

    curY += 10;

    // --- 4. SCHEDULED PAYMENT INSTALLMENTS ---
    drawSectionHeader('3. SCHEDULED INSTALLMENT TIMELINE', yellowHeader, '#854d0e');
    const instColWidth = contentWidth / 2;
    doc.rect(margin, curY, contentWidth, 18).fillColor('#f8fafc').fill();
    doc.rect(margin, curY, contentWidth, 18).strokeColor(borderColor).lineWidth(0.5).stroke();
    doc.moveTo(margin + instColWidth, curY).lineTo(margin + instColWidth, curY + 18).stroke();
    doc.fontSize(8.5).fillColor('#475569').font('Helvetica-Bold').text('INSTALLMENT DUE DATE', margin + 8, curY + 5);
    doc.fontSize(8.5).fillColor('#475569').font('Helvetica-Bold').text('AMOUNT PAYABLE', margin + instColWidth + 8, curY + 5);
    curY += 18;

    const installments = (voucherData.installments || []).slice();
    while (installments.length < 4) {
      installments.push({ date: '', amountDisplay: '' });
    }

    installments.forEach((inst, idx) => {
      const bg = idx % 2 === 1 ? '#fafbfc' : '#ffffff';
      doc.rect(margin, curY, contentWidth, 17).fillColor(bg).fill();
      doc.rect(margin, curY, contentWidth, 17).strokeColor(borderColor).lineWidth(0.5).stroke();
      doc.moveTo(margin + instColWidth, curY).lineTo(margin + instColWidth, curY + 17).stroke();

      if (inst.date) {
        doc.fontSize(8.5).fillColor(darkColor).font('Helvetica').text(inst.date, margin + 8, curY + 4);
      }
      if (inst.amountDisplay) {
        doc.fontSize(8.5).fillColor(darkColor).font('Helvetica-Bold').text(inst.amountDisplay, margin + instColWidth + 8, curY + 4);
      }
      curY += 17;
    });

    curY += 24;

    // --- 5. AUTHORIZED STAMP & SIGNATURE BLOCK ---
    if (curY < 720) {
      doc
        .fontSize(8)
        .fillColor('#64748b')
        .font('Helvetica-Oblique')
        .text('* This voucher is an official computer-verified institutional record of The Prime Classes ERP System.', margin, curY);

      doc
        .fontSize(8.5)
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .text('Accounts Officer / Authorized Signatory', pageWidth - margin - 220, curY + 30, {
          width: 220,
          align: 'right'
        });

      doc
        .fontSize(7.5)
        .fillColor('#94a3b8')
        .font('Helvetica')
        .text('The Prime Classes Defense Academy', pageWidth - margin - 220, curY + 42, {
          width: 220,
          align: 'right'
        });
    }

    doc.end();
  });
}

/**
 * Generates a single record application form PDF export
 */
export async function generateRecordPdfBuffer(sheetName, headers, values) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const primaryColor = '#b3132a';
    const margin = 36;
    const pageWidth = 595.28;
    const contentWidth = pageWidth - margin * 2;

    doc
      .fontSize(22)
      .fillColor(primaryColor)
      .font('Helvetica-Bold')
      .text('THE PRIME CLASSES', margin, margin);

    doc
      .fontSize(12)
      .fillColor('#444444')
      .font('Helvetica')
      .text(`${sheetName} Official Record Form`, margin, margin + 28);

    doc.moveTo(margin, margin + 48).lineTo(pageWidth - margin, margin + 48).strokeColor(primaryColor).lineWidth(1.5).stroke();

    let curY = margin + 60;

    headers.forEach((header, i) => {
      const val = values[i] || '-';
      if (curY > 750) {
        doc.addPage();
        curY = margin;
      }

      const rowHeight = 22;
      doc.rect(margin, curY, contentWidth, rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.moveTo(margin + 180, curY).lineTo(margin + 180, curY + rowHeight).stroke();

      doc.rect(margin, curY, 180, rowHeight).fillColor('#f8fafc').fill();
      doc.rect(margin, curY, 180, rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

      doc.fontSize(8.5).fillColor('#334155').font('Helvetica-Bold').text(header, margin + 6, curY + 6, { width: 168 });
      doc.fontSize(8.5).fillColor('#0f172a').font('Helvetica').text(String(val), margin + 188, curY + 6, { width: contentWidth - 196 });

      curY += rowHeight;
    });

    doc.end();
  });
}
