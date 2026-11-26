import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Smartphone, ArrowUpRight, RefreshCw } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { formatCurrency } from '../shared/rules';
import type { InstitutionSettings, SmartAlert } from '../shared/types';

interface DashboardData {
  institution: InstitutionSettings;
  kpis: {
    totalStudents: number;
    totalTeachers: number;
    todaySessionsCount: number;
    billedCents: number;
    collectedCents: number;
    outstandingCents: number;
    overdueCents: number;
    openAlertsCount: number;
    timetableConflictsCount: number;
  };
  todaySchedule: Array<{
    id: number;
    day_of_week: string;
    start_time: string;
    end_time: string;
    course_code: string;
    course_name: string;
    teacher_name: string;
    class_name: string;
    section: string;
    room: string;
    attendance_session_id: number | null;
    attendance_status: string | null;
  }>;
  alerts: SmartAlert[];
  devices: Array<{
    device_id: string;
    device_name: string;
    teacher_name: string;
    status: string;
    pending_count: number;
    last_sync_at: string;
  }>;
}

export const DashboardView: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiGet<DashboardData>('/api/dashboard');
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleResolveAlert = async (alertId: number, status: 'resolved' | 'dismissed') => {
    await apiPost(`/api/alerts/${alertId}/resolve`, { status });
    load();
  };

  if (loading && !data) {
    return <div className="text-sm text-slate-500">Loading institutional overview...</div>;
  }
  if (!data) return null;

  const { institution, kpis, todaySchedule, alerts, devices } = data;
  const currency = institution.currency || 'USD';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Administrative Overview</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {institution.name} · Academic Year {institution.academic_year} · {institution.type}
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Active Enrollment</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{kpis.totalStudents}</div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">{kpis.totalTeachers} active faculty</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Today's Timetable</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{kpis.todaySessionsCount}</div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {kpis.timetableConflictsCount} schedule conflicts
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Fee Collection</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {formatCurrency(kpis.collectedCents, currency)}
          </div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            Outstanding: {formatCurrency(kpis.outstandingCents, currency)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Task Center Alerts</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{kpis.openAlertsCount}</div>
          <div className="text-xs text-amber-700 mt-1 tabular-nums">
            Overdue: {formatCurrency(kpis.overdueCents, currency)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Administrative Task Center & Smart Alerts */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Administrative Task Center</h3>
              <p className="text-xs text-slate-500">Prioritized institutional actions requiring attention</p>
            </div>
            <span className="text-xs font-mono text-slate-500 tabular-nums">{alerts.length} open</span>
          </div>

          {alerts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              All operational tasks and alerts are resolved.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto">
              {alerts.map((alert) => (
                <div key={alert.id} className="px-5 py-3.5 flex items-start justify-between gap-4 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <AlertTriangle
                        className={`w-3.5 h-3.5 shrink-0 ${
                          alert.severity === 'high' ? 'text-red-600' : 'text-amber-600'
                        }`}
                      />
                      <span className={alert.severity === 'high' ? 'text-red-700' : 'text-amber-700'}>
                        {alert.severity === 'high' ? 'High Priority' : 'Attention'}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="text-slate-500">{alert.category}</span>
                    </div>
                    <div className="text-sm font-medium text-slate-900 mt-1">{alert.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{alert.description}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onNavigate(alert.target_tab)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap"
                    >
                      <span>Open</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleResolveAlert(alert.id, 'resolved')}
                      aria-label={`Resolve alert ${alert.title}`}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md whitespace-nowrap"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Paired Android Teacher Devices */}
        <div className="bg-white border border-slate-200 rounded-xl flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Teacher Mobile Sync</h3>
              <p className="text-xs text-slate-500">Local LAN Android devices</p>
            </div>
            <button
              onClick={() => onNavigate('sync')}
              className="text-xs font-medium text-blue-800 hover:underline whitespace-nowrap"
            >
              Manage Devices
            </button>
          </div>
          <div className="divide-y divide-slate-200 flex-1">
            {devices.map((d) => (
              <div key={d.device_id} className="px-5 py-3.5 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                    <Smartphone className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{d.device_name}</div>
                    <div className="text-xs text-slate-500">{d.teacher_name}</div>
                    <div className="text-xs font-mono text-slate-400 mt-0.5 tabular-nums">
                      Last sync: {d.last_sync_at ? d.last_sync_at.slice(0, 16).replace('T', ' ') : 'Never'}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-xs font-medium ${
                      d.status === 'online' ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {d.status === 'online' ? 'Synced' : 'Offline'}
                  </div>
                  {d.pending_count > 0 && (
                    <div className="text-xs text-amber-700 font-mono tabular-nums">
                      {d.pending_count} pending
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Today's Class Sessions */}
      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Today's Scheduled Classes</h3>
            <p className="text-xs text-slate-500">Timetable-based session tracking</p>
          </div>
          <button
            onClick={() => onNavigate('attendance')}
            className="text-xs font-medium text-blue-800 hover:underline"
          >
            Open Attendance Console
          </button>
        </div>

        {todaySchedule.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No classes scheduled for today's weekday.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Time</th>
                  <th className="py-2.5 px-4 font-medium">Subject</th>
                  <th className="py-2.5 px-4 font-medium">Cohort</th>
                  <th className="py-2.5 px-4 font-medium">Teacher</th>
                  <th className="py-2.5 px-4 font-medium">Room</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {todaySchedule.map((s) => {
                  const st = s.attendance_status || 'upcoming';
                  return (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        {s.start_time}–{s.end_time}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="font-medium text-slate-900">{s.course_code}</span>
                        <span className="text-slate-500 ml-1.5">{s.course_name}</span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        {s.class_name} · Sec {s.section}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{s.teacher_name}</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-600">{s.room}</td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          {st === 'submitted' ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">Submitted</span>
                            </>
                          ) : st === 'pending_submission' ? (
                            <>
                              <Clock className="w-3.5 h-3.5 text-amber-600" />
                              <span className="text-amber-700">Pending Submission</span>
                            </>
                          ) : (
                            <span className="text-slate-600">
                              {st === 'upcoming' ? 'Upcoming' : st.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
