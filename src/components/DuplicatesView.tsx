import React, { useEffect, useState } from 'react';
import { GitMerge, CheckCircle2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import type { DuplicateMatch } from '../shared/types';

export const DuplicatesView: React.FC = () => {
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ duplicates: DuplicateMatch[] }>('/api/duplicates');
      setDuplicates(res.duplicates);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDismiss = async (m: DuplicateMatch) => {
    await apiPost('/api/duplicates/dismiss', {
      pairKey: m.pairKey,
      studentAId: m.studentA.id,
      studentBId: m.studentB.id,
      notes: 'Verified as distinct individuals by administrator',
    });
    setMessage('Marked pair as separate individuals.');
    load();
  };

  const handleMerge = async (primary: DuplicateMatch['studentA'], secondary: DuplicateMatch['studentB']) => {
    await apiPost('/api/duplicates/merge', {
      primaryId: primary.id,
      secondaryId: secondary.id,
      retainedFields: {
        full_name: primary.full_name,
        guardian_name: primary.guardian_name || secondary.guardian_name,
        phone: primary.phone || secondary.phone,
        guardian_phone: primary.guardian_phone || secondary.guardian_phone,
        email: primary.email || secondary.email,
        dob: primary.dob || secondary.dob,
      },
      reason: `Merged duplicate ${secondary.student_code} into ${primary.student_code}`,
    });
    setMessage(`Merged ${secondary.student_code} into ${primary.student_code} while preserving attendance, fee, and enrollment history.`);
    load();
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Duplicate Student Detection Center</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Exact and fuzzy matching across names, guardian phones, emails, and dates of birth. Records are never merged automatically.
        </p>
      </div>

      {message && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Scanning student registry...</div>
      ) : duplicates.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <div className="text-sm font-semibold text-slate-900">No Suspected Duplicates Found</div>
          <div className="text-xs text-slate-500">All active student records appear unique.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {duplicates.map((m) => (
            <div key={m.pairKey} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="text-xs font-medium text-amber-800">
                  Match Confidence: <span className="font-mono font-bold">{Math.round(m.score * 100)}%</span>
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="text-slate-600">{m.reasons.join(' · ')}</span>
                </div>
                <button
                  onClick={() => handleDismiss(m)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Mark as Separate Individuals
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { primary: m.studentA, secondary: m.studentB, label: 'Record A' },
                  { primary: m.studentB, secondary: m.studentA, label: 'Record B' },
                ].map(({ primary, secondary, label }) => (
                  <div key={primary.id} className="border border-slate-200 rounded-lg p-4 space-y-2 bg-slate-50/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">{label}</span>
                      <span className="font-mono text-xs text-slate-700">{primary.student_code}</span>
                    </div>
                    <div className="text-sm font-bold text-slate-900">{primary.full_name}</div>
                    <div className="text-xs text-slate-600 space-y-0.5">
                      <div>Guardian: {primary.guardian_name || '—'} · {primary.guardian_phone || '—'}</div>
                      <div>Phone: {primary.phone || '—'} · Email: {primary.email || '—'}</div>
                      <div>Class: {primary.class_name} Sec {primary.section} · DOB: {primary.dob || '—'}</div>
                    </div>
                    <button
                      onClick={() => handleMerge(primary, secondary)}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg"
                    >
                      <GitMerge className="w-3.5 h-3.5" />
                      <span>Keep {primary.student_code} & Merge {secondary.student_code}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
