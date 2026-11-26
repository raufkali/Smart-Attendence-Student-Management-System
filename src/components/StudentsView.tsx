import React, { useEffect, useState } from 'react';
import { UserPlus, QrCode, Eye, Search, Printer, X, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../api/client';
import { formatCurrency } from '../shared/rules';
import type { StudentRecord } from '../shared/types';

interface AnalyticsPayload {
  student: StudentRecord;
  enrollmentHistory: Array<{
    id: number;
    academic_year: string;
    class_name: string;
    semester: string;
    section: string;
    action_type: string;
    effective_date: string;
    notes: string;
  }>;
  attendance: {
    overall: { totalSessions: number; presentCount: number; absentCount: number; lateCount: number; excusedCount: number; percentage: number };
    consecutiveAbsences: number;
    subjectWise: Array<{ course_code: string; course_name: string; totalSessions: number; presentCount: number; absentCount: number; percentage: number }>;
  };
  finance: {
    totalBilledCents: number;
    totalDiscountsCents: number;
    totalPaidCents: number;
    outstandingCents: number;
    overdueCents: number;
    invoices: Array<{ id: number; invoice_number: string; billing_period: string; due_date: string; total_cents: number; paid_cents: number; status: string }>;
    payments: Array<{ id: number; receipt_number: string; amount_cents: number; method: string; payment_date: string }>;
    fines: Array<{ id: number; fine_type: string; amount_cents: number; status: string; reason: string }>;
  };
  profileCompletion: { percentage: number; missingFields: string[] };
}

export const StudentsView: React.FC = () => {
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkSection, setBulkSection] = useState('');

  // Admission Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [admForm, setAdmForm] = useState({
    student_code: '',
    full_name: '',
    guardian_name: '',
    gender: 'Female',
    dob: '2006-06-15',
    phone: '',
    guardian_phone: '',
    email: '',
    address: '',
    admission_date: new Date().toISOString().slice(0, 10),
    academic_year: '2026-2027',
    department: 'Computer Science',
    program: 'BSCS',
    class_name: 'BSCS-1',
    semester: 'Sem 1',
    section: 'A',
    photo_url: '',
    admission_fee: 500,
    tuition_fee: 1800,
    discount_type: 'none',
    discount_value: 0,
    scholarship_category: 'Merit Scholarship',
    scholarship_reason: '',
  });
  const [admError, setAdmError] = useState('');
  const [admResult, setAdmResult] = useState<{ student: StudentRecord; invoice: Record<string, unknown> | null } | null>(null);

  // Analytics & ID card modals
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [idCardData, setIdCardData] = useState<{ student: StudentRecord; institution: { name: string; address: string }; qrDataUrl: string } | null>(null);

  const load = async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (classFilter) params.set('class_name', classFilter);
    if (showArchived) params.set('archived', '1');
    const res = await apiGet<{ students: StudentRecord[] }>(`/api/students?${params.toString()}`);
    setStudents(res.students);
  };

  useEffect(() => {
    load();
  }, [search, classFilter, showArchived]);

  const openAnalytics = async (id: number) => {
    const res = await apiGet<AnalyticsPayload>(`/api/students/${id}/analytics`);
    setAnalytics(res);
  };

  const openIdCard = async (id: number) => {
    const res = await apiGet<{ student: StudentRecord; institution: { name: string; address: string }; qrDataUrl: string }>(
      `/api/students/${id}/id-card`
    );
    setIdCardData(res);
  };

  const handleBulkApply = async () => {
    if (selectedIds.length === 0) return;
    await apiPost('/api/students/bulk-update', {
      studentIds: selectedIds,
      updates: {
        status: bulkStatus || undefined,
        section: bulkSection || undefined,
      },
    });
    setSelectedIds([]);
    setBulkStatus('');
    setBulkSection('');
    load();
  };

  const handleConfirmAdmission = async () => {
    setAdmError('');
    try {
      const res = await apiPost<{ student: StudentRecord; invoice: Record<string, unknown> | null }>(
        '/api/students/admit',
        admForm
      );
      setAdmResult(res);
      setStep(8);
      load();
    } catch (err) {
      setAdmError(err instanceof Error ? err.message : 'Failed to admit student.');
    }
  };

  const resetWizard = () => {
    setWizardOpen(false);
    setStep(1);
    setAdmResult(null);
    setAdmError('');
    setAdmForm({
      ...admForm,
      student_code: '',
      full_name: '',
      guardian_name: '',
      phone: '',
      guardian_phone: '',
      email: '',
      address: '',
      discount_type: 'none',
      discount_value: 0,
      scholarship_reason: '',
    });
  };

  const missingWarnings = [
    !admForm.guardian_name && "Father's / Guardian's Name",
    !admForm.guardian_phone && 'Guardian Phone',
    !admForm.email && 'Email Address',
    !admForm.photo_url && 'Student Photograph',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Student Directory & Admissions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Individual profiles, guided admission workflow, QR ID cards, and enrollment history.
          </p>
        </div>
        <button
          onClick={() => {
            resetWizard();
            setWizardOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg"
        >
          <UserPlus className="w-4 h-4" />
          <span>Admit Student</span>
        </button>
      </div>

      {/* Filters & Bulk Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search name, student ID, guardian..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <select
            aria-label="Filter by Class"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Classes</option>
            <option value="BSCS-1">BSCS-1</option>
            <option value="BSCS-2">BSCS-2</option>
            <option value="BSDA-1">BSDA-1</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span>Show Archived</span>
          </label>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
            <span className="text-xs font-medium text-slate-700 tabular-nums">{selectedIds.length} selected</span>
            <select
              aria-label="Bulk Section"
              value={bulkSection}
              onChange={(e) => setBulkSection(e.target.value)}
              className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
            >
              <option value="">Section...</option>
              <option value="A">Sec A</option>
              <option value="B">Sec B</option>
            </select>
            <select
              aria-label="Bulk Status"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
            >
              <option value="">Status...</option>
              <option value="Active">Active</option>
              <option value="Withdrawn">Withdrawn</option>
              <option value="Archived">Archive</option>
            </select>
            <button
              onClick={handleBulkApply}
              className="px-2.5 py-1 bg-slate-900 text-white text-xs font-medium rounded"
            >
              Apply Bulk Edit
            </button>
          </div>
        )}
      </div>

      {/* Students Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2.5 px-3 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all students"
                    checked={students.length > 0 && selectedIds.length === students.length}
                    onChange={(e) => setSelectedIds(e.target.checked ? students.map((s) => s.id) : [])}
                  />
                </th>
                <th className="py-2.5 px-3 font-medium">Student ID</th>
                <th className="py-2.5 px-3 font-medium">Student Name</th>
                <th className="py-2.5 px-3 font-medium">Guardian</th>
                <th className="py-2.5 px-3 font-medium">Academic Placement</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {students.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${st.full_name}`}
                      checked={selectedIds.includes(st.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked ? [...prev, st.id] : prev.filter((x) => x !== st.id)
                        )
                      }
                    />
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                    {st.student_code}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2.5">
                      {st.photo_url ? (
                        <img
                          src={st.photo_url}
                          alt={st.full_name}
                          className="w-7 h-7 rounded-md object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
                          {st.full_name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium text-slate-900">{st.full_name}</div>
                        <div className="text-xs text-slate-500">{st.email || st.phone || 'No contact'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-700">
                    <div>{st.guardian_name || '—'}</div>
                    <div className="font-mono text-slate-500">{st.guardian_phone || 'Missing phone'}</div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-700">
                    {st.class_name} · Sec {st.section} · {st.semester}
                  </td>
                  <td className="py-2.5 px-3 text-xs font-medium">
                    <span className={st.status === 'Active' ? 'text-emerald-700' : 'text-slate-500'}>
                      {st.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-2">
                    <button
                      onClick={() => openAnalytics(st.id)}
                      aria-label={`View profile for ${st.full_name}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-100"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Profile</span>
                    </button>
                    <button
                      onClick={() => openIdCard(st.id)}
                      aria-label={`ID Card for ${st.full_name}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-800 bg-blue-50 rounded-md hover:bg-blue-100"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>ID Card</span>
                    </button>
                  </td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No students match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Guided Admission Wizard Modal */}
      {wizardOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Guided Student Admission Wizard</h3>
                <p className="text-xs text-slate-500">Step {step} of 8</p>
              </div>
              <button onClick={resetWizard} aria-label="Close Admission Wizard" className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {step === 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={admForm.full_name}
                      onChange={(e) => setAdmForm({ ...admForm, full_name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      placeholder="e.g. Julian Mercer"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Father's / Guardian's Name</label>
                    <input
                      type="text"
                      value={admForm.guardian_name}
                      onChange={(e) => setAdmForm({ ...admForm, guardian_name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Gender</label>
                    <select
                      value={admForm.gender}
                      onChange={(e) => setAdmForm({ ...admForm, gender: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Date of Birth</label>
                    <input
                      type="date"
                      value={admForm.dob}
                      onChange={(e) => setAdmForm({ ...admForm, dob: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                    <input
                      type="text"
                      value={admForm.phone}
                      onChange={(e) => setAdmForm({ ...admForm, phone: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Guardian Phone</label>
                    <input
                      type="text"
                      value={admForm.guardian_phone}
                      onChange={(e) => setAdmForm({ ...admForm, guardian_phone: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={admForm.email}
                      onChange={(e) => setAdmForm({ ...admForm, email: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Academic Year *</label>
                    <input
                      type="text"
                      value={admForm.academic_year}
                      onChange={(e) => setAdmForm({ ...admForm, academic_year: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                    <input
                      type="text"
                      value={admForm.department}
                      onChange={(e) => setAdmForm({ ...admForm, department: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Class / Grade *</label>
                    <input
                      type="text"
                      value={admForm.class_name}
                      onChange={(e) => setAdmForm({ ...admForm, class_name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Section *</label>
                    <input
                      type="text"
                      value={admForm.section}
                      onChange={(e) => setAdmForm({ ...admForm, section: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Semester</label>
                    <input
                      type="text"
                      value={admForm.semester}
                      onChange={(e) => setAdmForm({ ...admForm, semester: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Custom Student ID (optional)</label>
                    <input
                      type="text"
                      placeholder="Auto-generated if blank"
                      value={admForm.student_code}
                      onChange={(e) => setAdmForm({ ...admForm, student_code: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <label className="block text-xs font-medium text-slate-700">
                    Photograph (Optional — can also be bulk-uploaded later by Student ID)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setAdmForm({ ...admForm, photo_url: String(reader.result || '') });
                      reader.readAsDataURL(file);
                    }}
                    className="text-xs"
                  />
                  {admForm.photo_url && (
                    <img src={admForm.photo_url} alt="Student preview" className="w-24 h-24 rounded-lg object-cover border border-slate-200" />
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Admission Fee (USD)</label>
                    <input
                      type="number"
                      value={admForm.admission_fee}
                      onChange={(e) => setAdmForm({ ...admForm, admission_fee: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tuition Fee (USD)</label>
                    <input
                      type="number"
                      value={admForm.tuition_fee}
                      onChange={(e) => setAdmForm({ ...admForm, tuition_fee: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                    />
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Scholarship / Discount Type</label>
                    <select
                      value={admForm.discount_type}
                      onChange={(e) => setAdmForm({ ...admForm, discount_type: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="none">No Discount</option>
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed Amount (USD)</option>
                      <option value="waiver">Full Fee Waiver</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Discount Value</label>
                    <input
                      type="number"
                      disabled={admForm.discount_type === 'none' || admForm.discount_type === 'waiver'}
                      value={admForm.discount_value}
                      onChange={(e) => setAdmForm({ ...admForm, discount_value: Number(e.target.value) })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Authorization Reason</label>
                    <input
                      type="text"
                      value={admForm.scholarship_reason}
                      onChange={(e) => setAdmForm({ ...admForm, scholarship_reason: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      placeholder="e.g. Academic Merit / Staff Child"
                    />
                  </div>
                </div>
              )}

              {(step === 6 || step === 7) && (
                <div className="space-y-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm space-y-1.5">
                    <div><span className="text-slate-500">Name:</span> <strong>{admForm.full_name || 'MISSING'}</strong></div>
                    <div><span className="text-slate-500">Placement:</span> {admForm.class_name} · Sec {admForm.section} ({admForm.academic_year})</div>
                    <div><span className="text-slate-500">Initial Charges:</span> ${(admForm.admission_fee + admForm.tuition_fee).toFixed(2)}</div>
                    <div><span className="text-slate-500">Discount:</span> {admForm.discount_type === 'none' ? 'None' : `${admForm.discount_type} (${admForm.discount_value})`}</div>
                  </div>
                  {missingWarnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3">
                      Optional fields not yet filled (can be completed later): {missingWarnings.join(', ')}
                    </div>
                  )}
                  {admError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{admError}</div>
                  )}
                </div>
              )}

              {step === 8 && admResult && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                    <Check className="w-5 h-5" />
                    <span>Student Admitted & Invoice Generated</span>
                  </div>
                  <div className="border border-slate-200 rounded-lg p-4 text-sm space-y-1">
                    <div>Student ID: <span className="font-mono font-bold">{admResult.student.student_code}</span></div>
                    <div>Full Name: {admResult.student.full_name}</div>
                    <div>Placement: {admResult.student.class_name} · Sec {admResult.student.section}</div>
                    {admResult.invoice && (
                      <div>
                        Invoice: <span className="font-mono">{String(admResult.invoice.invoice_number)}</span> · Total{' '}
                        <span className="font-mono">{formatCurrency(Number(admResult.invoice.total_cents))}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Admission Confirmation</span>
                  </button>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
              {step < 8 ? (
                <>
                  <button
                    type="button"
                    disabled={step === 1}
                    onClick={() => setStep((s) => Math.max(1, s - 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg disabled:opacity-40"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                  {step < 7 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (step === 1 && !admForm.full_name.trim()) {
                          setAdmError('Student Full Name is required.');
                          return;
                        }
                        setAdmError('');
                        setStep((s) => s + 1);
                      }}
                      className="inline-flex items-center gap-1 px-4 py-2 bg-blue-800 text-white text-xs font-medium rounded-lg"
                    >
                      <span>Continue</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConfirmAdmission}
                      className="inline-flex items-center gap-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm Admission & Generate Invoice</span>
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={resetWizard}
                  className="ml-auto px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Student Profile & Analytics Modal */}
      {analytics && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">{analytics.student.full_name}</h3>
                <p className="text-xs text-slate-500 font-mono">
                  {analytics.student.student_code} · {analytics.student.class_name} Sec {analytics.student.section} · Profile {analytics.profileCompletion.percentage}% complete
                </p>
              </div>
              <button onClick={() => setAnalytics(null)} aria-label="Close Student Profile" className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <div className="text-xs text-slate-500">Overall Attendance</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{analytics.attendance.overall.percentage}%</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {analytics.attendance.overall.presentCount}/{analytics.attendance.overall.totalSessions} present
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <div className="text-xs text-slate-500">Total Billed</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                    {formatCurrency(analytics.finance.totalBilledCents)}
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    Discounts: {formatCurrency(analytics.finance.totalDiscountsCents)}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <div className="text-xs text-slate-500">Total Paid</div>
                  <div className="text-xl font-bold text-emerald-700 tabular-nums mt-1">
                    {formatCurrency(analytics.finance.totalPaidCents)}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3.5">
                  <div className="text-xs text-slate-500">Outstanding</div>
                  <div className="text-xl font-bold text-red-700 tabular-nums mt-1">
                    {formatCurrency(analytics.finance.outstandingCents)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-semibold text-slate-800 mb-2">Subject-Wise Attendance</h4>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                    {analytics.attendance.subjectWise.length === 0 ? (
                      <div className="p-3 text-slate-500">No attendance recorded yet.</div>
                    ) : (
                      analytics.attendance.subjectWise.map((sw) => (
                        <div key={sw.course_code} className="px-3 py-2 flex justify-between">
                          <span>{sw.course_code} — {sw.course_name}</span>
                          <span className="font-mono font-semibold tabular-nums">{sw.percentage}%</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-800 mb-2">Enrollment & Promotion History</h4>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
                    {analytics.enrollmentHistory.map((eh) => (
                      <div key={eh.id} className="px-3 py-2 flex justify-between">
                        <span>{eh.action_type}: {eh.class_name} Sec {eh.section} ({eh.semester})</span>
                        <span className="font-mono text-slate-500">{eh.effective_date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                <span className="text-slate-500">
                  Guardian: {analytics.student.guardian_name || '—'} · {analytics.student.guardian_phone || '—'}
                </span>
                <button
                  onClick={async () => {
                    await apiPatch(`/api/students/${analytics.student.id}`, {
                      status: analytics.student.status === 'Active' ? 'Archived' : 'Active',
                    });
                    setAnalytics(null);
                    load();
                  }}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  {analytics.student.status === 'Active' ? 'Archive Student' : 'Restore Active'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Student ID Card Modal */}
      {idCardData && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between no-print">
              <h3 className="text-sm font-bold text-slate-900">Student Identification Card</h3>
              <button onClick={() => setIdCardData(null)} aria-label="Close ID Card" className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="border border-slate-300 rounded-xl p-5 text-center space-y-3 bg-slate-50">
              <div className="text-xs font-bold text-blue-900">{idCardData.institution.name}</div>
              <div className="text-base font-bold text-slate-900">{idCardData.student.full_name}</div>
              <div className="font-mono text-xs text-slate-600">{idCardData.student.student_code}</div>
              <div className="text-xs text-slate-700">
                {idCardData.student.class_name} · Section {idCardData.student.section} · {idCardData.student.academic_year}
              </div>
              <div className="flex justify-center pt-1">
                <img src={idCardData.qrDataUrl} alt="Student QR Code" className="w-36 h-36 border border-slate-200 rounded bg-white p-1" />
              </div>
            </div>
            <button
              onClick={() => window.print()}
              className="w-full inline-flex items-center justify-center gap-2 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg no-print"
            >
              <Printer className="w-4 h-4" />
              <span>Print Student ID Card</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
