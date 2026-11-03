/**
 * Date formatting and normalization utilities
 * Standard format required: day/month/year (DD/MM/YYYY)
 */

export function formatDisplayDate(val) {
  if (val == null || val === '') return '';
  const str = String(val).trim();
  if (!str || str === '-') return '';

  // 1. Plain numbers: IDs, fees, single years (e.g. 2026, 50000, 2602070001)
  if (/^\d{1,10}$/.test(str)) return str;

  // 2. Year ranges / Academic sessions (e.g. 2026-2027, 2026 - 2027)
  if (/^\d{4}\s*[-–/]\s*\d{4}$/.test(str)) return str;

  // 3. Already strictly DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    return str;
  }

  // 4. ISO Date / Timestamp: YYYY-MM-DD or YYYY/MM/DD (with optional time or timezone)
  let m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    // If it has time or timezone indicator (e.g. 2026-02-18T18:30:00.000Z), interpret in Asia/Kolkata (IST)
    if (m[4] != null || m[7] != null) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        try {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }).formatToParts(d);
          const dd = parts.find((p) => p.type === 'day')?.value;
          const mm = parts.find((p) => p.type === 'month')?.value;
          const yyyy = parts.find((p) => p.type === 'year')?.value;
          if (dd && mm && yyyy) return `${dd}/${mm}/${yyyy}`;
        } catch (e) {
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          return `${dd}/${mm}/${yyyy}`;
        }
      }
    }
    const yyyy = m[1];
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    return `${dd}/${mm}/${yyyy}`;
  }

  // 5. DD-MM-YYYY or DD.MM.YYYY
  m = str.match(/^(\d{1,2})[-\.](\d{1,2})[-\.](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${dd}/${mm}/${yyyy}`;
  }

  // 6. M/D/YYYY or MM/DD/YYYY (e.g. Google Sheets timestamp: 2/26/2026 16:21:41)
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let p1 = parseInt(m[1], 10);
    let p2 = parseInt(m[2], 10);
    let yyyy = m[3];
    let dd, mm;
    if (p1 > 12) {
      dd = String(p1).padStart(2, '0');
      mm = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      dd = String(p2).padStart(2, '0');
      mm = String(p1).padStart(2, '0');
    } else {
      dd = String(p1).padStart(2, '0');
      mm = String(p2).padStart(2, '0');
    }
    return `${dd}/${mm}/${yyyy}`;
  }

  // 7. General fallback for recognizable date strings
  if ((str.includes('-') || str.includes('/') || str.includes('T')) && !str.includes('@')) {
    const d = new Date(str);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }).formatToParts(d);
        const dd = parts.find((p) => p.type === 'day')?.value;
        const mm = parts.find((p) => p.type === 'month')?.value;
        const yyyy = parts.find((p) => p.type === 'year')?.value;
        if (dd && mm && yyyy) return `${dd}/${mm}/${yyyy}`;
      } catch (e) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      }
    }
  }

  return str;
}

/**
 * Checks whether a column header is a date-oriented field
 * Note: Session is excluded as it represents academic session labels (e.g. "2026")
 */
export function isDateHeader(headerName) {
  if (!headerName) return false;
  const norm = String(headerName).toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    norm.includes('date') ||
    norm.includes('dob') ||
    norm.includes('timestamp') ||
    norm.includes('createdat') ||
    norm.includes('updatedat')
  );
}

/**
 * Converts any date representation into standard YYYY-MM-DD for native HTML5 <input type="date">
 */
export function toInputDateValue(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (!str) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const dMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dMatch) {
    const p1 = parseInt(dMatch[1], 10);
    const p2 = parseInt(dMatch[2], 10);
    const yyyy = dMatch[3];
    let dd, mm;
    if (p1 > 12) {
      dd = String(p1).padStart(2, '0');
      mm = String(p2).padStart(2, '0');
    } else if (p2 > 12) {
      dd = String(p2).padStart(2, '0');
      mm = String(p1).padStart(2, '0');
    } else {
      dd = String(p1).padStart(2, '0');
      mm = String(p2).padStart(2, '0');
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return '';
}
