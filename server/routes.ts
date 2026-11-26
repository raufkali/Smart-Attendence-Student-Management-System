import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import {
  allocatePayment,
  calculateAttendanceStats,
  calculateDiscountCents,
  calculateInvoiceTotals,
  detectTimetableConflicts,
  findPotentialDuplicates,
  maxConsecutiveAbsences,
  toCents,
  validateStudentImportRow,
} from '../src/shared/rules';
import {
  type AuthedRequest,
  hashPassword,
  isAdminClaimed,
  requireAdmin,
  requireTeacherOrAdmin,
  signToken,
  verifyPassword,
  writeAuditLog,
} from './auth';
import { db, runInTransaction, UPLOAD_PHOTOS_DIR } from './db';

type SQLVal = string | number | null;
type DbRow = Record<string, SQLVal>;

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 100 },
});

function getInstitutionSettingsRow() {
  const row = db.prepare('SELECT * FROM institution_settings WHERE id = 1').get() as DbRow;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    logo_url: row.logo_url,
    address: row.address,
    phone: row.phone,
    email: row.email,
    website: row.website,
    academic_year: row.academic_year,
    currency: row.currency,
    timezone: row.timezone,
    working_days: JSON.parse(String(row.working_days_json || '[]')),
    attendance_rules: JSON.parse(String(row.attendance_rules_json || '{}')),
    fine_rules: JSON.parse(String(row.fine_rules_json || '{}')),
    fee_settings: JSON.parse(String(row.fee_settings_json || '{}')),
    setup_completed: Boolean(row.setup_completed),
  };
}

