export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type SessionLifecycleStatus =
  | 'upcoming'
  | 'in_progress'
  | 'pending_submission'
  | 'submitted'
  | 'cancelled'
  | 'missed';

export interface InstitutionSettings {
  id: number;
  name: string;
  type: 'School' | 'College' | 'University' | 'Academy' | 'Training Center' | 'Custom';
  logo_url: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  academic_year: string;
  currency: string;
  timezone: string;
  working_days: string[];
  attendance_rules: {
    lateThresholdMinutes: number;
    gracePeriodMinutes: number;
    submissionDeadlineHours: number;
    lockAfterHours: number;
    countExcusedAsPresent: boolean;
    lateCountsAsPresent: boolean;
    warningThresholds: number[];
    requireCorrectionReason: boolean;
  };
  fine_rules: {
    absenceFineCents: number;
    lateFineCents: number;
    consecutiveAbsenceThreshold: number;
    consecutiveAbsenceFineCents: number;
    repeatedLateThreshold: number;
    repeatedLateFineCents: number;
    maxMonthlyFineCents: number;
    autoGenerateFines: boolean;
  };
  fee_settings: {
    defaultDueDays: number;
    lateFeeCents: number;
    requiredImportFields: string[];
  };
  setup_completed: boolean;
}

export interface AcademicLevel {
  id: number;
  name: string;
  level_type: string;
  parent_id: number | null;
  sort_order: number;
  is_active: number;
  academic_year: string;
}

export interface AcademicGroup {
  id: number;
  academic_year: string;
  campus: string;
  department: string;
  program: string;
  class_name: string;
  semester: string;
  section: string;
  capacity: number;
  is_active: number;
}

export interface StudentRecord {
  id: number;
  student_code: string;
  full_name: string;
  guardian_name: string;
  gender: string;
  dob: string;
  phone: string;
  guardian_phone: string;
  email: string;
  address: string;
  admission_date: string;
  academic_year: string;
  department: string;
  program: string;
  class_name: string;
  semester: string;
  section: string;
  status: 'Active' | 'Graduated' | 'Withdrawn' | 'Transferred' | 'Archived';
  photo_url: string;
  custom_fields_json: string;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export interface TeacherRecord {
  id: number;
  employee_id: string;
  full_name: string;
  phone: string;
  email: string;
  address: string;
  department: string;
  designation: string;
  status: 'Active' | 'Inactive';
  photo_url: string;
  created_at: string;
}

export interface SubjectRecord {
  id: number;
  course_code: string;
  course_name: string;
  department: string;
  program: string;
  academic_year: string;
  semester: string;
  credit_hours: number;
  class_name: string;
  section: string;
}

export interface TimetableSession {
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
  academic_term: string;
  academic_year: string;
  is_active: number;
  template_name?: string;
  course_code?: string;
  course_name?: string;
  teacher_name?: string;
}

export interface TimetableConflict {
  type: 'teacher_conflict' | 'class_conflict' | 'room_conflict' | 'invalid_time' | 'duplicate_entry';
  severity: 'high' | 'medium';
  message: string;
  sessionAId: number;
  sessionBId?: number;
  day_of_week: string;
}

export interface DuplicateMatch {
  pairKey: string;
  studentA: {
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
  };
  studentB: {
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
  };
  score: number;
  reasons: string[];
}

export interface SmartAlert {
  id: number;
  alert_key: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  entity_type: string;
  entity_id: string;
  target_tab: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface RollbackBatch {
  id: number;
  operation_type: string;
  summary: string;
  affected_count: number;
  status: 'available' | 'rolled_back';
  initiated_by: string;
  created_at: string;
  rolled_back_at: string | null;
}
