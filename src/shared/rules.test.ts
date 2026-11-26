import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents,
  fromCents,
  calculateDiscountCents,
  calculateInvoiceTotals,
  allocatePayment,
  detectTimetableConflicts,
  findPotentialDuplicates,
  calculateAttendanceStats,
  maxConsecutiveAbsences,
  validateStudentImportRow,
} from './rules';

test('financial decimal math avoids IEEE-754 drift', () => {
  const a = toCents(19.99);
  const b = toCents(0.02);
  assert.equal(a + b, 2001);
  assert.equal(fromCents(a + b), 20.01);

  const discount = calculateDiscountCents(150000, 'percentage', 15);
  assert.equal(discount, 22500);

  const totals = calculateInvoiceTotals(
    [{ amount_cents: 100000 }, { amount_cents: 50000 }],
    discount,
    2500
  );
  assert.equal(totals.subtotalCents, 150000);
  assert.equal(totals.totalCents, 130000);

  const partial = allocatePayment(totals.totalCents, 0, 50000);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.remainingCents, 80000);

  const paid = allocatePayment(totals.totalCents, partial.newPaidCents, 80000);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.remainingCents, 0);
});

test('timetable conflict detection flags teacher, class, room, and invalid time', () => {
  const conflicts = detectTimetableConflicts([
    {
      id: 1,
      day_of_week: 'Monday',
      start_time: '09:00',
      end_time: '10:00',
      subject_id: 1,
      teacher_id: 10,
      teacher_name: 'Dr. Meera',
      class_name: 'BSCS',
      semester: 'Sem 1',
      section: 'A',
      room: 'R-101',
    },
    {
      id: 2,
      day_of_week: 'Monday',
      start_time: '09:30',
      end_time: '10:30',
      subject_id: 2,
      teacher_id: 10,
      teacher_name: 'Dr. Meera',
      class_name: 'BSCS',
      semester: 'Sem 1',
      section: 'B',
      room: 'R-101',
    },
    {
      id: 3,
      day_of_week: 'Tuesday',
      start_time: '11:00',
      end_time: '10:00',
      subject_id: 3,
      teacher_id: 11,
      class_name: 'BSCS',
      semester: 'Sem 1',
      section: 'A',
      room: 'R-102',
    },
  ]);

  const types = conflicts.map((c) => c.type);
  assert.ok(types.includes('teacher_conflict'));
  assert.ok(types.includes('room_conflict'));
  assert.ok(types.includes('invalid_time'));
});

test('duplicate detection identifies exact ID and fuzzy name + guardian matches', () => {
  const matches = findPotentialDuplicates([
    {
      id: 1,
      student_code: 'STU001',
      full_name: 'Amina Farooq',
      guardian_name: 'Farooq Ahmed',
      phone: '555-0101',
      guardian_phone: '555-0901',
      email: 'amina@example.edu',
      class_name: 'BSCS',
      section: 'A',
      dob: '2005-04-12',
      photo_url: '',
    },
    {
      id: 2,
      student_code: 'STU099',
      full_name: 'Amina Farooque',
      guardian_name: 'Farooq Ahmad',
      phone: '555-9999',
      guardian_phone: '555-0901',
      email: 'amina2@example.edu',
      class_name: 'BSCS',
      section: 'A',
      dob: '2005-04-12',
      photo_url: '',
    },
  ]);

  assert.equal(matches.length, 1);
  assert.ok(matches[0].score >= 0.85);
});

test('attendance calculation respects cancelled sessions and consecutive absences', () => {
  const records = [
    { status: 'present', session_status: 'submitted', session_date: '2026-11-01' },
    { status: 'absent', session_status: 'submitted', session_date: '2026-11-02' },
    { status: 'absent', session_status: 'submitted', session_date: '2026-11-03' },
    { status: 'absent', session_status: 'cancelled', session_date: '2026-11-04' },
    { status: 'excused', session_status: 'submitted', session_date: '2026-11-05' },
  ];

  const stats = calculateAttendanceStats(records, { countExcusedAsPresent: true, excludeCancelled: true });
  assert.equal(stats.totalSessions, 4);
  assert.equal(stats.cancelledExcluded, 1);
  assert.equal(stats.percentage, 50);
  assert.equal(maxConsecutiveAbsences(records), 2);
});

test('Excel import validation blocks missing required fields and detects existing IDs', () => {
  const existingCodes = new Set(['stu001']);
  const existingNames = new Map([['stu001', 'Amina Farooq']]);

  const blocked = validateStudentImportRow(
    { 'Student ID': 'STU500', 'Full Name': '' },
    2,
    ['Student ID', 'Full Name', 'Class'],
    existingCodes,
    existingNames
  );
  assert.equal(blocked.valid, false);
  assert.equal(blocked.action, 'blocked');
  assert.equal(blocked.errors.length, 2);

  const duplicateId = validateStudentImportRow(
    { 'Student ID': 'STU001', 'Full Name': 'Amina Farooq', Class: 'BSCS' },
    3,
    ['Student ID', 'Full Name', 'Class'],
    existingCodes,
    existingNames
  );
  assert.equal(duplicateId.valid, true);
  assert.equal(duplicateId.action, 'skip_existing');
  assert.ok(duplicateId.warnings.length >= 1);
});
