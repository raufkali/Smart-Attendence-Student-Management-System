import type { AttendanceStatus, DuplicateMatch, TimetableConflict } from './types';

// ============================================================================
// 1. Reliable Integer-Cents Financial Arithmetic
// ============================================================================

export function toCents(amount: number | string): number {
  const num = typeof amount === 'string' ? Number(amount.replace(/[^0-9.-]/g, '')) : amount;
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function formatCurrency(cents: number, currency = 'USD'): string {
  const value = fromCents(cents);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function calculateDiscountCents(
  subtotalCents: number,
  discountType: 'percentage' | 'fixed' | 'waiver',
  value: number
): number {
  if (subtotalCents <= 0) return 0;
  if (discountType === 'waiver') return subtotalCents;
  if (discountType === 'percentage') {
    const clampedPct = Math.max(0, Math.min(100, value));
    return Math.round((subtotalCents * clampedPct) / 100);
  }
  const fixedCents = toCents(value);
  return Math.max(0, Math.min(subtotalCents, fixedCents));
}

export function calculateInvoiceTotals(
  items: Array<{ amount_cents: number }>,
  discountCents: number,
  lateFeeCents = 0
): {
  subtotalCents: number;
  discountCents: number;
  lateFeeCents: number;
  totalCents: number;
} {
  const subtotalCents = items.reduce((sum, item) => sum + Math.max(0, Math.round(item.amount_cents)), 0);
  const clampedDiscount = Math.max(0, Math.min(subtotalCents, Math.round(discountCents)));
  const cleanLateFee = Math.max(0, Math.round(lateFeeCents));
  const totalCents = Math.max(0, subtotalCents - clampedDiscount + cleanLateFee);
  return {
    subtotalCents,
    discountCents: clampedDiscount,
    lateFeeCents: cleanLateFee,
    totalCents,
  };
}

export function allocatePayment(
  invoiceTotalCents: number,
  alreadyPaidCents: number,
  paymentAmountCents: number
): {
  newPaidCents: number;
  remainingCents: number;
  overpaidCents: number;
  status: 'unpaid' | 'partial' | 'paid';
} {
  const cleanPay = Math.max(0, Math.round(paymentAmountCents));
  const newPaidCents = Math.max(0, Math.round(alreadyPaidCents)) + cleanPay;
  const remainingCents = Math.max(0, invoiceTotalCents - newPaidCents);
  const overpaidCents = Math.max(0, newPaidCents - invoiceTotalCents);
  const status: 'unpaid' | 'partial' | 'paid' =
    newPaidCents <= 0 ? 'unpaid' : remainingCents === 0 ? 'paid' : 'partial';
  return { newPaidCents, remainingCents, overpaidCents, status };
}

// ============================================================================
// 2. Timetable Conflict Detection
// ============================================================================

export interface TimetableSessionLike {
  id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject_id: number;
  teacher_id: number;
  class_name: string;
  semester: string;
  section: string;
  room: string;
  academic_year?: string;
  is_active?: number;
  course_name?: string;
  teacher_name?: string;
}

export function parseMinutes(hhmm: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a1 = parseMinutes(startA);
  const a2 = parseMinutes(endA);
  const b1 = parseMinutes(startB);
  const b2 = parseMinutes(endB);
  if (a1 < 0 || a2 < 0 || b1 < 0 || b2 < 0) return false;
  return a1 < b2 && b1 < a2;
}

export function detectTimetableConflicts(
  sessions: TimetableSessionLike[]
): TimetableConflict[] {
  const active = sessions.filter((s) => s.is_active !== 0);
  const conflicts: TimetableConflict[] = [];

  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    const startMin = parseMinutes(a.start_time);
    const endMin = parseMinutes(a.end_time);
    if (startMin < 0 || endMin < 0 || startMin >= endMin) {
      conflicts.push({
        type: 'invalid_time',
        severity: 'high',
        message: `Invalid time range ${a.start_time}–${a.end_time} on ${a.day_of_week} for ${a.class_name} ${a.section}.`,
        sessionAId: a.id,
        day_of_week: a.day_of_week,
      });
    }

    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      if (a.day_of_week !== b.day_of_week) continue;
      if (a.academic_year && b.academic_year && a.academic_year !== b.academic_year) continue;
      if (!timesOverlap(a.start_time, a.end_time, b.start_time, b.end_time)) continue;

      if (
        a.class_name === b.class_name &&
        a.section === b.section &&
        a.semester === b.semester &&
        a.subject_id === b.subject_id &&
        a.start_time === b.start_time &&
        a.end_time === b.end_time
      ) {
        conflicts.push({
          type: 'duplicate_entry',
          severity: 'high',
          message: `Duplicate session on ${a.day_of_week} ${a.start_time}–${a.end_time} for ${a.class_name} ${a.section}.`,
          sessionAId: a.id,
          sessionBId: b.id,
          day_of_week: a.day_of_week,
        });
        continue;
      }

      if (a.teacher_id === b.teacher_id) {
        conflicts.push({
          type: 'teacher_conflict',
          severity: 'high',
          message: `Teacher ${a.teacher_name || `#${a.teacher_id}`} double-booked on ${a.day_of_week} (${a.start_time}–${a.end_time} vs ${b.start_time}–${b.end_time}).`,
          sessionAId: a.id,
          sessionBId: b.id,
          day_of_week: a.day_of_week,
        });
      }

      if (
        a.class_name === b.class_name &&
        a.section === b.section &&
        a.semester === b.semester
      ) {
        conflicts.push({
          type: 'class_conflict',
          severity: 'high',
          message: `${a.class_name} ${a.section} (${a.semester}) has overlapping subjects on ${a.day_of_week} (${a.start_time}–${a.end_time}).`,
          sessionAId: a.id,
          sessionBId: b.id,
          day_of_week: a.day_of_week,
        });
      }

      if (a.room && b.room && a.room.trim().toLowerCase() === b.room.trim().toLowerCase()) {
        conflicts.push({
          type: 'room_conflict',
          severity: 'medium',
          message: `Room ${a.room} assigned to multiple classes on ${a.day_of_week} (${a.start_time}–${a.end_time}).`,
          sessionAId: a.id,
          sessionBId: b.id,
          day_of_week: a.day_of_week,
        });
      }
    }
  }

  return conflicts;
}

