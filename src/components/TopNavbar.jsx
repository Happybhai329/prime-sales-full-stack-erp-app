import React from 'react';
import { RefreshCw, PlusCircle, ExternalLink, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

export default function TopNavbar({
  viewTitle,
  syncStatus,
  onRefresh,
  onOpenSetup,
  isRefreshing
}) {
  const openExternal = (type) => {
    const urls = {
      admission: '/admission-form',
      enquiry: '/enquiry-form',
      studentReport: 'https://prime-student-report.onrender.com'
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
              Management <span className="page-title-highlight">{viewTitle}</span>
            </h1>
            <p className="header-note">
              Centralized Admissions, Enquiries, Financial Breakups, and Institutional Vouchers
            </p>
          </div>
        </div>

        <div className="navbar-actions">
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
          <ExternalLink size={13} /> Admission Form
        </button>
        <button
          className="btn btn-link"
          onClick={() => openExternal('enquiry')}
        >
          <ExternalLink size={13} /> Enquiry Form
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
