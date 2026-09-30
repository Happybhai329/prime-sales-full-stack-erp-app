import React, { useState, useEffect } from 'react';
import {
  Edit3,
  FileCheck,
  Eye,
  FileDown,
  Trash2,
  UserMinus,
  CheckCircle,
  XCircle,
  ExternalLink,
  Phone,
  User,
  Calendar,
  GraduationCap,
  CreditCard,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';

export default function RecordsTable({
  headers,
  rows,
  activeTab,
  onEditRecord,
  onGenerateVoucher,
  onPreviewVoucher,
  onToggleVoucherStatus,
  onCancelAdmission,
  onDownloadRecordPdf,
  onDeleteRecord,
  isLoading
}) {
  const isAdmissionsLike = activeTab === 'admissions' || activeTab === 'conversions';

  // State to toggle between Card View and Table View (defaults to Cards on mobile screens)
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return 'cards';
    }
    return 'table';
  });

  // Track expanded cards in mobile view
  const [expandedRows, setExpandedRows] = useState({});

  // Pagination state (25 items per page by default to eliminate browser freeze)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Reset page when dataset or activeTab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [rows, activeTab]);

  const totalRecords = rows.length;
  const isAll = pageSize === 'all';
  const effectivePageSize = isAll ? Math.max(1, totalRecords) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalRecords / effectivePageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * effectivePageSize;
  const endIndex = Math.min(startIndex + effectivePageSize, totalRecords);
  const paginatedRows = isAll ? rows : rows.slice(startIndex, endIndex);

  const toggleExpandRow = (rowNum) => {
    setExpandedRows((prev) => ({
      ...prev,
      [rowNum]: !prev[rowNum]
    }));
  };

  // Filter out raw VoucherStatus / VoucherPDFLink columns from main table because they have dedicated action buttons & preview
  const displayHeaders = headers.filter((h) => {
    const norm = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (isAdmissionsLike && (norm === 'voucherstatus' || norm === 'voucherpdflink')) {
      return false;
    }
    return true;
  });

  const getHeaderIndex = (h) => headers.indexOf(h);

  // Helper to get value by fuzzy matching header name
  const getRecordField = (values, matchers) => {
    for (const m of matchers) {
      const idx = headers.findIndex((h) =>
        String(h || '').toLowerCase().trim().includes(m.toLowerCase().trim())
      );
      if (idx !== -1 && values[idx] != null && String(values[idx]).trim() !== '') {
        return String(values[idx]).trim();
      }
    }
    return '';
  };

  // Helper to render special cell values
  const renderCellValue = (header, val) => {
    if (val == null || val === '') return <span style={{ color: '#94a3b8' }}>-</span>;

    const strVal = String(val).trim();
    const normHeader = header.toLowerCase();

    // Check if JSON column (Other Fees or Installments)
    if (normHeader.includes('other fees') && (strVal.startsWith('[') || strVal.startsWith('{'))) {
      try {
        const parsed = JSON.parse(strVal);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const total = items.reduce((sum, it) => sum + (parseFloat(it.amount || it.fee || 0) || 0), 0);
        return (
          <div className="json-card">
            <div className="json-card-title">Extra Fees ({items.length})</div>
            {items.slice(0, 3).map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span>{it.feeType || it.name || `Fee ${i + 1}`}</span>
                <strong>₹{Number(it.amount || 0).toLocaleString('en-IN')}</strong>
              </div>
            ))}
            {items.length > 3 && <div style={{ color: '#64748b', fontSize: '10px' }}>+{items.length - 3} more...</div>}
            <div style={{ borderTop: '1px solid #eee', marginTop: 4, paddingTop: 2, fontWeight: 700 }}>
              Total: ₹{total.toLocaleString('en-IN')}
            </div>
          </div>
        );
      } catch (e) {
        return <span>{strVal}</span>;
      }
    }

    if (normHeader.includes('installment') && (strVal.startsWith('[') || strVal.startsWith('{'))) {
      try {
        const parsed = JSON.parse(strVal);
        const items = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.installments)
            ? parsed.installments
            : [parsed];
        const total = items.reduce((sum, it) => sum + (parseFloat(it.amount || 0) || 0), 0);
        return (
          <div className="json-card">
            <div className="json-card-title">Installments ({items.length})</div>
            {items.slice(0, 3).map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span>{it.date || '-'}</span>
                <strong>₹{Number(it.amount || 0).toLocaleString('en-IN')}</strong>
              </div>
            ))}
            {items.length > 3 && <div style={{ color: '#64748b', fontSize: '10px' }}>+{items.length - 3} more...</div>}
            <div style={{ borderTop: '1px solid #eee', marginTop: 4, paddingTop: 2, fontWeight: 700 }}>
              Total: ₹{total.toLocaleString('en-IN')}
            </div>
          </div>
        );
      } catch (e) {
        return <span>{strVal}</span>;
      }
    }

    // Money formatting for fee columns
    if (
      /(fee|amount|cost|total|scholarship)/i.test(normHeader) &&
      !isNaN(strVal.replace(/,/g, '')) &&
      !normHeader.includes('percent') &&
      !normHeader.includes('%')
    ) {
      const num = parseFloat(strVal.replace(/,/g, ''));
      return <strong>₹{num.toLocaleString('en-IN')}</strong>;
    }

    return <span>{strVal}</span>;
  };

  // Clean phone number helper
  const cleanPhone = (raw) => {
    if (!raw) return '';
    try {
      if (raw.startsWith('[') || raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return String(parsed[0]).replace(/\D/g, '');
      }
    } catch (e) {}
    return String(raw).replace(/\D/g, '');
  };

  return (
    <div className="records-container">
      {/* View Switcher Header (Cards vs Table) */}
      <div className="table-top-bar">
        <div className="view-mode-toggle">
          <button
            type="button"
            className={`toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
            onClick={() => setViewMode('cards')}
            title="Switch to Mobile Card View"
          >
            <LayoutGrid size={13} />
            <span>Cards</span>
          </button>
          <button
            type="button"
            className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
            title="Switch to Full Table View"
          >
            <TableIcon size={13} />
            <span>Table</span>
          </button>
        </div>
        <div className="view-mode-hint">
          {viewMode === 'cards'
            ? 'Touch-friendly student cards with quick actions'
            : 'Full data spreadsheet with horizontal scroll'}
        </div>
      </div>

      {isLoading ? (
        <div className="loading-state-box">
          <div className="loading-spinner" />
          <p>Loading institutional records...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state-box">
          <strong>No records match the current filters.</strong>
          <p>Try adjusting your search query, program filter, or date range.</p>
        </div>
      ) : viewMode === 'cards' ? (
        /* ======================================================================
           MOBILE CARD VIEW: Touch-Friendly, Clean, Full Student Data Visible
           ====================================================================== */
        <div className="mobile-cards-list">
          {paginatedRows.map((row) => {
            const rowNum = row.rowNumber;
            const values = row.values || [];
            const voucherStatus = row.voucherStatus || 'Not Given';
            const voucherPdfLink = row.voucherPdfLink || '';
            const isExpanded = !!expandedRows[rowNum];

            // Extract key fields safely
            const studentName = getRecordField(values, ['student name', 'name']) || 'STUDENT RECORD';
            const studentId = getRecordField(values, ['studentsid', 'student id', 'id', 's.no.', 'sno']);
            const fatherName = getRecordField(values, ["father's name", 'father name', 'father']);
            const rawPhone = getRecordField(values, ['mobile numbers', 'mobile', 'father no.', 'father no', 'phone']);
            const phoneDigits = cleanPhone(rawPhone);
            const program = getRecordField(values, ['program', 'class', 'course']) || 'General Wing';
            const dateStr = getRecordField(values, ['date of application', 'admission date', 'application date', 'date', 'timestamp']);
            const totalFee = getRecordField(values, ['final cost', 'total amount', 'total']);
            const category = getRecordField(values, ['category', 'caste']);

            return (
              <div key={rowNum} className="student-mobile-card">
                {/* 1. Card Top Bar: Name, ID, and Status */}
                <div className="card-header">
                  <div>
                    <h3 className="card-student-name">{studentName.toUpperCase()}</h3>
                    <div className="card-sub-pills">
                      {studentId && <span className="pill pill-id">ID: {studentId}</span>}
                      {program && <span className="pill pill-program">{program}</span>}
                      {category && <span className="pill pill-category">{category}</span>}
                    </div>
                  </div>

                  {isAdmissionsLike && (
                    <div className="card-voucher-pill">
                      <span className={`voucher-badge ${voucherStatus === 'Given' ? 'given' : 'not-given'}`}>
                        {voucherStatus === 'Given' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                        {voucherStatus}
                      </span>
                    </div>
                  )}
                </div>

                {/* 2. Key Particulars Grid */}
                <div className="card-info-grid">
                  {fatherName && (
                    <div className="info-item">
                      <span className="info-label"><User size={11} /> Father's Name</span>
                      <strong className="info-val">{fatherName}</strong>
                    </div>
                  )}

                  {phoneDigits ? (
                    <div className="info-item">
                      <span className="info-label"><Phone size={11} /> Contact No.</span>
                      <a href={`tel:${phoneDigits}`} className="info-phone-link" title="Tap to call">
                        <Phone size={12} /> {rawPhone}
                      </a>
                    </div>
                  ) : null}

                  {dateStr && (
                    <div className="info-item">
                      <span className="info-label"><Calendar size={11} /> {isAdmissionsLike ? 'Admission Date' : 'Enquiry Date'}</span>
                      <strong className="info-val">{dateStr}</strong>
                    </div>
                  )}

                  {totalFee && (
                    <div className="info-item">
                      <span className="info-label"><CreditCard size={11} /> Net Payable</span>
                      <strong className="info-val fee-highlight">
                        ₹{Number(parseFloat(totalFee.replace(/,/g, '')) || 0).toLocaleString('en-IN')}
                      </strong>
                    </div>
                  )}
                </div>

                {/* 3. Action Buttons Row (Touch Friendly) */}
                <div className="card-action-bar">
                  <button
                    type="button"
                    className="card-btn btn-edit"
                    onClick={() => onEditRecord(row)}
                  >
                    <Edit3 size={13} /> Edit
                  </button>

                  {isAdmissionsLike && (
                    <>
                      <button
                        type="button"
                        className="card-btn btn-voucher-generate"
                        onClick={() => onGenerateVoucher(rowNum)}
                      >
                        <FileCheck size={13} /> Voucher
                      </button>

                      <button
                        type="button"
                        className="card-btn btn-voucher-preview"
                        onClick={() => onPreviewVoucher(row)}
                        title="Preview breakdown"
                      >
                        <Eye size={13} /> Preview
                      </button>

                      {voucherStatus === 'Given' ? (
                        <button
                          type="button"
                          className="card-btn btn-toggle-status"
                          onClick={() => onToggleVoucherStatus(rowNum, 'Not Given')}
                        >
                          <XCircle size={13} /> Not Given
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="card-btn btn-toggle-status active"
                          onClick={() => onToggleVoucherStatus(rowNum, 'Given')}
                        >
                          <CheckCircle size={13} /> Mark Given
                        </button>
                      )}

                      <button
                        type="button"
                        className="card-btn btn-cancel"
                        onClick={() => onCancelAdmission(rowNum)}
                      >
                        <UserMinus size={13} /> Cancel
                      </button>
                    </>
                  )}

                  {voucherPdfLink ? (
                    <a
                      href={voucherPdfLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="card-btn btn-primary"
                      style={{ textDecoration: 'none' }}
                    >
                      <ExternalLink size={13} /> PDF
                    </a>
                  ) : activeTab !== 'inquiries' ? (
                    <button
                      type="button"
                      className="card-btn btn-pdf"
                      onClick={() => onDownloadRecordPdf(row)}
                    >
                      <FileDown size={13} /> PDF
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="card-btn btn-delete"
                    onClick={() => onDeleteRecord(row)}
                  >
                    <Trash2 size={13} /> Del
                  </button>
                </div>

                {/* 4. Expandable Details Drawer */}
                <div className="card-expand-section">
                  <button
                    type="button"
                    className="btn-expand-details"
                    onClick={() => toggleExpandRow(rowNum)}
                  >
                    <span>{isExpanded ? 'Hide Full Particulars' : 'View Full Particulars'}</span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {isExpanded && (
                    <div className="card-expanded-content">
                      <div className="expanded-details-grid">
                        {displayHeaders.map((header) => {
                          const idx = getHeaderIndex(header);
                          const val = values[idx];
                          if (val == null || val === '') return null;
                          return (
                            <div key={header} className="expanded-kv">
                              <span className="expanded-k">{header}</span>
                              <div className="expanded-v">{renderCellValue(header, val)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ======================================================================
           DESKTOP / SPREADSHEET TABLE VIEW
           ====================================================================== */
        <div className="table-wrapper">
          <table className="dashboard-table">
            <thead>
              <tr>
                {displayHeaders.map((header) => (
                  <th key={header}>{header}</th>
                ))}
                {isAdmissionsLike && <th>Voucher</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => {
                const rowNum = row.rowNumber;
                const values = row.values || [];
                const voucherStatus = row.voucherStatus || 'Not Given';
                const voucherPdfLink = row.voucherPdfLink || '';

                return (
                  <tr key={rowNum}>
                    {displayHeaders.map((header) => {
                      const idx = getHeaderIndex(header);
                      const val = values[idx];
                      return <td key={header}>{renderCellValue(header, val)}</td>;
                    })}

                    {/* Voucher Column (for Admissions & Conversions) */}
                    {isAdmissionsLike && (
                      <td>
                        <div className="voucher-cell-card">
                          <span className={`voucher-badge ${voucherStatus === 'Given' ? 'given' : 'not-given'}`}>
                            {voucherStatus}
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              className="btn btn-voucher-preview"
                              style={{ padding: '3px 8px', fontSize: '10px' }}
                              onClick={() => onPreviewVoucher(row)}
                              title="Preview voucher breakup"
                            >
                              <Eye size={11} /> Preview
                            </button>

                            {voucherPdfLink ? (
                              <a
                                href={voucherPdfLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary"
                                style={{ padding: '3px 8px', fontSize: '10px', textDecoration: 'none' }}
                                title="Open Voucher PDF"
                              >
                                <ExternalLink size={11} /> PDF
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    )}

                    {/* Actions Column */}
                    <td className="actions-cell">
                      <div className="actions-group">
                        <button
                          type="button"
                          className="btn btn-edit"
                          onClick={() => onEditRecord(row)}
                          title="Edit record details"
                        >
                          <Edit3 size={12} /> Edit
                        </button>

                        {isAdmissionsLike && (
                          <>
                            <button
                              type="button"
                              className="btn btn-voucher-generate"
                              onClick={() => onGenerateVoucher(rowNum)}
                              title="Calculate fees, generate institutional PDF and upload to Drive"
                            >
                              <FileCheck size={12} /> Voucher
                            </button>

                            {voucherStatus === 'Given' ? (
                              <button
                                type="button"
                                className="btn btn-toggle-status"
                                onClick={() => onToggleVoucherStatus(rowNum, 'Not Given')}
                                title="Mark voucher as Not Given"
                              >
                                <XCircle size={12} /> Mark Not Given
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-toggle-status"
                                onClick={() => onToggleVoucherStatus(rowNum, 'Given')}
                                title="Mark voucher as Given"
                              >
                                <CheckCircle size={12} /> Mark Given
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn btn-cancel"
                              onClick={() => onCancelAdmission(rowNum)}
                              title="Move admission to Cancelled Log"
                            >
                              <UserMinus size={12} /> Cancel
                            </button>
                          </>
                        )}

                        {/* Download record application form PDF */}
                        {activeTab !== 'inquiries' && (
                          <button
                            type="button"
                            className="btn btn-pdf"
                            onClick={() => onDownloadRecordPdf(row)}
                            title="Download record application form PDF"
                          >
                            <FileDown size={12} /> PDF
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn btn-delete"
                          onClick={() => onDeleteRecord(row)}
                          title="Delete record permanently"
                        >
                          <Trash2 size={12} /> Del
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modern High-Performance Pagination Toolbar */}
      {!isLoading && totalRecords > 0 && (
        <div className="table-pagination-bar">
          <div className="pagination-info">
            Showing <strong>{totalRecords === 0 ? 0 : startIndex + 1}</strong> - <strong>{endIndex}</strong> of <strong>{totalRecords}</strong> records
          </div>

          <div className="pagination-controls">
            <div className="page-size-selector">
              <label>Rows per page:</label>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value="all">All ({totalRecords})</option>
              </select>
            </div>

            {!isAll && totalPages > 1 && (
              <div className="page-nav-buttons">
                <button
                  type="button"
                  className="page-btn"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                  title="First Page"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  type="button"
                  className="page-btn"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  title="Previous Page"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="page-indicator">
                  Page <strong>{safeCurrentPage}</strong> of <strong>{totalPages}</strong>
                </span>
                <button
                  type="button"
                  className="page-btn"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  title="Next Page"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="page-btn"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  title="Last Page"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
