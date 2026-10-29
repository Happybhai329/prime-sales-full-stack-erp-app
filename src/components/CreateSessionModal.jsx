import React, { useState } from 'react';
import { X, Calendar, PlusCircle, Check, Loader2 } from 'lucide-react';

export default function CreateSessionModal({ isOpen, onClose, onSessionCreated, currentSession }) {
  const [sessionName, setSessionName] = useState('');
  const [isCurrent, setIsCurrent] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = sessionName.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanName) {
      setError('Please provide a valid session name (e.g., 2027 or 2027-2028).');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          isCurrent
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create academic session.');
      }

      onSessionCreated(data.session);
      setSessionName('');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#ede9fe', padding: 8, borderRadius: 10, color: '#6d28d9' }}>
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="modal-title">Create New Academic Session</h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                Provision dedicated database records and Google Sheet tabs
              </p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose} disabled={isLoading}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {error && (
            <div style={{
              background: '#fef2f2',
              color: '#dc2626',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16,
              border: '1px solid #fecaca'
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#1e293b', marginBottom: 6 }}>
              Academic Session Name / Year <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 2027 or 2027-2028"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 14,
                fontWeight: 600,
                outline: 'none'
              }}
              required
            />
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Current academic session is <strong>{currentSession || '2026'}</strong>.
            </div>
          </div>

          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 20
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={isCurrent}
                onChange={(e) => setIsCurrent(e.target.checked)}
                disabled={isLoading}
                style={{ marginTop: 3, accentColor: '#7c3aed', width: 16, height: 16 }}
              />
              <div style={{ fontSize: 13, color: '#334155' }}>
                <strong>Set as active default session</strong>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b' }}>
                  New admissions, inquiries, and public forms will default to this session.
                </p>
              </div>
            </label>
          </div>

          <div style={{
            background: '#f5f3ff',
            border: '1px dashed #c4b5fd',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 12,
            color: '#5b21b6'
          }}>
            ℹ️ Creating this session will create separate tabs in Google Sheets:
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              <li><code>Admissions_{sessionName || 'XXXX'}</code></li>
              <li><code>Enquiries_{sessionName || 'XXXX'}</code></li>
              <li><code>Cancelled_{sessionName || 'XXXX'}</code></li>
            </ul>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isLoading}
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || !sessionName.trim()}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#7c3aed',
                borderColor: '#6d28d9',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Provisioning Sheets...</span>
                </>
              ) : (
                <>
                  <PlusCircle size={14} />
                  <span>Create Session</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
