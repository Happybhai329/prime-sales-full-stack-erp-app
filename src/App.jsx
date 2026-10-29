import React, { useState, useEffect, useCallback } from 'react';
import TopNavbar from './components/TopNavbar';
import StatsOverview from './components/StatsOverview';
import FilterControls from './components/FilterControls';
import RecordsTable from './components/RecordsTable';
import EditRecordModal from './components/EditRecordModal';
import VoucherModal from './components/VoucherModal';
import SetupModal from './components/SetupModal';
import CreateSessionModal from './components/CreateSessionModal';
import AdmissionRenewalModal from './components/AdmissionRenewalModal';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('admissions');
  const [stats, setStats] = useState({
    activeAdmissions: 0,
    inquiries: 0,
    cancelled: 0,
    conversions: 0,
    conversionRate: 0
  });

  // Multi-Session Management States
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(() => {
    return localStorage.getItem('prime_selected_session') || '2026';
  });
  const [currentSession, setCurrentSession] = useState('2026');
  const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
  const [renewalModal, setRenewalModal] = useState({
    isOpen: false,
    preloadedStudent: null
  });

  const [programs, setPrograms] = useState([]);
  const [feeTypes, setFeeTypes] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);

  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);

  // Filter States
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState('all');
  const [programFilter, setProgramFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedDateRange, setAppliedDateRange] = useState({ from: '', to: '' });

  // UI States
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Modals
  const [editModal, setEditModal] = useState({ isOpen: false, record: null });
  const [voucherModal, setVoucherModal] = useState({
    isOpen: false,
    voucherData: null,
    pdfUrl: '',
    status: 'Not Given',
    rowNumber: null,
    isGenerating: false
  });
  const [setupModal, setSetupModal] = useState({ isOpen: false, type: 'academic_program' });

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Fetch Dashboard Stats & Masters (Session Aware)
  const fetchDashboardOverview = useCallback(async (sessionToFetch = selectedSession) => {
    try {
      const res = await fetch(`/api/dashboard?session=${encodeURIComponent(sessionToFetch)}`);
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setPrograms(data.programs || []);
        setFeeTypes(data.feeTypes || []);
        setSyncStatus(data.sync);
        if (data.sessions && data.sessions.length > 0) {
          setSessions(data.sessions);
        }
        if (data.currentSession?.name) {
          setCurrentSession(data.currentSession.name);
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard overview:', err);
    }
  }, [selectedSession]);

  // Fetch Records with filters (Session Aware)
  const fetchRecords = useCallback(
    async (tab, searchVal, progVal, timeVal, range, sessVal = selectedSession) => {
      setIsLoadingRecords(true);
      try {
        const queryParams = new URLSearchParams({
          tab,
          session: sessVal || '2026',
          search: searchVal || '',
          program: progVal || 'all',
          timeFilter: timeVal || 'all',
          from: range?.from || '',
          to: range?.to || ''
        });

        const res = await fetch(`/api/records?${queryParams.toString()}`);
        const data = await res.json();

        setHeaders(data.headers || []);
        setRows(data.rows || []);
        setTotalCount(data.totalCount || 0);
      } catch (err) {
        console.error('Failed to fetch records:', err);
        showToast('Error loading records', 'error');
      } finally {
        setIsLoadingRecords(false);
      }
    },
    [selectedSession]
  );

  // Initial load
  useEffect(() => {
    fetchDashboardOverview(selectedSession);
  }, [fetchDashboardOverview, selectedSession]);

  // Load records whenever tab, session, or applied filters change
  useEffect(() => {
    fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
  }, [activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession, fetchRecords]);

  // Handle Session Switching
  const handleSelectSession = (newSession) => {
    setSelectedSession(newSession);
    localStorage.setItem('prime_selected_session', newSession);
    showToast(`Switched to Academic Session ${newSession}`);
  };

  // Handle New Session Created
  const handleSessionCreated = (newSessionObj) => {
    setSessions((prev) => [...prev, newSessionObj]);
    handleSelectSession(newSessionObj.name);
    showToast(`Academic Session ${newSessionObj.name} created successfully!`, 'success');
    fetchDashboardOverview(newSessionObj.name);
  };

  // Handle Renewal Success
  const handleRenewSuccess = (data) => {
    showToast(data.message || 'Student renewed successfully!', 'success');
    if (data.session && data.session !== selectedSession) {
      handleSelectSession(data.session);
    } else {
      fetchDashboardOverview(selectedSession);
      fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
    }
  };

  // Refresh & Two-Way Sync
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/sync/trigger', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(`Sync completed in ${data.elapsedMs}ms`);
      } else {
        showToast(data.message || 'Sync queued', 'success');
      }
      await fetchDashboardOverview(selectedSession);
      await fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
    } catch (err) {
      showToast('Sync request failed', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Date Filter Handlers
  const handleApplyDateFilter = () => {
    setAppliedDateRange({ from: fromDate, to: toDate });
  };

  const handleResetDateFilter = () => {
    setFromDate('');
    setToDate('');
    setAppliedDateRange({ from: '', to: '' });
  };

  // Tab Switcher
  const handleSelectTab = (tab) => {
    setActiveTab(tab);
  };

  // Record Update (Inline Edit)
  const handleSaveRecord = async (rowNumber, values) => {
    try {
      const res = await fetch(`/api/records/${activeTab}/${rowNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values,
          ssId: editModal.record?.ssId,
          sheetName: editModal.record?.sheetName,
          session: selectedSession
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Record updated successfully');
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
      } else {
        showToast(data.error || 'Failed to update record', 'error');
      }
    } catch (err) {
      showToast('Network error while updating record', 'error');
    }
  };

  // Cancel Admission
  const handleCancelAdmission = async (rowNumber) => {
    if (!window.confirm(`Are you sure you want to cancel admission #${rowNumber} and move to Cancelled Log?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admissions/${rowNumber}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: selectedSession })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Admission moved to Cancelled Log');
        fetchDashboardOverview(selectedSession);
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
      } else {
        showToast(data.error || 'Failed to cancel admission', 'error');
      }
    } catch (err) {
      showToast('Network error while cancelling admission', 'error');
    }
  };

  // Generate Institutional Fee Voucher
  const handleGenerateVoucher = async (rowNumber) => {
    setVoucherModal((prev) => ({ ...prev, isGenerating: true }));
    try {
      const res = await fetch(`/api/admissions/${rowNumber}/voucher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: selectedSession })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Voucher PDF generated & synced with Google Drive');
        setVoucherModal({
          isOpen: true,
          voucherData: data.voucherData,
          pdfUrl: data.pdfUrl,
          status: 'Given',
          rowNumber,
          isGenerating: false
        });
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
      } else {
        showToast(data.error || 'Voucher generation failed', 'error');
        setVoucherModal((prev) => ({ ...prev, isGenerating: false }));
      }
    } catch (err) {
      showToast('Error generating voucher', 'error');
      setVoucherModal((prev) => ({ ...prev, isGenerating: false }));
    }
  };

  // Preview Voucher Breakup
  const handlePreviewVoucher = async (row) => {
    try {
      const res = await fetch(`/api/admissions/${row.rowNumber}/voucher-preview?session=${encodeURIComponent(selectedSession)}`);
      const data = await res.json();
      if (data.success) {
        setVoucherModal({
          isOpen: true,
          voucherData: data.voucherData,
          pdfUrl: data.pdfUrl,
          status: data.status,
          rowNumber: row.rowNumber,
          isGenerating: false
        });
      } else {
        showToast(data.error || 'Failed to load voucher preview', 'error');
      }
    } catch (err) {
      showToast('Network error loading preview', 'error');
    }
  };

  // Toggle Voucher Status (Given / Not Given)
  const handleToggleVoucherStatus = async (rowNumber, newStatus) => {
    try {
      const res = await fetch(`/api/admissions/${rowNumber}/voucher-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, session: selectedSession })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Voucher status updated to ${newStatus}`);
        setVoucherModal((prev) => ({ ...prev, status: newStatus }));
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
      } else {
        showToast(data.error || 'Failed to update status', 'error');
      }
    } catch (err) {
      showToast('Network error updating status', 'error');
    }
  };

  // Download Single Record Form PDF
  const handleDownloadRecordPdf = (row) => {
    window.open(`/api/records/${activeTab}/${row.rowNumber}/pdf?session=${encodeURIComponent(selectedSession)}`, '_blank');
  };

  // Permanently Delete Record
  const handleDeleteRecord = async (row) => {
    if (!window.confirm(`Permanently delete row #${row.rowNumber}? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/records/${activeTab}/${row.rowNumber}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssId: row.ssId,
          sheetName: row.sheetName,
          session: selectedSession
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Record deleted successfully');
        fetchDashboardOverview(selectedSession);
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange, selectedSession);
      } else {
        showToast(data.error || 'Failed to delete record', 'error');
      }
    } catch (err) {
      showToast('Error deleting record', 'error');
    }
  };

  // Setup Items (Add & Delete)
  const handleAddSetupItem = async (sheetName, values) => {
    const res = await fetch(`/api/setup/${sheetName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Master item added');
      fetchDashboardOverview(selectedSession);
    } else {
      showToast(data.error || 'Failed to add item', 'error');
    }
  };

  const handleDeleteSetupItem = async (sheetName, idOrRow) => {
    if (!window.confirm('Delete this setup item?')) return;
    const res = await fetch(`/api/setup/${sheetName}/${idOrRow}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Master item deleted');
      fetchDashboardOverview(selectedSession);
    } else {
      showToast(data.error || 'Failed to delete item', 'error');
    }
  };

  const tabLabels = {
    admissions: 'Active Admissions',
    inquiries: 'Inquiries Log',
    cancelled: 'Cancelled Admissions',
    conversions: 'Enquiry-to-Admission Conversions'
  };

  return (
    <div className="app-shell">
      {/* Top Navbar with Academic Session Selector & Renewal Button */}
      <TopNavbar
        viewTitle={tabLabels[activeTab]}
        syncStatus={syncStatus}
        onRefresh={handleRefresh}
        onOpenSetup={(type) => setSetupModal({ isOpen: true, type })}
        isRefreshing={isRefreshing}
        sessions={sessions}
        selectedSession={selectedSession}
        onSelectSession={handleSelectSession}
        onOpenCreateSession={() => setIsCreateSessionOpen(true)}
        onOpenRenewal={() => setRenewalModal({ isOpen: true, preloadedStudent: null })}
      />

      {/* KPI Metric Overview Cards */}
      <StatsOverview
        stats={stats}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
      />

      {/* Data Center Panel */}
      <div className="data-panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Institutional Data Center • Session {selectedSession}</p>
            <h2 className="panel-title">{tabLabels[activeTab]}</h2>
          </div>
          <div className="panel-hint">
            Touch or swipe horizontally to view all fields • Academic Session: {selectedSession}
          </div>
        </div>

        {/* Filter Controls */}
        <FilterControls
          search={search}
          onSearchChange={setSearch}
          timeFilter={timeFilter}
          onTimeFilterChange={setTimeFilter}
          programFilter={programFilter}
          onProgramFilterChange={setProgramFilter}
          programOptions={programs}
          fromDate={fromDate}
          onFromDateChange={setFromDate}
          toDate={toDate}
          onToDateChange={setToDate}
          onApplyDateFilter={handleApplyDateFilter}
          onResetDateFilter={handleResetDateFilter}
          activeTab={activeTab}
          filteredCount={rows.length}
          totalCount={totalCount}
        />

        {/* Responsive Touch Table */}
        <RecordsTable
          headers={headers}
          rows={rows}
          activeTab={activeTab}
          onEditRecord={(record) => setEditModal({ isOpen: true, record })}
          onGenerateVoucher={handleGenerateVoucher}
          onPreviewVoucher={handlePreviewVoucher}
          onToggleVoucherStatus={handleToggleVoucherStatus}
          onCancelAdmission={handleCancelAdmission}
          onDownloadRecordPdf={handleDownloadRecordPdf}
          onDeleteRecord={handleDeleteRecord}
          onRenewAdmission={(record) => setRenewalModal({ isOpen: true, preloadedStudent: record })}
          isLoading={isLoadingRecords}
        />
      </div>

      {/* Create New Academic Session Modal */}
      <CreateSessionModal
        isOpen={isCreateSessionOpen}
        onClose={() => setIsCreateSessionOpen(false)}
        onSessionCreated={handleSessionCreated}
        currentSession={currentSession}
      />

      {/* Student Admission Renewal Modal */}
      <AdmissionRenewalModal
        isOpen={renewalModal.isOpen}
        onClose={() => setRenewalModal({ isOpen: false, preloadedStudent: null })}
        preloadedStudent={renewalModal.preloadedStudent}
        sessions={sessions}
        currentSession={selectedSession}
        onRenewSuccess={handleRenewSuccess}
        programs={programs}
      />

      {/* Edit Record Modal with Visual JSON Form Builders */}
      <EditRecordModal
        isOpen={editModal.isOpen}
        onClose={() => setEditModal({ isOpen: false, record: null })}
        record={editModal.record}
        headers={headers}
        feeTypes={feeTypes}
        onSave={handleSaveRecord}
      />

      {/* Voucher Breakup Preview & PDF Modal */}
      <VoucherModal
        isOpen={voucherModal.isOpen}
        onClose={() =>
          setVoucherModal({
            isOpen: false,
            voucherData: null,
            pdfUrl: '',
            status: 'Not Given',
            rowNumber: null,
            isGenerating: false
          })
        }
        voucherData={voucherModal.voucherData}
        pdfUrl={voucherModal.pdfUrl}
        status={voucherModal.status}
        rowNumber={voucherModal.rowNumber}
        onGenerateVoucher={handleGenerateVoucher}
        onToggleStatus={handleToggleVoucherStatus}
        isGenerating={voucherModal.isGenerating}
      />

      {/* Setup Masters Management Modal */}
      <SetupModal
        isOpen={setupModal.isOpen}
        onClose={() => setSetupModal({ isOpen: false, type: 'academic_program' })}
        type={setupModal.type}
        programs={programs}
        feeTypes={feeTypes}
        onAddItem={handleAddSetupItem}
        onDeleteItem={handleDeleteSetupItem}
      />

      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