function refreshSmartAlerts(): void {
  const now = new Date().toISOString();
  const inst = getInstitutionSettingsRow();
  const thresholds: number[] = inst.attendance_rules?.warningThresholds || [80, 75];
  const minThreshold = Math.min(...thresholds);

  const students = db.prepare("SELECT * FROM students WHERE is_archived = 0 AND status = 'Active'").all() as Array<DbRow>;
  const attRecords = db.prepare(`
    SELECT ar.student_id, ar.status, ases.status AS session_status, ases.session_date
    FROM attendance_records ar
    JOIN attendance_sessions ases ON ases.id = ar.session_id
  `).all() as Array<{ student_id: number; status: string; session_status: string; session_date: string }>;

  const recsByStudent = new Map<number, typeof attRecords>();
  for (const r of attRecords) {
    const list = recsByStudent.get(r.student_id) || [];
    list.push(r);
    recsByStudent.set(r.student_id, list);
  }

  const upsertAlert = db.prepare(`
    INSERT INTO smart_alerts (alert_key, category, severity, title, description, entity_type, entity_id, target_tab, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
    ON CONFLICT(alert_key) DO UPDATE SET
      severity = excluded.severity,
      title = excluded.title,
      description = excluded.description
  `);

  for (const st of students) {
    const id = Number(st.id);
    if (!st.guardian_phone) {
      upsertAlert.run(
        `missing_guardian_phone_${id}`,
        'Incomplete Profile',
        'medium',
        `Missing guardian phone: ${st.full_name}`,
        `Student ${st.student_code} (${st.class_name} ${st.section}) has no guardian phone on file.`,
        'student',
        String(id),
        'students',
        now
      );
    }
    const recs = recsByStudent.get(id) || [];
    if (recs.length >= 3) {
      const stats = calculateAttendanceStats(recs, inst.attendance_rules);
      const streak = maxConsecutiveAbsences(recs);
      if (stats.percentage < minThreshold || streak >= 3) {
        upsertAlert.run(
          `attendance_risk_${id}`,
          'Attendance Alert',
          'high',
          `Attendance below ${minThreshold}%: ${st.full_name}`,
          `${st.student_code} is at ${stats.percentage}% attendance (${streak} consecutive absences).`,
          'student',
          String(id),
          'defaulters',
          now
        );
      }
    }
  }

  const overdueInvoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.total_cents, i.paid_cents, s.full_name, s.student_code
    FROM invoices i JOIN students s ON s.id = i.student_id
    WHERE i.status = 'overdue' AND i.total_cents > i.paid_cents
  `).all() as Array<DbRow>;

  for (const inv of overdueInvoices) {
    const bal = ((Number(inv.total_cents) - Number(inv.paid_cents)) / 100).toFixed(2);
    upsertAlert.run(
      `overdue_inv_${inv.id}`,
      'Overdue Invoice',
      'high',
      `Overdue invoice ${inv.invoice_number} (${inv.full_name})`,
      `Outstanding balance ${inst.currency} ${bal} for ${inv.student_code}.`,
      'invoice',
      String(inv.id),
      'finance',
      now
    );
  }

  const pendingSessions = db.prepare(`
    SELECT ases.id, ases.session_date, ases.class_name, ases.section, sub.course_code, t.full_name AS teacher_name
    FROM attendance_sessions ases
    JOIN subjects sub ON sub.id = ases.subject_id
    JOIN teachers t ON t.id = ases.teacher_id
    WHERE ases.status = 'pending_submission'
  `).all() as Array<DbRow>;

  for (const ps of pendingSessions) {
    upsertAlert.run(
      `pending_att_${ps.id}`,
      'Pending Attendance',
      'medium',
      `Pending attendance: ${ps.course_code} (${ps.class_name} ${ps.section})`,
      `${ps.teacher_name} has not yet submitted attendance for ${ps.session_date}.`,
      'attendance_session',
      String(ps.id),
      'attendance',
      now
    );
  }

  const offlineDevices = db.prepare(`
    SELECT pd.*, t.full_name FROM paired_devices pd
    JOIN teachers t ON t.id = pd.teacher_id
    WHERE pd.pending_count > 0
  `).all() as Array<DbRow>;

  for (const dev of offlineDevices) {
    upsertAlert.run(
      `unsynced_device_${dev.device_id}`,
      'Device Sync',
      'medium',
      `Unsynchronized attendance on ${dev.device_name}`,
      `${dev.pending_count} pending record(s) awaiting local network sync from ${dev.full_name}.`,
      'device',
      String(dev.device_id),
      'sync',
      now
    );
  }

  const duplicates = findPotentialDuplicates(students as never[]);
  if (duplicates.length > 0) {
    upsertAlert.run(
      'duplicates_detected',
      'Duplicate Records',
      'medium',
      `${duplicates.length} suspected duplicate student pair(s)`,
      'Review side-by-side records in the Duplicate Detection Center.',
      'duplicate',
      '0',
      'duplicates',
      now
    );
  }
}

refreshSmartAlerts();

export function createApiRouter(): express.Router {
  const router = express.Router();

  // --------------------------------------------------------------------------
  // Health & Local Network Info
  // --------------------------------------------------------------------------
  router.get('/health', (_req, res) => {
    res.json({ ok: true, database: 'sqlite-wal', timestamp: new Date().toISOString() });
  });

  router.get('/system/network-info', requireAdmin, (_req, res) => {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    for (const entries of Object.values(interfaces)) {
      if (!entries) continue;
      for (const entry of entries) {
        if (entry.family === 'IPv4' && !entry.internal) {
          addresses.push(entry.address);
        }
      }
    }
    const port =
      process.env.NODE_ENV === 'production'
        ? Number(process.env.PORT || 3000)
        : Number(process.env.SCHOLARGRID_PORT || 3000);
    res.json({
      port,
      lanUrls: addresses.map((ip) => `http://${ip}:${port}`),
      localUrl: `http://127.0.0.1:${port}`,
      hostname: os.hostname(),
    });
  });

  // --------------------------------------------------------------------------
  // Authentication (First-run Admin Claim, Admin Login, Teacher Mobile Login)
  // --------------------------------------------------------------------------
  router.get('/auth/status', (_req, res) => {
    const claimed = isAdminClaimed();
    const inst = getInstitutionSettingsRow();
    res.json({
      adminClaimed: claimed,
      envOverrideActive: Boolean(process.env.ADMIN_PASSCODE?.trim()),
      institutionName: inst.name,
      institutionLogo: inst.logo_url,
    });
  });

  router.post('/auth/claim', (req, res) => {
    if (isAdminClaimed()) {
      res.status(409).json({ error: 'Administrator credentials are already configured.' });
      return;
    }
    const { fullName, username, password } = req.body as {
      fullName?: string;
      username?: string;
      password?: string;
    };
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    const cleanUser = (username || 'admin').trim().toLowerCase();
    const cleanName = (fullName || 'Institutional Registrar').trim();
    const now = new Date().toISOString();

    const admin = runInTransaction(() => {
      const existing = db.prepare("SELECT id FROM admin_users WHERE role = 'admin' LIMIT 1").get();
      if (existing) return null;
      const info = db.prepare(`
        INSERT INTO admin_users (username, full_name, role, password_hash, avatar_url, created_at)
        VALUES (?, ?, 'admin', ?, '/src/assets/images/admin_portrait_1795676738697.jpg', ?)
      `).run(cleanUser, cleanName, hashPassword(password), now);
      writeAuditLog({
        actor: cleanName,
        actorRole: 'admin',
        action: 'ADMIN_CLAIM',
        entityType: 'admin_user',
        entityId: String(info.lastInsertRowid),
        reason: 'Initial administrator account setup',
      });
      return { id: Number(info.lastInsertRowid), username: cleanUser, fullName: cleanName };
    });

    if (!admin) {
      res.status(409).json({ error: 'Administrator account already claimed.' });
      return;
    }

    const token = signToken({ sub: admin.username, role: 'admin', name: admin.fullName });
    res.json({
      token,
      user: {
        username: admin.username,
        fullName: admin.fullName,
        role: 'admin',
        avatarUrl: '/src/assets/images/admin_portrait_1795676738697.jpg',
      },
    });
  });

  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!password) {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }

    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (envPasscode) {
      const a = Buffer.from(password);
      const b = Buffer.from(envPasscode);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        const token = signToken({ sub: username || 'admin', role: 'admin', name: 'System Administrator' });
        res.json({
          token,
          user: {
            username: username || 'admin',
            fullName: 'System Administrator',
            role: 'admin',
            avatarUrl: '/src/assets/images/admin_portrait_1795676738697.jpg',
          },
        });
        return;
      }
    }

    const cleanUser = (username || 'admin').trim().toLowerCase();
    const row = db
      .prepare('SELECT * FROM admin_users WHERE lower(username) = ? LIMIT 1')
      .get(cleanUser) as DbRow | undefined;

    if (!row || !verifyPassword(password, String(row.password_hash))) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = signToken({
      sub: String(row.username),
      role: 'admin',
      name: String(row.full_name),
    });

    res.json({
      token,
      user: {
        username: row.username,
        fullName: row.full_name,
        role: 'admin',
        avatarUrl: row.avatar_url || '/src/assets/images/admin_portrait_1795676738697.jpg',
      },
    });
  });

  // --------------------------------------------------------------------------
  // Institution Setup, Dynamic Academic Levels & Holidays
  // --------------------------------------------------------------------------
  router.get('/institution', requireAdmin, (_req, res) => {
    const inst = getInstitutionSettingsRow();
    const levels = db.prepare('SELECT * FROM academic_levels ORDER BY sort_order ASC, id ASC').all();
    const groups = db.prepare('SELECT * FROM academic_groups ORDER BY academic_year DESC, class_name, semester, section').all();
    const holidays = db.prepare('SELECT * FROM holidays ORDER BY holiday_date ASC').all();
    res.json({ institution: inst, levels, groups, holidays });
  });

  router.put('/institution', requireAdmin, (req: AuthedRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const prev = getInstitutionSettingsRow();
    db.prepare(`
      UPDATE institution_settings SET
        name = ?, type = ?, address = ?, phone = ?, email = ?, website = ?,
        academic_year = ?, currency = ?, timezone = ?,
        working_days_json = ?, attendance_rules_json = ?, fine_rules_json = ?, fee_settings_json = ?,
        setup_completed = 1
      WHERE id = 1
    `).run(
      String(body.name || prev.name),
      String(body.type || prev.type),
      String(body.address ?? prev.address),
      String(body.phone ?? prev.phone),
      String(body.email ?? prev.email),
      String(body.website ?? prev.website),
      String(body.academic_year || prev.academic_year),
      String(body.currency || prev.currency),
      String(body.timezone || prev.timezone),
      JSON.stringify(body.working_days || prev.working_days),
      JSON.stringify(body.attendance_rules || prev.attendance_rules),
      JSON.stringify(body.fine_rules || prev.fine_rules),
      JSON.stringify(body.fee_settings || prev.fee_settings)
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'UPDATE_INSTITUTION_SETTINGS',
      entityType: 'institution',
      entityId: '1',
      prevValue: prev,
      newValue: body,
    });
    res.json({ institution: getInstitutionSettingsRow() });
  });

  router.post('/academic-levels', requireAdmin, (req: AuthedRequest, res) => {
    const { name, level_type, academic_year } = req.body as {
      name?: string;
      level_type?: string;
      academic_year?: string;
    };
    if (!name?.trim() || !level_type?.trim()) {
      res.status(400).json({ error: 'Level name and level type are required.' });
      return;
    }
    const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM academic_levels').get() as { m: number }).m;
    const info = db.prepare(`
      INSERT INTO academic_levels (name, level_type, sort_order, is_active, academic_year)
      VALUES (?, ?, ?, 1, ?)
    `).run(name.trim(), level_type.trim(), maxOrder + 1, academic_year || '2026-2027');
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CREATE_ACADEMIC_LEVEL',
      entityType: 'academic_level',
      entityId: String(info.lastInsertRowid),
      newValue: { name, level_type },
    });
    res.json({ id: info.lastInsertRowid });
  });

  router.patch('/academic-levels/:id', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { name, is_active, sort_order } = req.body as { name?: string; is_active?: number; sort_order?: number };
    const prev = db.prepare('SELECT * FROM academic_levels WHERE id = ?').get(id) as DbRow | undefined;
    if (!prev) {
      res.status(404).json({ error: 'Academic level not found.' });
      return;
    }
    db.prepare(`
      UPDATE academic_levels SET name = ?, is_active = ?, sort_order = ? WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : prev.name,
      is_active !== undefined ? (is_active ? 1 : 0) : prev.is_active,
      sort_order !== undefined ? Number(sort_order) : prev.sort_order,
      id
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'UPDATE_ACADEMIC_LEVEL',
      entityType: 'academic_level',
      entityId: String(id),
      prevValue: prev,
      newValue: req.body,
    });
    res.json({ ok: true });
  });

  router.post('/academic-groups', requireAdmin, (req: AuthedRequest, res) => {
    const { academic_year, campus, department, program, class_name, semester, section, capacity } = req.body as Record<string, string | number>;
    if (!department || !program || !class_name || !semester || !section) {
      res.status(400).json({ error: 'Department, program, class, semester, and section are required.' });
      return;
    }
    const info = db.prepare(`
      INSERT INTO academic_groups (academic_year, campus, department, program, class_name, semester, section, capacity, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      String(academic_year || '2026-2027'),
      String(campus || 'Main Campus'),
      String(department),
      String(program),
      String(class_name),
      String(semester),
      String(section),
      Number(capacity || 40)
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CREATE_ACADEMIC_GROUP',
      entityType: 'academic_group',
      entityId: String(info.lastInsertRowid),
      newValue: req.body,
    });
    res.json({ id: info.lastInsertRowid });
  });

  router.post('/holidays', requireAdmin, (req: AuthedRequest, res) => {
    const { title, holiday_date, holiday_type, description } = req.body as Record<string, string>;
    if (!title || !holiday_date) {
      res.status(400).json({ error: 'Holiday title and date are required.' });
      return;
    }
    const info = db.prepare(`
      INSERT INTO holidays (title, holiday_date, holiday_type, description)
      VALUES (?, ?, ?, ?)
    `).run(title.trim(), holiday_date.trim(), holiday_type || 'Institutional', description || '');
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CREATE_HOLIDAY',
      entityType: 'holiday',
      entityId: String(info.lastInsertRowid),
      newValue: req.body,
    });
    res.json({ id: info.lastInsertRowid });
  });

  router.delete('/holidays/:id', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'DELETE_HOLIDAY',
      entityType: 'holiday',
      entityId: String(id),
    });
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Dashboard Summary
  // --------------------------------------------------------------------------
  router.get('/dashboard', requireAdmin, (_req, res) => {
    refreshSmartAlerts();
    const inst = getInstitutionSettingsRow();
    const totalStudents = (db.prepare("SELECT COUNT(*) AS c FROM students WHERE is_archived = 0 AND status = 'Active'").get() as { c: number }).c;
    const totalTeachers = (db.prepare("SELECT COUNT(*) AS c FROM teachers WHERE status = 'Active'").get() as { c: number }).c;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = days[new Date().getDay()] || 'Monday';
    const todayStr = new Date().toISOString().slice(0, 10);

    const todaySchedule = db.prepare(`
      SELECT ts.*, sub.course_code, sub.course_name, t.full_name AS teacher_name,
        ases.id AS attendance_session_id, ases.status AS attendance_status
      FROM timetable_sessions ts
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teachers t ON t.id = ts.teacher_id
      LEFT JOIN attendance_sessions ases ON ases.timetable_session_id = ts.id AND ases.session_date = ?
      WHERE ts.day_of_week = ? AND ts.is_active = 1
      ORDER BY ts.start_time ASC
    `).all(todayStr, todayName);

    const financeTotals = db.prepare(`
      SELECT
        COALESCE(SUM(total_cents), 0) AS billed,
        COALESCE(SUM(paid_cents), 0) AS collected,
        COALESCE(SUM(discount_cents), 0) AS discounted,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN total_cents - paid_cents ELSE 0 END), 0) AS overdue
      FROM invoices
    `).get() as Record<string, number>;

    const alerts = db.prepare("SELECT * FROM smart_alerts WHERE status = 'open' ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC").all();
    const devices = db.prepare(`
      SELECT pd.*, t.full_name AS teacher_name FROM paired_devices pd
      JOIN teachers t ON t.id = pd.teacher_id
      ORDER BY pd.last_sync_at DESC
    `).all();
    const conflicts = detectTimetableConflicts(
      db.prepare(`
        SELECT ts.*, t.full_name AS teacher_name, sub.course_name
        FROM timetable_sessions ts
        JOIN teachers t ON t.id = ts.teacher_id
        JOIN subjects sub ON sub.id = ts.subject_id
        WHERE ts.is_active = 1
      `).all() as never[]
    );

    res.json({
      institution: inst,
      kpis: {
        totalStudents,
        totalTeachers,
        todaySessionsCount: todaySchedule.length,
        billedCents: financeTotals.billed,
        collectedCents: financeTotals.collected,
        outstandingCents: Math.max(0, financeTotals.billed - financeTotals.collected),
        overdueCents: financeTotals.overdue,
        openAlertsCount: alerts.length,
        timetableConflictsCount: conflicts.length,
      },
      todaySchedule,
      alerts,
      devices,
    });
  });

  // --------------------------------------------------------------------------
  // Students, Guided Admission Wizard, Analytics & QR ID Card
  // --------------------------------------------------------------------------
  router.get('/students', requireAdmin, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const className = String(req.query.class_name || '').trim();
    const section = String(req.query.section || '').trim();
    const status = String(req.query.status || '').trim();
    const includeArchived = req.query.archived === '1';

    let sql = 'SELECT * FROM students WHERE 1=1';
    const params: (string | number)[] = [];
    if (!includeArchived) {
      sql += ' AND is_archived = 0';
    }
    if (className) {
      sql += ' AND class_name = ?';
      params.push(className);
    }
    if (section) {
      sql += ' AND section = ?';
      params.push(section);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (lower(full_name) LIKE ? OR lower(student_code) LIKE ? OR lower(guardian_name) LIKE ? OR lower(email) LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY id DESC';
    const rows = db.prepare(sql).all(...params);
    res.json({ students: rows });
  });

  router.post('/students/admit', requireAdmin, (req: AuthedRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const fullName = String(body.full_name || '').trim();
    const className = String(body.class_name || '').trim();
    const section = String(body.section || '').trim();
    const academicYear = String(body.academic_year || '2026-2027').trim();
    const program = String(body.program || className.split('-')[0] || 'General').trim();
    const department = String(body.department || 'General Studies').trim();
    const semester = String(body.semester || 'Sem 1').trim();

    if (!fullName || !className || !section) {
      res.status(400).json({ error: 'Full Name, Class, and Section are required to complete admission.' });
      return;
    }

    const now = new Date().toISOString();
    const admissionDate = String(body.admission_date || now.slice(0, 10));
    const suppliedCode = String(body.student_code || '').trim();

    try {
      const result = runInTransaction(() => {
        const count = (db.prepare('SELECT COUNT(*) AS c FROM students').get() as { c: number }).c;
        const studentCode = suppliedCode || `STU-${academicYear.slice(0, 4)}-${String(count + 1).padStart(3, '0')}`;

        const sInfo = db.prepare(`
          INSERT INTO students (
            student_code, full_name, guardian_name, gender, dob, phone, guardian_phone, email, address,
            admission_date, academic_year, department, program, class_name, semester, section, status,
            photo_url, custom_fields_json, is_archived, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, 0, ?, ?)
        `).run(
          studentCode,
          fullName,
          String(body.guardian_name || ''),
          String(body.gender || ''),
          String(body.dob || ''),
          String(body.phone || ''),
          String(body.guardian_phone || ''),
          String(body.email || ''),
          String(body.address || ''),
          admissionDate,
          academicYear,
          department,
          program,
          className,
          semester,
          section,
          String(body.photo_url || ''),
          JSON.stringify(body.custom_fields || {}),
          now,
          now
        );

        const studentId = Number(sInfo.lastInsertRowid);
        db.prepare(`
          INSERT INTO enrollment_history (
            student_id, academic_year, department, program, class_name, semester, section, action_type, effective_date, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Admitted', ?, 'Guided Admission Wizard')
        `).run(studentId, academicYear, department, program, className, semester, section, admissionDate);

        // Fee schedule & invoice generation
        const feeItems = Array.isArray(body.fee_items)
          ? (body.fee_items as Array<{ category: string; amount: number }>).map((f) => ({
              category: String(f.category),
              amount_cents: toCents(f.amount),
            }))
          : [
              { category: 'Admission Fee', amount_cents: toCents(Number(body.admission_fee || 500)) },
              { category: 'Tuition Fee', amount_cents: toCents(Number(body.tuition_fee || 1800)) },
            ];

        const cleanItems = feeItems.filter((i) => i.amount_cents > 0);
        const subtotal = cleanItems.reduce((s, i) => s + i.amount_cents, 0);

        let discountCents = 0;
        const discountType = String(body.discount_type || 'none');
        const discountValue = Number(body.discount_value || 0);
        if (discountType !== 'none' && (discountValue > 0 || discountType === 'waiver')) {
          discountCents = calculateDiscountCents(
            subtotal,
            discountType as 'percentage' | 'fixed' | 'waiver',
            discountValue
          );
          db.prepare(`
            INSERT INTO scholarships (student_id, category, discount_type, value, reason, effective_date, authorized_by, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
          `).run(
            studentId,
            String(body.scholarship_category || 'Admission Scholarship'),
            discountType,
            discountValue,
            String(body.scholarship_reason || 'Approved at admission'),
            admissionDate,
            req.user!.name
          );
        }

        let createdInvoice: DbRow | null = null;
        if (cleanItems.length > 0) {
          const totals = calculateInvoiceTotals(cleanItems, discountCents, 0);
          const invCount = (db.prepare('SELECT COUNT(*) AS c FROM invoices').get() as { c: number }).c;
          const invNumber = `INV-${academicYear.slice(0, 4)}-${String(1001 + invCount)}`;
          const dueDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
          const billingPeriod = String(body.billing_period || `Admission ${academicYear}`);

          const invInfo = db.prepare(`
            INSERT INTO invoices (
              invoice_number, student_id, billing_period, issue_date, due_date,
              subtotal_cents, discount_cents, late_fee_cents, total_cents, paid_cents, status, items_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)
          `).run(
            invNumber,
            studentId,
            billingPeriod,
            admissionDate,
            dueDate,
            totals.subtotalCents,
            totals.discountCents,
            totals.totalCents,
            totals.totalCents === 0 ? 'paid' : 'unpaid',
            JSON.stringify(cleanItems),
            now
          );
          createdInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invInfo.lastInsertRowid) as DbRow;
        }

        writeAuditLog({
          actor: req.user!.name,
          actorRole: req.user!.role,
          action: 'ADMIT_STUDENT',
          entityType: 'student',
          entityId: String(studentId),
          newValue: { studentCode, fullName, className, section },
        });

        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
        return { student, invoice: createdInvoice };
      });

      refreshSmartAlerts();
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to admit student';
      res.status(400).json({ error: msg.includes('UNIQUE') ? 'Student ID already exists.' : msg });
    }
  });

  router.patch('/students/:id', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const prev = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as DbRow | undefined;
    if (!prev) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    const b = req.body as Record<string, unknown>;
    const now = new Date().toISOString();
    const nextClass = String(b.class_name ?? prev.class_name);
    const nextSection = String(b.section ?? prev.section);
    const nextSemester = String(b.semester ?? prev.semester);
    const nextYear = String(b.academic_year ?? prev.academic_year);
    const nextStatus = String(b.status ?? prev.status);

    runInTransaction(() => {
      db.prepare(`
        UPDATE students SET
          full_name = ?, guardian_name = ?, gender = ?, dob = ?, phone = ?, guardian_phone = ?,
          email = ?, address = ?, academic_year = ?, department = ?, program = ?,
          class_name = ?, semester = ?, section = ?, status = ?, is_archived = ?, updated_at = ?
        WHERE id = ?
      `).run(
        String(b.full_name ?? prev.full_name),
        String(b.guardian_name ?? prev.guardian_name),
        String(b.gender ?? prev.gender),
        String(b.dob ?? prev.dob),
        String(b.phone ?? prev.phone),
        String(b.guardian_phone ?? prev.guardian_phone),
        String(b.email ?? prev.email),
        String(b.address ?? prev.address),
        nextYear,
        String(b.department ?? prev.department),
        String(b.program ?? prev.program),
        nextClass,
        nextSemester,
        nextSection,
        nextStatus,
        nextStatus === 'Archived' ? 1 : Number(b.is_archived ?? prev.is_archived),
        now,
        id
      );

      if (
        nextClass !== prev.class_name ||
        nextSection !== prev.section ||
        nextSemester !== prev.semester ||
        nextYear !== prev.academic_year ||
        nextStatus !== prev.status
      ) {
        db.prepare(`
          INSERT INTO enrollment_history (
            student_id, academic_year, department, program, class_name, semester, section, action_type, effective_date, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          nextYear,
          String(b.department ?? prev.department),
          String(b.program ?? prev.program),
          nextClass,
          nextSemester,
          nextSection,
          nextStatus !== prev.status ? nextStatus : 'Transferred',
          now.slice(0, 10),
          String(b.transfer_reason || 'Updated academic placement')
        );
      }

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'UPDATE_STUDENT',
        entityType: 'student',
        entityId: String(id),
        prevValue: prev,
        newValue: b,
        reason: String(b.transfer_reason || ''),
      });
    });

    res.json({ student: db.prepare('SELECT * FROM students WHERE id = ?').get(id) });
  });

  router.post('/students/bulk-update', requireAdmin, (req: AuthedRequest, res) => {
    const { studentIds, updates } = req.body as {
      studentIds?: number[];
      updates?: { class_name?: string; section?: string; semester?: string; status?: string };
    };
    if (!Array.isArray(studentIds) || studentIds.length === 0 || !updates) {
      res.status(400).json({ error: 'Select at least one student and specify updates.' });
      return;
    }

    const now = new Date().toISOString();
    const batchId = runInTransaction(() => {
      const beforeRows = studentIds
        .map((sid) => db.prepare('SELECT * FROM students WHERE id = ?').get(sid))
        .filter(Boolean) as Array<DbRow>;

      const batchInfo = db.prepare(`
        INSERT INTO rollback_batches (operation_type, summary, affected_count, before_state_json, status, initiated_by, created_at)
        VALUES ('bulk_student_update', ?, ?, ?, 'available', ?, ?)
      `).run(
        `Bulk updated ${beforeRows.length} student(s)`,
        beforeRows.length,
        JSON.stringify({ students: beforeRows }),
        req.user!.name,
        now
      );

      for (const prev of beforeRows) {
        db.prepare(`
          UPDATE students SET
            class_name = COALESCE(?, class_name),
            section = COALESCE(?, section),
            semester = COALESCE(?, semester),
            status = COALESCE(?, status),
            is_archived = CASE WHEN ? = 'Archived' THEN 1 ELSE is_archived END,
            updated_at = ?
          WHERE id = ?
        `).run(
          updates.class_name || null,
          updates.section || null,
          updates.semester || null,
          updates.status || null,
          updates.status || '',
          now,
          prev.id
        );
      }

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'BULK_UPDATE_STUDENTS',
        entityType: 'rollback_batch',
        entityId: String(batchInfo.lastInsertRowid),
        newValue: { count: beforeRows.length, updates },
      });

      return batchInfo.lastInsertRowid;
    });

    res.json({ ok: true, batchId });
  });

  router.get('/students/:id/analytics', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as DbRow | undefined;
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }

    const inst = getInstitutionSettingsRow();
    const enrollmentHistory = db
      .prepare('SELECT * FROM enrollment_history WHERE student_id = ? ORDER BY effective_date DESC, id DESC')
      .all(id);

    const records = db.prepare(`
      SELECT ar.*, ases.session_date, ases.status AS session_status, sub.course_code, sub.course_name
      FROM attendance_records ar
      JOIN attendance_sessions ases ON ases.id = ar.session_id
      JOIN subjects sub ON sub.id = ases.subject_id
      WHERE ar.student_id = ?
      ORDER BY ases.session_date DESC
    `).all(id) as Array<{ status: string; session_status: string; session_date: string; course_code: string; course_name: string }>;

    const overallStats = calculateAttendanceStats(records, inst.attendance_rules);

    const bySubjectMap = new Map<string, { course_code: string; course_name: string; records: typeof records }>();
    for (const r of records) {
      const existing = bySubjectMap.get(r.course_code) || {
        course_code: r.course_code,
        course_name: r.course_name,
        records: [],
      };
      existing.records.push(r);
      bySubjectMap.set(r.course_code, existing);
    }
    const subjectWise = Array.from(bySubjectMap.values()).map((entry) => ({
      course_code: entry.course_code,
      course_name: entry.course_name,
      ...calculateAttendanceStats(entry.records, inst.attendance_rules),
    }));

    const invoices = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY issue_date DESC').all(id) as Array<DbRow>;
    const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY payment_date DESC, id DESC').all(id);
    const scholarships = db.prepare('SELECT * FROM scholarships WHERE student_id = ? ORDER BY id DESC').all(id);
    const fines = db.prepare('SELECT * FROM fines WHERE student_id = ? ORDER BY created_at DESC').all(id);

    const totalBilledCents = invoices.reduce((s, inv) => s + Number(inv.total_cents), 0);
    const totalDiscountsCents = invoices.reduce((s, inv) => s + Number(inv.discount_cents), 0);
    const totalPaidCents = invoices.reduce((s, inv) => s + Number(inv.paid_cents), 0);
    const overdueCents = invoices
      .filter((inv) => inv.status === 'overdue')
      .reduce((s, inv) => s + Math.max(0, Number(inv.total_cents) - Number(inv.paid_cents)), 0);

    const missingFields: string[] = [];
    if (!student.photo_url) missingFields.push('Photograph');
    if (!student.guardian_phone) missingFields.push('Guardian Phone');
    if (!student.dob) missingFields.push('Date of Birth');
    if (!student.address) missingFields.push('Address');

    res.json({
      student,
      enrollmentHistory,
      attendance: {
        overall: overallStats,
        consecutiveAbsences: maxConsecutiveAbsences(records),
        subjectWise,
        recentRecords: records.slice(0, 20),
      },
      finance: {
        totalBilledCents,
        totalDiscountsCents,
        totalPaidCents,
        outstandingCents: Math.max(0, totalBilledCents - totalPaidCents),
        overdueCents,
        invoices,
        payments,
        scholarships,
        fines,
      },
      profileCompletion: {
        percentage: Math.round(((4 - missingFields.length) / 4) * 100),
        missingFields,
      },
    });
  });

  router.get('/students/:id/id-card', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as DbRow | undefined;
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    const inst = getInstitutionSettingsRow();
    const qrPayload = JSON.stringify({
      type: 'SCHOLARGRID_ID',
      studentCode: student.student_code,
      fullName: student.full_name,
      class: student.class_name,
      section: student.section,
      academicYear: student.academic_year,
    });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 220, margin: 1 });
    res.json({ student, institution: inst, qrDataUrl });
  });

  // --------------------------------------------------------------------------
  // Excel Template Download, Preview, Commit, Export & Bulk Photo Matching
  // --------------------------------------------------------------------------
  router.get('/excel/template', requireAdmin, (_req, res) => {
    const headers = [
      'Student ID',
      'Full Name',
      "Father's/Guardian's Name",
      'Gender',
      'Date of Birth',
      'Phone',
      'Guardian Phone',
      'Email',
      'Address',
      'Admission Date',
      'Academic Year',
      'Program',
      'Class',
      'Semester',
      'Section',
      'Admission Fee',
      'Monthly Fee',
      'Discount',
      'Photograph Filename',
    ];
    const sampleRow = [
      'STU-2026-101',
      'Elena Rostova',
      'Viktor Rostov',
      'Female',
      '2006-05-18',
      '+1-555-402-1100',
      '+1-555-402-9100',
      'elena.r@academiamodern.edu',
      '128 Crescent Way',
      '2026-09-01',
      '2026-2027',
      'BSCS',
      'BSCS-1',
      'Sem 1',
      'A',
      500,
      1800,
      0,
      'STU-2026-101.jpg',
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="scholargrid_student_template.xlsx"');
    res.send(buf);
  });

  router.post('/excel/preview', requireAdmin, uploadMemory.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Please upload an .xlsx or .csv file.' });
      return;
    }
    const inst = getInstitutionSettingsRow();
    const requiredFields: string[] = req.body.requiredFields
      ? JSON.parse(String(req.body.requiredFields))
      : inst.fee_settings?.requiredImportFields || ['Student ID', 'Full Name', 'Class', 'Section', 'Academic Year'];

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) {
      res.status(400).json({ error: 'Uploaded workbook has no sheets.' });
      return;
    }
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], { defval: '' });
    const existing = db.prepare('SELECT student_code, full_name FROM students').all() as Array<{
      student_code: string;
      full_name: string;
    }>;
    const existingCodes = new Set(existing.map((e) => e.student_code.toLowerCase()));
    const existingNames = new Map(existing.map((e) => [e.student_code, e.full_name]));

    const seenInFile = new Set<string>();
    const validated = rows.map((row, idx) => {
      const result = validateStudentImportRow(row, idx + 2, requiredFields, existingCodes, existingNames);
      const code = String(result.normalized.student_code || '').toLowerCase();
      if (code && seenInFile.has(code)) {
        result.valid = false;
        result.action = 'blocked';
        result.errors.push(`Duplicate Student ID "${result.normalized.student_code}" within uploaded file`);
      }
      if (code) seenInFile.add(code);
      return result;
    });

    res.json({
      filename: req.file.originalname,
      headers: rows.length > 0 ? Object.keys(rows[0]) : [],
      totalRows: validated.length,
      validCreateCount: validated.filter((r) => r.action === 'create').length,
      existingSkipCount: validated.filter((r) => r.action === 'skip_existing').length,
      blockedCount: validated.filter((r) => r.action === 'blocked').length,
      rows: validated,
    });
  });

  router.post('/excel/commit', requireAdmin, (req: AuthedRequest, res) => {
    const { rows, updateExisting } = req.body as {
      rows?: Array<{ action: string; normalized: Record<string, string | number> }>;
      updateExisting?: boolean;
    };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'No validated import rows provided.' });
      return;
    }

    const now = new Date().toISOString();
    const summary = runInTransaction(() => {
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const insertedIds: number[] = [];
      const beforeUpdated: Array<DbRow> = [];

      for (const r of rows) {
        if (r.action === 'blocked') {
          skipped++;
          continue;
        }
        const n = r.normalized;
        const code = String(n.student_code || '').trim();
        const existing = db.prepare('SELECT * FROM students WHERE lower(student_code) = lower(?)').get(code) as
          | DbRow
          | undefined;

        if (existing) {
          if (updateExisting) {
            beforeUpdated.push(existing);
            db.prepare(`
              UPDATE students SET
                full_name = COALESCE(NULLIF(?, ''), full_name),
                guardian_name = COALESCE(NULLIF(?, ''), guardian_name),
                phone = COALESCE(NULLIF(?, ''), phone),
                email = COALESCE(NULLIF(?, ''), email),
                class_name = COALESCE(NULLIF(?, ''), class_name),
                section = COALESCE(NULLIF(?, ''), section),
                updated_at = ?
              WHERE id = ?
            `).run(
              String(n.full_name || ''),
              String(n.guardian_name || ''),
              String(n.phone || ''),
              String(n.email || ''),
              String(n.class_name || ''),
              String(n.section || ''),
              now,
              existing.id
            );
            updated++;
          } else {
            skipped++;
          }
          continue;
        }

        const sInfo = db.prepare(`
          INSERT INTO students (
            student_code, full_name, guardian_name, gender, dob, phone, guardian_phone, email, address,
            admission_date, academic_year, department, program, class_name, semester, section, status,
            photo_url, custom_fields_json, is_archived, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', '', '{}', 0, ?, ?)
        `).run(
          code,
          String(n.full_name || ''),
          String(n.guardian_name || ''),
          String(n.gender || ''),
          String(n.dob || ''),
          String(n.phone || ''),
          String(n.guardian_phone || ''),
          String(n.email || ''),
          String(n.address || ''),
          String(n.admission_date || now.slice(0, 10)),
          String(n.academic_year || '2026-2027'),
          String(n.department || n.program || 'General'),
          String(n.program || 'General'),
          String(n.class_name || ''),
          String(n.semester || 'Sem 1'),
          String(n.section || 'A'),
          now,
          now
        );
        const newId = Number(sInfo.lastInsertRowid);
        insertedIds.push(newId);
        db.prepare(`
          INSERT INTO enrollment_history (
            student_id, academic_year, department, program, class_name, semester, section, action_type, effective_date, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Excel Import', ?, 'Imported via Excel batch')
        `).run(
          newId,
          String(n.academic_year || '2026-2027'),
          String(n.department || n.program || 'General'),
          String(n.program || 'General'),
          String(n.class_name || ''),
          String(n.semester || 'Sem 1'),
          String(n.section || 'A'),
          String(n.admission_date || now.slice(0, 10))
        );
        created++;
      }

      const batchInfo = db.prepare(`
        INSERT INTO rollback_batches (operation_type, summary, affected_count, before_state_json, status, initiated_by, created_at)
        VALUES ('excel_import', ?, ?, ?, 'available', ?, ?)
      `).run(
        `Excel import: ${created} created, ${updated} updated, ${skipped} skipped`,
        created + updated,
        JSON.stringify({ insertedIds, beforeUpdated }),
        req.user!.name,
        now
      );

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'EXCEL_IMPORT_COMMIT',
        entityType: 'rollback_batch',
        entityId: String(batchInfo.lastInsertRowid),
        newValue: { created, updated, skipped },
      });

      return { created, updated, skipped, batchId: batchInfo.lastInsertRowid };
    });

    refreshSmartAlerts();
    res.json(summary);
  });

  router.get('/excel/export', requireAdmin, (req, res) => {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const students = db.prepare('SELECT * FROM students WHERE is_archived = 0 ORDER BY student_code ASC').all() as Array<DbRow>;
    const formatted = students.map((s) => ({
      'Student ID': s.student_code,
      'Full Name': s.full_name,
      "Father's/Guardian's Name": s.guardian_name,
      Gender: s.gender,
      'Date of Birth': s.dob,
      Phone: s.phone,
      'Guardian Phone': s.guardian_phone,
      Email: s.email,
      Address: s.address,
      'Admission Date': s.admission_date,
      'Academic Year': s.academic_year,
      Program: s.program,
      Class: s.class_name,
      Semester: s.semester,
      Section: s.section,
      Status: s.status,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(formatted);
    XLSX.utils.book_append_sheet(wb, ws, 'Students');

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="scholargrid_students.csv"');
      res.send(csv);
      return;
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="scholargrid_students.xlsx"');
    res.send(buf);
  });

  // Bulk photo preview & commit
  router.post('/photos/bulk-preview', requireAdmin, uploadMemory.array('photos', 80), (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const students = db.prepare('SELECT id, student_code, full_name, photo_url FROM students WHERE is_archived = 0').all() as Array<{
      id: number;
      student_code: string;
      full_name: string;
      photo_url: string;
    }>;

    const studentByCode = new Map(students.map((s) => [s.student_code.toLowerCase(), s]));
    const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const seenFilenames = new Set<string>();

    const matched: Array<{ filename: string; studentId: number; studentCode: string; studentName: string; dataUrl: string }> = [];
    const unmatchedFiles: Array<{ filename: string; reason: string }> = [];
    const invalidFiles: Array<{ filename: string; reason: string }> = [];
    const duplicateFilenames: string[] = [];

    for (const f of files) {
      const lowerName = f.originalname.toLowerCase();
      const ext = path.extname(lowerName);
      const base = path.basename(f.originalname, path.extname(f.originalname)).trim();

      if (seenFilenames.has(lowerName)) {
        duplicateFilenames.push(f.originalname);
        continue;
      }
      seenFilenames.add(lowerName);

      if (!allowedExt.has(ext)) {
        invalidFiles.push({ filename: f.originalname, reason: `Unsupported format (${ext || 'unknown'})` });
        continue;
      }

      const student = studentByCode.get(base.toLowerCase());
      if (!student) {
        unmatchedFiles.push({ filename: f.originalname, reason: `No student found matching ID "${base}"` });
        continue;
      }

      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      matched.push({
        filename: f.originalname,
        studentId: student.id,
        studentCode: student.student_code,
        studentName: student.full_name,
        dataUrl: `data:${mime};base64,${f.buffer.toString('base64')}`,
      });
    }

    const matchedIds = new Set(matched.map((m) => m.studentId));
    const studentsWithoutPhoto = students.filter((s) => !s.photo_url && !matchedIds.has(s.id));

    res.json({
      matched,
      unmatchedFiles,
      invalidFiles,
      duplicateFilenames,
      studentsWithoutPhotoCount: studentsWithoutPhoto.length,
    });
  });

  router.post('/photos/bulk-commit', requireAdmin, (req: AuthedRequest, res) => {
    const { assignments } = req.body as {
      assignments?: Array<{ studentId: number; filename: string; dataUrl: string }>;
    };
    if (!Array.isArray(assignments) || assignments.length === 0) {
      res.status(400).json({ error: 'No matched photos to commit.' });
      return;
    }

    const now = new Date().toISOString();
    const batchId = runInTransaction(() => {
      const beforePhotos: Array<{ id: number; photo_url: string }> = [];

      for (const item of assignments) {
        const stu = db.prepare('SELECT id, student_code, photo_url FROM students WHERE id = ?').get(item.studentId) as
          | { id: number; student_code: string; photo_url: string }
          | undefined;
        if (!stu) continue;
        beforePhotos.push({ id: stu.id, photo_url: stu.photo_url });

        const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(item.dataUrl);
        if (!match) continue;
        const ext = match[1] === 'png' ? '.png' : match[1] === 'webp' ? '.webp' : '.jpg';
        const safeName = `${stu.student_code.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}${ext}`;
        const destPath = path.resolve(UPLOAD_PHOTOS_DIR, safeName);
        if (!destPath.startsWith(UPLOAD_PHOTOS_DIR + path.sep)) continue;

        fs.writeFileSync(destPath, Buffer.from(match[2], 'base64'));
        const publicUrl = `/api/uploads/photos/${safeName}`;
        db.prepare('UPDATE students SET photo_url = ?, updated_at = ? WHERE id = ?').run(publicUrl, now, stu.id);
      }

      const batchInfo = db.prepare(`
        INSERT INTO rollback_batches (operation_type, summary, affected_count, before_state_json, status, initiated_by, created_at)
        VALUES ('bulk_photo_upload', ?, ?, ?, 'available', ?, ?)
      `).run(
        `Bulk assigned ${beforePhotos.length} student photograph(s)`,
        beforePhotos.length,
        JSON.stringify({ beforePhotos }),
        req.user!.name,
        now
      );

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'BULK_PHOTO_COMMIT',
        entityType: 'rollback_batch',
        entityId: String(batchInfo.lastInsertRowid),
        newValue: { count: beforePhotos.length },
      });

      return batchInfo.lastInsertRowid;
    });

    res.json({ ok: true, batchId });
  });

  router.get('/uploads/photos/:filename', (req, res) => {
    const requested = path.basename(req.params.filename);
    const resolved = path.resolve(UPLOAD_PHOTOS_DIR, requested);
    if (!resolved.startsWith(UPLOAD_PHOTOS_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).end();
      return;
    }
    res.sendFile(resolved);
  });

  // --------------------------------------------------------------------------
  // Duplicate Detection & Safe Merge
  // --------------------------------------------------------------------------
  router.get('/duplicates', requireAdmin, (_req, res) => {
    const students = db.prepare('SELECT * FROM students WHERE is_archived = 0').all() as never[];
    const dismissed = db.prepare("SELECT pair_key FROM duplicate_resolutions WHERE resolution_type = 'separate'").all() as Array<{
      pair_key: string;
    }>;
    const dismissedSet = new Set(dismissed.map((d) => d.pair_key));
    const matches = findPotentialDuplicates(students, dismissedSet);
    res.json({ duplicates: matches });
  });

  router.post('/duplicates/dismiss', requireAdmin, (req: AuthedRequest, res) => {
    const { pairKey, studentAId, studentBId, notes } = req.body as {
      pairKey: string;
      studentAId: number;
      studentBId: number;
      notes?: string;
    };
    db.prepare(`
      INSERT OR REPLACE INTO duplicate_resolutions (pair_key, student_a_id, student_b_id, resolution_type, resolved_by, notes, created_at)
      VALUES (?, ?, ?, 'separate', ?, ?, ?)
    `).run(pairKey, studentAId, studentBId, req.user!.name, notes || 'Confirmed separate individuals', new Date().toISOString());

    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'DISMISS_DUPLICATE_PAIR',
      entityType: 'student_pair',
      entityId: pairKey,
      reason: notes || 'Marked separate individuals',
    });
    res.json({ ok: true });
  });

  router.post('/duplicates/merge', requireAdmin, (req: AuthedRequest, res) => {
    const { primaryId, secondaryId, retainedFields, reason } = req.body as {
      primaryId: number;
      secondaryId: number;
      retainedFields?: Record<string, string>;
      reason?: string;
    };
    if (!primaryId || !secondaryId || primaryId === secondaryId) {
      res.status(400).json({ error: 'Two distinct student IDs are required to merge.' });
      return;
    }

    const now = new Date().toISOString();
    runInTransaction(() => {
      const primary = db.prepare('SELECT * FROM students WHERE id = ?').get(primaryId) as DbRow | undefined;
      const secondary = db.prepare('SELECT * FROM students WHERE id = ?').get(secondaryId) as DbRow | undefined;
      if (!primary || !secondary) throw new Error('One or both students not found');

      if (retainedFields) {
        db.prepare(`
          UPDATE students SET
            full_name = ?, guardian_name = ?, phone = ?, guardian_phone = ?, email = ?, address = ?, dob = ?, updated_at = ?
          WHERE id = ?
        `).run(
          retainedFields.full_name || primary.full_name,
          retainedFields.guardian_name || primary.guardian_name,
          retainedFields.phone || primary.phone,
          retainedFields.guardian_phone || primary.guardian_phone,
          retainedFields.email || primary.email,
          retainedFields.address || primary.address,
          retainedFields.dob || primary.dob,
          now,
          primaryId
        );
      }

      // Preserve attendance records (avoid session_id+student_id collision)
      const secRecords = db.prepare('SELECT * FROM attendance_records WHERE student_id = ?').all(secondaryId) as Array<DbRow>;
      for (const rec of secRecords) {
        const conflict = db
          .prepare('SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?')
          .get(rec.session_id, primaryId);
        if (!conflict) {
          db.prepare('UPDATE attendance_records SET student_id = ? WHERE id = ?').run(primaryId, rec.id);
        }
      }

      // Preserve invoices (avoid student_id+billing_period collision)
      const secInvoices = db.prepare('SELECT * FROM invoices WHERE student_id = ?').all(secondaryId) as Array<DbRow>;
      for (const inv of secInvoices) {
        const conflict = db
          .prepare('SELECT id FROM invoices WHERE student_id = ? AND billing_period = ?')
          .get(primaryId, inv.billing_period);
        if (!conflict) {
          db.prepare('UPDATE invoices SET student_id = ? WHERE id = ?').run(primaryId, inv.id);
        }
      }

      db.prepare('UPDATE payments SET student_id = ? WHERE student_id = ?').run(primaryId, secondaryId);
      db.prepare('UPDATE fines SET student_id = ? WHERE student_id = ?').run(primaryId, secondaryId);
      db.prepare('UPDATE scholarships SET student_id = ? WHERE student_id = ?').run(primaryId, secondaryId);
      db.prepare('UPDATE enrollment_history SET student_id = ? WHERE student_id = ?').run(primaryId, secondaryId);

      // Archive secondary safely
      db.prepare("UPDATE students SET status = 'Archived', is_archived = 1, updated_at = ? WHERE id = ?").run(now, secondaryId);

      const pairKey = `${Math.min(primaryId, secondaryId)}:${Math.max(primaryId, secondaryId)}`;
      db.prepare(`
        INSERT OR REPLACE INTO duplicate_resolutions (pair_key, student_a_id, student_b_id, resolution_type, resolved_by, notes, created_at)
        VALUES (?, ?, ?, 'merged', ?, ?, ?)
      `).run(pairKey, primaryId, secondaryId, req.user!.name, reason || 'Merged duplicate records', now);

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'MERGE_DUPLICATE_STUDENTS',
        entityType: 'student',
        entityId: String(primaryId),
        prevValue: { primary, secondary },
        newValue: { primaryId, archivedSecondaryId: secondaryId, retainedFields },
        reason: reason || 'Confirmed duplicate student merge',
      });
    });

    refreshSmartAlerts();
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Teachers & Subjects Management
  // --------------------------------------------------------------------------
  router.get('/teachers', requireAdmin, (_req, res) => {
    const teachers = db.prepare(`
      SELECT id, employee_id, full_name, phone, email, address, department, designation, status, photo_url, created_at
      FROM teachers ORDER BY full_name ASC
    `).all();
    const assignments = db.prepare(`
      SELECT ta.*, sub.course_code, sub.course_name
      FROM teacher_assignments ta
      JOIN subjects sub ON sub.id = ta.subject_id
      WHERE ta.is_active = 1
    `).all();
    const submissions = db.prepare(`
      SELECT teacher_id, COUNT(*) AS submitted_count, MAX(submitted_at) AS last_submitted_at
      FROM attendance_sessions WHERE status = 'submitted'
      GROUP BY teacher_id
    `).all();
    res.json({ teachers, assignments, submissions });
  });

  router.post('/teachers', requireAdmin, (req: AuthedRequest, res) => {
    const { employee_id, full_name, phone, email, address, department, designation, initial_password } = req.body as Record<string, string>;
    if (!employee_id || !full_name || !department) {
      res.status(400).json({ error: 'Employee ID, full name, and department are required.' });
      return;
    }
    const now = new Date().toISOString();
    const pass = initial_password && initial_password.length >= 6 ? initial_password : 'teacher123';
    try {
      const info = db.prepare(`
        INSERT INTO teachers (employee_id, full_name, phone, email, address, department, designation, status, photo_url, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', '', ?, ?)
      `).run(
        employee_id.trim(),
        full_name.trim(),
        phone || '',
        email || '',
        address || '',
        department.trim(),
        designation || 'Lecturer',
        hashPassword(pass),
        now
      );
      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'CREATE_TEACHER',
        entityType: 'teacher',
        entityId: String(info.lastInsertRowid),
        newValue: { employee_id, full_name, department },
      });
      res.status(201).json({ id: info.lastInsertRowid });
    } catch {
      res.status(400).json({ error: 'Employee ID already exists.' });
    }
  });

  router.patch('/teachers/:id', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const prev = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id) as DbRow | undefined;
    if (!prev) {
      res.status(404).json({ error: 'Teacher not found.' });
      return;
    }
    const b = req.body as Record<string, string>;
    db.prepare(`
      UPDATE teachers SET full_name = ?, phone = ?, email = ?, address = ?, department = ?, designation = ?, status = ?
      WHERE id = ?
    `).run(
      b.full_name ?? prev.full_name,
      b.phone ?? prev.phone,
      b.email ?? prev.email,
      b.address ?? prev.address,
      b.department ?? prev.department,
      b.designation ?? prev.designation,
      b.status ?? prev.status,
      id
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'UPDATE_TEACHER',
      entityType: 'teacher',
      entityId: String(id),
      newValue: b,
    });
    res.json({ ok: true });
  });

  router.post('/teachers/:id/reset-password', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { newPassword } = req.body as { newPassword?: string };
    if (!newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters.' });
      return;
    }
    db.prepare('UPDATE teachers SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), id);
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'RESET_TEACHER_PASSWORD',
      entityType: 'teacher',
      entityId: String(id),
      reason: 'Administrator password reset',
    });
    res.json({ ok: true });
  });

  router.get('/subjects', requireAdmin, (_req, res) => {
    const subjects = db.prepare('SELECT * FROM subjects ORDER BY course_code ASC').all();
    res.json({ subjects });
  });

  router.post('/subjects', requireAdmin, (req: AuthedRequest, res) => {
    const b = req.body as Record<string, string | number>;
    if (!b.course_code || !b.course_name || !b.class_name) {
      res.status(400).json({ error: 'Course code, course name, and class are required.' });
      return;
    }
    try {
      const info = db.prepare(`
        INSERT INTO subjects (course_code, course_name, department, program, academic_year, semester, credit_hours, class_name, section)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(b.course_code).trim(),
        String(b.course_name).trim(),
        String(b.department || 'Computer Science'),
        String(b.program || 'BSCS'),
        String(b.academic_year || '2026-2027'),
        String(b.semester || 'Sem 1'),
        Number(b.credit_hours || 3),
        String(b.class_name),
        String(b.section || 'A')
      );
      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'CREATE_SUBJECT',
        entityType: 'subject',
        entityId: String(info.lastInsertRowid),
        newValue: b,
      });
      res.status(201).json({ id: info.lastInsertRowid });
    } catch {
      res.status(400).json({ error: 'Subject already exists for that class/semester/section.' });
    }
  });

  router.post('/teacher-assignments', requireAdmin, (req: AuthedRequest, res) => {
    const { teacher_id, subject_id, class_name, section, academic_year, semester } = req.body as Record<string, string | number>;
    const info = db.prepare(`
      INSERT INTO teacher_assignments (teacher_id, subject_id, class_name, section, academic_year, semester, is_active, assigned_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      Number(teacher_id),
      Number(subject_id),
      String(class_name),
      String(section),
      String(academic_year || '2026-2027'),
      String(semester || 'Sem 1'),
      new Date().toISOString()
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'ASSIGN_TEACHER_SUBJECT',
      entityType: 'teacher_assignment',
      entityId: String(info.lastInsertRowid),
      newValue: req.body,
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  // --------------------------------------------------------------------------
  // Timetable, Conflict Detection, Cloning & Substitutions
  // --------------------------------------------------------------------------
  router.get('/timetable', requireAdmin, (_req, res) => {
    const sessions = db.prepare(`
      SELECT ts.*, sub.course_code, sub.course_name, t.full_name AS teacher_name
      FROM timetable_sessions ts
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teachers t ON t.id = ts.teacher_id
      WHERE ts.is_active = 1
      ORDER BY ts.day_of_week, ts.start_time
    `).all();
    const conflicts = detectTimetableConflicts(sessions as never[]);
    const substitutions = db.prepare(`
      SELECT tsub.*, ts.day_of_week, ts.start_time, ts.class_name, ts.section,
        t1.full_name AS original_teacher_name, t2.full_name AS substitute_teacher_name, sub.course_code
      FROM teacher_substitutions tsub
      JOIN timetable_sessions ts ON ts.id = tsub.timetable_session_id
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teachers t1 ON t1.id = tsub.original_teacher_id
      JOIN teachers t2 ON t2.id = tsub.substitute_teacher_id
      ORDER BY tsub.substitution_date DESC
    `).all();
    res.json({ sessions, conflicts, substitutions });
  });

  router.post('/timetable', requireAdmin, (req: AuthedRequest, res) => {
    const b = req.body as Record<string, string | number>;
    if (!b.day_of_week || !b.start_time || !b.end_time || !b.subject_id || !b.teacher_id || !b.class_name || !b.section) {
      res.status(400).json({ error: 'All timetable session fields are required.' });
      return;
    }

    const existing = db.prepare(`
      SELECT ts.*, t.full_name AS teacher_name, sub.course_name
      FROM timetable_sessions ts
      JOIN teachers t ON t.id = ts.teacher_id
      JOIN subjects sub ON sub.id = ts.subject_id
      WHERE ts.is_active = 1
    `).all() as Array<DbRow>;

    const candidateTeacher = db.prepare('SELECT full_name FROM teachers WHERE id = ?').get(Number(b.teacher_id)) as
      | { full_name: string }
      | undefined;
    const candidate = {
      id: -1,
      day_of_week: String(b.day_of_week),
      start_time: String(b.start_time),
      end_time: String(b.end_time),
      subject_id: Number(b.subject_id),
      teacher_id: Number(b.teacher_id),
      teacher_name: candidateTeacher?.full_name || '',
      class_name: String(b.class_name),
      semester: String(b.semester || 'Sem 1'),
      section: String(b.section),
      room: String(b.room || 'LH-101'),
      academic_year: String(b.academic_year || '2026-2027'),
      is_active: 1,
    };

    const conflicts = detectTimetableConflicts([...(existing as never[]), candidate]).filter(
      (c) => c.sessionAId === -1 || c.sessionBId === -1
    );

    if (conflicts.length > 0 && !b.forceSave) {
      res.status(409).json({ error: 'Timetable conflict detected', conflicts });
      return;
    }

    const info = db.prepare(`
      INSERT INTO timetable_sessions (
        day_of_week, start_time, end_time, subject_id, teacher_id, class_name, semester, section, room, academic_term, academic_year, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      candidate.day_of_week,
      candidate.start_time,
      candidate.end_time,
      candidate.subject_id,
      candidate.teacher_id,
      candidate.class_name,
      candidate.semester,
      candidate.section,
      candidate.room,
      String(b.academic_term || 'Fall'),
      candidate.academic_year
    );

    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CREATE_TIMETABLE_SESSION',
      entityType: 'timetable_session',
      entityId: String(info.lastInsertRowid),
      newValue: candidate,
    });
    res.status(201).json({ id: info.lastInsertRowid, conflicts });
  });

  router.delete('/timetable/:id', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE timetable_sessions SET is_active = 0 WHERE id = ?').run(id);
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'ARCHIVE_TIMETABLE_SESSION',
      entityType: 'timetable_session',
      entityId: String(id),
    });
    res.json({ ok: true });
  });

  router.post('/timetable/clone-preview', requireAdmin, (req, res) => {
    const { sourceClass, sourceSection, targetClass, targetSection, targetYear, targetSemester, daysFilter } = req.body as {
      sourceClass: string;
      sourceSection?: string;
      targetClass: string;
      targetSection: string;
      targetYear?: string;
      targetSemester?: string;
      daysFilter?: string[];
    };

    const sourceSessions = db.prepare(`
      SELECT ts.*, sub.course_code, sub.course_name, t.full_name AS teacher_name
      FROM timetable_sessions ts
      JOIN subjects sub ON sub.id = ts.subject_id
      JOIN teachers t ON t.id = ts.teacher_id
      WHERE ts.is_active = 1 AND ts.class_name = ? ${sourceSection ? 'AND ts.section = ?' : ''}
    `).all(...(sourceSection ? [sourceClass, sourceSection] : [sourceClass])) as Array<DbRow>;

    const filtered = Array.isArray(daysFilter) && daysFilter.length > 0
      ? sourceSessions.filter((s) => daysFilter.includes(String(s.day_of_week)))
      : sourceSessions;

    const existingActive = db.prepare(`
      SELECT ts.*, t.full_name AS teacher_name, sub.course_name
      FROM timetable_sessions ts
      JOIN teachers t ON t.id = ts.teacher_id
      JOIN subjects sub ON sub.id = ts.subject_id
      WHERE ts.is_active = 1
    `).all() as Array<DbRow>;

    const proposed = filtered.map((s, idx) => ({
      ...s,
      id: -1000 - idx,
      class_name: targetClass,
      section: targetSection,
      academic_year: targetYear || String(s.academic_year),
      semester: targetSemester || String(s.semester),
    }));

    const conflicts = detectTimetableConflicts([...(existingActive as never[]), ...(proposed as never[])]).filter(
      (c) => c.sessionAId < 0 || (c.sessionBId !== undefined && c.sessionBId < 0)
    );

    res.json({ proposedCount: proposed.length, proposed, conflicts });
  });

  router.post('/timetable/clone-commit', requireAdmin, (req: AuthedRequest, res) => {
    const { proposed, overwriteTarget, targetClass, targetSection } = req.body as {
      proposed?: Array<Record<string, unknown>>;
      overwriteTarget?: boolean;
      targetClass?: string;
      targetSection?: string;
    };
    if (!Array.isArray(proposed) || proposed.length === 0) {
      res.status(400).json({ error: 'No proposed sessions to clone.' });
      return;
    }

    const now = new Date().toISOString();
    const batchId = runInTransaction(() => {
      const deactivatedIds: number[] = [];
      if (overwriteTarget && targetClass && targetSection) {
        const toDeactivate = db
          .prepare('SELECT id FROM timetable_sessions WHERE is_active = 1 AND class_name = ? AND section = ?')
          .all(targetClass, targetSection) as Array<{ id: number }>;
        for (const r of toDeactivate) {
          deactivatedIds.push(r.id);
          db.prepare('UPDATE timetable_sessions SET is_active = 0 WHERE id = ?').run(r.id);
        }
      }

      const insertedIds: number[] = [];
      for (const p of proposed) {
        const info = db.prepare(`
          INSERT INTO timetable_sessions (
            day_of_week, start_time, end_time, subject_id, teacher_id, class_name, semester, section, room, academic_term, academic_year, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          String(p.day_of_week),
          String(p.start_time),
          String(p.end_time),
          Number(p.subject_id),
          Number(p.teacher_id),
          String(p.class_name),
          String(p.semester),
          String(p.section),
          String(p.room || 'LH-101'),
          String(p.academic_term || 'Fall'),
          String(p.academic_year || '2026-2027')
        );
        insertedIds.push(Number(info.lastInsertRowid));
      }

      const batchInfo = db.prepare(`
        INSERT INTO rollback_batches (operation_type, summary, affected_count, before_state_json, status, initiated_by, created_at)
        VALUES ('timetable_clone', ?, ?, ?, 'available', ?, ?)
      `).run(
        `Cloned ${insertedIds.length} timetable session(s) to ${targetClass || ''} ${targetSection || ''}`.trim(),
        insertedIds.length,
        JSON.stringify({ insertedIds, deactivatedIds }),
        req.user!.name,
        now
      );

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'CLONE_TIMETABLE',
        entityType: 'rollback_batch',
        entityId: String(batchInfo.lastInsertRowid),
        newValue: { insertedCount: insertedIds.length, targetClass, targetSection },
      });

      return batchInfo.lastInsertRowid;
    });

    res.json({ ok: true, batchId });
  });

  router.post('/substitutions', requireAdmin, (req: AuthedRequest, res) => {
    const { timetable_session_id, substitution_date, substitute_teacher_id, reason } = req.body as Record<string, string | number>;
    const session = db.prepare('SELECT * FROM timetable_sessions WHERE id = ?').get(Number(timetable_session_id)) as
      | DbRow
      | undefined;
    if (!session) {
      res.status(404).json({ error: 'Timetable session not found.' });
      return;
    }
    const info = db.prepare(`
      INSERT OR REPLACE INTO teacher_substitutions (
        timetable_session_id, substitution_date, original_teacher_id, substitute_teacher_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Number(timetable_session_id),
      String(substitution_date),
      Number(session.teacher_id),
      Number(substitute_teacher_id),
      String(reason || 'Teacher unavailable'),
      new Date().toISOString()
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'ASSIGN_TEACHER_SUBSTITUTION',
      entityType: 'teacher_substitution',
      entityId: String(info.lastInsertRowid),
      newValue: req.body,
      reason: String(reason || ''),
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  // --------------------------------------------------------------------------
  // Attendance Sessions, Marking, Corrections & Fine Triggering
  // --------------------------------------------------------------------------
  router.get('/attendance/sessions', requireAdmin, (_req, res) => {
    const sessions = db.prepare(`
      SELECT ases.*, sub.course_code, sub.course_name, t.full_name AS teacher_name,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = ases.id AND ar.status = 'present') AS present_count,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = ases.id AND ar.status = 'absent') AS absent_count,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = ases.id AND ar.status = 'late') AS late_count,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = ases.id AND ar.status = 'excused') AS excused_count
      FROM attendance_sessions ases
      JOIN subjects sub ON sub.id = ases.subject_id
      JOIN teachers t ON t.id = ases.teacher_id
      ORDER BY ases.session_date DESC, ases.id DESC
    `).all();
    const corrections = db.prepare(`
      SELECT ac.*, s.full_name AS student_name, s.student_code
      FROM attendance_corrections ac
      JOIN students s ON s.id = ac.student_id
      ORDER BY ac.created_at DESC LIMIT 100
    `).all();
    res.json({ sessions, corrections });
  });

  router.get('/attendance/sessions/:id/records', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const session = db.prepare(`
      SELECT ases.*, sub.course_code, sub.course_name, t.full_name AS teacher_name
      FROM attendance_sessions ases
      JOIN subjects sub ON sub.id = ases.subject_id
      JOIN teachers t ON t.id = ases.teacher_id
      WHERE ases.id = ?
    `).get(id) as DbRow | undefined;
    if (!session) {
      res.status(404).json({ error: 'Attendance session not found.' });
      return;
    }
    const students = db.prepare(`
      SELECT s.id AS student_id, s.student_code, s.full_name, s.photo_url,
        ar.id AS record_id, COALESCE(ar.status, '') AS status, COALESCE(ar.remarks, '') AS remarks
      FROM students s
      LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.session_id = ?
      WHERE s.is_archived = 0 AND s.status = 'Active' AND s.class_name = ? AND s.section = ?
      ORDER BY s.student_code ASC
    `).all(id, session.class_name, session.section);
    res.json({ session, records: students });
  });

  router.post('/attendance/mark', requireAdmin, (req: AuthedRequest, res) => {
    const { timetable_session_id, session_date, status, records, notes } = req.body as {
      timetable_session_id: number;
      session_date: string;
      status?: string;
      records: Array<{ student_id: number; status: string; remarks?: string }>;
      notes?: string;
    };
    const tt = db.prepare('SELECT * FROM timetable_sessions WHERE id = ?').get(timetable_session_id) as DbRow | undefined;
    if (!tt) {
      res.status(404).json({ error: 'Timetable session not found.' });
      return;
    }

    const inst = getInstitutionSettingsRow();
    const now = new Date().toISOString();

    const sessionId = runInTransaction(() => {
      let sess = db
        .prepare('SELECT id FROM attendance_sessions WHERE timetable_session_id = ? AND session_date = ?')
        .get(timetable_session_id, session_date) as { id: number } | undefined;

      if (!sess) {
        const info = db.prepare(`
          INSERT INTO attendance_sessions (
            client_uuid, timetable_session_id, session_date, teacher_id, subject_id, class_name, section, status, submitted_at, device_id, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'desktop-admin', ?)
        `).run(
          crypto.randomUUID(),
          timetable_session_id,
          session_date,
          tt.teacher_id,
          tt.subject_id,
          tt.class_name,
          tt.section,
          status || 'submitted',
          status === 'cancelled' ? null : now,
          notes || ''
        );
        sess = { id: Number(info.lastInsertRowid) };
      } else {
        db.prepare('UPDATE attendance_sessions SET status = ?, submitted_at = ?, notes = ? WHERE id = ?').run(
          status || 'submitted',
          now,
          notes || '',
          sess.id
        );
      }

      if (Array.isArray(records) && status !== 'cancelled') {
        for (const rec of records) {
          const existingRec = db
            .prepare('SELECT id, status FROM attendance_records WHERE session_id = ? AND student_id = ?')
            .get(sess.id, rec.student_id) as { id: number; status: string } | undefined;

          if (!existingRec) {
            const rInfo = db.prepare(`
              INSERT INTO attendance_records (client_uuid, session_id, student_id, status, remarks, marked_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(crypto.randomUUID(), sess.id, rec.student_id, rec.status, rec.remarks || '', now);

            if (inst.fine_rules?.autoGenerateFines) {
              if (rec.status === 'absent' && inst.fine_rules.absenceFineCents > 0) {
                db.prepare(`
                  INSERT OR IGNORE INTO fines (student_id, attendance_record_id, fine_type, amount_cents, status, reason, created_at)
                  VALUES (?, ?, 'Absence', ?, 'unpaid', ?, ?)
                `).run(
                  rec.student_id,
                  rInfo.lastInsertRowid,
                  inst.fine_rules.absenceFineCents,
                  `Unexcused absence on ${session_date}`,
                  now
                );
              } else if (rec.status === 'late' && inst.fine_rules.lateFineCents > 0) {
                db.prepare(`
                  INSERT OR IGNORE INTO fines (student_id, attendance_record_id, fine_type, amount_cents, status, reason, created_at)
                  VALUES (?, ?, 'Late Arrival', ?, 'unpaid', ?, ?)
                `).run(
                  rec.student_id,
                  rInfo.lastInsertRowid,
                  inst.fine_rules.lateFineCents,
                  `Late arrival on ${session_date}`,
                  now
                );
              }
            }
          } else if (existingRec.status !== rec.status) {
            db.prepare('UPDATE attendance_records SET status = ?, remarks = ?, marked_at = ? WHERE id = ?').run(
              rec.status,
              rec.remarks || '',
              now,
              existingRec.id
            );
            db.prepare(`
              INSERT INTO attendance_corrections (record_id, session_id, student_id, original_status, new_status, changed_by, reason, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?)
            `).run(
              existingRec.id,
              sess.id,
              rec.student_id,
              existingRec.status,
              rec.status,
              req.user!.name,
              'Updated via Desktop Attendance Console',
              now
            );
          }
        }
      }

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'MARK_ATTENDANCE_SESSION',
        entityType: 'attendance_session',
        entityId: String(sess.id),
        newValue: { session_date, status: status || 'submitted', count: records?.length || 0 },
      });

      return sess.id;
    });

    refreshSmartAlerts();
    res.json({ ok: true, sessionId });
  });

  router.post('/attendance/correct', requireAdmin, (req: AuthedRequest, res) => {
    const { record_id, new_status, reason } = req.body as { record_id: number; new_status: string; reason: string };
    if (!record_id || !new_status || !reason?.trim()) {
      res.status(400).json({ error: 'Record ID, new status, and a mandatory correction reason are required.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(record_id) as DbRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Attendance record not found.' });
      return;
    }
    const now = new Date().toISOString();
    runInTransaction(() => {
      db.prepare('UPDATE attendance_records SET status = ? WHERE id = ?').run(new_status, record_id);
      db.prepare(`
        INSERT INTO attendance_corrections (record_id, session_id, student_id, original_status, new_status, changed_by, reason, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?)
      `).run(record_id, existing.session_id, existing.student_id, existing.status, new_status, req.user!.name, reason.trim(), now);
      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'CORRECT_ATTENDANCE',
        entityType: 'attendance_record',
        entityId: String(record_id),
        prevValue: { status: existing.status },
        newValue: { status: new_status },
        reason: reason.trim(),
      });
    });
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Finance: Categories, Scholarships, Invoices, Payments & Receipts
  // --------------------------------------------------------------------------
  router.get('/finance/summary', requireAdmin, (_req, res) => {
    const categories = db.prepare('SELECT * FROM fee_categories ORDER BY id ASC').all();
    const scholarships = db.prepare(`
      SELECT sc.*, s.full_name AS student_name, s.student_code
      FROM scholarships sc JOIN students s ON s.id = sc.student_id
      ORDER BY sc.id DESC
    `).all();
    const invoices = db.prepare(`
      SELECT i.*, s.full_name AS student_name, s.student_code, s.class_name, s.section
      FROM invoices i JOIN students s ON s.id = i.student_id
      ORDER BY i.id DESC
    `).all();
    const payments = db.prepare(`
      SELECT p.*, s.full_name AS student_name, s.student_code, i.invoice_number
      FROM payments p
      JOIN students s ON s.id = p.student_id
      JOIN invoices i ON i.id = p.invoice_id
      ORDER BY p.id DESC
    `).all();

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(total_cents), 0) AS billedCents,
        COALESCE(SUM(paid_cents), 0) AS collectedCents,
        COALESCE(SUM(discount_cents), 0) AS discountsCents,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN total_cents - paid_cents ELSE 0 END), 0) AS overdueCents
      FROM invoices
    `).get() as Record<string, number>;

    res.json({
      categories,
      scholarships,
      invoices,
      payments,
      totals: {
        billedCents: totals.billedCents,
        collectedCents: totals.collectedCents,
        outstandingCents: Math.max(0, totals.billedCents - totals.collectedCents),
        overdueCents: totals.overdueCents,
        discountsCents: totals.discountsCents,
      },
    });
  });

  router.post('/fee-categories', requireAdmin, (req: AuthedRequest, res) => {
    const { name, frequency, default_amount } = req.body as { name: string; frequency: string; default_amount: number };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }
    const info = db.prepare('INSERT INTO fee_categories (name, frequency, default_amount_cents) VALUES (?, ?, ?)').run(
      name.trim(),
      frequency || 'Semester',
      toCents(default_amount || 0)
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CREATE_FEE_CATEGORY',
      entityType: 'fee_category',
      entityId: String(info.lastInsertRowid),
      newValue: req.body,
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.post('/scholarships', requireAdmin, (req: AuthedRequest, res) => {
    const { student_id, category, discount_type, value, reason, effective_date, expiry_date } = req.body as Record<string, string | number>;
    if (!student_id || !reason) {
      res.status(400).json({ error: 'Student and authorization reason are required.' });
      return;
    }
    const info = db.prepare(`
      INSERT INTO scholarships (student_id, category, discount_type, value, reason, effective_date, expiry_date, authorized_by, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      Number(student_id),
      String(category || 'Merit Scholarship'),
      String(discount_type || 'percentage'),
      Number(value || 0),
      String(reason),
      String(effective_date || new Date().toISOString().slice(0, 10)),
      String(expiry_date || ''),
      req.user!.name
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'GRANT_SCHOLARSHIP',
      entityType: 'scholarship',
      entityId: String(info.lastInsertRowid),
      newValue: req.body,
      reason: String(reason),
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.post('/invoices/generate', requireAdmin, (req: AuthedRequest, res) => {
    const { class_name, billing_period, due_date, items } = req.body as {
      class_name?: string;
      billing_period: string;
      due_date: string;
      items: Array<{ category: string; amount: number }>;
    };
    if (!billing_period || !due_date || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Billing period, due date, and at least one fee item are required.' });
      return;
    }

    const now = new Date().toISOString();
    const issueDate = now.slice(0, 10);
    const students = db
      .prepare(
        `SELECT * FROM students WHERE is_archived = 0 AND status = 'Active' ${class_name ? 'AND class_name = ?' : ''}`
      )
      .all(...(class_name ? [class_name] : [])) as Array<DbRow>;

    const cleanItems = items.map((i) => ({ category: i.category, amount_cents: toCents(i.amount) }));

    const result = runInTransaction(() => {
      let created = 0;
      let skippedExisting = 0;
      let baseCount = (db.prepare('SELECT COUNT(*) AS c FROM invoices').get() as { c: number }).c;

      for (const st of students) {
        const dup = db
          .prepare('SELECT id FROM invoices WHERE student_id = ? AND billing_period = ?')
          .get(st.id, billing_period);
        if (dup) {
          skippedExisting++;
          continue;
        }

        const activeScholarship = db
          .prepare('SELECT * FROM scholarships WHERE student_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1')
          .get(st.id) as { discount_type: 'percentage' | 'fixed' | 'waiver'; value: number } | undefined;

        const subtotal = cleanItems.reduce((s, i) => s + i.amount_cents, 0);
        const discountCents = activeScholarship
          ? calculateDiscountCents(subtotal, activeScholarship.discount_type, activeScholarship.value)
          : 0;
        const totals = calculateInvoiceTotals(cleanItems, discountCents, 0);
        baseCount++;
        const invNum = `INV-${issueDate.slice(0, 4)}-${String(1001 + baseCount)}`;

        db.prepare(`
          INSERT INTO invoices (
            invoice_number, student_id, billing_period, issue_date, due_date,
            subtotal_cents, discount_cents, late_fee_cents, total_cents, paid_cents, status, items_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)
        `).run(
          invNum,
          st.id,
          billing_period,
          issueDate,
          due_date,
          totals.subtotalCents,
          totals.discountCents,
          totals.totalCents,
          totals.totalCents === 0 ? 'paid' : 'unpaid',
          JSON.stringify(cleanItems),
          now
        );
        created++;
      }

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'GENERATE_INVOICES',
        entityType: 'invoice_batch',
        entityId: billing_period,
        newValue: { created, skippedExisting, class_name: class_name || 'All' },
      });

      return { created, skippedExisting };
    });

    refreshSmartAlerts();
    res.json(result);
  });

  router.post('/payments', requireAdmin, (req: AuthedRequest, res) => {
    const { invoice_id, amount, method, reference_no, notes } = req.body as {
      invoice_id: number;
      amount: number;
      method: string;
      reference_no?: string;
      notes?: string;
    };
    const amountCents = toCents(amount);
    if (!invoice_id || amountCents <= 0) {
      res.status(400).json({ error: 'Valid invoice and positive payment amount are required.' });
      return;
    }

    const now = new Date().toISOString();
    const result = runInTransaction(() => {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id) as DbRow | undefined;
      if (!inv) throw new Error('Invoice not found');

      const allocation = allocatePayment(Number(inv.total_cents), Number(inv.paid_cents), amountCents);
      const pCount = (db.prepare('SELECT COUNT(*) AS c FROM payments').get() as { c: number }).c;
      const receiptNumber = `RCP-${now.slice(0, 4)}-${String(pCount + 1).padStart(4, '0')}`;

      const pInfo = db.prepare(`
        INSERT INTO payments (receipt_number, invoice_id, student_id, amount_cents, method, reference_no, payment_date, received_by, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptNumber,
        invoice_id,
        inv.student_id,
        amountCents,
        method || 'Cash',
        reference_no || '',
        now.slice(0, 10),
        req.user!.name,
        notes || '',
        now
      );

      db.prepare('UPDATE invoices SET paid_cents = ?, status = ? WHERE id = ?').run(
        allocation.newPaidCents,
        allocation.status,
        invoice_id
      );

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'RECORD_PAYMENT',
        entityType: 'payment',
        entityId: receiptNumber,
        newValue: { invoice_number: inv.invoice_number, amountCents, method, newStatus: allocation.status },
      });

      return {
        receiptNumber,
        payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(pInfo.lastInsertRowid),
        invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id),
      };
    });

    refreshSmartAlerts();
    res.status(201).json(result);
  });

  router.post('/payments/:id/reverse', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body as { reason?: string };
    if (!reason?.trim()) {
      res.status(400).json({ error: 'Audit reason is required to reverse a financial payment.' });
      return;
    }
    const orig = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as DbRow | undefined;
    if (!orig || Number(orig.is_reversal) === 1) {
      res.status(404).json({ error: 'Original payment not found or already a reversal.' });
      return;
    }
    const alreadyReversed = db.prepare('SELECT id FROM payments WHERE reversed_payment_id = ?').get(id);
    if (alreadyReversed) {
      res.status(409).json({ error: 'This payment has already been reversed.' });
      return;
    }

    const now = new Date().toISOString();
    runInTransaction(() => {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(orig.invoice_id) as DbRow;
      const pCount = (db.prepare('SELECT COUNT(*) AS c FROM payments').get() as { c: number }).c;
      const revReceipt = `REV-${now.slice(0, 4)}-${String(pCount + 1).padStart(4, '0')}`;

      db.prepare(`
        INSERT INTO payments (receipt_number, invoice_id, student_id, amount_cents, method, reference_no, payment_date, received_by, is_reversal, reversed_payment_id, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        revReceipt,
        orig.invoice_id,
        orig.student_id,
        -Number(orig.amount_cents),
        String(orig.method),
        String(orig.receipt_number),
        now.slice(0, 10),
        req.user!.name,
        id,
        reason.trim(),
        now
      );

      const newPaid = Math.max(0, Number(inv.paid_cents) - Number(orig.amount_cents));
      const newStatus = newPaid <= 0 ? 'unpaid' : newPaid >= Number(inv.total_cents) ? 'paid' : 'partial';
      db.prepare('UPDATE invoices SET paid_cents = ?, status = ? WHERE id = ?').run(newPaid, newStatus, inv.id);

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'REVERSE_PAYMENT',
        entityType: 'payment',
        entityId: revReceipt,
        prevValue: orig,
        reason: reason.trim(),
      });
    });

    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Fines & Defaulters Center
  // --------------------------------------------------------------------------
  router.get('/fines', requireAdmin, (_req, res) => {
    const fines = db.prepare(`
      SELECT f.*, s.full_name AS student_name, s.student_code, s.class_name, s.section
      FROM fines f JOIN students s ON s.id = f.student_id
      ORDER BY f.id DESC
    `).all();
    res.json({ fines });
  });

  router.post('/fines', requireAdmin, (req: AuthedRequest, res) => {
    const { student_id, fine_type, amount, reason } = req.body as {
      student_id: number;
      fine_type: string;
      amount: number;
      reason: string;
    };
    const amountCents = toCents(amount);
    if (!student_id || amountCents <= 0 || !reason?.trim()) {
      res.status(400).json({ error: 'Student, positive fine amount, and reason are required.' });
      return;
    }
    const info = db.prepare(`
      INSERT INTO fines (student_id, fine_type, amount_cents, status, reason, created_at)
      VALUES (?, ?, ?, 'unpaid', ?, ?)
    `).run(student_id, fine_type || 'Manual', amountCents, reason.trim(), new Date().toISOString());
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'CREATE_MANUAL_FINE',
      entityType: 'fine',
      entityId: String(info.lastInsertRowid),
      newValue: req.body,
      reason: reason.trim(),
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.post('/fines/:id/waive', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body as { reason?: string };
    db.prepare("UPDATE fines SET status = 'waived', waived_by = ?, waive_reason = ? WHERE id = ?").run(
      req.user!.name,
      reason || 'Institutional waiver',
      id
    );
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'WAIVE_FINE',
      entityType: 'fine',
      entityId: String(id),
      reason: reason || 'Institutional waiver',
    });
    res.json({ ok: true });
  });

  router.post('/fines/:id/pay', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { amount } = req.body as { amount?: number };
    const fine = db.prepare('SELECT * FROM fines WHERE id = ?').get(id) as DbRow | undefined;
    if (!fine) {
      res.status(404).json({ error: 'Fine not found.' });
      return;
    }
    const payCents = amount ? toCents(amount) : Number(fine.amount_cents) - Number(fine.paid_cents);
    const newPaid = Math.min(Number(fine.amount_cents), Number(fine.paid_cents) + Math.max(0, payCents));
    const status = newPaid >= Number(fine.amount_cents) ? 'paid' : 'partial';
    db.prepare('UPDATE fines SET paid_cents = ?, status = ? WHERE id = ?').run(newPaid, status, id);
    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'PAY_FINE',
      entityType: 'fine',
      entityId: String(id),
      newValue: { paidCents: newPaid, status },
    });
    res.json({ ok: true });
  });

  router.get('/defaulters', requireAdmin, (req, res) => {
    const inst = getInstitutionSettingsRow();
    const threshold = Number(req.query.threshold || inst.attendance_rules?.warningThresholds?.[1] || 80);

    const feeDefaulters = db.prepare(`
      SELECT
        s.id AS student_id, s.student_code, s.full_name, s.class_name, s.section, s.semester, s.department, s.academic_year,
        s.phone, s.guardian_phone,
        COALESCE(SUM(i.total_cents - i.paid_cents), 0) AS outstanding_cents,
        COALESCE(SUM(CASE WHEN i.status = 'overdue' THEN i.total_cents - i.paid_cents ELSE 0 END), 0) AS overdue_cents,
        MIN(CASE WHEN i.total_cents > i.paid_cents THEN i.due_date ELSE NULL END) AS oldest_due_date,
        (SELECT COALESCE(SUM(f.amount_cents - f.paid_cents), 0) FROM fines f WHERE f.student_id = s.id AND f.status IN ('unpaid', 'partial')) AS unpaid_fines_cents
      FROM students s
      LEFT JOIN invoices i ON i.student_id = s.id
      WHERE s.is_archived = 0 AND s.status = 'Active'
      GROUP BY s.id
      HAVING outstanding_cents > 0 OR unpaid_fines_cents > 0
      ORDER BY outstanding_cents DESC
    `).all();

    const students = db.prepare("SELECT * FROM students WHERE is_archived = 0 AND status = 'Active'").all() as Array<DbRow>;
    const allRecs = db.prepare(`
      SELECT ar.student_id, ar.status, ases.status AS session_status, ases.session_date
      FROM attendance_records ar JOIN attendance_sessions ases ON ases.id = ar.session_id
    `).all() as Array<{ student_id: number; status: string; session_status: string; session_date: string }>;

    const byStu = new Map<number, typeof allRecs>();
    for (const r of allRecs) {
      const list = byStu.get(r.student_id) || [];
      list.push(r);
      byStu.set(r.student_id, list);
    }

    const attendanceDefaulters = students
      .map((st) => {
        const recs = byStu.get(Number(st.id)) || [];
        const stats = calculateAttendanceStats(recs, inst.attendance_rules);
        const streak = maxConsecutiveAbsences(recs);
        return {
          student_id: st.id,
          student_code: st.student_code,
          full_name: st.full_name,
          class_name: st.class_name,
          section: st.section,
          semester: st.semester,
          department: st.department,
          ...stats,
          consecutiveAbsences: streak,
        };
      })
      .filter((row) => row.totalSessions > 0 && (row.percentage < threshold || row.consecutiveAbsences >= 2))
      .sort((a, b) => a.percentage - b.percentage);

    res.json({
      threshold,
      availableThresholds: inst.attendance_rules?.warningThresholds || [90, 80, 75],
      feeDefaulters,
      attendanceDefaulters,
    });
  });

  // --------------------------------------------------------------------------
  // Promotion Wizard
  // --------------------------------------------------------------------------
  router.post('/promotions/preview', requireAdmin, (req, res) => {
    const { academic_year, class_name, semester, section } = req.body as Record<string, string>;
    let sql = "SELECT * FROM students WHERE is_archived = 0 AND status = 'Active'";
    const params: string[] = [];
    if (academic_year) {
      sql += ' AND academic_year = ?';
      params.push(academic_year);
    }
    if (class_name) {
      sql += ' AND class_name = ?';
      params.push(class_name);
    }
    if (semester) {
      sql += ' AND semester = ?';
      params.push(semester);
    }
    if (section) {
      sql += ' AND section = ?';
      params.push(section);
    }
    const students = db.prepare(sql).all(...params);
    res.json({ students });
  });

  router.post('/promotions/commit', requireAdmin, (req: AuthedRequest, res) => {
    const { decisions } = req.body as {
      decisions: Array<{
        student_id: number;
        action: 'promote' | 'repeat' | 'graduate' | 'withdraw' | 'transfer';
        target_academic_year: string;
        target_class_name: string;
        target_semester: string;
        target_section: string;
        notes?: string;
      }>;
    };
    if (!Array.isArray(decisions) || decisions.length === 0) {
      res.status(400).json({ error: 'No student promotion decisions provided.' });
      return;
    }

    const now = new Date().toISOString();
    const batchId = runInTransaction(() => {
      const beforeStudents: Array<DbRow> = [];
      const historyIds: number[] = [];

      const batchInfo = db.prepare(`
        INSERT INTO rollback_batches (operation_type, summary, affected_count, before_state_json, status, initiated_by, created_at)
        VALUES ('promotion_batch', ?, ?, '[]', 'available', ?, ?)
      `).run(`Promotion batch for ${decisions.length} student(s)`, decisions.length, req.user!.name, now);

      const bid = Number(batchInfo.lastInsertRowid);

      for (const d of decisions) {
        const prev = db.prepare('SELECT * FROM students WHERE id = ?').get(d.student_id) as DbRow | undefined;
        if (!prev) continue;
        beforeStudents.push(prev);

        const nextStatus =
          d.action === 'graduate'
            ? 'Graduated'
            : d.action === 'withdraw'
            ? 'Withdrawn'
            : d.action === 'transfer'
            ? 'Transferred'
            : 'Active';

        db.prepare(`
          UPDATE students SET
            academic_year = ?, class_name = ?, semester = ?, section = ?, status = ?, updated_at = ?
          WHERE id = ?
        `).run(
          d.target_academic_year || prev.academic_year,
          d.target_class_name || prev.class_name,
          d.target_semester || prev.semester,
          d.target_section || prev.section,
          nextStatus,
          now,
          d.student_id
        );

        const hInfo = db.prepare(`
          INSERT INTO enrollment_history (
            student_id, academic_year, department, program, class_name, semester, section, action_type, effective_date, notes, batch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          d.student_id,
          d.target_academic_year || prev.academic_year,
          prev.department,
          prev.program,
          d.target_class_name || prev.class_name,
          d.target_semester || prev.semester,
          d.target_section || prev.section,
          d.action.charAt(0).toUpperCase() + d.action.slice(1),
          now.slice(0, 10),
          d.notes || `Batch #${bid}`,
          bid
        );
        historyIds.push(Number(hInfo.lastInsertRowid));
      }

      db.prepare('UPDATE rollback_batches SET before_state_json = ? WHERE id = ?').run(
        JSON.stringify({ students: beforeStudents, historyIds }),
        bid
      );

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'COMMIT_PROMOTION_BATCH',
        entityType: 'rollback_batch',
        entityId: String(bid),
        newValue: { count: beforeStudents.length },
      });

      return bid;
    });

    res.json({ ok: true, batchId });
  });

  // --------------------------------------------------------------------------
  // Smart Alerts
  // --------------------------------------------------------------------------
  router.get('/alerts', requireAdmin, (_req, res) => {
    refreshSmartAlerts();
    const alerts = db.prepare('SELECT * FROM smart_alerts ORDER BY status ASC, id DESC').all();
    res.json({ alerts });
  });

  router.post('/alerts/:id/resolve', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { status } = req.body as { status?: 'resolved' | 'dismissed' };
    db.prepare('UPDATE smart_alerts SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(
      status || 'resolved',
      req.user!.name,
      new Date().toISOString(),
      id
    );
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Android Teacher Pairing, Local-Network Sync & Mobile APIs
  // --------------------------------------------------------------------------
  router.get('/sync/devices', requireAdmin, (_req, res) => {
    const devices = db.prepare(`
      SELECT pd.*, t.full_name AS teacher_name, t.employee_id
      FROM paired_devices pd JOIN teachers t ON t.id = pd.teacher_id
      ORDER BY pd.created_at DESC
    `).all();
    const logs = db.prepare(`
      SELECT sl.*, t.full_name AS teacher_name
      FROM sync_logs sl JOIN teachers t ON t.id = sl.teacher_id
      ORDER BY sl.synced_at DESC LIMIT 50
    `).all();
    const activeCodes = db.prepare(`
      SELECT pc.*, t.full_name AS teacher_name
      FROM pairing_codes pc JOIN teachers t ON t.id = pc.teacher_id
      WHERE pc.used = 0 ORDER BY pc.id DESC
    `).all();
    res.json({ devices, logs, activeCodes });
  });

  router.post('/sync/pair-code', requireAdmin, (req: AuthedRequest, res) => {
    const { teacher_id } = req.body as { teacher_id: number };
    const teacher = db.prepare('SELECT id, full_name FROM teachers WHERE id = ?').get(teacher_id) as
      | { id: number; full_name: string }
      | undefined;
    if (!teacher) {
      res.status(404).json({ error: 'Teacher not found.' });
      return;
    }
    const code = String(crypto.randomInt(100000, 999999));
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO pairing_codes (code, teacher_id, expires_at, used, created_at)
      VALUES (?, ?, ?, 0, ?)
    `).run(code, teacher_id, expires, now.toISOString());

    writeAuditLog({
      actor: req.user!.name,
      actorRole: req.user!.role,
      action: 'GENERATE_PAIRING_CODE',
      entityType: 'teacher',
      entityId: String(teacher_id),
      newValue: { expiresAt: expires },
    });

    res.json({ code, teacherName: teacher.full_name, expiresAt: expires });
  });

  // Mobile pairing (used by Native Android App)
  router.post('/mobile/pair', (req, res) => {
    const { code, device_id, device_name, app_version } = req.body as {
      code: string;
      device_id: string;
      device_name: string;
      app_version?: string;
    };
    if (!code || !device_id) {
      res.status(400).json({ error: 'Pairing code and device ID are required.' });
      return;
    }
    const row = db
      .prepare('SELECT * FROM pairing_codes WHERE code = ? AND used = 0 LIMIT 1')
      .get(code.trim()) as DbRow | undefined;
    if (!row || String(row.expires_at) < new Date().toISOString()) {
      res.status(401).json({ error: 'Invalid or expired pairing code.' });
      return;
    }
    const teacher = db.prepare("SELECT * FROM teachers WHERE id = ? AND status = 'Active'").get(row.teacher_id) as
      | DbRow
      | undefined;
    if (!teacher) {
      res.status(403).json({ error: 'Teacher account is inactive.' });
      return;
    }

    const now = new Date().toISOString();
    const rawDeviceSecret = crypto.randomBytes(24).toString('hex');
    const secretHash = crypto.createHash('sha256').update(rawDeviceSecret).digest('hex');

    runInTransaction(() => {
      db.prepare('UPDATE pairing_codes SET used = 1 WHERE id = ?').run(row.id);
      db.prepare(`
        INSERT INTO paired_devices (device_id, teacher_id, device_name, app_version, pairing_token_hash, last_sync_at, last_ip, status, pending_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'online', 0, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          teacher_id = excluded.teacher_id,
          device_name = excluded.device_name,
          pairing_token_hash = excluded.pairing_token_hash,
          status = 'online',
          last_sync_at = excluded.last_sync_at
      `).run(device_id, teacher.id, device_name || 'Android Device', app_version || '1.0.0', secretHash, now, req.ip || '', now);

      writeAuditLog({
        actor: String(teacher.full_name),
        actorRole: 'teacher',
        action: 'PAIR_ANDROID_DEVICE',
        entityType: 'device',
        entityId: device_id,
        source: 'android-teacher-app',
      });
    });

    const token = signToken({
      sub: String(teacher.employee_id),
      role: 'teacher',
      name: String(teacher.full_name),
      teacherId: Number(teacher.id),
      deviceId: device_id,
    });

    res.json({
      token,
      teacher: {
        id: teacher.id,
        employeeId: teacher.employee_id,
        fullName: teacher.full_name,
        department: teacher.department,
        photoUrl: teacher.photo_url,
      },
    });
  });

  // Mobile teacher login (Employee ID + password)
  router.post('/mobile/login', (req, res) => {
    const { employee_id, password, device_id, device_name } = req.body as {
      employee_id: string;
      password: string;
      device_id?: string;
      device_name?: string;
    };
    if (!employee_id || !password) {
      res.status(400).json({ error: 'Employee ID and password are required.' });
      return;
    }
    const teacher = db
      .prepare('SELECT * FROM teachers WHERE lower(employee_id) = lower(?) LIMIT 1')
      .get(employee_id.trim()) as DbRow | undefined;
    if (!teacher || teacher.status !== 'Active' || !verifyPassword(password, String(teacher.password_hash))) {
      res.status(401).json({ error: 'Invalid credentials or inactive teacher account.' });
      return;
    }
    const devId = device_id || `android-${teacher.employee_id}`;
    const now = new Date().toISOString();
    const secretHash = crypto.createHash('sha256').update(devId).digest('hex');

    db.prepare(`
      INSERT INTO paired_devices (device_id, teacher_id, device_name, app_version, pairing_token_hash, last_sync_at, last_ip, status, pending_count, created_at)
      VALUES (?, ?, ?, '1.0.0', ?, ?, ?, 'online', 0, ?)
      ON CONFLICT(device_id) DO UPDATE SET last_sync_at = excluded.last_sync_at, status = 'online'
    `).run(devId, teacher.id, device_name || 'Android Teacher Phone', secretHash, now, req.ip || '', now);

    const token = signToken({
      sub: String(teacher.employee_id),
      role: 'teacher',
      name: String(teacher.full_name),
      teacherId: Number(teacher.id),
      deviceId: devId,
    });
    res.json({
      token,
      teacher: {
        id: teacher.id,
        employeeId: teacher.employee_id,
        fullName: teacher.full_name,
        department: teacher.department,
        photoUrl: teacher.photo_url,
      },
    });
  });

  // Pull teacher's assigned timetable & assigned students ONLY (enforced on backend!)
  router.get('/sync/pull', requireTeacherOrAdmin, (req: AuthedRequest, res) => {
    const teacherId = req.user!.role === 'teacher' ? req.user!.teacherId : Number(req.query.teacher_id || 1);
    if (!teacherId) {
      res.status(400).json({ error: 'Teacher ID required.' });
      return;
    }

    const timetable = db.prepare(`
      SELECT ts.*, sub.course_code, sub.course_name
      FROM timetable_sessions ts
      JOIN subjects sub ON sub.id = ts.subject_id
      WHERE ts.teacher_id = ? AND ts.is_active = 1
      ORDER BY ts.day_of_week, ts.start_time
    `).all(teacherId) as Array<DbRow>;

    // Also include active substitutions where this teacher is the substitute
    const substitutions = db.prepare(`
      SELECT tsub.*, ts.day_of_week, ts.start_time, ts.end_time, ts.subject_id, ts.class_name, ts.semester, ts.section, ts.room,
        sub.course_code, sub.course_name
      FROM teacher_substitutions tsub
      JOIN timetable_sessions ts ON ts.id = tsub.timetable_session_id
      JOIN subjects sub ON sub.id = ts.subject_id
      WHERE tsub.substitute_teacher_id = ?
    `).all(teacherId);

    // Collect only cohorts assigned to this teacher
    const cohorts = new Set(timetable.map((t) => `${t.class_name}::${t.section}`));
    const allActiveStudents = db
      .prepare("SELECT id, student_code, full_name, class_name, semester, section, photo_url FROM students WHERE is_archived = 0 AND status = 'Active'")
      .all() as Array<DbRow>;
    const assignedStudents = allActiveStudents.filter((s) => cohorts.has(`${s.class_name}::${s.section}`));

    const inst = getInstitutionSettingsRow();
    res.json({
      serverTime: new Date().toISOString(),
      institutionName: inst.name,
      attendanceRules: inst.attendance_rules,
      timetable,
      substitutions,
      students: assignedStudents,
    });
  });

  // Idempotent transactional attendance sync endpoint for Android devices
  router.post('/sync/attendance', requireTeacherOrAdmin, (req: AuthedRequest, res) => {
    const { sync_uuid, device_id, sessions } = req.body as {
      sync_uuid: string;
      device_id: string;
      sessions: Array<{
        client_uuid: string;
        timetable_session_id: number;
        session_date: string;
        notes?: string;
        records: Array<{
          client_uuid: string;
          student_id: number;
          status: string;
          remarks?: string;
          marked_at?: string;
        }>;
      }>;
    };

    if (!sync_uuid || !Array.isArray(sessions)) {
      res.status(400).json({ error: 'sync_uuid and sessions array are required.' });
      return;
    }

    const teacherId = req.user!.role === 'teacher' ? req.user!.teacherId! : Number(req.body.teacher_id || 1);
    const devId = device_id || req.user!.deviceId || 'android-device';
    const inst = getInstitutionSettingsRow();
    const now = new Date().toISOString();

    // Check if this sync batch UUID was already committed
    const prevSync = db.prepare('SELECT * FROM sync_logs WHERE sync_uuid = ?').get(sync_uuid) as DbRow | undefined;
    if (prevSync) {
      res.json({
        ok: true,
        idempotentReplay: true,
        acceptedSessionUuids: sessions.map((s) => s.client_uuid),
        duplicateCount: sessions.length,
        conflictCount: 0,
      });
      return;
    }

    const outcome = runInTransaction(() => {
      let accepted = 0;
      let duplicates = 0;
      let conflicts = 0;
      const acceptedUuids: string[] = [];
      const conflictDetails: Array<{ client_uuid: string; reason: string }> = [];

      for (const s of sessions) {
        // Verify teacher owns the timetable session (or is an active substitute)
        const tt = db.prepare('SELECT * FROM timetable_sessions WHERE id = ?').get(s.timetable_session_id) as
          | DbRow
          | undefined;
        if (!tt) {
          conflicts++;
          conflictDetails.push({ client_uuid: s.client_uuid, reason: 'Timetable session no longer exists' });
          continue;
        }
        if (req.user!.role === 'teacher' && Number(tt.teacher_id) !== teacherId) {
          const isSub = db
            .prepare('SELECT id FROM teacher_substitutions WHERE timetable_session_id = ? AND substitution_date = ? AND substitute_teacher_id = ?')
            .get(s.timetable_session_id, s.session_date, teacherId);
          if (!isSub) {
            conflicts++;
            conflictDetails.push({ client_uuid: s.client_uuid, reason: 'Unauthorized: teacher not assigned to this session' });
            continue;
          }
        }

        const existingByUuid = db
          .prepare('SELECT id FROM attendance_sessions WHERE client_uuid = ?')
          .get(s.client_uuid) as { id: number } | undefined;
        if (existingByUuid) {
          duplicates++;
          acceptedUuids.push(s.client_uuid);
          continue;
        }

        // Detect conflict if a DIFFERENT device already submitted attendance for same timetable_session_id + session_date
        const existingSlot = db
          .prepare('SELECT id, status, client_uuid, device_id FROM attendance_sessions WHERE timetable_session_id = ? AND session_date = ?')
          .get(s.timetable_session_id, s.session_date) as DbRow | undefined;

        let targetSessionId: number;
        if (existingSlot && existingSlot.status === 'submitted' && existingSlot.client_uuid !== s.client_uuid) {
          conflicts++;
          conflictDetails.push({
            client_uuid: s.client_uuid,
            reason: `Conflict: session already submitted by device ${existingSlot.device_id}`,
          });
          continue;
        } else if (existingSlot) {
          db.prepare(`
            UPDATE attendance_sessions SET client_uuid = ?, status = 'submitted', submitted_at = ?, device_id = ?, notes = ?
            WHERE id = ?
          `).run(s.client_uuid, now, devId, s.notes || '', existingSlot.id);
          targetSessionId = Number(existingSlot.id);
        } else {
          const sInfo = db.prepare(`
            INSERT INTO attendance_sessions (
              client_uuid, timetable_session_id, session_date, teacher_id, subject_id, class_name, section, status, submitted_at, device_id, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)
          `).run(
            s.client_uuid,
            s.timetable_session_id,
            s.session_date,
            teacherId,
            tt.subject_id,
            tt.class_name,
            tt.section,
            now,
            devId,
            s.notes || ''
          );
          targetSessionId = Number(sInfo.lastInsertRowid);
        }

        for (const rec of s.records || []) {
          const dupRec = db.prepare('SELECT id FROM attendance_records WHERE client_uuid = ?').get(rec.client_uuid);
          if (dupRec) continue;

          const rInfo = db.prepare(`
            INSERT OR IGNORE INTO attendance_records (client_uuid, session_id, student_id, status, remarks, marked_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(rec.client_uuid, targetSessionId, rec.student_id, rec.status, rec.remarks || '', rec.marked_at || now);

          if (rInfo.changes > 0 && inst.fine_rules?.autoGenerateFines) {
            if (rec.status === 'absent' && inst.fine_rules.absenceFineCents > 0) {
              db.prepare(`
                INSERT OR IGNORE INTO fines (student_id, attendance_record_id, fine_type, amount_cents, status, reason, created_at)
                VALUES (?, ?, 'Absence', ?, 'unpaid', ?, ?)
              `).run(
                rec.student_id,
                rInfo.lastInsertRowid,
                inst.fine_rules.absenceFineCents,
                `Unexcused absence on ${s.session_date}`,
                now
              );
            }
          }
        }

        accepted++;
        acceptedUuids.push(s.client_uuid);
      }

      db.prepare(`
        INSERT INTO sync_logs (sync_uuid, device_id, teacher_id, payload_count, accepted_count, duplicate_count, conflict_count, status, error_details, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sync_uuid,
        devId,
        teacherId,
        sessions.length,
        accepted,
        duplicates,
        conflicts,
        conflicts > 0 ? 'partial_conflict' : 'success',
        conflictDetails.length > 0 ? JSON.stringify(conflictDetails) : '',
        now
      );

      db.prepare(`
        UPDATE paired_devices SET last_sync_at = ?, last_ip = ?, status = 'online', pending_count = 0, error_message = ?
        WHERE device_id = ?
      `).run(now, req.ip || '', conflictDetails.length > 0 ? conflictDetails[0].reason : '', devId);

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'SYNC_ANDROID_ATTENDANCE',
        entityType: 'sync_batch',
        entityId: sync_uuid,
        newValue: { accepted, duplicates, conflicts, devId },
        source: 'android-teacher-app',
      });

      return {
        ok: true,
        acceptedSessionUuids: acceptedUuids,
        acceptedCount: accepted,
        duplicateCount: duplicates,
        conflictCount: conflicts,
        conflictDetails,
      };
    });

    refreshSmartAlerts();
    res.json(outcome);
  });

  // --------------------------------------------------------------------------
  // Audit Logs & Rollback Recovery Center
  // --------------------------------------------------------------------------
  router.get('/audit-logs', requireAdmin, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    let sql = 'SELECT * FROM audit_logs';
    const params: string[] = [];
    if (search) {
      sql += ' WHERE lower(actor) LIKE ? OR lower(action) LIKE ? OR lower(entity_type) LIKE ? OR lower(reason) LIKE ?';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY id DESC LIMIT 200';
    res.json({ logs: db.prepare(sql).all(...params) });
  });

  router.get('/rollbacks', requireAdmin, (_req, res) => {
    const batches = db.prepare('SELECT id, operation_type, summary, affected_count, status, initiated_by, created_at, rolled_back_at FROM rollback_batches ORDER BY id DESC').all();
    res.json({ batches });
  });

  router.post('/rollbacks/:id/execute', requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const { reason } = req.body as { reason?: string };
    const batch = db.prepare('SELECT * FROM rollback_batches WHERE id = ?').get(id) as DbRow | undefined;
    if (!batch) {
      res.status(404).json({ error: 'Rollback batch not found.' });
      return;
    }
    if (batch.status === 'rolled_back') {
      res.status(409).json({ error: 'This operation has already been rolled back.' });
      return;
    }

    const beforeState = JSON.parse(String(batch.before_state_json || '{}')) as Record<string, unknown>;
    const now = new Date().toISOString();

    runInTransaction(() => {
      const op = String(batch.operation_type);
      if (op === 'excel_import') {
        const insertedIds = (beforeState.insertedIds as number[]) || [];
        for (const sid of insertedIds) {
          db.prepare('DELETE FROM students WHERE id = ?').run(sid);
        }
        const beforeUpdated = (beforeState.beforeUpdated as Array<DbRow>) || [];
        for (const prev of beforeUpdated) {
          db.prepare(`
            UPDATE students SET full_name = ?, guardian_name = ?, phone = ?, email = ?, class_name = ?, section = ?, updated_at = ?
            WHERE id = ?
          `).run(prev.full_name, prev.guardian_name, prev.phone, prev.email, prev.class_name, prev.section, now, prev.id);
        }
      } else if (op === 'bulk_student_update' || op === 'promotion_batch') {
        const prevStudents = (beforeState.students as Array<DbRow>) || [];
        for (const prev of prevStudents) {
          db.prepare(`
            UPDATE students SET
              academic_year = ?, class_name = ?, semester = ?, section = ?, status = ?, is_archived = ?, updated_at = ?
            WHERE id = ?
          `).run(
            prev.academic_year,
            prev.class_name,
            prev.semester,
            prev.section,
            prev.status,
            prev.is_archived,
            now,
            prev.id
          );
        }
        const historyIds = (beforeState.historyIds as number[]) || [];
        for (const hid of historyIds) {
          db.prepare('DELETE FROM enrollment_history WHERE id = ?').run(hid);
        }
      } else if (op === 'timetable_clone') {
        const insertedIds = (beforeState.insertedIds as number[]) || [];
        for (const tid of insertedIds) {
          db.prepare('UPDATE timetable_sessions SET is_active = 0 WHERE id = ?').run(tid);
        }
        const deactivatedIds = (beforeState.deactivatedIds as number[]) || [];
        for (const tid of deactivatedIds) {
          db.prepare('UPDATE timetable_sessions SET is_active = 1 WHERE id = ?').run(tid);
        }
      } else if (op === 'bulk_photo_upload') {
        const beforePhotos = (beforeState.beforePhotos as Array<{ id: number; photo_url: string }>) || [];
        for (const bp of beforePhotos) {
          db.prepare('UPDATE students SET photo_url = ?, updated_at = ? WHERE id = ?').run(bp.photo_url || '', now, bp.id);
        }
      }

      db.prepare("UPDATE rollback_batches SET status = 'rolled_back', rolled_back_at = ? WHERE id = ?").run(now, id);

      writeAuditLog({
        actor: req.user!.name,
        actorRole: req.user!.role,
        action: 'EXECUTE_ROLLBACK',
        entityType: 'rollback_batch',
        entityId: String(id),
        prevValue: { operation_type: op },
        reason: reason || 'Administrator compensating rollback',
      });
    });

    refreshSmartAlerts();
    res.json({ ok: true });
  });

  return router;
}