// ============================================================================
// 3. Duplicate Student Detection (Exact & Fuzzy)
// ============================================================================

export function normalizeString(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

export function normalizePhone(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

export function stringSimilarity(a: string, b: string): number {
  const na = normalizeString(a);
  const nb = normalizeString(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshteinDistance(na, nb) / maxLen;
}

export interface StudentDuplicateCandidate {
  id: number;
  student_code: string;
  full_name: string;
  guardian_name: string;
  phone: string;
  guardian_phone: string;
  email: string;
  class_name: string;
  section: string;
  dob: string;
  photo_url: string;
  is_archived?: number;
}

export function findPotentialDuplicates(
  students: StudentDuplicateCandidate[],
  dismissedPairKeys: Set<string> = new Set()
): DuplicateMatch[] {
  const active = students.filter((s) => s.is_archived !== 1);
  const matches: DuplicateMatch[] = [];

  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      const low = Math.min(a.id, b.id);
      const high = Math.max(a.id, b.id);
      const pairKey = `${low}:${high}`;
      if (dismissedPairKeys.has(pairKey)) continue;

      const reasons: string[] = [];
      let score = 0;

      if (
        a.student_code &&
        b.student_code &&
        a.student_code.trim().toLowerCase() === b.student_code.trim().toLowerCase()
      ) {
        reasons.push('Identical Student ID');
        score = Math.max(score, 1.0);
      }

      const phoneA = normalizePhone(a.phone);
      const phoneB = normalizePhone(b.phone);
      if (phoneA.length >= 7 && phoneA === phoneB) {
        reasons.push('Matching Student Phone');
        score = Math.max(score, 0.92);
      }

      const gPhoneA = normalizePhone(a.guardian_phone);
      const gPhoneB = normalizePhone(b.guardian_phone);
      const nameSim = stringSimilarity(a.full_name, b.full_name);
      const guardianSim = stringSimilarity(a.guardian_name, b.guardian_name);

      if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) {
        reasons.push('Matching Email Address');
        score = Math.max(score, 0.94);
      }

      if (nameSim >= 0.85) {
        reasons.push(`Similar Name (${Math.round(nameSim * 100)}%)`);
        if (guardianSim >= 0.78) {
          reasons.push(`Similar Guardian (${Math.round(guardianSim * 100)}%)`);
          score = Math.max(score, 0.95);
        } else if (gPhoneA.length >= 7 && gPhoneA === gPhoneB) {
          reasons.push('Matching Guardian Phone');
          score = Math.max(score, 0.93);
        } else if (a.dob && b.dob && a.dob === b.dob) {
          reasons.push('Matching Date of Birth');
          score = Math.max(score, 0.9);
        } else {
          score = Math.max(score, nameSim * 0.9);
        }
      } else if (gPhoneA.length >= 7 && gPhoneA === gPhoneB && nameSim >= 0.65) {
        reasons.push('Matching Guardian Phone & Partial Name');
        score = Math.max(score, 0.82);
      }

      if (reasons.length > 0 && score >= 0.78) {
        matches.push({
          pairKey,
          studentA: a,
          studentB: b,
          score: Number(score.toFixed(2)),
          reasons,
        });
      }
    }
  }

  return matches.sort((x, y) => y.score - x.score);
}

