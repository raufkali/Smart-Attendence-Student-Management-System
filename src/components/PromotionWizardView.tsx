import React, { useState } from 'react';
import { GraduationCap, Check, ArrowRight } from 'lucide-react';
import { apiPost } from '../api/client';
import type { StudentRecord } from '../shared/types';

interface DecisionRow {
  student: StudentRecord;
  action: 'promote' | 'repeat' | 'graduate' | 'withdraw' | 'transfer';
  target_academic_year: string;
  target_class_name: string;
  target_semester: string;
  target_section: string;
}

export const PromotionWizardView: React.FC = () => {
  const [sourceYear, setSourceYear] = useState('2026-2027');
  const [sourceClass, setSourceClass] = useState('BSCS-1');
  const [sourceSection, setSourceSection] = useState('');
  const [targetYear, setTargetYear] = useState('2027-2028');
  const [targetClass, setTargetClass] = useState('BSCS-2');
  const [targetSemester, setTargetSemester] = useState('Sem 3');

  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [resultMsg, setResultMsg] = useState('');

  const handleLoadCohort = async (e: React.FormEvent) => {
    e.preventDefault();
    setResultMsg('');
    setPreviewMode(false);
    const res = await apiPost<{ students: StudentRecord[] }>('/api/promotions/preview', {
      academic_year: sourceYear,
      class_name: sourceClass,
      section: sourceSection || undefined,
    });
    setRows(
      res.students.map((s) => ({
        student: s,
        action: 'promote',
        target_academic_year: targetYear,
        target_class_name: targetClass,
        target_semester: targetSemester,
        target_section: s.section,
      }))
    );
  };

  const handleCommit = async () => {
    const res = await apiPost<{ ok: boolean; batchId: number }>('/api/promotions/commit', {
      decisions: rows.map((r) => ({
        student_id: r.student.id,
        action: r.action,
        target_academic_year: r.target_academic_year,
        target_class_name: r.target_class_name,
        target_semester: r.target_semester,
        target_section: r.target_section,
      })),
    });
    setResultMsg(
      `Promotion batch #${res.batchId} committed for ${rows.length} student(s). Historical placements preserved; rollback available in Rollback Center.`
    );
    setRows([]);
    setPreviewMode(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Promotion Wizard & Academic Year Transition</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Bulk-promote, repeat, graduate, withdraw, or transfer cohorts while preserving full historical enrollment and financial records.
        </p>
      </div>

      {resultMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {resultMsg}
        </div>
      )}

      <form onSubmit={handleLoadCohort} className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-600 mb-1">Source Academic Year</label>
          <input
            type="text"
            value={sourceYear}
            onChange={(e) => setSourceYear(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">Source Class</label>
          <input
            type="text"
            value={sourceClass}
            onChange={(e) => setSourceClass(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">Source Section</label>
          <input
            type="text"
            placeholder="All"
            value={sourceSection}
            onChange={(e) => setSourceSection(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">Destination Year</label>
          <input
            type="text"
            value={targetYear}
            onChange={(e) => setTargetYear(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-600 mb-1">Destination Class</label>
          <input
            type="text"
            value={targetClass}
            onChange={(e) => setTargetClass(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 py-2 px-4 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg"
        >
          <GraduationCap className="w-4 h-4" />
          <span>Load Cohort</span>
        </button>
      </form>

      {rows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-900">
              {rows.length} Eligible Student(s) Loaded
            </span>
            <div className="flex gap-2">
              {!previewMode ? (
                <button
                  onClick={() => setPreviewMode(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg"
                >
                  <span>Preview Promotion Changes</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={handleCommit}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm & Execute Promotion Batch</span>
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Student</th>
                  <th className="py-2.5 px-4">Current Placement</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Target Class</th>
                  <th className="py-2.5 px-4">Target Section</th>
                  <th className="py-2.5 px-4">Target Semester</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r, idx) => (
                  <tr key={r.student.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{r.student.full_name}</div>
                      <div className="font-mono text-slate-500">{r.student.student_code}</div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {r.student.class_name} · Sec {r.student.section} ({r.student.academic_year})
                    </td>
                    <td className="py-2.5 px-4">
                      <select
                        disabled={previewMode}
                        value={r.action}
                        onChange={(e) => {
                          const next = [...rows];
                          const act = e.target.value as DecisionRow['action'];
                          next[idx] = {
                            ...next[idx],
                            action: act,
                            target_class_name: act === 'repeat' ? r.student.class_name : targetClass,
                            target_academic_year: targetYear,
                          };
                          setRows(next);
                        }}
                        className="px-2 py-1 border border-slate-300 rounded bg-white"
                      >
                        <option value="promote">Promote</option>
                        <option value="repeat">Repeat Same Class</option>
                        <option value="graduate">Graduate</option>
                        <option value="transfer">Transfer</option>
                        <option value="withdraw">Withdraw</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        disabled={previewMode}
                        value={r.target_class_name}
                        onChange={(e) => {
                          const next = [...rows];
                          next[idx] = { ...next[idx], target_class_name: e.target.value };
                          setRows(next);
                        }}
                        className="w-24 px-2 py-1 border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        disabled={previewMode}
                        value={r.target_section}
                        onChange={(e) => {
                          const next = [...rows];
                          next[idx] = { ...next[idx], target_section: e.target.value };
                          setRows(next);
                        }}
                        className="w-16 px-2 py-1 border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        disabled={previewMode}
                        value={r.target_semester}
                        onChange={(e) => {
                          const next = [...rows];
                          next[idx] = { ...next[idx], target_semester: e.target.value };
                          setRows(next);
                        }}
                        className="w-24 px-2 py-1 border border-slate-300 rounded"
                      />
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
