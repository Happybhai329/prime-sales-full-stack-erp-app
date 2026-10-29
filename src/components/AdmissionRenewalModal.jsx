import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  Search,
  User,
  GraduationCap,
  Calendar,
  CreditCard,
  FileCheck,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  ChevronRight,
  Loader2
} from 'lucide-react';

export default function AdmissionRenewalModal({
  isOpen,
  onClose,
  preloadedStudent = null,
  sessions = [],
  currentSession = '2026',
  onRenewSuccess,
  programs = []
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Form fields for renewal
  const [targetSession, setTargetSession] = useState(currentSession || '2026');
  const [studentName, setStudentName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [motherName, setMotherName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [caste, setCaste] = useState('');
  const [studentClass, setStudentClass] = useState('');
  const [program, setProgram] = useState('');
  const [presentSchool, setPresentSchool] = useState('');
  const [completeAddress, setCompleteAddress] = useState('');
  const [fatherOccupation, setFatherOccupation] = useState('');
  const [defenceService, setDefenceService] = useState('');
  const [jobDescription, setJobDescription] = useState('');

  // Session Dates
  const [startSession, setStartSession] = useState('');
  const [endSession, setEndSession] = useState('');

  // Financial fields
  const [registrationFee, setRegistrationFee] = useState(0);
  const [tuitionFee, setTuitionFee] = useState(0);
  const [otherFees, setOtherFees] = useState([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [scholarshipAmount, setScholarshipAmount] = useState(0);
  const [gstPercent, setGstPercent] = useState(0);
  const [installments, setInstallments] = useState([]);
  const [numberOfInstallments, setNumberOfInstallments] = useState(1);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // When modal opens or preloaded student changes
  useEffect(() => {
    if (isOpen) {
      if (preloadedStudent) {
        populateFromRecord(preloadedStudent);
      } else {
        resetForm();
      }
    }
  }, [isOpen, preloadedStudent]);

  // Sync targetSession with available sessions
  useEffect(() => {
    if (sessions.length > 0) {
      // Find a session newer than selected or current
      const defaultS = sessions.find((s) => s.name !== (selectedStudent?.session_name || '2026')) || sessions[0];
      if (defaultS) setTargetSession(defaultS.name);
    }
  }, [sessions, selectedStudent]);

  const resetForm = () => {
    setSelectedStudent(null);
    setSearchQuery('');
    setSearchResults([]);
    setStudentName('');
    setFatherName('');
    setMotherName('');
    setMobile('');
    setEmail('');
    setDob('');
    setCaste('');
    setStudentClass('');
    setProgram('');
    setPresentSchool('');
    setCompleteAddress('');
    setFatherOccupation('');
    setDefenceService('');
    setJobDescription('');
    setRegistrationFee(0);
    setTuitionFee(0);
    setOtherFees([]);
    setDiscountPercent(0);
    setScholarshipAmount(0);
    setGstPercent(0);
    setInstallments([]);
    setError('');
  };

  const populateFromRecord = (rec) => {
    setSelectedStudent(rec);
    const raw = Array.isArray(rec.raw_values)
      ? rec.raw_values
      : typeof rec.raw_values === 'string'
        ? JSON.parse(rec.raw_values || '[]')
        : [];

    setStudentName(rec.student_name || raw[0] || '');
    setFatherName(rec.father_name || raw[1] || '');
    setMotherName(raw[2] || '');

    // Mobile
    let mob = rec.mobile || raw[9] || '';
    if (typeof mob === 'string' && mob.startsWith('[')) {
      try {
        const arr = JSON.parse(mob);
        mob = arr.join(', ');
      } catch (e) {}
    }
    setMobile(mob);

    setEmail(raw[10] || raw[38] || '');
    setDob(raw[8] || '');
    setCaste(raw[11] || raw[37] || '');

    // Promoted class estimation (e.g. 6 -> 7)
    const oldClass = String(raw[15] || '').trim();
    const classNum = parseInt(oldClass, 10);
    if (!isNaN(classNum) && classNum < 12) {
      setStudentClass(String(classNum + 1));
    } else {
      setStudentClass(oldClass);
    }

    setProgram(rec.program || raw[23] || '');
    setPresentSchool(raw[16] || '');
    setCompleteAddress(raw[39] || '');
    setFatherOccupation(raw[12] || '');
    setDefenceService(raw[13] || '');
    setJobDescription(raw[14] || '');

    // Default dates for new session
    const nextYr = parseInt(targetSession, 10) || (new Date().getFullYear() + 1);
    setStartSession(`${nextYr}-04-01`);
    setEndSession(`${nextYr + 1}-03-31`);

    // Prior fee structure as baseline
    const regFee = parseFloat(raw[24] || 0) || 0;
    const tuiFee = parseFloat(raw[25] || 0) || 0;
    setRegistrationFee(regFee);
    setTuitionFee(tuiFee);

    // Other fees
    try {
      const parsedOther = JSON.parse(raw[26] || '[]');
      setOtherFees(Array.isArray(parsedOther) ? parsedOther : []);
    } catch (e) {
      setOtherFees([]);
    }

    setDiscountPercent(parseFloat(raw[29] || 0) || 0);
    setScholarshipAmount(parseFloat(raw[30] || 0) || 0);
    setGstPercent(parseFloat(raw[31] || 0) || 0);
  };

  // Live search handler
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const res = await fetch(`/api/admissions/search-previous?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.admissions || []);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Calculations
  const extraFeesTotal = otherFees.reduce((sum, f) => sum + (parseFloat(f.amount || 0) || 0), 0);
  const baseSubtotal = (parseFloat(registrationFee) || 0) + (parseFloat(tuitionFee) || 0) + extraFeesTotal;
  const discountVal = (baseSubtotal * (parseFloat(discountPercent) || 0)) / 100;
  const netAfterDiscount = Math.max(0, baseSubtotal - discountVal - (parseFloat(scholarshipAmount) || 0));
  const gstVal = (netAfterDiscount * (parseFloat(gstPercent) || 0)) / 100;
  const finalCost = Math.round(netAfterDiscount + gstVal);

  // Recalculate installments when final cost changes
  const generateInstallments = (count) => {
    const n = Math.max(1, parseInt(count, 10) || 1);
    setNumberOfInstallments(n);
    const perInst = Math.floor(finalCost / n);
    const rem = finalCost - perInst * n;

    const newInst = [];
    const today = new Date();
    for (let i = 1; i <= n; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + (i - 1) * 2, 10);
      newInst.push({
        installmentNumber: String(i),
        amount: String(i === 1 ? perInst + rem : perInst),
        date: d.toISOString().split('T')[0],
        paid: 'false'
      });
    }
    setInstallments(newInst);
  };

  // Submit Renewal
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStudent && !preloadedStudent) {
      setError('Please select a student to renew.');
      return;
    }
    if (!targetSession) {
      setError('Please choose a target academic session.');
      return;
    }
    if (!studentName.trim() || !studentClass.trim()) {
      setError('Student name and promoted class are required.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const payload = {
        targetSession,
        oldSession: selectedStudent?.session_name || '2026',
        oldRowNumber: selectedStudent?.row_number || selectedStudent?.rowNumber,
        studentName,
        fatherName,
        motherName,
        dob,
        mobile,
        email,
        caste,
        fatherOccupation,
        defenceService,
        jobDescription,
        studentClass,
        presentSchool,
        completeAddress,
        program,
        startSession,
        endSession,
        registrationFee: parseFloat(registrationFee) || 0,
        tuitionFee: parseFloat(tuitionFee) || 0,
        otherFees,
        installmentDetails: {
          totalInstallments: installments.length,
          paidInstallments: 0,
          remainingInstallments: installments.length,
          paidAmount: 0,
          pendingAmount: finalCost,
          installments
        },
        totalAmount: baseSubtotal,
        discountPercent: parseFloat(discountPercent) || 0,
        scholarshipAmount: parseFloat(scholarshipAmount) || 0,
        gstPercent: parseFloat(gstPercent) || 0,
        finalCost,
        termsAgreement: 'Agreed (Academic Renewal)'
      };

      const res = await fetch('/api/admissions/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Renewal failed.');
      }

      onRenewSuccess(data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 840, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#ecfdf5', padding: 8, borderRadius: 10, color: '#059669' }}>
              <RefreshCw size={20} />
            </div>
            <div>
              <h2 className="modal-title">Student Admission Renewal</h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                Re-enroll student into a new academic session with updated class & fee structure
              </p>
            </div>
          </div>
          <button className="btn-close" onClick={onClose} disabled={isSubmitting}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
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

          {/* 1. Student Selector / Search (if not preloaded) */}
          {!selectedStudent ? (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#1e293b', marginBottom: 6 }}>
                🔍 Search Enrolled Student from Previous Sessions
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Type student name, phone number, father's name, or student ID..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                    outline: 'none'
                  }}
                  autoFocus
                />
                {isSearching && (
                  <Loader2 size={16} className="animate-spin" style={{ position: 'absolute', right: 12, top: 12, color: '#7c3aed' }} />
                )}
              </div>

              {/* Search Results Dropdown / List */}
              {searchResults.length > 0 && (
                <div style={{
                  marginTop: 8,
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  maxHeight: 220,
                  overflowY: 'auto',
                  background: '#ffffff',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.06)'
                }}>
                  {searchResults.map((rec) => (
                    <div
                      key={`${rec.session_name}_${rec.row_number}`}
                      onClick={() => populateFromRecord(rec)}
                      style={{
                        padding: '10px 14px',
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
                    >
                      <div>
                        <strong style={{ fontSize: 13, color: '#0f172a' }}>{rec.student_name}</strong>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          Father: {rec.father_name || 'N/A'} • Contact: {rec.mobile || 'N/A'} • Program: {rec.program || 'N/A'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          background: '#ede9fe',
                          color: '#6d28d9',
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 6
                        }}>
                          Session {rec.session_name || '2026'}
                        </span>
                        <ChevronRight size={14} color="#94a3b8" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                  Selected Student for Renewal
                </span>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                  {studentName} <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>(Original Session: {selectedStudent.session_name || '2026'})</span>
                </div>
                <div style={{ fontSize: 12, color: '#475569' }}>
                  Father: {fatherName} • Contact: {mobile}
                </div>
              </div>
              <button
                type="button"
                onClick={resetForm}
                style={{
                  background: 'none',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 11,
                  color: '#475569',
                  cursor: 'pointer'
                }}
              >
                Change Student
              </button>
            </div>
          )}

          {/* Renewal Form */}
          {selectedStudent && (
            <form onSubmit={handleSubmit}>
              {/* Target Academic Session */}
              <div style={{
                background: '#f5f3ff',
                border: '1px solid #c4b5fd',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 18,
                display: 'flex',
                alignItems: 'center',
                gap: 12
              }}>
                <GraduationCap size={20} color="#7c3aed" />
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#5b21b6', marginBottom: 4 }}>
                    RENEW INTO ACADEMIC SESSION <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={targetSession}
                    onChange={(e) => setTargetSession(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid #a78bfa',
                      fontSize: 13,
                      fontWeight: 600,
                      background: '#fff',
                      color: '#4c1d95'
                    }}
                    required
                  >
                    {sessions.map((s) => (
                      <option key={s.name} value={s.name}>
                        Academic Session {s.name} {s.is_current ? '(Current Active)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Student Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Student Full Name *
                  </label>
                  <input
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Promoted Class *
                  </label>
                  <input
                    type="text"
                    value={studentClass}
                    onChange={(e) => setStudentClass(e.target.value)}
                    placeholder="e.g. 7th, 8th, 9th"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 600 }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Academic Program
                  </label>
                  <input
                    type="text"
                    value={program}
                    onChange={(e) => setProgram(e.target.value)}
                    placeholder="e.g. PRE FOUNDATION"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Contact Mobile Number *
                  </label>
                  <input
                    type="text"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Father's Name
                  </label>
                  <input
                    type="text"
                    value={fatherName}
                    onChange={(e) => setFatherName(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Parent Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student@example.com"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                  />
                </div>
              </div>

              {/* Fee Breakdown & Financials */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '14px 16px',
                marginBottom: 16
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                  <CreditCard size={16} color="#0f766e" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0f766e' }}>
                    Fee Structure for Renewal (Session {targetSession})
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                      Registration Fee (₹)
                    </label>
                    <input
                      type="number"
                      value={registrationFee}
                      onChange={(e) => setRegistrationFee(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                      Tuition Fee (₹)
                    </label>
                    <input
                      type="number"
                      value={tuitionFee}
                      onChange={(e) => setTuitionFee(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                      Discount (%)
                    </label>
                    <input
                      type="number"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                      GST (%)
                    </label>
                    <input
                      type="number"
                      value={gstPercent}
                      onChange={(e) => setGstPercent(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                    />
                  </div>
                </div>

                {/* Net Payable Badge */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#f1f5f9',
                  padding: '10px 14px',
                  borderRadius: 6,
                  marginTop: 8
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                    Calculated Net Payable Cost:
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#059669' }}>
                    ₹{finalCost.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Installments Setup */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                    Installments Schedule ({installments.length})
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[1, 2, 3, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        onClick={() => generateInstallments(count)}
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 4,
                          border: numberOfInstallments === count ? '1px solid #7c3aed' : '1px solid #cbd5e1',
                          background: numberOfInstallments === count ? '#ede9fe' : '#fff',
                          color: numberOfInstallments === count ? '#6d28d9' : '#475569',
                          cursor: 'pointer'
                        }}
                      >
                        {count} {count === 1 ? 'Lump Sum' : 'Parts'}
                      </button>
                    ))}
                  </div>
                </div>

                {installments.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                    {installments.map((inst, i) => (
                      <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
                          Part #{inst.installmentNumber}
                        </div>
                        <input
                          type="number"
                          value={inst.amount}
                          onChange={(e) => {
                            const val = e.target.value;
                            setInstallments((prev) =>
                              prev.map((item, idx) => (idx === i ? { ...item, amount: val } : item))
                            );
                          }}
                          placeholder="Amount"
                          style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12, marginBottom: 4 }}
                        />
                        <input
                          type="date"
                          value={inst.date}
                          onChange={(e) => {
                            const val = e.target.value;
                            setInstallments((prev) =>
                              prev.map((item, idx) => (idx === i ? { ...item, date: val } : item))
                            );
                          }}
                          style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 11 }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={isSubmitting}
                  style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 8,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#059669',
                    borderColor: '#047857',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Renewing Student...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={14} />
                      <span>Confirm Renewal for {targetSession}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
