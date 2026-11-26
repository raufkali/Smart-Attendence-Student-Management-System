import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { formatCurrency } from '../shared/rules';

interface FineRow {
  id: number;
  student_id: number;
  student_name: string;
  student_code: string;
  class_name: string;
  section: string;
  fine_type: string;
  amount_cents: number;
  paid_cents: number;
  status: string;
  reason: string;
  created_at: string;
}

interface FeeDefaulter {
  student_id: number;
  student_code: string;
  full_name: string;
  class_name: string;
  section: string;
  outstanding_cents: number;
  overdue_cents: number;
  oldest_due_date: string | null;
  unpaid_fines_cents: number;
}

interface AttendanceDefaulter {
  student_id: number;
  student_code: string;
  full_name: string;
  class_name: string;
  section: string;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  percentage: number;
  consecutiveAbsences: number;
}

export const FinesDefaultersView: React.FC = () => {
  const [fines, setFines] = useState<FineRow[]>([]);
  const [feeDefaulters, setFeeDefaulters] = useState<FeeDefaulter[]>([]);
  const [attDefaulters, setAttDefaulters] = useState<AttendanceDefaulter[]>([]);
  const [threshold, setThreshold] = useState(80);
  const [availableThresholds, setAvailableThresholds] = useState<number[]>([90, 80, 75]);
  const [tab, setTab] = useState<'fee' | 'attendance' | 'fines'>('fee');

  const load = async () => {
    const [fRes, dRes] = await Promise.all([
      apiGet<{ fines: FineRow[] }>('/api/fines'),
      apiGet<{
        threshold: number;
        availableThresholds: number[];
        feeDefaulters: FeeDefaulter[];
        attendanceDefaulters: AttendanceDefaulter[];
      }>(`/api/defaulters?threshold=${threshold}`),
    ]);
    setFines(fRes.fines);
    setAvailableThresholds(dRes.availableThresholds);
    setFeeDefaulters(dRes.feeDefaulters);
    setAttDefaulters(dRes.attendanceDefaulters);
  };

  useEffect(() => {
    load();
  }, [threshold]);

  const exportCsv = (rows: unknown[], name: string) => {
    if (rows.length === 0) return;
    const keys = Object.keys(rows[0] as Record<string, unknown>);
    const csv = [
      keys.join(','),
      ...rows.map((r) => keys.map((k) => `"${String((r as Record<string, unknown>)[k] ?? '')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Fine Management & Defaulter Center</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track fee defaulters, configurable attendance thresholds, automated absence/late fines, and waivers.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            onClick={() => setTab('fee')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${tab === 'fee' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            Fee Defaulters ({feeDefaulters.length})
          </button>
          <button
            onClick={() => setTab('attendance')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${tab === 'attendance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            Attendance Defaulters ({attDefaulters.length})
          </button>
          <button
            onClick={() => setTab('fines')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${tab === 'fines' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
          >
            Fines Ledger ({fines.length})
          </button>
        </div>
      </div>

      {tab === 'fee' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-slate-900">Outstanding Fee & Fine Defaulters</h3>
            <button
              onClick={() => exportCsv(feeDefaulters, 'fee_defaulters.csv')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Student ID</th>
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Cohort</th>
                  <th className="py-2.5 px-4">Oldest Due</th>
                  <th className="py-2.5 px-4 text-right">Overdue</th>
                  <th className="py-2.5 px-4 text-right">Unpaid Fines</th>
                  <th className="py-2.5 px-4 text-right">Total Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {feeDefaulters.map((d) => (
                  <tr key={d.student_id}>
                    <td className="py-2.5 px-4 font-mono">{d.student_code}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{d.full_name}</td>
                    <td className="py-2.5 px-4">{d.class_name} · Sec {d.section}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-500">{d.oldest_due_date || '—'}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">
                      {formatCurrency(d.overdue_cents)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {formatCurrency(d.unpaid_fines_cents)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatCurrency(d.outstanding_cents + d.unpaid_fines_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Attendance Defaulter Threshold</h3>
              <select
                aria-label="Attendance Threshold Percentage"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white font-mono"
              >
                {Array.from(new Set([...availableThresholds, 90, 80, 75])).map((th) => (
                  <option key={th} value={th}>Below {th}%</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => exportCsv(attDefaulters, 'attendance_defaulters.csv')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Student ID</th>
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Cohort</th>
                  <th className="py-2.5 px-4 text-right">Sessions</th>
                  <th className="py-2.5 px-4 text-right">Absent</th>
                  <th className="py-2.5 px-4 text-right">Consecutive Absences</th>
                  <th className="py-2.5 px-4 text-right">Attendance %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {attDefaulters.map((d) => (
                  <tr key={d.student_id}>
                    <td className="py-2.5 px-4 font-mono">{d.student_code}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{d.full_name}</td>
                    <td className="py-2.5 px-4">{d.class_name} · Sec {d.section}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{d.totalSessions}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">{d.absentCount}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{d.consecutiveAbsences}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-red-700">
                      {d.percentage}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'fines' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Type & Reason</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {fines.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{f.student_name}</div>
                      <div className="font-mono text-slate-500">{f.student_code}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="font-medium">{f.fine_type}</span> · {f.reason}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{formatCurrency(f.amount_cents)}</td>
                    <td className="py-2.5 px-4 capitalize font-medium">{f.status}</td>
                    <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {f.status === 'unpaid' && (
                        <>
                          <button
                            onClick={() => apiPost(`/api/fines/${f.id}/pay`, {}).then(load)}
                            className="px-2.5 py-1 bg-slate-900 text-white rounded"
                          >
                            Mark Paid
                          </button>
                          <button
                            onClick={() => apiPost(`/api/fines/${f.id}/waive`, { reason: 'Administrative waiver' }).then(load)}
                            className="px-2.5 py-1 border border-slate-300 rounded text-slate-700"
                          >
                            Waive
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
