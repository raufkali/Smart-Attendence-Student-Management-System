import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_PHOTOS_DIR = path.resolve(DATA_DIR, 'uploads', 'photos');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_PHOTOS_DIR, { recursive: true });

export { DATA_DIR, UPLOAD_PHOTOS_DIR };

const DB_PATH = path.resolve(DATA_DIR, 'institution.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export function runInTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      password_hash TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS institution_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      logo_url TEXT DEFAULT '',
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      academic_year TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      working_days_json TEXT NOT NULL,
      attendance_rules_json TEXT NOT NULL,
      fine_rules_json TEXT NOT NULL,
      fee_settings_json TEXT NOT NULL,
      setup_completed INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS academic_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level_type TEXT NOT NULL,
      parent_id INTEGER REFERENCES academic_levels(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      academic_year TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS academic_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      academic_year TEXT NOT NULL,
      campus TEXT NOT NULL DEFAULT 'Main Campus',
      department TEXT NOT NULL,
      program TEXT NOT NULL,
      class_name TEXT NOT NULL,
      semester TEXT NOT NULL,
      section TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 40,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(academic_year, program, class_name, semester, section)
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      holiday_date TEXT NOT NULL UNIQUE,
      holiday_type TEXT NOT NULL DEFAULT 'Institutional',
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      guardian_name TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      dob TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      guardian_phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      admission_date TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      department TEXT NOT NULL,
      program TEXT NOT NULL,
      class_name TEXT NOT NULL,
      semester TEXT NOT NULL,
      section TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      photo_url TEXT DEFAULT '',
      custom_fields_json TEXT DEFAULT '{}',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_students_cohort ON students(academic_year, class_name, semester, section);
    CREATE INDEX IF NOT EXISTS idx_students_name ON students(full_name);

    CREATE TABLE IF NOT EXISTS enrollment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      academic_year TEXT NOT NULL,
      department TEXT NOT NULL,
      program TEXT NOT NULL,
      class_name TEXT NOT NULL,
      semester TEXT NOT NULL,
      section TEXT NOT NULL,
      action_type TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      batch_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS duplicate_resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair_key TEXT NOT NULL UNIQUE,
      student_a_id INTEGER NOT NULL,
      student_b_id INTEGER NOT NULL,
      resolution_type TEXT NOT NULL,
      resolved_by TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      department TEXT NOT NULL,
      designation TEXT DEFAULT 'Lecturer',
      status TEXT NOT NULL DEFAULT 'Active',
      photo_url TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_code TEXT NOT NULL,
      course_name TEXT NOT NULL,
      department TEXT NOT NULL,
      program TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      semester TEXT NOT NULL,
      credit_hours INTEGER NOT NULL DEFAULT 3,
      class_name TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT 'All',
      UNIQUE(course_code, academic_year, class_name, semester, section)
    );

    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      class_name TEXT NOT NULL,
      section TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      semester TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timetable_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      class_name TEXT NOT NULL,
      semester TEXT NOT NULL,
      section TEXT NOT NULL,
      room TEXT NOT NULL DEFAULT 'Room 101',
      academic_term TEXT NOT NULL DEFAULT 'Fall',
      academic_year TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      template_name TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_tt_teacher_day ON timetable_sessions(teacher_id, day_of_week, academic_year);
    CREATE INDEX IF NOT EXISTS idx_tt_cohort_day ON timetable_sessions(class_name, semester, section, day_of_week);

    CREATE TABLE IF NOT EXISTS teacher_substitutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timetable_session_id INTEGER NOT NULL REFERENCES timetable_sessions(id) ON DELETE CASCADE,
      substitution_date TEXT NOT NULL,
      original_teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      substitute_teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(timetable_session_id, substitution_date)
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_uuid TEXT NOT NULL UNIQUE,
      timetable_session_id INTEGER REFERENCES timetable_sessions(id) ON DELETE SET NULL,
      session_date TEXT NOT NULL,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      class_name TEXT NOT NULL,
      section TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      submitted_at TEXT,
      locked_at TEXT,
      device_id TEXT DEFAULT 'desktop-admin',
      notes TEXT DEFAULT '',
      UNIQUE(timetable_session_id, session_date)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_uuid TEXT NOT NULL UNIQUE,
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      remarks TEXT DEFAULT '',
      marked_at TEXT NOT NULL,
      UNIQUE(session_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_att_student ON attendance_records(student_id);

    CREATE TABLE IF NOT EXISTS attendance_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      original_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fee_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      frequency TEXT NOT NULL,
      default_amount_cents INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS scholarships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      discount_type TEXT NOT NULL,
      value REAL NOT NULL,
      reason TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      expiry_date TEXT DEFAULT '',
      authorized_by TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      billing_period TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      late_fee_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      paid_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid',
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(student_id, billing_period)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT NOT NULL UNIQUE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      method TEXT NOT NULL,
      reference_no TEXT DEFAULT '',
      payment_date TEXT NOT NULL,
      received_by TEXT NOT NULL,
      is_reversal INTEGER NOT NULL DEFAULT 0,
      reversed_payment_id INTEGER,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      attendance_record_id INTEGER UNIQUE REFERENCES attendance_records(id) ON DELETE SET NULL,
      fine_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      paid_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid',
      reason TEXT NOT NULL,
      waived_by TEXT DEFAULT '',
      waive_reason TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paired_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      app_version TEXT DEFAULT '1.0.0',
      pairing_token_hash TEXT NOT NULL,
      last_sync_at TEXT,
      last_ip TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'paired',
      pending_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_uuid TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      teacher_id INTEGER NOT NULL,
      payload_count INTEGER NOT NULL DEFAULT 0,
      accepted_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_details TEXT DEFAULT '',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS smart_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_key TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      target_tab TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_by TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      prev_value_json TEXT DEFAULT '',
      new_value_json TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'desktop-admin',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rollback_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      affected_count INTEGER NOT NULL DEFAULT 0,
      before_state_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      initiated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      rolled_back_at TEXT
    );
  `);
}

function hashQuick(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function seedInitialData(): void {
  const existing = db.prepare('SELECT id FROM institution_settings WHERE id = 1').get();
  if (existing) return;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName = days[new Date().getDay()] || 'Monday';

  runInTransaction(() => {
    db.prepare(`
      INSERT INTO institution_settings (
        id, name, type, logo_url, address, phone, email, website, academic_year, currency, timezone,
        working_days_json, attendance_rules_json, fine_rules_json, fee_settings_json, setup_completed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      'Academia Modern — Institute of Applied Sciences',
      'University',
      '/src/assets/images/institution_crest_1795676738629.jpg',
      '420 University Avenue, North Campus',
      '+1 (555) 234-8900',
      'registrar@academiamodern.edu',
      'https://academiamodern.local',
      '2026-2027',
      'USD',
      'America/Los_Angeles',
      JSON.stringify(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']),
      JSON.stringify({
        lateThresholdMinutes: 10,
        gracePeriodMinutes: 5,
        submissionDeadlineHours: 4,
        lockAfterHours: 48,
        countExcusedAsPresent: true,
        lateCountsAsPresent: true,
        warningThresholds: [90, 80, 75],
        requireCorrectionReason: true,
      }),
      JSON.stringify({
        absenceFineCents: 500,
        lateFineCents: 200,
        consecutiveAbsenceThreshold: 3,
        consecutiveAbsenceFineCents: 1500,
        repeatedLateThreshold: 4,
        repeatedLateFineCents: 1000,
        maxMonthlyFineCents: 10000,
        autoGenerateFines: true,
      }),
      JSON.stringify({
        defaultDueDays: 15,
        lateFeeCents: 2500,
        requiredImportFields: ['Student ID', 'Full Name', 'Class', 'Section', 'Academic Year'],
      }),
      1
    );

    const levels = [
      ['Main Campus', 'Campus', 1],
      ['Faculty of Computing & Engineering', 'Department', 2],
      ['Faculty of Business & Economics', 'Department', 3],
      ['B.S. Computer Science', 'Program', 4],
      ['B.S. Data Analytics', 'Program', 5],
      ['Year 1 / Freshman', 'Class', 6],
      ['Year 2 / Sophomore', 'Class', 7],
      ['Fall Semester 2026', 'Semester', 8],
      ['Section A', 'Section', 9],
      ['Section B', 'Section', 10],
    ];
    for (const [name, levelType, order] of levels) {
      db.prepare(`
        INSERT INTO academic_levels (name, level_type, parent_id, sort_order, is_active, academic_year)
        VALUES (?, ?, NULL, ?, 1, '2026-2027')
      `).run(name, levelType, order);
    }

    const groups = [
      ['2026-2027', 'Main Campus', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'A', 45],
      ['2026-2027', 'Main Campus', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'B', 45],
      ['2026-2027', 'Main Campus', 'Computer Science', 'BSCS', 'BSCS-2', 'Sem 3', 'A', 40],
      ['2026-2027', 'Main Campus', 'Data Analytics', 'BSDA', 'BSDA-1', 'Sem 1', 'A', 40],
    ];
    for (const g of groups) {
      db.prepare(`
        INSERT INTO academic_groups (academic_year, campus, department, program, class_name, semester, section, capacity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...g);
    }

    db.prepare(`
      INSERT INTO holidays (title, holiday_date, holiday_type, description)
      VALUES ('Founders Convocation Day', '2026-12-04', 'Institutional', 'Annual academic convocation — no classes')
    `).run();

    // Teachers (demo initial PIN 'teacher123' hashed via scrypt)
    const tHash = hashQuick('teacher123');
    const teachers = [
      ['EMP-101', 'Dr. Meera Sharma', '+1-555-310-1001', 'm.sharma@academiamodern.edu', 'Faculty Wing 2B', 'Computer Science', 'Associate Professor', '/src/assets/images/teacher_portrait_1_1795676739673.jpg'],
      ['EMP-102', 'Prof. David Lindqvist', '+1-555-310-1002', 'd.lindqvist@academiamodern.edu', 'Faculty Wing 3A', 'Computer Science', 'Senior Lecturer', ''],
      ['EMP-103', 'Dr. Nadia Al-Mansoor', '+1-555-310-1003', 'n.almansoor@academiamodern.edu', 'Science Block 1C', 'Data Analytics', 'Assistant Professor', ''],
    ];
    for (const t of teachers) {
      db.prepare(`
        INSERT INTO teachers (employee_id, full_name, phone, email, address, department, designation, status, photo_url, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
      `).run(...t, tHash, now);
    }

    // Subjects
    const subjects = [
      ['CS-101', 'Algorithms & Data Structures', 'Computer Science', 'BSCS', '2026-2027', 'Sem 1', 4, 'BSCS-1', 'A'],
      ['CS-102', 'Discrete Mathematics', 'Computer Science', 'BSCS', '2026-2027', 'Sem 1', 3, 'BSCS-1', 'A'],
      ['CS-103', 'Computer Systems Architecture', 'Computer Science', 'BSCS', '2026-2027', 'Sem 1', 3, 'BSCS-1', 'B'],
      ['CS-201', 'Database Systems & SQL', 'Computer Science', 'BSCS', '2026-2027', 'Sem 3', 4, 'BSCS-2', 'A'],
      ['DA-101', 'Statistical Modeling', 'Data Analytics', 'BSDA', '2026-2027', 'Sem 1', 3, 'BSDA-1', 'A'],
    ];
    for (const s of subjects) {
      db.prepare(`
        INSERT INTO subjects (course_code, course_name, department, program, academic_year, semester, credit_hours, class_name, section)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...s);
    }

    // Teacher assignments
    const assignments = [
      [1, 1, 'BSCS-1', 'A', '2026-2027', 'Sem 1'],
      [2, 2, 'BSCS-1', 'A', '2026-2027', 'Sem 1'],
      [1, 3, 'BSCS-1', 'B', '2026-2027', 'Sem 1'],
      [2, 4, 'BSCS-2', 'A', '2026-2027', 'Sem 3'],
      [3, 5, 'BSDA-1', 'A', '2026-2027', 'Sem 1'],
    ];
    for (const a of assignments) {
      db.prepare(`
        INSERT INTO teacher_assignments (teacher_id, subject_id, class_name, section, academic_year, semester, is_active, assigned_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `).run(...a, now);
    }

    // Timetable sessions (include today's weekday so dashboard & Android teacher dashboard always have today's classes!)
    const activeDay = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(todayName)
      ? todayName
      : 'Monday';
    const extraDays = ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].filter((d) => d !== activeDay);
    const ttSessions = [
      [activeDay, '08:30', '09:45', 1, 1, 'BSCS-1', 'Sem 1', 'A', 'LH-104', 'Fall', '2026-2027'],
      [activeDay, '10:00', '11:15', 2, 2, 'BSCS-1', 'Sem 1', 'A', 'LH-104', 'Fall', '2026-2027'],
      [activeDay, '11:30', '12:45', 3, 1, 'BSCS-1', 'Sem 1', 'B', 'LH-202', 'Fall', '2026-2027'],
      [activeDay, '14:00', '15:15', 4, 2, 'BSCS-2', 'Sem 3', 'A', 'Lab-301', 'Fall', '2026-2027'],
      [activeDay, '15:30', '16:45', 5, 3, 'BSDA-1', 'Sem 1', 'A', 'LH-108', 'Fall', '2026-2027'],
      ...(extraDays[0] ? [[extraDays[0], '09:00', '10:30', 1, 1, 'BSCS-1', 'Sem 1', 'A', 'LH-104', 'Fall', '2026-2027']] : []),
      ...(extraDays[1] ? [[extraDays[1], '10:00', '11:30', 2, 2, 'BSCS-1', 'Sem 1', 'A', 'LH-104', 'Fall', '2026-2027']] : []),
      ...(extraDays[2] ? [[extraDays[2], '13:00', '14:30', 4, 2, 'BSCS-2', 'Sem 3', 'A', 'Lab-301', 'Fall', '2026-2027']] : []),
      ...(extraDays[3] ? [[extraDays[3], '09:00', '10:30', 5, 3, 'BSDA-1', 'Sem 1', 'A', 'LH-108', 'Fall', '2026-2027']] : []),
    ];
    for (const ts of ttSessions) {
      db.prepare(`
        INSERT INTO timetable_sessions (
          day_of_week, start_time, end_time, subject_id, teacher_id, class_name, semester, section, room, academic_term, academic_year
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...ts);
    }

    // Students (including 1 intentional near-duplicate pair so Duplicate Detection Center shines immediately!)
    const students = [
      ['STU-2026-001', 'Amina Farooq', 'Farooq Ahmed', 'Female', '2006-03-14', '+1-555-401-1001', '+1-555-401-9001', 'amina.f@academiamodern.edu', '14 Oakridge Lane', '2026-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'A', 'Active'],
      ['STU-2026-002', 'Liam O\'Connor', 'Patrick O\'Connor', 'Male', '2005-11-22', '+1-555-401-1002', '+1-555-401-9002', 'liam.oc@academiamodern.edu', '88 Maplewood Ave', '2026-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'A', 'Active'],
      ['STU-2026-003', 'Priya Nair', 'Suresh Nair', 'Female', '2006-01-09', '+1-555-401-1003', '+1-555-401-9003', 'priya.n@academiamodern.edu', '302 Cedar Heights', '2026-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'A', 'Active'],
      ['STU-2026-004', 'Marcus Vance', 'Evelyn Vance', 'Male', '2005-07-19', '+1-555-401-1004', '+1-555-401-9004', 'marcus.v@academiamodern.edu', '19 Birch St', '2026-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'A', 'Active'],
      ['STU-2026-005', 'Sofia Alvarez', 'Carlos Alvarez', 'Female', '2006-05-30', '+1-555-401-1005', '', 'sofia.a@academiamodern.edu', '72 Riverview Blvd', '2026-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'A', 'Active'],
      ['STU-2026-006', 'Zainab Mansoor', 'Tariq Mansoor', 'Female', '2005-09-11', '+1-555-401-1006', '+1-555-401-9006', 'zainab.m@academiamodern.edu', '511 Elmwood Ct', '2026-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'B', 'Active'],
      ['STU-2026-007', 'Noah Takahashi', 'Kenji Takahashi', 'Male', '2005-12-03', '+1-555-401-1007', '+1-555-401-9007', 'noah.t@academiamodern.edu', '210 Pinecrest Rd', '2026-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'B', 'Active'],
      ['STU-2026-008', 'Hannah Brooks', 'Rachel Brooks', 'Female', '2004-08-25', '+1-555-401-1008', '+1-555-401-9008', 'hannah.b@academiamodern.edu', '45 Harbor Way', '2025-09-01', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-2', 'Sem 3', 'A', 'Active'],
      ['STU-2026-009', 'Daniel Kim', 'Sung-Ho Kim', 'Male', '2006-02-17', '+1-555-401-1009', '+1-555-401-9009', 'daniel.k@academiamodern.edu', '94 Summit Dr', '2026-09-01', '2026-2027', 'Data Analytics', 'BSDA', 'BSDA-1', 'Sem 1', 'A', 'Active'],
      ['STU-2026-010', 'Amina Farooque', 'Farooq Ahmad', 'Female', '2006-03-14', '+1-555-401-1099', '+1-555-401-9001', 'amina.farooque@academiamodern.edu', '14 Oakridge Ln', '2026-09-03', '2026-2027', 'Computer Science', 'BSCS', 'BSCS-1', 'Sem 1', 'A', 'Active'],
    ];
    for (const st of students) {
      const info = db.prepare(`
        INSERT INTO students (
          student_code, full_name, guardian_name, gender, dob, phone, guardian_phone, email, address,
          admission_date, academic_year, department, program, class_name, semester, section, status,
          photo_url, custom_fields_json, is_archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}', 0, ?, ?)
      `).run(...st, now, now);

      db.prepare(`
        INSERT INTO enrollment_history (
          student_id, academic_year, department, program, class_name, semester, section, action_type, effective_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Admitted', ?, 'Initial institutional enrollment')
      `).run(info.lastInsertRowid, st[10], st[11], st[12], st[13], st[14], st[15], st[9]);
    }

    // Fee categories
    const feeCats = [
      ['Admission Fee', 'One-time', 50000],
      ['Tuition Fee', 'Semester', 180000],
      ['Laboratory Fee', 'Semester', 25000],
      ['Examination Fee', 'Semester', 15000],
      ['Library Fee', 'Annual', 10000],
    ];
    for (const fc of feeCats) {
      db.prepare('INSERT INTO fee_categories (name, frequency, default_amount_cents) VALUES (?, ?, ?)').run(...fc);
    }

    // Scholarships
    db.prepare(`
      INSERT INTO scholarships (student_id, category, discount_type, value, reason, effective_date, expiry_date, authorized_by, is_active)
      VALUES (1, 'Merit Scholarship', 'percentage', 25, 'Top 5% Entrance Merit Distinction', '2026-09-01', '2027-08-31', 'Registrar Office', 1)
    `).run();

    // Invoices & Payments
    const invoiceSeeds = [
      ['INV-2026-1001', 1, 'Fall 2026', '2026-09-05', '2026-09-20', 205000, 51250, 0, 153750, 153750, 'paid'],
      ['INV-2026-1002', 2, 'Fall 2026', '2026-09-05', '2026-09-20', 205000, 0, 0, 205000, 100000, 'partial'],
      ['INV-2026-1003', 3, 'Fall 2026', '2026-09-05', '2026-09-20', 205000, 0, 0, 205000, 205000, 'paid'],
      ['INV-2026-1004', 4, 'Fall 2026', '2026-09-05', '2026-10-15', 205000, 0, 2500, 207500, 0, 'overdue'],
      ['INV-2026-1005', 5, 'Fall 2026', '2026-09-05', '2026-10-15', 205000, 0, 2500, 207500, 50000, 'overdue'],
      ['INV-2026-1006', 6, 'Fall 2026', '2026-09-05', '2026-12-05', 205000, 0, 0, 205000, 205000, 'paid'],
      ['INV-2026-1007', 7, 'Fall 2026', '2026-09-05', '2026-12-05', 205000, 0, 0, 205000, 0, 'unpaid'],
    ];
    for (const inv of invoiceSeeds) {
      db.prepare(`
        INSERT INTO invoices (
          invoice_number, student_id, billing_period, issue_date, due_date,
          subtotal_cents, discount_cents, late_fee_cents, total_cents, paid_cents, status, items_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ...inv,
        JSON.stringify([
          { category: 'Tuition Fee', amount_cents: 180000 },
          { category: 'Laboratory Fee', amount_cents: 25000 },
        ]),
        now
      );
    }

    const paymentSeeds = [
      ['RCP-2026-0001', 1, 1, 153750, 'Bank Transfer', 'TXN-88412', '2026-09-12', 'Registrar Desk'],
      ['RCP-2026-0002', 2, 2, 100000, 'Cash', 'CASH-019', '2026-09-14', 'Registrar Desk'],
      ['RCP-2026-0003', 3, 3, 205000, 'Bank Transfer', 'TXN-88504', '2026-09-16', 'Registrar Desk'],
      ['RCP-2026-0004', 5, 5, 50000, 'Cheque', 'CHQ-4410', '2026-09-25', 'Registrar Desk'],
      ['RCP-2026-0005', 6, 6, 205000, 'Bank Transfer', 'TXN-89011', '2026-09-28', 'Registrar Desk'],
    ];
    for (const p of paymentSeeds) {
      db.prepare(`
        INSERT INTO payments (receipt_number, invoice_id, student_id, amount_cents, method, reference_no, payment_date, received_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...p, now);
    }

    // Past Attendance Sessions & Records (create realistic attendance percentages & defaulter data)
    const pastDates = [
      '2026-11-10',
      '2026-11-12',
      '2026-11-14',
      '2026-11-17',
      '2026-11-19',
      '2026-11-21',
    ];
    for (let dIdx = 0; dIdx < pastDates.length; dIdx++) {
      const sDate = pastDates[dIdx];
      const sessUuid = crypto.randomUUID();
      const sInfo = db.prepare(`
        INSERT INTO attendance_sessions (
          client_uuid, timetable_session_id, session_date, teacher_id, subject_id, class_name, section, status, submitted_at, device_id, notes
        ) VALUES (?, 1, ?, 1, 1, 'BSCS-1', 'A', 'submitted', ?, 'android-pixel7-01', 'Synced via campus LAN')
      `).run(sessUuid, sDate, `${sDate}T09:50:00Z`);

      const sessId = Number(sInfo.lastInsertRowid);
      const bscs1a = [1, 2, 3, 4, 5, 10];
      for (const stuId of bscs1a) {
        let st = 'present';
        if (stuId === 4 && dIdx >= 2) st = 'absent'; // Marcus Vance has consecutive absences (defaulter + auto fine!)
        else if (stuId === 2 && dIdx % 2 === 1) st = 'late';
        else if (stuId === 5 && dIdx === 4) st = 'excused';

        const recInfo = db.prepare(`
          INSERT INTO attendance_records (client_uuid, session_id, student_id, status, remarks, marked_at)
          VALUES (?, ?, ?, ?, '', ?)
        `).run(crypto.randomUUID(), sessId, stuId, st, `${sDate}T09:45:00Z`);

        if (st === 'absent' && stuId === 4) {
          db.prepare(`
            INSERT INTO fines (student_id, attendance_record_id, fine_type, amount_cents, paid_cents, status, reason, created_at)
            VALUES (?, ?, 'Absence', 500, 0, 'unpaid', ?, ?)
          `).run(stuId, recInfo.lastInsertRowid, `Unexcused absence in CS-101 on ${sDate}`, now);
        }
      }
    }

    // Also add one pending session for today's date
    db.prepare(`
      INSERT INTO attendance_sessions (
        client_uuid, timetable_session_id, session_date, teacher_id, subject_id, class_name, section, status, device_id, notes
      ) VALUES (?, 2, ?, 2, 2, 'BSCS-1', 'A', 'pending_submission', 'pending-teacher-device', 'Awaiting teacher submission')
    `).run(crypto.randomUUID(), today);

    // Paired Android Device & Sync Logs
    const pairingHash = crypto.createHash('sha256').update('demo-device-token-1').digest('hex');
    db.prepare(`
      INSERT INTO paired_devices (device_id, teacher_id, device_name, app_version, pairing_token_hash, last_sync_at, last_ip, status, pending_count, created_at)
      VALUES ('android-pixel7-01', 1, 'Pixel 7 — Dr. Meera Sharma', '1.4.0', ?, ?, '192.168.1.42', 'online', 0, ?)
    `).run(pairingHash, now, now);

    db.prepare(`
      INSERT INTO paired_devices (device_id, teacher_id, device_name, app_version, pairing_token_hash, last_sync_at, last_ip, status, pending_count, created_at)
      VALUES ('android-galaxy-02', 2, 'Galaxy S23 — Prof. David Lindqvist', '1.4.0', ?, ?, '192.168.1.58', 'offline', 2, ?)
    `).run(pairingHash, '2026-11-24T16:20:00Z', now);

    db.prepare(`
      INSERT INTO sync_logs (sync_uuid, device_id, teacher_id, payload_count, accepted_count, duplicate_count, conflict_count, status, error_details, synced_at)
      VALUES (?, 'android-pixel7-01', 1, 6, 6, 0, 0, 'success', '', ?)
    `).run(crypto.randomUUID(), now);

    // Audit seed
    db.prepare(`
      INSERT INTO audit_logs (actor, actor_role, action, entity_type, entity_id, prev_value_json, new_value_json, reason, source, created_at)
      VALUES ('System Bootstrap', 'system', 'INITIALIZE_INSTITUTION', 'institution', '1', '', ?, 'Initial institution provisioning', 'desktop-admin', ?)
    `).run(JSON.stringify({ name: 'Academia Modern' }), now);
  });
}

initSchema();
seedInitialData();
