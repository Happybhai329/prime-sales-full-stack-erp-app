import React, { useState, useEffect, useCallback } from 'react';
import TopNavbar from './components/TopNavbar';
import StatsOverview from './components/StatsOverview';
import FilterControls from './components/FilterControls';
import RecordsTable from './components/RecordsTable';
import EditRecordModal from './components/EditRecordModal';
import VoucherModal from './components/VoucherModal';
import SetupModal from './components/SetupModal';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('admissions');
  const [stats, setStats] = useState({
    active: 0,
    inquiries: 0,
    cancelled: 0,
    conversions: 0,
    conversionRate: 0
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

  // Fetch Dashboard Stats & Masters
  const fetchDashboardOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setPrograms(data.programs || []);
        setFeeTypes(data.feeTypes || []);
        setSyncStatus(data.sync);
      }
    } catch (err) {
      console.error('Failed to load dashboard overview:', err);
    }
  }, []);

  // Fetch Records with filters
  const fetchRecords = useCallback(
    async (tab, searchVal, progVal, timeVal, range) => {
      setIsLoadingRecords(true);
      try {
        const queryParams = new URLSearchParams({
          tab,
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
    []
  );

  // Initial load
  useEffect(() => {
    fetchDashboardOverview();
  }, [fetchDashboardOverview]);

  // Load records whenever tab or applied filters change
  useEffect(() => {
    fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange);
  }, [activeTab, search, programFilter, timeFilter, appliedDateRange, fetchRecords]);

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
      await fetchDashboardOverview();
      await fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange);
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
          sheetName: editModal.record?.sheetName
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Record updated successfully');
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange);
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
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        showToast('Admission moved to Cancelled Log');
        fetchDashboardOverview();
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange);
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
        method: 'POST'
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
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange);
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
      const res = await fetch(`/api/admissions/${row.rowNumber}/voucher-preview`);
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
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Voucher status updated to ${newStatus}`);
        setVoucherModal((prev) => ({ ...prev, status: newStatus }));
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange);
      } else {
        showToast(data.error || 'Failed to update status', 'error');
      }
    } catch (err) {
      showToast('Network error updating status', 'error');
    }
  };

  // Download Single Record Form PDF
  const handleDownloadRecordPdf = (row) => {
    window.open(`/api/records/${activeTab}/${row.rowNumber}/pdf`, '_blank');
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
        body: JSON.stringify({ ssId: row.ssId, sheetName: row.sheetName })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Record deleted successfully');
        fetchDashboardOverview();
        fetchRecords(activeTab, search, programFilter, timeFilter, appliedDateRange);
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
      fetchDashboardOverview();
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
      fetchDashboardOverview();
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
      {/* Top Navbar */}
      <TopNavbar
        viewTitle={tabLabels[activeTab]}
        syncStatus={syncStatus}
        onRefresh={handleRefresh}
        onOpenSetup={(type) => setSetupModal({ isOpen: true, type })}
        isRefreshing={isRefreshing}
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
            <p className="panel-kicker">Institutional Data Center</p>
            <h2 className="panel-title">{tabLabels[activeTab]}</h2>
          </div>
          <div className="panel-hint">Touch or swipe horizontally to view all fields</div>
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
          isLoading={isLoadingRecords}
        />
      </div>

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
