import React from 'react';
import { X, FileCheck, ExternalLink, CheckCircle, XCircle } from 'lucide-react';

export default function VoucherModal({
  isOpen,
  onClose,
  voucherData,
  pdfUrl,
  status,
  rowNumber,
  onGenerateVoucher,
  onToggleStatus,
  isGenerating
}) {
  if (!isOpen || !voucherData) return null;

  const display = voucherData.display || {};

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '780px' }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#b3132a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Institutional Fee Voucher
            </div>
            <h3 className="modal-title" style={{ marginTop: 2 }}>
              {voucherData.studentName || 'Student'}
            </h3>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="voucher-preview-box">
          {/* Status Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fdf2f4', padding: '10px 14px', borderRadius: '12px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Voucher Status</span>
            <span className={`voucher-badge ${status === 'Given' ? 'given' : 'not-given'}`}>
              {status}
            </span>
          </div>

          {/* Section 1: Basic Information */}
          <div className="voucher-preview-section">
            <h4>Basic Information</h4>
            <div className="voucher-kv-row">
              <span>Student Name:</span>
              <strong>{(voucherData.studentName || '-').toUpperCase()}</strong>
            </div>
            <div className="voucher-kv-row">
              <span>Father's Name:</span>
              <strong>{(voucherData.fatherName || '-').toUpperCase()}</strong>
            </div>
            <div className="voucher-kv-row">
              <span>Academic Program:</span>
              <strong>{(voucherData.program || '-').toUpperCase()}</strong>
            </div>
            <div className="voucher-kv-row">
              <span>Date of Admission:</span>
              <strong>{voucherData.admissionDate || '-'}</strong>
            </div>
            {voucherData.session && (
              <div className="voucher-kv-row">
                <span>Session:</span>
                <strong>{voucherData.session}</strong>
              </div>
            )}
            {voucherData.mobileNumber && (
              <div className="voucher-kv-row">
                <span>Contact Number:</span>
                <strong>{voucherData.mobileNumber}</strong>
              </div>
            )}
          </div>

          {/* Section 2: Fee Structure */}
          <div className="voucher-preview-section">
            <h4>Fee Structure & Financial Breakup</h4>
            <div className="voucher-kv-row">
              <span>Registration Fee:</span>
              <span>{display.registrationFee}</span>
            </div>
            <div className="voucher-kv-row">
              <span>Tuition Fee:</span>
              <span>{display.tuitionFee}</span>
            </div>
            {voucherData.otherFees > 0 && (
              <>
                <div className="voucher-kv-row">
                  <span>Other Fees:</span>
                  <span>{display.otherFees}</span>
                </div>
                {voucherData.otherFeesBreakdown && voucherData.otherFeesBreakdown.length > 0 && (
                  <div style={{ background: '#fff', padding: '8px 12px', borderRadius: 8, margin: '6px 0', border: '1px solid #ebd0d5' }}>
                    <div style={{ fontSize: '10px', fontWeight: 800, color: '#8f1024', textTransform: 'uppercase', marginBottom: 4 }}>
                      Other Fees Breakdown
                    </div>
                    {voucherData.otherFeesBreakdown.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '2px 0' }}>
                        <span>{item.label}</span>
                        <strong>{item.amountDisplay}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="voucher-kv-row" style={{ fontWeight: 700, borderTop: '1px solid #ebc8ce', paddingTop: 6 }}>
              <span>Total Standard Amount:</span>
              <span>{display.totalAmount}</span>
            </div>
            <div className="voucher-kv-row">
              <span>Discount ({display.discountPercent}):</span>
              <span style={{ color: '#dc2626' }}>- {display.discountAmount}</span>
            </div>
            {voucherData.scholarshipAmount > 0 && (
              <div className="voucher-kv-row">
                <span>Scholarship Amount:</span>
                <span style={{ color: '#dc2626' }}>- {display.scholarshipAmount}</span>
              </div>
            )}
            <div className="voucher-kv-row">
              <span>GST ({display.gstPercent}):</span>
              <span>+ {display.gstAmount}</span>
            </div>
            <div className="voucher-kv-row total-row">
              <span>Final Payable Amount:</span>
              <span>{display.finalPayable}</span>
            </div>
          </div>

          {/* Section 3: Installments */}
          {voucherData.installments && voucherData.installments.length > 0 && (
            <div className="voucher-preview-section">
              <h4>Scheduled Installments</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Due Date</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {voucherData.installments.map((inst, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px' }}>{inst.date || '-'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                        {inst.amountDisplay}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1d7db', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {status === 'Given' ? (
              <button
                type="button"
                className="btn btn-toggle-status"
                onClick={() => onToggleStatus(rowNumber, 'Not Given')}
              >
                <XCircle size={13} /> Mark Not Given
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-toggle-status active"
                onClick={() => onToggleStatus(rowNumber, 'Given')}
              >
                <CheckCircle size={13} /> Mark Given
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-voucher-generate"
              disabled={isGenerating}
              onClick={() => onGenerateVoucher(rowNumber)}
            >
              <FileCheck size={14} /> {isGenerating ? 'Generating...' : 'Generate & Sync PDF'}
            </button>

            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={14} /> Open PDF
              </a>
            )}

            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
