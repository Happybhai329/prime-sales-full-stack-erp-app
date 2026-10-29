import React, { useState, useRef, useEffect } from 'react';
import {
  RefreshCw,
  PlusCircle,
  ExternalLink,
  FileText,
  Calendar,
  ChevronDown,
  Plus,
  Repeat,
  Check
} from 'lucide-react';

export default function TopNavbar({
  viewTitle,
  syncStatus,
  onRefresh,
  onOpenSetup,
  isRefreshing,
  sessions = [],
  selectedSession = '2026',
  onSelectSession,
  onOpenCreateSession,
  onOpenRenewal
}) {
  const [isSessionDropdownOpen, setIsSessionDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsSessionDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openExternal = (type) => {
    const sessionParam = selectedSession ? `?session=${encodeURIComponent(selectedSession)}` : '';
    const urls = {
      admission: `/admission-form${sessionParam}`,
      enquiry: `/enquiry-form${sessionParam}`,
      studentReport: 'https://prime-student-report-dcbz.onrender.com'
    };
    if (urls[type]) window.open(urls[type], '_blank', 'noopener,noreferrer');
  };

  const isSyncing = isRefreshing || syncStatus?.status === 'syncing';
  const isError = syncStatus?.status === 'error';

  return (
    <header>
      <div className="top-navbar">
        <div className="brand-section">
          <img
            src="/tpc-logo.png"
            alt="The Prime Classes"
            className="brand-logo-img"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = '/tpc-logo.jpg';
            }}
          />
          <div className="brand-block">
            <p className="eyebrow">THE PRIME CLASSES • RIMC | RMS | SAINIK SCHOOL | FOUNDATION</p>
            <h1 className="page-title">
              Sales Dashboard <span className="page-title-highlight">• {viewTitle}</span>
            </h1>
            <p className="header-note">
              Centralized Admissions, Enquiries, Financial Breakups, and Institutional Vouchers
            </p>
          </div>
        </div>

        <div className="navbar-actions">
          {/* Academic Session Selector Pill & Dropdown */}
          <div className="session-picker-container" ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="session-selector-btn"
              onClick={() => setIsSessionDropdownOpen(!isSessionDropdownOpen)}
              title="Switch or manage academic sessions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#f5f3ff',
                border: '1.5px solid #c4b5fd',
                borderRadius: 20,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 700,
                color: '#5b21b6',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <Calendar size={15} color="#7c3aed" />
              <span>Session: <strong>{selectedSession || '2026'}</strong></span>
              <ChevronDown size={14} color="#6d28d9" style={{ transform: isSessionDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>

            {isSessionDropdownOpen && (
              <div
                className="session-dropdown-menu"
                style={{
                  position: 'absolute',
                  top: '115%',
                  right: 0,
                  width: 230,
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                  zIndex: 100,
                  overflow: 'hidden',
                  padding: '6px 0'
                }}
              >
                <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Select Academic Session
                </div>

                {sessions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      onSelectSession(s.name);
                      setIsSessionDropdownOpen(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: selectedSession === s.name ? '#f5f3ff' : 'transparent',
                      color: selectedSession === s.name ? '#6d28d9' : '#1e293b',
                      fontWeight: selectedSession === s.name ? 700 : 500,
                      border: 'none',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span>Session {s.name} {s.is_current ? '(Active)' : ''}</span>
                    {selectedSession === s.name && <Check size={14} color="#7c3aed" />}
                  </button>
                ))}

                <div style={{ height: 1, background: '#e2e8f0', margin: '6px 0' }} />

                <button
                  type="button"
                  onClick={() => {
                    setIsSessionDropdownOpen(false);
                    onOpenCreateSession();
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'transparent',
                    color: '#059669',
                    fontWeight: 600,
                    border: 'none',
                    fontSize: 12,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <Plus size={14} />
                  <span>+ Create New Session</span>
                </button>
              </div>
            )}
          </div>

          <div className={`sync-badge ${isSyncing ? 'syncing' : isError ? 'error' : 'synced'}`}>
            <span className="sync-dot" />
            <span>
              {isSyncing
                ? 'Syncing Sheets...'
                : isError
                  ? 'Sync Alert'
                  : 'Live Synced'}
            </span>
          </div>

          <button
            className="btn btn-primary"
            onClick={onRefresh}
            disabled={isSyncing}
            title="Trigger instant two-way sync with Google Sheets"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Syncing...' : 'Refresh Data'}</span>
          </button>
        </div>
      </div>

      <div className="setup-bar">
        {/* Admission Renewal Action Button */}
        <button
          className="btn btn-setup"
          onClick={onOpenRenewal}
          style={{
            background: '#ecfdf5',
            color: '#047857',
            borderColor: '#a7f3d0',
            fontWeight: 700
          }}
          title="Search old admissions and renew into a new session"
        >
          <Repeat size={14} /> 🔄 Student Renewal
        </button>

        <button
          className="btn btn-setup"
          onClick={onOpenCreateSession}
          style={{
            background: '#fdf4ff',
            color: '#86198f',
            borderColor: '#f5d0fe',
            fontWeight: 600
          }}
          title="Provision a new academic session with isolated sheet tabs"
        >
          <PlusCircle size={14} /> + New Session
        </button>

        <button
          className="btn btn-setup"
          onClick={() => onOpenSetup('academic_program')}
        >
          <PlusCircle size={14} /> + Add Program
        </button>
        <button
          className="btn btn-setup"
          onClick={() => onOpenSetup('feestype')}
        >
          <PlusCircle size={14} /> + Fee Type
        </button>

        <div className="setup-divider" />

        <button
          className="btn btn-link"
          onClick={() => openExternal('admission')}
        >
          <ExternalLink size={13} /> Admission Form ({selectedSession})
        </button>
        <button
          className="btn btn-link"
          onClick={() => openExternal('enquiry')}
        >
          <ExternalLink size={13} /> Enquiry Form ({selectedSession})
        </button>
        <button
          className="btn btn-primary"
          onClick={() => openExternal('studentReport')}
        >
          <FileText size={13} /> Student Live Report
        </button>
      </div>
    </header>
  );
}
