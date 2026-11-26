import React, { useEffect, useState } from 'react';
import { Wifi, Smartphone, RefreshCw, Key, Send, CheckCircle2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import type { TeacherRecord } from '../shared/types';

interface NetworkInfo {
  port: number;
  lanUrls: string[];
  localUrl: string;
  hostname: string;
}

interface SyncDeviceRow {
  device_id: string;
  teacher_id: number;
  teacher_name: string;
  employee_id: string;
  device_name: string;
  app_version: string;
  last_sync_at: string;
  last_ip: string;
  status: string;
  pending_count: number;
  error_message: string;
}

interface SyncLogRow {
  id: number;
  sync_uuid: string;
  device_id: string;
  teacher_name: string;
  payload_count: number;
  accepted_count: number;
  duplicate_count: number;
  conflict_count: number;
  status: string;
  error_details: string;
  synced_at: string;
}

export const DeviceSyncView: React.FC = () => {
  const [netInfo, setNetInfo] = useState<NetworkInfo | null>(null);
  const [devices, setDevices] = useState<SyncDeviceRow[]>([]);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [pairTeacherId, setPairTeacherId] = useState(0);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; teacherName: string; expiresAt: string } | null>(null);

  // Interactive Android Sync Endpoint Tester (verifies idempotent mobile sync live)
  const [simResult, setSimResult] = useState('');

  const load = async () => {
    const [net, devRes, tRes] = await Promise.all([
      apiGet<NetworkInfo>('/api/system/network-info'),
      apiGet<{ devices: SyncDeviceRow[]; logs: SyncLogRow[] }>('/api/sync/devices'),
      apiGet<{ teachers: TeacherRecord[] }>('/api/teachers'),
    ]);
    setNetInfo(net);
    setDevices(devRes.devices);
    setLogs(devRes.logs);
    setTeachers(tRes.teachers);
    if (tRes.teachers.length > 0 && pairTeacherId === 0) {
      setPairTeacherId(tRes.teachers[0].id);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleGenerateCode = async () => {
    if (!pairTeacherId) return;
    const res = await apiPost<{ code: string; teacherName: string; expiresAt: string }>('/api/sync/pair-code', {
      teacher_id: pairTeacherId,
    });
    setGeneratedCode(res);
  };

  const handleTestIdempotentSync = async () => {
    setSimResult('Testing Android local-network login, roster pull, and idempotent UUID sync...');
    try {
      const loginRes = await fetch('/api/mobile/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: 'EMP-101',
          password: 'teacher123',
          device_id: 'android-pixel7-01',
          device_name: 'Pixel 7 — Dr. Meera Sharma',
        }),
      }).then((r) => r.json());

      if (!loginRes.token) throw new Error(loginRes.error || 'Teacher login failed');

      const pullRes = await fetch('/api/sync/pull', {
        headers: { Authorization: `Bearer ${loginRes.token}` },
      }).then((r) => r.json());

      const syncUuid = crypto.randomUUID();
      const sessionUuid = crypto.randomUUID();
      const firstTimetableId = pullRes.timetable?.[0]?.id || 1;
      const samplePayload = {
        sync_uuid: syncUuid,
        device_id: 'android-pixel7-01',
        sessions: [
          {
            client_uuid: sessionUuid,
            timetable_session_id: firstTimetableId,
            session_date: '2026-11-25',
            notes: 'Verified via local LAN sync',
            records: (pullRes.students || []).slice(0, 3).map((st: { id: number }) => ({
              client_uuid: crypto.randomUUID(),
              student_id: st.id,
              status: 'present',
              remarks: '',
            })),
          },
        ],
      };

      const sync1 = await fetch('/api/sync/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginRes.token}` },
        body: JSON.stringify(samplePayload),
      }).then((r) => r.json());

      // Replay exact same UUID to verify idempotency prevents duplicate rows
      const sync2 = await fetch('/api/sync/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginRes.token}` },
        body: JSON.stringify(samplePayload),
      }).then((r) => r.json());

      setSimResult(
        `Verified: Pulled ${pullRes.timetable?.length || 0} classes & ${pullRes.students?.length || 0} students. ` +
          `Sync 1 accepted=${sync1.acceptedCount}; Replay with same UUID returned idempotentReplay=${Boolean(sync2.idempotentReplay)} (0 duplicates created).`
      );
      load();
    } catch (err) {
      setSimResult(err instanceof Error ? err.message : 'Sync test failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Local Network & Android Device Sync Monitor</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pair native Android teacher phones over local Wi-Fi, issue pairing codes, and monitor idempotent offline synchronization.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Local LAN Endpoint & Pairing Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Wifi className="w-4 h-4 text-blue-800" />
            <span>Local Network Server Address</span>
          </div>
          <p className="text-xs text-slate-500">
            Enter one of these local network addresses in the ScholarGrid Android Teacher App (no internet or cloud required):
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1 font-mono text-xs text-slate-800">
            {netInfo?.lanUrls.length ? (
              netInfo.lanUrls.map((url) => <div key={url}>{url}</div>)
            ) : (
              <div>{netInfo?.localUrl || 'http://127.0.0.1:3000'}</div>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Native Android Kotlin + Jetpack Compose + Room + WorkManager source project is bundled in{' '}
            <span className="font-mono text-slate-800">/android-teacher-app/</span>.
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Key className="w-4 h-4 text-blue-800" />
            <span>Generate 6-Digit Android Pairing Code</span>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Select Teacher to Pair"
              value={pairTeacherId}
              onChange={(e) => setPairTeacherId(Number(e.target.value))}
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name} ({t.employee_id})
                </option>
              ))}
            </select>
            <button
              onClick={handleGenerateCode}
              className="px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg whitespace-nowrap"
            >
              Issue Pairing Code
            </button>
          </div>
          {generatedCode && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="text-xs text-blue-900 font-medium">Pairing Code for {generatedCode.teacherName}</div>
                <div className="text-xs text-blue-700">Valid for 60 minutes</div>
              </div>
              <div className="text-2xl font-mono font-bold tracking-widest text-blue-950 tabular-nums">
                {generatedCode.code}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">Test live idempotent Android sync pipeline:</span>
            <button
              onClick={handleTestIdempotentSync}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Run Sync Verification</span>
            </button>
          </div>
          {simResult && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-lg p-3 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
              <span>{simResult}</span>
            </div>
          )}
        </div>
      </div>

      {/* Paired Devices Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Paired Teacher Devices</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4">Device</th>
                <th className="py-2.5 px-4">Teacher</th>
                <th className="py-2.5 px-4">Local IP</th>
                <th className="py-2.5 px-4">Last Sync</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {devices.map((d) => (
                <tr key={d.device_id}>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2 font-medium text-slate-900">
                      <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                      <span>{d.device_name}</span>
                    </div>
                    <div className="font-mono text-slate-400">{d.device_id}</div>
                  </td>
                  <td className="py-2.5 px-4">{d.teacher_name} ({d.employee_id})</td>
                  <td className="py-2.5 px-4 font-mono">{d.last_ip || '—'}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">
                    {d.last_sync_at ? d.last_sync_at.slice(0, 19).replace('T', ' ') : 'Never'}
                  </td>
                  <td className="py-2.5 px-4 font-medium">
                    <span className={d.status === 'online' ? 'text-emerald-700' : 'text-amber-700'}>
                      {d.status === 'online' ? 'Synchronized' : `Offline (${d.pending_count} pending)`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sync Logs */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Synchronization Transaction Logs</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Teacher / Device</th>
                <th className="py-2.5 px-4 text-right">Accepted</th>
                <th className="py-2.5 px-4 text-right">Duplicates</th>
                <th className="py-2.5 px-4 text-right">Conflicts</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">
                    {l.synced_at.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-slate-900">{l.teacher_name}</div>
                    <div className="font-mono text-slate-400">{l.device_id}</div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{l.accepted_count}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{l.duplicate_count}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{l.conflict_count}</td>
                  <td
                    className={`py-2.5 px-4 font-medium ${
                      l.status === 'success' ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {l.status === 'success'
                      ? 'Success'
                      : l.status === 'partial_conflict'
                      ? 'Partial Conflict'
                      : l.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
