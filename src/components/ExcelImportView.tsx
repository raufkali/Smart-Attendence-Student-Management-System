import React, { useState } from 'react';
import { Download, Upload, Image as ImageIcon, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiDownload, apiPost, apiUpload } from '../api/client';

interface PreviewRow {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  action: 'create' | 'skip_existing' | 'blocked';
  normalized: Record<string, string | number>;
}

interface ExcelPreviewResponse {
  filename: string;
  totalRows: number;
  validCreateCount: number;
  existingSkipCount: number;
  blockedCount: number;
  rows: PreviewRow[];
}

interface PhotoPreviewResponse {
  matched: Array<{ filename: string; studentId: number; studentCode: string; studentName: string; dataUrl: string }>;
  unmatchedFiles: Array<{ filename: string; reason: string }>;
  invalidFiles: Array<{ filename: string; reason: string }>;
  duplicateFilenames: string[];
  studentsWithoutPhotoCount: number;
}

export const ExcelImportView: React.FC = () => {
  const [excelPreview, setExcelPreview] = useState<ExcelPreviewResponse | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');

  const [photoPreview, setPhotoPreview] = useState<PhotoPreviewResponse | null>(null);
  const [photoMsg, setPhotoMsg] = useState('');

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCommitMsg('');
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiUpload<ExcelPreviewResponse>('/api/excel/preview', fd);
    setExcelPreview(res);
  };

  const handleCommitExcel = async () => {
    if (!excelPreview) return;
    const res = await apiPost<{ created: number; updated: number; skipped: number; batchId: number }>('/api/excel/commit', {
      rows: excelPreview.rows,
      updateExisting,
    });
    setCommitMsg(
      `Imported safely: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped (Rollback Batch #${res.batchId} saved).`
    );
    setExcelPreview(null);
  };

  const handleDownloadErrors = () => {
    if (!excelPreview) return;
    const lines = ['Row,Student ID,Full Name,Status,Errors,Warnings'];
    for (const r of excelPreview.rows) {
      if (r.errors.length === 0 && r.warnings.length === 0) continue;
      lines.push(
        `${r.rowNumber},"${r.normalized.student_code}","${r.normalized.full_name}",${r.action},"${r.errors.join('; ')}","${r.warnings.join('; ')}"`
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import_validation_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setPhotoMsg('');
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('photos', f));
    const res = await apiUpload<PhotoPreviewResponse>('/api/photos/bulk-preview', fd);
    setPhotoPreview(res);
  };

  const handleCommitPhotos = async () => {
    if (!photoPreview || photoPreview.matched.length === 0) return;
    const res = await apiPost<{ ok: boolean; batchId: number }>('/api/photos/bulk-commit', {
      assignments: photoPreview.matched,
    });
    setPhotoMsg(`Assigned ${photoPreview.matched.length} photograph(s) cleanly (Rollback Batch #${res.batchId}).`);
    setPhotoPreview(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Excel Bulk Import, Export & Photo Matching</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Download configurable templates, validate rows before commit, and match student photos by ID filename.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => apiDownload('/api/excel/template', 'scholargrid_student_template.xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .xlsx Template</span>
          </button>
          <button
            onClick={() => apiDownload('/api/excel/export?format=xlsx', 'scholargrid_students.xlsx')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Students (.xlsx)</span>
          </button>
          <button
            onClick={() => apiDownload('/api/excel/export?format=csv', 'scholargrid_students.csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Excel Upload Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">01. Upload & Validate Student Spreadsheet</h3>
            <p className="text-xs text-slate-500">
              Missing required fields block only the affected row. Existing Student IDs are never overwritten silently.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-800 hover:bg-blue-900 text-white text-xs font-medium rounded-lg cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Select .xlsx / .csv File</span>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
          </label>
        </div>

        {commitMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
            {commitMsg}
          </div>
        )}

        {excelPreview && (
          <div className="space-y-4 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 tabular-nums">
                <span className="font-semibold text-slate-900">{excelPreview.filename}</span>
                <span className="text-emerald-700">{excelPreview.validCreateCount} ready to create</span>
                <span className="text-amber-700">{excelPreview.existingSkipCount} existing IDs</span>
                <span className="text-red-700">{excelPreview.blockedCount} blocked rows</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-slate-700">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                  />
                  <span>Update matched existing records</span>
                </label>
                <button
                  onClick={handleDownloadErrors}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Download Error Report
                </button>
                <button
                  onClick={handleCommitExcel}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-lg"
                >
                  Commit Valid Rows
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-80">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 px-3">Row</th>
                    <th className="py-2 px-3">Student ID</th>
                    <th className="py-2 px-3">Full Name</th>
                    <th className="py-2 px-3">Class / Sec</th>
                    <th className="py-2 px-3">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {excelPreview.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="py-2 px-3 font-mono tabular-nums">{r.rowNumber}</td>
                      <td className="py-2 px-3 font-mono">{String(r.normalized.student_code || '—')}</td>
                      <td className="py-2 px-3 font-medium">{String(r.normalized.full_name || '—')}</td>
                      <td className="py-2 px-3">
                        {String(r.normalized.class_name || '—')} · {String(r.normalized.section || '—')}
                      </td>
                      <td className="py-2 px-3">
                        {r.errors.length > 0 ? (
                          <span className="text-red-700 font-medium">{r.errors.join(' · ')}</span>
                        ) : r.warnings.length > 0 ? (
                          <span className="text-amber-700">{r.warnings.join(' · ')}</span>
                        ) : (
                          <span className="text-emerald-700">Valid (Create)</span>
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

      {/* Bulk Photo Upload Matcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">02. Bulk Student Photo Upload Matcher</h3>
            <p className="text-xs text-slate-500">
              Name image files using Student IDs (e.g. STU-2026-001.jpg). Uncertain matches are never assigned.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg cursor-pointer">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Select Photos</span>
            <input type="file" multiple accept="image/*" onChange={handlePhotoUpload} className="hidden" />
          </label>
        </div>

        {photoMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-4 py-2.5 rounded-lg">
            {photoMsg}
          </div>
        )}

        {photoPreview && (
          <div className="space-y-4 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 tabular-nums">
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {photoPreview.matched.length} matched
                </span>
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {photoPreview.unmatchedFiles.length} unmatched files
                </span>
                <span className="text-red-700">{photoPreview.invalidFiles.length} invalid</span>
                <span className="text-slate-500">{photoPreview.studentsWithoutPhotoCount} students still without photo</span>
              </div>
              {photoPreview.matched.length > 0 && (
                <button
                  onClick={handleCommitPhotos}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-lg"
                >
                  Confirm & Assign Matched Photos
                </button>
              )}
            </div>

            {photoPreview.matched.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {photoPreview.matched.map((m) => (
                  <div key={m.studentId} className="border border-slate-200 rounded-lg p-2 text-center">
                    <img src={m.dataUrl} alt={m.studentName} className="w-16 h-16 mx-auto rounded object-cover" />
                    <div className="text-xs font-medium text-slate-900 mt-1.5 truncate">{m.studentName}</div>
                    <div className="text-xs font-mono text-slate-500">{m.studentCode}</div>
                  </div>
                ))}
              </div>
            )}

            {photoPreview.unmatchedFiles.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Unmatched: {photoPreview.unmatchedFiles.map((u) => `${u.filename} (${u.reason})`).join(' · ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