// ============================================================================
// 4. Attendance Calculation & Defaulter Detection
// ============================================================================

export interface AttendancePolicy {
  countExcusedAsPresent?: boolean;
  lateCountsAsPresent?: boolean;
  excludeCancelled?: boolean;
}

export interface AttendanceStats {
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  cancelledExcluded: number;
  percentage: number;
}

export function calculateAttendanceStats(
  records: Array<{ status: AttendanceStatus | string; session_status?: string }>,
  policy: AttendancePolicy = {}
): AttendanceStats {
  const {
    countExcusedAsPresent = true,
    lateCountsAsPresent = true,
    excludeCancelled = true,
  } = policy;

  let totalSessions = 0;
  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  let excusedCount = 0;
  let cancelledExcluded = 0;

  for (const rec of records) {
    if (excludeCancelled && rec.session_status === 'cancelled') {
      cancelledExcluded++;
      continue;
    }
    totalSessions++;
    if (rec.status === 'present') presentCount++;
    else if (rec.status === 'absent') absentCount++;
    else if (rec.status === 'late') lateCount++;
    else if (rec.status === 'excused') excusedCount++;
  }

  const effectivePresent =
    presentCount +
    (lateCountsAsPresent ? lateCount : 0) +
    (countExcusedAsPresent ? excusedCount : 0);

  const percentage =
    totalSessions === 0 ? 100 : Number(((effectivePresent / totalSessions) * 100).toFixed(1));

  return {
    totalSessions,
    presentCount,
    absentCount,
    lateCount,
    excusedCount,
    cancelledExcluded,
    percentage,
  };
}

export function maxConsecutiveAbsences(
  records: Array<{ status: string; session_status?: string; session_date?: string }>
): number {
  const sorted = [...records]
    .filter((r) => r.session_status !== 'cancelled')
    .sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''));
  let maxStreak = 0;
  let current = 0;
  for (const rec of sorted) {
    if (rec.status === 'absent') {
      current++;
      if (current > maxStreak) maxStreak = current;
    } else {
      current = 0;
    }
  }
  return maxStreak;
}

