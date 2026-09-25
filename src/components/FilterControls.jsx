import React from 'react';
import { Search, Calendar, Filter, RotateCcw } from 'lucide-react';

export default function FilterControls({
  search,
  onSearchChange,
  timeFilter,
  onTimeFilterChange,
  programFilter,
  onProgramFilterChange,
  programOptions,
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
  onApplyDateFilter,
  onResetDateFilter,
  activeTab,
  filteredCount,
  totalCount
}) {
  const tabDateLabels = {
    inquiries: 'Enquiry Date / Timestamp',
    admissions: 'Admission / Application Date',
    cancelled: 'Cancellation Date',
    conversions: 'Admission / Application Date'
  };

  return (
    <div className="controls">
      <div className="controls-row">
        {/* Search Input */}
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94a3b8'
            }}
          />
          <input
            type="text"
            className="search-input"
            style={{ paddingLeft: 36, width: '100%' }}
            placeholder="Search records by name, mobile, father, course..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        {/* Time Preset Filter */}
        <select
          className="select-filter"
          value={timeFilter}
          onChange={(e) => onTimeFilterChange(e.target.value)}
        >
          <option value="all">All Time</option>
          <option value="weekly">This Week</option>
          <option value="monthly">This Month</option>
          <option value="yearly">This Year</option>
        </select>

        {/* Academic Program Filter */}
        <select
          className="select-filter"
          value={programFilter}
          onChange={(e) => onProgramFilterChange(e.target.value)}
        >
          <option value="all">All Programs</option>
          {programOptions.map((prog) => (
            <option key={prog} value={prog}>
              {prog}
            </option>
          ))}
        </select>

        {/* Date Range Inputs */}
        <input
          type="date"
          className="date-input"
          value={fromDate}
          onChange={(e) => onFromDateChange(e.target.value)}
          title="From Date"
        />
        <input
          type="date"
          className="date-input"
          value={toDate}
          onChange={(e) => onToDateChange(e.target.value)}
          title="To Date"
        />

        <button
          className="btn btn-primary"
          type="button"
          onClick={onApplyDateFilter}
        >
          <Filter size={13} /> Apply
        </button>

        <button
          className="btn btn-secondary"
          type="button"
          onClick={onResetDateFilter}
          title="Reset date filters"
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>

      <div className="filter-meta">
        <div className="filter-pill">
          <strong>Date Field:</strong> {tabDateLabels[activeTab] || 'Record Date'}
        </div>
        <div className="filter-pill">
          <strong>Records:</strong> {filteredCount} of {totalCount}
        </div>
      </div>
    </div>
  );
}
