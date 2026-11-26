import React, { useEffect, useState } from 'react';
import { RotateCcw, Search, Shield } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import type { RollbackBatch } from '../shared/types';

interface AuditRow {
  id: number;
  actor: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  source: string;
  created_at: string;
}

export const AuditRollbackView: React.FC = () => {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [batches, setBatches] = useState<RollbackBatch[]>([]);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [lRes, bRes] = await Promise.all([
      apiGet<{ logs: AuditRow[] }>(`/api/audit-logs?search=${encodeURIComponent(search)}`),
      apiGet<{ batches: RollbackBatch[] }>('/api/rollbacks'),
    ]);
    setLogs(lRes.logs);
    setBatches(bRes.batches);
  };

  useEffect(() => {
    load();
  }, [search]);

  const handleRollback = async (batchId: number, summary: string) => {
    await apiPost(`/api/rollbacks/${batchId}/execute`, {
      reason: `Authorized rollback of "${summary}"`,
    });
    setMsg(`Compensating rollback completed for Batch #${batchId}.`);
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Audit Logs & Rollback Recovery Center</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Immutable institutional activity history and compensating-transaction rollback for bulk operations.
        </p>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {msg}
        </div>
      )}

      {/* Rollback Recovery Batches */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Reversible Bulk Operations</h3>
        </div>
        {batches.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No bulk operations (Excel imports, bulk student updates, promotions, timetable clones, or bulk photos) recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Batch #</th>
                  <th className="py-2.5 px-4">Operation</th>
                  <th className="py-2.5 px-4 text-right">Records</th>
                  <th className="py-2.5 px-4">Initiated By</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2.5 px-4 font-mono">#{b.id}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{b.summary}</div>
                      <div className="text-slate-500 capitalize">{b.operation_type.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{b.affected_count}</td>
                    <td className="py-2.5 px-4">{b.initiated_by}</td>
                    <td className="py-2.5 px-4 capitalize font-medium">
                      <span className={b.status === 'available' ? 'text-blue-800' : 'text-slate-500'}>
                        {b.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {b.status === 'available' && (
                        <button
                          onClick={() => handleRollback(b.id, b.summary)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 text-white rounded hover:bg-slate-800"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Rollback</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Immutable Audit Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Immutable Audit Trail</h3>
          </div>
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2" />
            <input
              type="text"
              placeholder="Filter actor, action, entity..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0">
              <tr>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Entity</th>
                <th className="py-2.5 px-4">Reason / Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                    {l.created_at.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="py-2 px-4 font-medium text-slate-900">{l.actor}</td>
                  <td className="py-2 px-4 font-mono text-slate-800">{l.action}</td>
                  <td className="py-2 px-4 font-mono text-slate-600">
                    {l.entity_type} #{l.entity_id}
                  </td>
                  <td className="py-2 px-4 text-slate-600">
                    {l.reason ? `${l.reason} · ` : ''}
                    <span className="text-slate-400">{l.source}</span>
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
