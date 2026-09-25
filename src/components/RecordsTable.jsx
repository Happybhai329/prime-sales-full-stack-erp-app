import React from 'react';
import {
  Edit3,
  FileCheck,
  Eye,
  FileDown,
  Trash2,
  UserMinus,
  CheckCircle,
  XCircle,
  ExternalLink
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

  // Filter out raw VoucherStatus / VoucherPDFLink columns from main table because they have dedicated action buttons & preview
  const displayHeaders = headers.filter((h) => {
    const norm = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (isAdmissionsLike && (norm === 'voucherstatus' || norm === 'voucherpdflink')) {
      return false;
    }
    return true;
  });

  const getHeaderIndex = (h) => headers.indexOf(h);

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

  return (
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
          {isLoading ? (
            <tr>
              <td colSpan={displayHeaders.length + (isAdmissionsLike ? 2 : 1)} style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ color: '#b3132a', fontWeight: 700, fontSize: '14px' }}>Loading records...</div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={displayHeaders.length + (isAdmissionsLike ? 2 : 1)} style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ color: '#64748b', fontSize: '14px' }}>
                  <strong>No records match the current filters.</strong>
                  <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Try adjusting your search query, program filter, or date range.</p>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
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
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