// ============================================================================
// 5. Excel Import Row Validation
// ============================================================================

export interface ImportRowValidation {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  action: 'create' | 'skip_existing' | 'blocked';
  normalized: Record<string, string | number>;
}

const VALID_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateStudentImportRow(
  rawRow: Record<string, unknown>,
  rowNumber: number,
  requiredFields: string[],
  existingCodes: Set<string>,
  existingNamesByCode: Map<string, string>
): ImportRowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const str = (key: string) => {
    const val = rawRow[key];
    return val === undefined || val === null ? '' : String(val).trim();
  };

  const normalized: Record<string, string | number> = {
    student_code: str('Student ID'),
    full_name: str('Full Name'),
    guardian_name: str("Father's/Guardian's Name"),
    gender: str('Gender'),
    dob: str('Date of Birth'),
    phone: str('Phone'),
    guardian_phone: str('Guardian Phone'),
    email: str('Email'),
    address: str('Address'),
    admission_date: str('Admission Date'),
    academic_year: str('Academic Year'),
    department: str('Department') || str('Program'),
    program: str('Program'),
    class_name: str('Class'),
    semester: str('Semester'),
    section: str('Section'),
    admission_fee: Number(rawRow['Admission Fee'] || 0) || 0,
    monthly_fee: Number(rawRow['Monthly Fee'] || 0) || 0,
    discount: Number(rawRow['Discount'] || 0) || 0,
    photo_filename: str('Photograph Filename'),
  };

  const fieldMap: Record<string, keyof typeof normalized> = {
    'Student ID': 'student_code',
    'Full Name': 'full_name',
    "Father's/Guardian's Name": 'guardian_name',
    Gender: 'gender',
    'Date of Birth': 'dob',
    Phone: 'phone',
    'Guardian Phone': 'guardian_phone',
    Email: 'email',
    Address: 'address',
    'Admission Date': 'admission_date',
    'Academic Year': 'academic_year',
    Program: 'program',
    Class: 'class_name',
    Semester: 'semester',
    Section: 'section',
  };

  for (const req of requiredFields) {
    const key = fieldMap[req];
    if (key && !String(normalized[key] || '').trim()) {
      errors.push(`Missing required field "${req}"`);
    }
  }

  if (normalized.dob && !VALID_DATE_RE.test(String(normalized.dob))) {
    errors.push(`Invalid Date of Birth "${normalized.dob}" (expected YYYY-MM-DD)`);
  }
  if (normalized.admission_date && !VALID_DATE_RE.test(String(normalized.admission_date))) {
    errors.push(`Invalid Admission Date "${normalized.admission_date}" (expected YYYY-MM-DD)`);
  }
  if (normalized.phone && normalizePhone(String(normalized.phone)).length < 7) {
    errors.push(`Invalid Phone format "${normalized.phone}"`);
  }
  if (normalized.guardian_phone && normalizePhone(String(normalized.guardian_phone)).length < 7) {
    errors.push(`Invalid Guardian Phone format "${normalized.guardian_phone}"`);
  }
  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(normalized.email))) {
    errors.push(`Invalid Email "${normalized.email}"`);
  }

  const code = String(normalized.student_code).toLowerCase();
  let action: 'create' | 'skip_existing' | 'blocked' = 'create';

  if (code && existingCodes.has(code)) {
    warnings.push(`Student ID "${normalized.student_code}" already exists (will not overwrite silently)`);
    action = 'skip_existing';
  } else if (normalized.full_name) {
    for (const [exCode, exName] of existingNamesByCode.entries()) {
      if (stringSimilarity(String(normalized.full_name), exName) >= 0.88) {
        warnings.push(`Possible duplicate of existing student "${exName}" (${exCode})`);
        break;
      }
    }
  }

  if (errors.length > 0) {
    action = 'blocked';
  }

  return {
    rowNumber,
    valid: errors.length === 0,
    errors,
    warnings,
    action,
    normalized,
  };
}
