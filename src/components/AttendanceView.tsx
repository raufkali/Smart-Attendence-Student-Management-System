import React, { useEffect, useState } from 'react';
import { ClipboardCheck, Check, Ban, History } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import type { TimetableSession } from '../shared/types';

interface AttendanceSessionRow {
  id: number;
  session_date: string;
  timetable_session_id: number;
  course_code: string;
  course_name: string;
  teacher_name: string;
  class_name: string;
  section: string;
  status: string;
  device_id: string;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
}

interface CorrectionRow {
  id: number;
  student_name: string;
  student_code: string;
  original_status: string;
  new_status: string;
  changed_by: string;
  reason: string;
  created_at: string;
}

export const AttendanceView: React.FC = () => {
  const [sessions, setSessions] = useState<AttendanceSessionRow[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [timetable, setTimetable] = useState<TimetableSession[]>([]);

  // New session marking modal/drawer
  const [selectedTtId, setSelectedTtId] = useState<number>(0);
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState<Array<{ id: number; student_code: string; full_name: string; status: string; remarks: string }>>([]);
  const [activeSessionRecords, setActiveSessionRecords] = useState<{
    session: AttendanceSessionRow;
    records: Array<{ student_id: number; student_code: string; full_name: string; record_id: number | null; status: string; remarks: string }>;
  } | null>(null);
  const [corrReason, setCorrReason] = useState('Verified medical note');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [attRes, ttRes] = await Promise.all([
      apiGet<{ sessions: AttendanceSessionRow[]; corrections: CorrectionRow[] }>('/api/attendance/sessions'),
      apiGet<{ sessions: TimetableSession[] }>('/api/timetable'),
    ]);
    setSessions(attRes.sessions);
    setCorrections(attRes.corrections);
    setTimetable(ttRes.sessions);
    if (ttRes.sessions.length > 0 && selectedTtId === 0) {
      setSelectedTtId(ttRes.sessions[0].id);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadRosterForTimetable = async (ttId: number) => {
    const tt = timetable.find((t) => t.id === ttId);
    if (!tt) return;
    const stuRes = await apiGet<{ students: Array<{ id: number; student_code: string; full_name: string }> }>(
      `/api/students?class_name=${encodeURIComponent(tt.class_name)}`
    );
    const filtered = stuRes.students.map((s) => ({
      id: s.id,
      student_code: s.student_code,
      full_name: s.full_name,
      status: 'present',
      remarks: '',
    }));
    setRoster(filtered);
  };

  const handleSubmitNewAttendance = async (cancelled = false) => {
    if (!selectedTtId) return;
    await apiPost('/api/attendance/mark', {
      timetable_session_id: selectedTtId,
      session_date: sessionDate,
      status: cancelled ? 'cancelled' : 'submitted',
      records: roster.map((r) => ({ student_id: r.id, status: r.status, remarks: r.remarks })),
    });
    setRoster([]);
    setMsg(cancelled ? 'Session marked cancelled (excluded from attendance averages).' : 'Attendance submitted and fine rules evaluated.');
    load();
  };

  const openSessionDetail = async (sessionId: number) => {
    const res = await apiGet<typeof activeSessionRecords>(`/api/attendance/sessions/${sessionId}/records`);
    setActiveSessionRecords(res);
  };

  const handleCorrectRecord = async (recordId: number, newStatus: string) => {
    if (!corrReason.trim()) return;
    await apiPost('/api/attendance/correct', {
      record_id: recordId,
      new_status: newStatus,
      reason: corrReason,
    });
    if (activeSessionRecords) openSessionDetail(activeSessionRecords.session.id);
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Timetable-Based Attendance Console</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Track submitted, pending, cancelled, and missed sessions. All corrections preserve original values and audit reasons.
        </p>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {msg}
        </div>
      )}

      {/* Mark / Take Attendance for Timetable Slot */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-slate-700 mb-1">Timetable Session</label>
            <select
              value={selectedTtId}
              onChange={(e) => setSelectedTtId(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {timetable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.day_of_week} {t.start_time} · {t.course_code} ({t.class_name} {t.section}) — {t.teacher_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Session Date</label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="button"
            onClick={() => loadRosterForTimetable(selectedTtId)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Load Class Roster</span>
          </button>
        </div>

        {roster.length > 0 && (
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">{roster.length} students loaded</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRoster(roster.map((r) => ({ ...r, status: 'present' })))}
                  className="px-3 py-1 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Mark All Present
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmitNewAttendance(true)}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Mark Session Cancelled</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmitNewAttendance(false)}
                  className="inline-flex items-center gap-1 px-4 py-1 bg-emerald-700 text-white text-xs font-medium rounded-lg"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Submit Attendance</span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {roster.map((stu, idx) => (
                <div key={stu.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-mono text-slate-500 mr-2">{stu.student_code}</span>
                    <span className="font-medium text-slate-900">{stu.full_name}</span>
                  </div>
                  <div className="flex gap-1">
                    {(['present', 'absent', 'late', 'excused'] as const).map((statusVal) => (
                      <button
                        key={statusVal}
                        type="button"
                        onClick={() => {
                          const next = [...roster];
                          next[idx] = { ...next[idx], status: statusVal };
                          setRoster(next);
                        }}
                        className={`px-2.5 py-1 rounded capitalize font-medium ${
                          stu.status === statusVal
                            ? statusVal === 'absent'
                              ? 'bg-red-700 text-white'
                              : statusVal === 'late'
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {statusVal}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Submitted & Pending Sessions Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">Attendance Sessions Log</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Subject & Cohort</th>
                  <th className="py-2.5 px-4">Counts (P/A/L/E)</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono tabular-nums">{s.session_date}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{s.course_code} · {s.class_name} {s.section}</div>
                      <div className="text-slate-500">{s.teacher_name} · {s.device_id}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">
                      {s.present_count}/{s.absent_count}/{s.late_count}/{s.excused_count}
                    </td>
                    <td className="py-2.5 px-4 capitalize font-medium">
                      <span
                        className={
                          s.status === 'submitted'
                            ? 'text-emerald-700'
                            : s.status === 'pending_submission'
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }
                      >
                        {s.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        onClick={() => openSessionDetail(s.id)}
                        className="px-2.5 py-1 border border-slate-200 rounded text-slate-700 hover:bg-slate-100"
                      >
                        Inspect / Correct
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Correction Panel & Audit Trail */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <History className="w-4 h-4 text-blue-800" />
            <span>Audited Corrections</span>
          </div>

          {activeSessionRecords && (
            <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-2 text-xs">
              <div className="font-semibold text-slate-900">
                Correcting {activeSessionRecords.session.course_code} ({activeSessionRecords.session.session_date})
              </div>
              <input
                type="text"
                placeholder="Correction reason (mandatory)"
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
                className="w-full px-2.5 py-1 border border-slate-300 rounded bg-white"
              />
              <div className="divide-y divide-slate-200 max-h-48 overflow-y-auto">
                {activeSessionRecords.records.map((r) => (
                  <div key={r.student_id} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="truncate">{r.full_name}</span>
                    {r.record_id ? (
                      <select
                        value={r.status}
                        onChange={(e) => handleCorrectRecord(r.record_id!, e.target.value)}
                        className="px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs"
                      >
                        <option value="present">present</option>
                        <option value="absent">absent</option>
                        <option value="late">late</option>
                        <option value="excused">excused</option>
                      </select>
                    ) : (
                      <span className="text-slate-400">unmarked</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs max-h-64 overflow-y-auto">
            {corrections.length === 0 ? (
              <div className="p-3 text-slate-500">No attendance corrections logged yet.</div>
            ) : (
              corrections.map((c) => (
                <div key={c.id} className="p-2.5 space-y-0.5">
                  <div className="font-medium text-slate-900">
                    {c.student_name}: {c.original_status} → {c.new_status}
                  </div>
                  <div className="text-slate-500">
                    By {c.changed_by} · {c.reason}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
