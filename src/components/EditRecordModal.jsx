import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save } from 'lucide-react';

export default function EditRecordModal({
  isOpen,
  onClose,
  record,
  headers,
  feeTypes,
  onSave
}) {
  if (!isOpen || !record) return null;

  const [formData, setFormData] = useState([]);
  const [otherFeesRows, setOtherFeesRows] = useState([]);
  const [installmentRows, setInstallmentRows] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form state
  useEffect(() => {
    if (!record || !headers) return;
    const initialValues = [...(record.values || [])];
    setFormData(initialValues);

    // Parse Other Fees (JSON)
    const otherFeesIdx = headers.findIndex((h) => /other fees/i.test(h));
    if (otherFeesIdx !== -1) {
      const val = initialValues[otherFeesIdx] || '';
      try {
        const parsed = JSON.parse(val);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        setOtherFeesRows(
          arr.map((it) => ({
            feeType: it.feeType || it.name || it.type || '',
            amount: it.amount || ''
          }))
        );
      } catch (e) {
        setOtherFeesRows([]);
      }
    }

    // Parse Installment Details (JSON)
    const instIdx = headers.findIndex((h) => /installment/i.test(h));
    if (instIdx !== -1) {
      const val = initialValues[instIdx] || '';
      try {
        const parsed = JSON.parse(val);
        const arr = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.installments)
            ? parsed.installments
            : [parsed];
        setInstallmentRows(
          arr.map((it) => ({
            date: it.date || '',
            amount: it.amount || ''
          }))
        );
      } catch (e) {
        setInstallmentRows([]);
      }
    }
  }, [record, headers]);

  const handleFieldChange = (idx, value) => {
    setFormData((prev) => {
      const updated = [...prev];
      updated[idx] = value;
      return updated;
    });
  };

  // Other Fees row actions
  const addOtherFeeRow = () => {
    setOtherFeesRows((prev) => [...prev, { feeType: '', amount: '' }]);
  };

  const updateOtherFeeRow = (index, field, value) => {
    setOtherFeesRows((prev) => {
      const updated = [...prev];
      updated[index][field] = value;
      return updated;
    });
  };

  const removeOtherFeeRow = (index) => {
    setOtherFeesRows((prev) => prev.filter((_, i) => i !== index));
  };

  // Installments row actions
  const addInstallmentRow = () => {
    setInstallmentRows((prev) => [...prev, { date: '', amount: '' }]);
  };

  const updateInstallmentRow = (index, field, value) => {
    setInstallmentRows((prev) => {
      const updated = [...prev];
      updated[index][field] = value;
      return updated;
    });
  };

  const removeInstallmentRow = (index) => {
    setInstallmentRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const submissionValues = [...formData];

    // Encode Other Fees (JSON)
    const otherFeesIdx = headers.findIndex((h) => /other fees/i.test(h));
    if (otherFeesIdx !== -1) {
      const cleanFees = otherFeesRows
        .filter((r) => r.feeType || r.amount)
        .map((r) => ({
          feeType: r.feeType.trim(),
          amount: parseFloat(r.amount) || 0
        }));
      submissionValues[otherFeesIdx] = cleanFees.length > 0 ? JSON.stringify(cleanFees) : '';
    }

    // Encode Installments (JSON)
    const instIdx = headers.findIndex((h) => /installment/i.test(h));
    if (instIdx !== -1) {
      const cleanInst = installmentRows
        .filter((r) => r.date || r.amount)
        .map((r) => ({
          date: r.date.trim(),
          amount: parseFloat(r.amount) || 0
        }));
      submissionValues[instIdx] = cleanInst.length > 0 ? JSON.stringify(cleanInst) : '';
    }

    try {
      await onSave(record.rowNumber, submissionValues);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Update Record #{record.rowNumber}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            {headers.map((header, idx) => {
              const normHeader = header.toLowerCase();

              // Skip internal voucher fields
              if (normHeader.includes('voucherstatus') || normHeader.includes('voucherpdflink')) {
                return null;
              }

              // Visual JSON builder for Other Fees
              if (normHeader.includes('other fees')) {
                return (
                  <div key={header} className="form-group full-width">
                    <label className="form-label">{header} (Visual Form Builder)</label>
                    <div className="json-builder-shell">
                      <div className="json-builder-head">
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          Add extra fee heads without manually editing raw JSON
                        </span>
                        <button
                          type="button"
                          className="btn btn-setup"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={addOtherFeeRow}
                        >
                          <Plus size={12} /> Add Fee
                        </button>
                      </div>

                      {otherFeesRows.length === 0 ? (
                        <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center', padding: '8px' }}>
                          No additional fees added yet. Click "+ Add Fee" above.
                        </div>
                      ) : (
                        otherFeesRows.map((feeRow, fIdx) => (
                          <div key={fIdx} className="json-builder-row">
                            <input
                              type="text"
                              className="form-input"
                              placeholder="Fee Type (e.g. Hostel, Transport)"
                              list="feeTypeList"
                              value={feeRow.feeType}
                              onChange={(e) => updateOtherFeeRow(fIdx, 'feeType', e.target.value)}
                            />
                            <input
                              type="number"
                              className="form-input"
                              placeholder="Amount (₹)"
                              value={feeRow.amount}
                              onChange={(e) => updateOtherFeeRow(fIdx, 'amount', e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-delete"
                              style={{ padding: '6px', height: '36px' }}
                              onClick={() => removeOtherFeeRow(fIdx)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              }

              // Visual JSON builder for Installment Details
              if (normHeader.includes('installment')) {
                return (
                  <div key={header} className="form-group full-width">
                    <label className="form-label">{header} (Visual Form Builder)</label>
                    <div className="json-builder-shell">
                      <div className="json-builder-head">
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          Add scheduled installment payment dates and amounts
                        </span>
                        <button
                          type="button"
                          className="btn btn-setup"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={addInstallmentRow}
                        >
                          <Plus size={12} /> Add Installment
                        </button>
                      </div>

                      {installmentRows.length === 0 ? (
                        <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center', padding: '8px' }}>
                          No installments scheduled yet. Click "+ Add Installment" above.
                        </div>
                      ) : (
                        installmentRows.map((instRow, iIdx) => (
                          <div key={iIdx} className="json-builder-row">
                            <input
                              type="date"
                              className="form-input"
                              value={instRow.date}
                              onChange={(e) => updateInstallmentRow(iIdx, 'date', e.target.value)}
                            />
                            <input
                              type="number"
                              className="form-input"
                              placeholder="Amount (₹)"
                              value={instRow.amount}
                              onChange={(e) => updateInstallmentRow(iIdx, 'amount', e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-delete"
                              style={{ padding: '6px', height: '36px' }}
                              onClick={() => removeInstallmentRow(iIdx)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              }

              // Standard inputs
              const val = formData[idx] || '';
              const isDate = /(date|dob|timestamp)/i.test(normHeader);
              const isNumber = /(fee|amount|discount|gst|cost|total|scholarship)/i.test(normHeader) && !normHeader.includes('session');

              return (
                <div key={header} className="form-group">
                  <label className="form-label">{header}</label>
                  <input
                    type={isDate ? 'date' : isNumber ? 'number' : 'text'}
                    step={isNumber ? 'any' : undefined}
                    className="form-input"
                    value={val}
                    onChange={(e) => handleFieldChange(idx, e.target.value)}
                  />
                </div>
              );
            })}
          </div>

          <datalist id="feeTypeList">
            {(feeTypes || []).map((f) => (
              <option key={f.feeType} value={f.feeType} />
            ))}
          </datalist>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #f1d7db' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              <Save size={14} /> {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
