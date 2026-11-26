import React, { useEffect, useState } from 'react';
import { CalendarPlus, Copy, AlertTriangle, Printer, UserCheck, Trash2, X } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '../api/client';
import type { SubjectRecord, TeacherRecord, TimetableConflict, TimetableSession } from '../shared/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const TimetableView: React.FC = () => {
  const [sessions, setSessions] = useState<TimetableSession[]>([]);
  const [conflicts, setConflicts] = useState<TimetableConflict[]>([]);
  const [substitutions, setSubstitutions] = useState<
    Array<{
      id: number;
      substitution_date: string;
      day_of_week: string;
      start_time: string;
      class_name: string;
      section: string;
      course_code: string;
      original_teacher_name: string;
      substitute_teacher_name: string;
      reason: string;
    }>
  >([]);
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);

  const [viewMode, setViewMode] = useState<'weekly' | 'teacher' | 'room'>('weekly');
  const [filterClass, setFilterClass] = useState('');

  // New session form
  const [newForm, setNewForm] = useState({
    day_of_week: 'Monday',
    start_time: '08:30',
    end_time: '09:45',
    subject_id: 0,
    teacher_id: 0,
    class_name: 'BSCS-1',
    semester: 'Sem 1',
    section: 'A',
    room: 'LH-104',
  });
  const [conflictWarn, setConflictWarn] = useState<TimetableConflict[]>([]);

  // Clone modal
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState({
    sourceClass: 'BSCS-1',
    sourceSection: 'A',
    targetClass: 'BSCS-1',
    targetSection: 'B',
    targetYear: '2026-2027',
    targetSemester: 'Sem 1',
    overwriteTarget: false,
  });
  const [clonePreview, setClonePreview] = useState<{
    proposedCount: number;
    proposed: TimetableSession[];
    conflicts: TimetableConflict[];
  } | null>(null);

  // Substitution form
  const [subForm, setSubForm] = useState({
    timetable_session_id: 0,
    substitution_date: new Date().toISOString().slice(0, 10),
    substitute_teacher_id: 0,
    reason: 'Faculty conference / medical leave',
  });
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [ttRes, tRes, sRes] = await Promise.all([
      apiGet<{ sessions: TimetableSession[]; conflicts: TimetableConflict[]; substitutions: typeof substitutions }>('/api/timetable'),
      apiGet<{ teachers: TeacherRecord[] }>('/api/teachers'),
      apiGet<{ subjects: SubjectRecord[] }>('/api/subjects'),
    ]);
    setSessions(ttRes.sessions);
    setConflicts(ttRes.conflicts);
    setSubstitutions(ttRes.substitutions);
    setTeachers(tRes.teachers);
    setSubjects(sRes.subjects);
    if (tRes.teachers.length > 0 && newForm.teacher_id === 0) {
      setNewForm((f) => ({ ...f, teacher_id: tRes.teachers[0].id }));
      setSubForm((f) => ({ ...f, substitute_teacher_id: tRes.teachers[0].id }));
    }
    if (sRes.subjects.length > 0 && newForm.subject_id === 0) {
      setNewForm((f) => ({ ...f, subject_id: sRes.subjects[0].id }));
    }
    if (ttRes.sessions.length > 0 && subForm.timetable_session_id === 0) {
      setSubForm((f) => ({ ...f, timetable_session_id: ttRes.sessions[0].id }));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateSession = async (forceSave = false) => {
    setConflictWarn([]);
    try {
      await apiPost('/api/timetable', { ...newForm, forceSave });
      setMsg('Timetable session scheduled.');
      load();
    } catch (err) {
      const e = err as Error & { data?: { conflicts?: TimetableConflict[] } };
      if (e.data?.conflicts) {
        setConflictWarn(e.data.conflicts);
      } else {
        setMsg(e.message);
      }
    }
  };

  const handlePreviewClone = async () => {
    const res = await apiPost<{ proposedCount: number; proposed: TimetableSession[]; conflicts: TimetableConflict[] }>(
      '/api/timetable/clone-preview',
      cloneForm
    );
    setClonePreview(res);
  };

  const handleCommitClone = async () => {
    if (!clonePreview) return;
    await apiPost('/api/timetable/clone-commit', {
      proposed: clonePreview.proposed,
      overwriteTarget: cloneForm.overwriteTarget,
      targetClass: cloneForm.targetClass,
      targetSection: cloneForm.targetSection,
    });
    setCloneOpen(false);
    setClonePreview(null);
    setMsg(`Cloned ${clonePreview.proposedCount} session(s) to ${cloneForm.targetClass} ${cloneForm.targetSection}.`);
    load();
  };

  const handleAssignSub = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/api/substitutions', subForm);
    setMsg('Substitute teacher assigned and synced to mobile schedule.');
    load();
  };

  const filtered = filterClass ? sessions.filter((s) => s.class_name === filterClass) : sessions;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Timetable Editor, Cloning & Conflict Center</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Visual schedule matrix with real-time conflict detection, cloning previews, and teacher substitutions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCloneOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-blue-800 hover:bg-blue-900 text-white rounded-lg"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Clone Timetable</span>
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Schedule</span>
          </button>
        </div>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {msg}
        </div>
      )}

      {/* Conflict Alert Banner */}
      {conflicts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-red-800">
            <AlertTriangle className="w-4 h-4" />
            <span>{conflicts.length} Active Timetable Conflict(s) Detected</span>
          </div>
          <div className="space-y-1 text-xs text-red-700">
            {conflicts.map((c, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span>{c.message}</span>
                {c.sessionBId && (
                  <button
                    onClick={() => apiDelete(`/api/timetable/${c.sessionBId}`).then(load)}
                    className="px-2 py-0.5 bg-white border border-red-300 rounded text-red-800 font-medium hover:bg-red-100 whitespace-nowrap"
                  >
                    Remove Conflicting Session
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View Switch & Add Session Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['weekly', 'teacher', 'room'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize ${
                  viewMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {m} View
              </button>
            ))}
          </div>
          <select
            aria-label="Filter timetable by class"
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Classes</option>
            <option value="BSCS-1">BSCS-1</option>
            <option value="BSCS-2">BSCS-2</option>
            <option value="BSDA-1">BSDA-1</option>
          </select>
        </div>

        {/* Add Session Form */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-3 border-t border-slate-200 items-end">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Day</label>
            <select
              value={newForm.day_of_week}
              onChange={(e) => setNewForm({ ...newForm, day_of_week: e.target.value })}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Start</label>
            <input
              type="time"
              value={newForm.start_time}
              onChange={(e) => setNewForm({ ...newForm, start_time: e.target.value })}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">End</label>
            <input
              type="time"
              value={newForm.end_time}
              onChange={(e) => setNewForm({ ...newForm, end_time: e.target.value })}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Subject</label>
            <select
              value={newForm.subject_id}
              onChange={(e) => setNewForm({ ...newForm, subject_id: Number(e.target.value) })}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.course_code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Teacher</label>
            <select
              value={newForm.teacher_id}
              onChange={(e) => setNewForm({ ...newForm, teacher_id: Number(e.target.value) })}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Class / Sec</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={newForm.class_name}
                onChange={(e) => setNewForm({ ...newForm, class_name: e.target.value })}
                className="w-2/3 px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                value={newForm.section}
                onChange={(e) => setNewForm({ ...newForm, section: e.target.value })}
                className="w-1/3 px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Room</label>
            <input
              type="text"
              value={newForm.room}
              onChange={(e) => setNewForm({ ...newForm, room: e.target.value })}
              className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
            />
          </div>
          <button
            type="button"
            onClick={() => handleCreateSession(false)}
            className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            <span>Schedule</span>
          </button>
        </div>

        {conflictWarn.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-center justify-between">
            <div>
              <strong>Conflict prevented save:</strong> {conflictWarn.map((c) => c.message).join(' ')}
            </div>
            <button
              type="button"
              onClick={() => handleCreateSession(true)}
              className="px-2.5 py-1 bg-amber-800 text-white rounded font-medium ml-3 whitespace-nowrap"
            >
              Override & Save
            </button>
          </div>
        )}
      </div>

      {/* Visual Weekly Grid */}
      {viewMode === 'weekly' && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {DAYS.map((day) => {
            const daySessions = filtered.filter((s) => s.day_of_week === day);
            return (
              <div key={day} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
                <div className="text-xs font-bold text-slate-800 pb-2 border-b border-slate-200 flex justify-between">
                  <span>{day}</span>
                  <span className="font-mono text-slate-400 tabular-nums">{daySessions.length}</span>
                </div>
                {daySessions.length === 0 ? (
                  <div className="text-xs text-slate-400 py-4 text-center">No sessions</div>
                ) : (
                  daySessions.map((s) => {
                    const hasConflict = conflicts.some((c) => c.sessionAId === s.id || c.sessionBId === s.id);
                    return (
                      <div
                        key={s.id}
                        className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                          hasConflict ? 'border-red-300 bg-red-50/50' : 'border-slate-200 bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] text-slate-500 tabular-nums">
                          <span>{s.start_time}–{s.end_time}</span>
                          <button
                            onClick={() => apiDelete(`/api/timetable/${s.id}`).then(load)}
                            aria-label={`Remove ${s.course_code} on ${day}`}
                            className="text-slate-400 hover:text-red-600 no-print"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="font-semibold text-slate-900">{s.course_code} · {s.class_name} {s.section}</div>
                        <div className="text-slate-600 truncate">{s.teacher_name}</div>
                        <div className="font-mono text-[11px] text-slate-500">Room {s.room}</div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewMode !== 'weekly' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4">{viewMode === 'teacher' ? 'Teacher' : 'Room'}</th>
                <th className="py-2.5 px-4">Day & Time</th>
                <th className="py-2.5 px-4">Subject</th>
                <th className="py-2.5 px-4">Cohort</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {[...filtered]
                .sort((a, b) =>
                  viewMode === 'teacher'
                    ? (a.teacher_name || '').localeCompare(b.teacher_name || '')
                    : a.room.localeCompare(b.room)
                )
                .map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      {viewMode === 'teacher' ? s.teacher_name : s.room}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">
                      {s.day_of_week} · {s.start_time}–{s.end_time}
                    </td>
                    <td className="py-2.5 px-4">{s.course_code} — {s.course_name}</td>
                    <td className="py-2.5 px-4">{s.class_name} · Sec {s.section}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Teacher Substitution Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <UserCheck className="w-4 h-4 text-blue-800" />
          <span>Teacher Substitution Manager</span>
        </div>
        <form onSubmit={handleAssignSub} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Scheduled Session</label>
            <select
              value={subForm.timetable_session_id}
              onChange={(e) => setSubForm({ ...subForm, timetable_session_id: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.day_of_week} {s.start_time} · {s.course_code} ({s.teacher_name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Substitution Date</label>
            <input
              type="date"
              value={subForm.substitution_date}
              onChange={(e) => setSubForm({ ...subForm, substitution_date: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Substitute Teacher</label>
            <select
              value={subForm.substitute_teacher_id}
              onChange={(e) => setSubForm({ ...subForm, substitute_teacher_id: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Reason</label>
            <input
              type="text"
              value={subForm.reason}
              onChange={(e) => setSubForm({ ...subForm, reason: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <button type="submit" className="py-1.5 px-4 bg-slate-900 text-white text-xs font-medium rounded-lg">
            Assign Substitute
          </button>
        </form>

        {substitutions.length > 0 && (
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 text-xs">
            {substitutions.map((sub) => (
              <div key={sub.id} className="px-3 py-2 flex justify-between">
                <span>
                  <strong>{sub.course_code}</strong> ({sub.class_name} {sub.section}) on <span className="font-mono">{sub.substitution_date}</span>: {sub.original_teacher_name} → <strong>{sub.substitute_teacher_name}</strong>
                </span>
                <span className="text-slate-500">{sub.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timetable Cloning Modal */}
      {cloneOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Clone Timetable with Conflict Preview</h3>
              <button onClick={() => setCloneOpen(false)} aria-label="Close Clone Modal" className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">Source Class</label>
                <input
                  type="text"
                  value={cloneForm.sourceClass}
                  onChange={(e) => setCloneForm({ ...cloneForm, sourceClass: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Source Section</label>
                <input
                  type="text"
                  value={cloneForm.sourceSection}
                  onChange={(e) => setCloneForm({ ...cloneForm, sourceSection: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Target Class</label>
                <input
                  type="text"
                  value={cloneForm.targetClass}
                  onChange={(e) => setCloneForm({ ...cloneForm, targetClass: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Target Section</label>
                <input
                  type="text"
                  value={cloneForm.targetSection}
                  onChange={(e) => setCloneForm({ ...cloneForm, targetSection: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={cloneForm.overwriteTarget}
                onChange={(e) => setCloneForm({ ...cloneForm, overwriteTarget: e.target.checked })}
              />
              <span>Archive existing timetable in target class/section before cloning</span>
            </label>

            <button
              type="button"
              onClick={handlePreviewClone}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg"
            >
              Preview Clone & Check Conflicts
            </button>

            {clonePreview && (
              <div className="space-y-3 border-t border-slate-200 pt-3 text-xs">
                <div className="font-medium text-slate-900">
                  {clonePreview.proposedCount} session(s) prepared · {clonePreview.conflicts.length} conflict(s) detected
                </div>
                {clonePreview.conflicts.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 p-2.5 rounded text-amber-800 space-y-1">
                    {clonePreview.conflicts.map((c, idx) => (
                      <div key={idx}>{c.message}</div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleCommitClone}
                  className="w-full py-2 bg-blue-800 text-white font-medium rounded-lg"
                >
                  Confirm & Apply Cloned Timetable
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
