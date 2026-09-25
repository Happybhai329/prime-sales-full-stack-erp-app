import React from 'react';
import { Users, GraduationCap, UserX, TrendingUp } from 'lucide-react';

export default function StatsOverview({ stats, activeTab, onSelectTab }) {
  return (
    <div className="stats-container">
      {/* 1. Inquiries Card */}
      <div
        className={`stat-card ${activeTab === 'inquiries' ? 'active' : ''}`}
        onClick={() => onSelectTab('inquiries')}
      >
        <div className="stat-label">Inquiries</div>
        <div className="stat-value">
          <Users size={24} color="#6366f1" style={{ opacity: 0.9 }} />
          <span>{stats?.inquiries || 0}</span>
        </div>
        <div className="stat-subline">Prospective student leads</div>
      </div>

      {/* 2. Active Admissions Card */}
      <div
        className={`stat-card ${activeTab === 'admissions' ? 'active' : ''}`}
        onClick={() => onSelectTab('admissions')}
      >
        <div className="stat-label">Active Admissions</div>
        <div className="stat-value">
          <GraduationCap size={24} color="#16a34a" style={{ opacity: 0.9 }} />
          <span>{stats?.active || 0}</span>
        </div>
        <div className="stat-subline">Enrolled student records</div>
      </div>

      {/* 3. Cancelled Admissions Log Card */}
      <div
        className={`stat-card ${activeTab === 'cancelled' ? 'active' : ''}`}
        onClick={() => onSelectTab('cancelled')}
      >
        <div className="stat-label">Cancelled Log</div>
        <div className="stat-value">
          <UserX size={24} color="#ef4444" style={{ opacity: 0.9 }} />
          <span>{stats?.cancelled || 0}</span>
        </div>
        <div className="stat-subline">Withdrawn & cancelled admissions</div>
      </div>

      {/* 4. Conversions & Conversion Rate Card */}
      <div
        className={`stat-card stat-card-conversion ${activeTab === 'conversions' ? 'active' : ''}`}
        onClick={() => onSelectTab('conversions')}
      >
        <div className="stat-label">Conversions</div>
        <div className="stat-value">
          <TrendingUp size={24} color="#d97706" style={{ opacity: 0.9 }} />
          <span>{stats?.conversions || 0}</span>
          <span className="stat-suffix">students</span>
        </div>
        <div className="stat-meta">
          <span>{stats?.conversionRate || 0}%</span> conversion rate
        </div>
        <div className="stat-subline">Matched by ID, Phone, or Name</div>
      </div>
    </div>
  );
}
