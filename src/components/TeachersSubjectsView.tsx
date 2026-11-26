import React, { useEffect, useState } from 'react';
import { UserPlus, BookPlus, KeyRound } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../api/client';
import type { SubjectRecord, TeacherRecord } from '../shared/types';

export const TeachersSubjectsView: React.FC = () => {
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [assignments, setAssignments] = useState<
    Array<{ id: number; teacher_id: number; course_code: string; course_name: string; class_name: string; section: string }>
  >([]);
  const [submissions, setSubmissions] = useState<Array<{ teacher_id: number; submitted_count: number; last_submitted_at: string }>>([]);

  // Forms
  const [tForm, setTForm] = useState({
    employee_id: '',
    full_name: '',
    department: 'Computer Science',
    designation: 'Lecturer',
    phone: '',
    email: '',
    initial_password: '',
  });
  const [sForm, setSForm] = useState({
    course_code: '',
    course_name: '',
    department: 'Computer Science',
    program: 'BSCS',
    class_name: 'BSCS-1',
    semester: 'Sem 1',
    section: 'A',
    credit_hours: 3,
  });
  const [assignForm, setAssignForm] = useState({
    teacher_id: 0,
    subject_id: 0,
    class_name: 'BSCS-1',
    section: 'A',
  });
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [tRes, sRes] = await Promise.all([
      apiGet<{ teachers: TeacherRecord[]; assignments: typeof assignments; submissions: typeof submissions }>('/api/teachers'),
      apiGet<{ subjects: SubjectRecord[] }>('/api/subjects'),
    ]);
    setTeachers(tRes.teachers);
    setAssignments(tRes.assignments);
    setSubmissions(tRes.submissions);
    setSubjects(sRes.subjects);
    if (tRes.teachers.length > 0 && assignForm.teacher_id === 0) {
      setAssignForm((prev) => ({ ...prev, teacher_id: tRes.teachers[0].id }));
    }
    if (sRes.subjects.length > 0 && assignForm.subject_id === 0) {
      setAssignForm((prev) => ({ ...prev, subject_id: sRes.subjects[0].id }));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAddTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/api/teachers', tForm);
    setTForm({ employee_id: '', full_name: '', department: 'Computer Science', designation: 'Lecturer', phone: '', email: '', initial_password: '' });
    setMsg('Teacher profile created.');
    load();
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/api/subjects', sForm);
    setSForm({ ...sForm, course_code: '', course_name: '' });
    setMsg('Subject added.');
    load();
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/api/teacher-assignments', assignForm);
    setMsg('Teacher assigned to subject & section.');
    load();
  };

  const handleResetPass = async (teacherId: number, name: string) => {
    await apiPost(`/api/teachers/${teacherId}/reset-password`, { newPassword: 'teacher123' });
    setMsg(`Password for ${name} reset to temporary credential (teacher123).`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Faculty & Subject Management</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage teacher accounts, course catalogs, section assignments, and submission history.
        </p>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {msg}
        </div>
      )}

      {/* Teachers Table & Add Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">Faculty Directory</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Employee ID</th>
                  <th className="py-2.5 px-4">Teacher</th>
                  <th className="py-2.5 px-4">Assigned Subjects</th>
                  <th className="py-2.5 px-4">Submitted</th>
                  <th className="py-2.5 px-4 text-right">Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {teachers.map((t) => {
                  const tAssign = assignments.filter((a) => a.teacher_id === t.id);
                  const subStat = submissions.find((s) => s.teacher_id === t.id);
                  return (
                    <tr key={t.id}>
                      <td className="py-2.5 px-4 font-mono text-slate-700">{t.employee_id}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{t.full_name}</div>
                        <div className="text-slate-500">{t.department} · {t.designation}</div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        {tAssign.length === 0
                          ? 'Unassigned'
                          : tAssign.map((a) => `${a.course_code} (${a.class_name} ${a.section})`).join(', ')}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums">{subStat?.submitted_count || 0}</td>
                      <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() =>
                            apiPatch(`/api/teachers/${t.id}`, { status: t.status === 'Active' ? 'Inactive' : 'Active' }).then(load)
                          }
                          className="px-2 py-1 border border-slate-200 rounded text-slate-700 hover:bg-slate-50"
                        >
                          {t.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => handleResetPass(t.id, t.full_name)}
                          aria-label={`Reset password for ${t.full_name}`}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-slate-200 rounded text-slate-700 hover:bg-slate-50"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Reset</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <form onSubmit={handleAddTeacher} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <UserPlus className="w-4 h-4 text-blue-800" />
            <span>Add Teacher Account</span>
          </div>
          <input
            type="text"
            required
            placeholder="Employee ID (e.g. EMP-104)"
            value={tForm.employee_id}
            onChange={(e) => setTForm({ ...tForm, employee_id: e.target.value })}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
          />
          <input
            type="text"
            required
            placeholder="Full Name"
            value={tForm.full_name}
            onChange={(e) => setTForm({ ...tForm, full_name: e.target.value })}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
          <input
            type="text"
            required
            placeholder="Department"
            value={tForm.department}
            onChange={(e) => setTForm({ ...tForm, department: e.target.value })}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
          <input
            type="text"
            placeholder="Designation"
            value={tForm.designation}
            onChange={(e) => setTForm({ ...tForm, designation: e.target.value })}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
          <input
            type="password"
            placeholder="Initial Password (default: teacher123)"
            value={tForm.initial_password}
            onChange={(e) => setTForm({ ...tForm, initial_password: e.target.value })}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
          <button type="submit" className="w-full py-2 bg-blue-800 text-white text-xs font-medium rounded-lg">
            Create Teacher
          </button>
        </form>
      </div>

      {/* Subjects & Assignments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Subjects & Course Catalog</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Code</th>
                  <th className="py-2.5 px-4">Course Name</th>
                  <th className="py-2.5 px-4">Class / Sec</th>
                  <th className="py-2.5 px-4 text-right">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {subjects.map((sub) => (
                  <tr key={sub.id}>
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-800">{sub.course_code}</td>
                    <td className="py-2.5 px-4 text-slate-900">{sub.course_name}</td>
                    <td className="py-2.5 px-4 text-slate-600">{sub.class_name} · Sec {sub.section} ({sub.semester})</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{sub.credit_hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <form onSubmit={handleAddSubject} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BookPlus className="w-4 h-4 text-blue-800" />
              <span>Add Subject</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="Code (CS-105)"
                value={sForm.course_code}
                onChange={(e) => setSForm({ ...sForm, course_code: e.target.value })}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
              />
              <input
                type="number"
                placeholder="Credits"
                value={sForm.credit_hours}
                onChange={(e) => setSForm({ ...sForm, credit_hours: Number(e.target.value) })}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg tabular-nums"
              />
            </div>
            <input
              type="text"
              required
              placeholder="Course Name"
              value={sForm.course_name}
              onChange={(e) => setSForm({ ...sForm, course_name: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Class (BSCS-1)"
                value={sForm.class_name}
                onChange={(e) => setSForm({ ...sForm, class_name: e.target.value })}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                placeholder="Section (A)"
                value={sForm.section}
                onChange={(e) => setSForm({ ...sForm, section: e.target.value })}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <button type="submit" className="w-full py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg">
              Create Subject
            </button>
          </form>

          <form onSubmit={handleAssign} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-900">Assign Teacher to Subject</h4>
            <select
              value={assignForm.teacher_id}
              onChange={(e) => setAssignForm({ ...assignForm, teacher_id: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
            <select
              value={assignForm.subject_id}
              onChange={(e) => setAssignForm({ ...assignForm, subject_id: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.course_code} — {s.course_name}</option>
              ))}
            </select>
            <button type="submit" className="w-full py-1.5 border border-slate-300 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-50">
              Assign Section
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
