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
    inquiries: 'Enquiry Date',
    admissions: 'Admission Date',
    cancelled: 'Cancellation Date',
    conversions: 'Admission Date'
  };

  return (
    <div className="controls">
      {/* Search Input Row (Full width on mobile) */}
      <div className="search-control-wrap">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Search records by name, mobile, father, course..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Select Filters & Date Range Grid */}
      <div className="filters-control-grid">
        {/* Time Preset Filter */}
        <div className="filter-field">
          <label className="filter-label">Timeframe</label>
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
        </div>

        {/* Academic Program Filter */}
        <div className="filter-field">
          <label className="filter-label">Program / Wing</label>
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
        </div>

        {/* From Date */}
        <div className="filter-field">
          <label className="filter-label">From Date</label>
          <input
            type="date"
            className="date-input"
            value={fromDate}
            onChange={(e) => onFromDateChange(e.target.value)}
          />
        </div>

        {/* To Date */}
        <div className="filter-field">
          <label className="filter-label">To Date</label>
          <input
            type="date"
            className="date-input"
            value={toDate}
            onChange={(e) => onToDateChange(e.target.value)}
          />
        </div>
      </div>

      {/* Action Buttons & Meta Summary */}
      <div className="controls-footer-row">
        <div className="filter-action-buttons">
          <button
            className="btn btn-primary btn-apply"
            type="button"
            onClick={onApplyDateFilter}
          >
            <Filter size={13} /> Apply Filter
          </button>
          <button
            className="btn btn-secondary btn-reset"
            type="button"
            onClick={onResetDateFilter}
            title="Reset all filters"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>

        <div className="filter-meta">
          <span className="filter-pill">
            <strong>Date Field:</strong> {tabDateLabels[activeTab] || 'Date'}
          </span>
          <span className="filter-pill records-count-pill">
            <strong>Records:</strong> {filteredCount} of {totalCount}
          </span>
        </div>
      </div>
    </div>
  );
}
