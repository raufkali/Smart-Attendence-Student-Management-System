import React, { useEffect, useState } from 'react';
import { Save, Plus, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../api/client';
import type { AcademicGroup, AcademicLevel, InstitutionSettings } from '../shared/types';

interface Holiday {
  id: number;
  title: string;
  holiday_date: string;
  holiday_type: string;
  description: string;
}

export const SetupWizardView: React.FC = () => {
  const [institution, setInstitution] = useState<InstitutionSettings | null>(null);
  const [levels, setLevels] = useState<AcademicLevel[]>([]);
  const [groups, setGroups] = useState<AcademicGroup[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [message, setMessage] = useState('');

  // New academic level
  const [levelName, setLevelName] = useState('');
  const [levelType, setLevelType] = useState('Department');

  // New academic group
  const [grpDept, setGrpDept] = useState('Computer Science');
  const [grpProgram, setGrpProgram] = useState('BSCS');
  const [grpClass, setGrpClass] = useState('');
  const [grpSemester, setGrpSemester] = useState('Sem 1');
  const [grpSection, setGrpSection] = useState('A');

  // New holiday
  const [holTitle, setHolTitle] = useState('');
  const [holDate, setHolDate] = useState('');

  const load = async () => {
    const res = await apiGet<{
      institution: InstitutionSettings;
      levels: AcademicLevel[];
      groups: AcademicGroup[];
      holidays: Holiday[];
    }>('/api/institution');
    setInstitution(res.institution);
    setLevels(res.levels);
    setGroups(res.groups);
    setHolidays(res.holidays);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaveInstitution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!institution) return;
    await apiPut('/api/institution', institution);
    setMessage('Institution profile, attendance rules, and fine settings saved.');
    setTimeout(() => setMessage(''), 4000);
  };

  const handleAddLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!levelName.trim()) return;
    await apiPost('/api/academic-levels', {
      name: levelName,
      level_type: levelType,
      academic_year: institution?.academic_year || '2026-2027',
    });
    setLevelName('');
    load();
  };

  const handleToggleLevel = async (lvl: AcademicLevel) => {
    await apiPatch(`/api/academic-levels/${lvl.id}`, { is_active: lvl.is_active ? 0 : 1 });
    load();
  };

  const handleMoveLevel = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= levels.length) return;
    const a = levels[idx];
    const b = levels[target];
    await apiPatch(`/api/academic-levels/${a.id}`, { sort_order: b.sort_order });
    await apiPatch(`/api/academic-levels/${b.id}`, { sort_order: a.sort_order });
    load();
  };

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grpClass.trim()) return;
    await apiPost('/api/academic-groups', {
      academic_year: institution?.academic_year || '2026-2027',
      department: grpDept,
      program: grpProgram,
      class_name: grpClass.trim(),
      semester: grpSemester,
      section: grpSection,
    });
    setGrpClass('');
    load();
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holTitle.trim() || !holDate) return;
    await apiPost('/api/holidays', { title: holTitle, holiday_date: holDate });
    setHolTitle('');
    setHolDate('');
    load();
  };

  if (!institution) return <div className="text-sm text-slate-500">Loading setup settings...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Institution Setup & Dynamic Academic Structure</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure institution identity, configurable academic levels, attendance policies, and fine rules.
        </p>
      </div>

      {message && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
          {message}
        </div>
      )}

      {/* Institution Profile & Policies */}
      <form onSubmit={handleSaveInstitution} className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <h3 className="text-sm font-semibold text-slate-900">Institution Profile & Operational Rules</h3>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Configuration</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Institution Name</label>
            <input
              type="text"
              value={institution.name}
              onChange={(e) => setInstitution({ ...institution, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Institution Type</label>
            <select
              value={institution.type}
              onChange={(e) => setInstitution({ ...institution, type: e.target.value as InstitutionSettings['type'] })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {['School', 'College', 'University', 'Academy', 'Training Center', 'Custom'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Active Academic Year</label>
            <input
              type="text"
              value={institution.academic_year}
              onChange={(e) => setInstitution({ ...institution, academic_year: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Currency Code</label>
            <input
              type="text"
              value={institution.currency}
              onChange={(e) => setInstitution({ ...institution, currency: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Contact Phone</label>
            <input
              type="text"
              value={institution.phone}
              onChange={(e) => setInstitution({ ...institution, phone: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Time Zone</label>
            <input
              type="text"
              value={institution.timezone}
              onChange={(e) => setInstitution({ ...institution, timezone: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-800">Attendance Policy Rules</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Late Threshold (min)</label>
                <input
                  type="number"
                  value={institution.attendance_rules.lateThresholdMinutes}
                  onChange={(e) =>
                    setInstitution({
                      ...institution,
                      attendance_rules: { ...institution.attendance_rules, lateThresholdMinutes: Number(e.target.value) },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Lock After (hours)</label>
                <input
                  type="number"
                  value={institution.attendance_rules.lockAfterHours}
                  onChange={(e) =>
                    setInstitution({
                      ...institution,
                      attendance_rules: { ...institution.attendance_rules, lockAfterHours: Number(e.target.value) },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={institution.attendance_rules.countExcusedAsPresent}
                onChange={(e) =>
                  setInstitution({
                    ...institution,
                    attendance_rules: { ...institution.attendance_rules, countExcusedAsPresent: e.target.checked },
                  })
                }
              />
              <span>Count Excused Absences as Present in Percentage</span>
            </label>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-800">Automated Fine Rules</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Absence Fine ({institution.currency})</label>
                <input
                  type="number"
                  step="0.5"
                  value={(institution.fine_rules.absenceFineCents / 100).toFixed(2)}
                  onChange={(e) =>
                    setInstitution({
                      ...institution,
                      fine_rules: { ...institution.fine_rules, absenceFineCents: Math.round(Number(e.target.value) * 100) },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Late Fine ({institution.currency})</label>
                <input
                  type="number"
                  step="0.5"
                  value={(institution.fine_rules.lateFineCents / 100).toFixed(2)}
                  onChange={(e) =>
                    setInstitution({
                      ...institution,
                      fine_rules: { ...institution.fine_rules, lateFineCents: Math.round(Number(e.target.value) * 100) },
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={institution.fine_rules.autoGenerateFines}
                onChange={(e) =>
                  setInstitution({
                    ...institution,
                    fine_rules: { ...institution.fine_rules, autoGenerateFines: e.target.checked },
                  })
                }
              />
              <span>Automatically generate fines on absence / late submission</span>
            </label>
          </div>
        </div>
      </form>

      {/* Dynamic Academic Levels + Academic Groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Configurable Academic Hierarchy Levels</h3>
          <form onSubmit={handleAddLevel} className="flex gap-2">
            <input
              type="text"
              placeholder="Level Name (e.g. North Wing)"
              value={levelName}
              onChange={(e) => setLevelName(e.target.value)}
              className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
            />
            <select
              value={levelType}
              onChange={(e) => setLevelType(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {['Campus', 'Branch', 'Department', 'Faculty', 'Program', 'Course', 'Grade', 'Class', 'Semester', 'Section', 'Batch'].map(
                (lt) => (
                  <option key={lt} value={lt}>{lt}</option>
                )
              )}
            </select>
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg max-h-72 overflow-y-auto">
            {levels.map((lvl, idx) => (
              <div key={lvl.id} className="px-3 py-2 flex items-center justify-between text-sm">
                <div>
                  <span className={lvl.is_active ? 'font-medium text-slate-900' : 'text-slate-400 line-through'}>
                    {lvl.name}
                  </span>
                  <span className="text-xs text-slate-500 ml-2">· {lvl.level_type}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveLevel(idx, -1)}
                    aria-label={`Move ${lvl.name} up`}
                    className="p-1 text-slate-500 hover:text-slate-900"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveLevel(idx, 1)}
                    aria-label={`Move ${lvl.name} down`}
                    className="p-1 text-slate-500 hover:text-slate-900"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleLevel(lvl)}
                    className="px-2 py-0.5 text-xs border border-slate-200 rounded text-slate-700 hover:bg-slate-50"
                  >
                    {lvl.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Academic Groups & Holidays */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Active Class / Section Groups</h3>
            <form onSubmit={handleAddGroup} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <input
                type="text"
                placeholder="Dept"
                value={grpDept}
                onChange={(e) => setGrpDept(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                placeholder="Program"
                value={grpProgram}
                onChange={(e) => setGrpProgram(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                placeholder="Class (e.g. BSCS-3)"
                value={grpClass}
                onChange={(e) => setGrpClass(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                placeholder="Sec (A)"
                value={grpSection}
                onChange={(e) => setGrpSection(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg"
              >
                Add Group
              </button>
            </form>
            <div className="text-xs text-slate-600 divide-y divide-slate-200 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
              {groups.map((g) => (
                <div key={g.id} className="px-3 py-2 flex justify-between">
                  <span className="font-medium text-slate-900">
                    {g.class_name} · Sec {g.section} ({g.semester})
                  </span>
                  <span className="text-slate-500">
                    {g.department} · {g.academic_year}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Institutional Holidays</h3>
            <form onSubmit={handleAddHoliday} className="flex gap-2">
              <input
                type="text"
                placeholder="Holiday Title"
                value={holTitle}
                onChange={(e) => setHolTitle(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="date"
                value={holDate}
                onChange={(e) => setHolDate(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg"
              >
                Add
              </button>
            </form>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
              {holidays.map((h) => (
                <div key={h.id} className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-slate-900">{h.title}</span>
                    <span className="font-mono text-slate-500 ml-2">{h.holiday_date}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => apiDelete(`/api/holidays/${h.id}`).then(load)}
                    aria-label={`Delete holiday ${h.title}`}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
