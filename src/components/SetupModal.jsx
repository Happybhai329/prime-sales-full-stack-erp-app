import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';

export default function SetupModal({
  isOpen,
  onClose,
  type, // 'academic_program' | 'feestype'
  programs,
  feeTypes,
  onAddItem,
  onDeleteItem
}) {
  if (!isOpen) return null;

  const isPrograms = type === 'academic_program';
  const title = isPrograms ? 'Manage Academic Programs' : 'Manage Fee Types';

  const [inputVal1, setInputVal1] = useState('');
  const [inputVal2, setInputVal2] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!inputVal1.trim()) return;

    setIsAdding(true);
    try {
      const values = isPrograms
        ? [inputVal1.trim()]
        : [inputVal1.trim(), parseFloat(inputVal2) || 0];

      await onAddItem(type, values);
      setInputVal1('');
      setInputVal2('');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Add New Item Form */}
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 18, background: '#fdf2f4', padding: 12, borderRadius: 12 }}>
          <input
            type="text"
            className="form-input"
            style={{ flex: 2 }}
            placeholder={isPrograms ? 'Program Name (e.g. NEET 2Yr)' : 'Fee Type (e.g. Lab Fee)'}
            value={inputVal1}
            onChange={(e) => setInputVal1(e.target.value)}
            required
          />

          {!isPrograms && (
            <input
              type="number"
              className="form-input"
              style={{ flex: 1 }}
              placeholder="Amount (₹)"
              value={inputVal2}
              onChange={(e) => setInputVal2(e.target.value)}
            />
          )}

          <button type="submit" className="btn btn-primary" disabled={isAdding}>
            <Plus size={14} /> Add
          </button>
        </form>

        {/* Existing Items List */}
        <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid #ebd0d5', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Item</th>
                {!isPrograms && <th style={{ padding: '8px 12px', textAlign: 'right' }}>Standard Amount</th>}
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {isPrograms ? (
                programs.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                      No programs defined yet.
                    </td>
                  </tr>
                ) : (
                  programs.map((prog, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{prog}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-delete"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => onDeleteItem(type, idx + 2)}
                          title="Delete program"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )
              ) : feeTypes.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                    No fee types defined yet.
                  </td>
                </tr>
              ) : (
                feeTypes.map((fee, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{fee.feeType}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>
                      ₹{Number(fee.amount || 0).toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-delete"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => onDeleteItem(type, idx + 2)}
                        title="Delete fee type"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
