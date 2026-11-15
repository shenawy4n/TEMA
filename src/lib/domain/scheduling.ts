import { DATE_PATTERN, TIME_PATTERN, isValidEntityId, sanitizeText } from '@/src/lib/firebase/validation';
import type {
  AttendanceRecord,
  AttendanceStatus,
  ClassSession,
  GroupEnrollment,
  Organization,
  OrganizationMember,
  SessionStatus,
  Student,
  StudyGroup,
} from '@/src/types/domain';
import { DomainValidationError } from './money';

const VALID_ATTENDANCE_STATUSES = new Set<AttendanceStatus>([
  'present',
  'absent',
  'late',
  'excused',
]);

const VALID_SESSION_STATUSES = new Set<SessionStatus>(['scheduled', 'completed', 'cancelled']);

export function isValidCalendarDate(isoDate: string): boolean {
  if (!DATE_PATTERN.test(isoDate)) return false;
  const [yStr, mStr, dStr] = isoDate.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidClockTime(hhmm: string): boolean {
  if (!TIME_PATTERN.test(hhmm)) return false;
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function assertValidSessionSchedule(date: string, startTime: string, endTime: string): void {
  if (!isValidCalendarDate(date)) {
    throw new DomainValidationError('تاريخ الحصة غير صالح.', 'INVALID_SESSION_DATE');
  }
  if (!isValidClockTime(startTime) || !isValidClockTime(endTime)) {
    throw new DomainValidationError('صيغة وقت البداية أو النهاية غير صالحة (HH:MM).', 'INVALID_SESSION_TIME');
  }
  if (endTime <= startTime) {
    throw new DomainValidationError(
      'وقت انتهاء الحصة يجب أن يكون بعد وقت البداية.',
      'SESSION_END_BEFORE_START'
    );
  }
}

export function assertValidSessionTransition(current: SessionStatus, next: SessionStatus): void {
  if (!VALID_SESSION_STATUSES.has(next)) {
    throw new DomainValidationError('حالة الحصة غير صالحة.', 'INVALID_SESSION_STATUS');
  }
  if (current === 'cancelled') {
    throw new DomainValidationError('الحصة الملغاة لا يمكن تعديل حالتها.', 'SESSION_CANCELLED', 409);
  }
  if (current === 'completed' && next !== 'completed') {
    throw new DomainValidationError('لا يمكن إعادة الحصة المكتملة إلى حالة سابقة.', 'SESSION_COMPLETED_IMMUTABLE', 409);
  }
}

export function assertValidGroupTeacher(
  teacherMember: OrganizationMember | null | undefined,
  organizationId: string
): OrganizationMember {
  if (
    !teacherMember ||
    teacherMember.organizationId !== organizationId ||
    teacherMember.status !== 'active' ||
    !['owner', 'teacher'].includes(teacherMember.role)
  ) {
    throw new DomainValidationError(
      'المدرس المحدد يجب أن يكون عضواً نشطاً بدور مالك أو مدرس في نفس المنظمة.',
      'INVALID_GROUP_TEACHER'
    );
  }
  return teacherMember;
}

export function assertCanEnrollStudent(
  group: StudyGroup,
  student: Student,
  existingEnrollment: GroupEnrollment | null,
  activeEnrollmentCountForGroup: number
): void {
  if (group.organizationId !== student.organizationId) {
    throw new DomainValidationError('عدم تطابق المنظمة بين الطالب والمجموعة.', 'TENANT_MISMATCH', 403);
  }
  if (group.status !== 'active') {
    throw new DomainValidationError(
      'لا يمكن تسجيل طلاب في مجموعة متوقفة أو مؤرشفة.',
      'GROUP_NOT_ACTIVE',
      409
    );
  }
  if (student.status !== 'active') {
    throw new DomainValidationError(
      'لا يمكن تسجيل طالب غير نشط أو مؤرشف في مجموعة دراسية.',
      'STUDENT_NOT_ACTIVE',
      409
    );
  }
  if (existingEnrollment && existingEnrollment.status === 'active') {
    throw new DomainValidationError(
      'الطالب مسجل بالفعل في هذه المجموعة.',
      'DUPLICATE_ENROLLMENT',
      409
    );
  }
  if (activeEnrollmentCountForGroup >= group.capacity) {
    throw new DomainValidationError(
      `المجموعة وصلت إلى السعة القصوى (${group.capacity} طالب).`,
      'GROUP_CAPACITY_EXCEEDED',
      409
    );
  }
}

export function assertCanMarkAttendance(params: {
  organizationId: string;
  session: ClassSession | null | undefined;
  student: Student | null | undefined;
  enrollment: GroupEnrollment | null | undefined;
  status: AttendanceStatus;
}): void {
  const { organizationId, session, student, enrollment, status } = params;

  if (!VALID_ATTENDANCE_STATUSES.has(status)) {
    throw new DomainValidationError('حالة الحضور غير صالحة.', 'INVALID_ATTENDANCE_STATUS');
  }
  if (!session || session.organizationId !== organizationId) {
    throw new DomainValidationError('الحصة غير موجودة داخل هذه المنظمة.', 'SESSION_NOT_FOUND', 404);
  }
  if (session.status === 'cancelled') {
    throw new DomainValidationError(
      'لا يمكن تسجيل الحضور لحصة ملغاة.',
      'SESSION_CANCELLED',
      409
    );
  }
  if (!student || student.organizationId !== organizationId) {
    throw new DomainValidationError('الطالب غير موجود داخل هذه المنظمة.', 'STUDENT_NOT_FOUND', 404);
  }
  if (student.status !== 'active') {
    throw new DomainValidationError(
      'لا يمكن تسجيل حضور لطالب غير نشط أو مؤرشف.',
      'STUDENT_NOT_ACTIVE',
      409
    );
  }
  if (
    !enrollment ||
    enrollment.organizationId !== organizationId ||
    enrollment.groupId !== session.groupId ||
    enrollment.studentId !== student.id ||
    enrollment.status !== 'active'
  ) {
    throw new DomainValidationError(
      `الطالب "${student.fullName}" غير مسجل في مجموعة هذه الحصة.`,
      'STUDENT_NOT_ENROLLED_IN_GROUP',
      409
    );
  }
}

export interface AttendanceSummaryMetrics {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  attendanceRatePercent: number;
}

/**
 * Computes accurate attendance statistics, excluding records belonging to cancelled sessions
 * and deduplicating by deterministic (sessionId, studentId) key.
 */
export function calculateAttendanceMetrics(
  records: AttendanceRecord[],
  sessions: ClassSession[]
): AttendanceSummaryMetrics {
  const cancelledSessionIds = new Set(
    sessions.filter((s) => s.status === 'cancelled').map((s) => s.id)
  );
  const deduped = new Map<string, AttendanceRecord>();

  for (const record of records) {
    if (cancelledSessionIds.has(record.sessionId)) continue;
    const key = `${record.sessionId}_${record.studentId}`;
    deduped.set(key, record);
  }

  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;

  for (const r of deduped.values()) {
    if (r.status === 'present') present += 1;
    else if (r.status === 'late') late += 1;
    else if (r.status === 'absent') absent += 1;
    else if (r.status === 'excused') excused += 1;
  }

  const total = present + late + absent + excused;
  const countable = present + late + absent;
  const attendanceRatePercent =
    countable > 0 ? Math.round(((present + late) / countable) * 100) : total > 0 ? 100 : 0;

  return {
    total,
    present,
    late,
    absent,
    excused,
    attendanceRatePercent,
  };
}

export interface GroupCountDiscrepancy {
  groupId: string;
  groupName: string;
  storedStudentCount: number;
  actualEnrolledCount: number;
  delta: number;
}

export interface OrganizationReconciliationReport {
  organizationId: string;
  storedTotalStudents: number | null;
  actualTotalStudents: number;
  storedActiveStudents: number | null;
  actualActiveStudents: number;
  storedInactiveStudents: number | null;
  actualInactiveStudents: number;
  storedArchivedStudents: number | null;
  actualArchivedStudents: number;
  totalActiveGroupEnrollments: number;
  groupDiscrepancies: GroupCountDiscrepancy[];
  hasDiscrepancies: boolean;
}

export function computeOrganizationCountReconciliation(
  organization: Pick<
    Organization,
    'id' | 'totalStudentsCount' | 'activeStudentsCount' | 'inactiveStudentsCount' | 'archivedStudentsCount'
  >,
  students: Student[],
  groups: StudyGroup[],
  enrollments: GroupEnrollment[]
): OrganizationReconciliationReport {
  const actualTotalStudents = students.length;
  const actualActiveStudents = students.filter((s) => s.status === 'active').length;
  const actualInactiveStudents = students.filter((s) => s.status === 'inactive').length;
  const actualArchivedStudents = students.filter((s) => s.status === 'archived').length;

  const activeStudentIds = new Set(
    students.filter((s) => s.status === 'active').map((s) => s.id)
  );

  const activeEnrollmentsByGroup = new Map<string, Set<string>>();
  let totalActiveGroupEnrollments = 0;

  for (const enr of enrollments) {
    if (enr.status !== 'active') continue;
    if (!activeStudentIds.has(enr.studentId)) continue;
    let set = activeEnrollmentsByGroup.get(enr.groupId);
    if (!set) {
      set = new Set<string>();
      activeEnrollmentsByGroup.set(enr.groupId, set);
    }
    if (!set.has(enr.studentId)) {
      set.add(enr.studentId);
      totalActiveGroupEnrollments += 1;
    }
  }

  const groupDiscrepancies: GroupCountDiscrepancy[] = [];
  for (const g of groups) {
    const actualEnrolledCount = activeEnrollmentsByGroup.get(g.id)?.size ?? 0;
    const storedStudentCount = typeof g.studentCount === 'number' ? g.studentCount : 0;
    if (storedStudentCount !== actualEnrolledCount) {
      groupDiscrepancies.push({
        groupId: g.id,
        groupName: g.name,
        storedStudentCount,
        actualEnrolledCount,
        delta: actualEnrolledCount - storedStudentCount,
      });
    }
  }

  const storedTotalStudents =
    typeof organization.totalStudentsCount === 'number' ? organization.totalStudentsCount : null;
  const storedActiveStudents =
    typeof organization.activeStudentsCount === 'number' ? organization.activeStudentsCount : null;
  const storedInactiveStudents =
    typeof organization.inactiveStudentsCount === 'number' ? organization.inactiveStudentsCount : null;
  const storedArchivedStudents =
    typeof organization.archivedStudentsCount === 'number' ? organization.archivedStudentsCount : null;

  const orgCountsMismatch =
    storedTotalStudents !== actualTotalStudents ||
    storedActiveStudents !== actualActiveStudents ||
    storedInactiveStudents !== actualInactiveStudents ||
    storedArchivedStudents !== actualArchivedStudents;

  return {
    organizationId: organization.id,
    storedTotalStudents,
    actualTotalStudents,
    storedActiveStudents,
    actualActiveStudents,
    storedInactiveStudents,
    actualInactiveStudents,
    storedArchivedStudents,
    actualArchivedStudents,
    totalActiveGroupEnrollments,
    groupDiscrepancies,
    hasDiscrepancies: orgCountsMismatch || groupDiscrepancies.length > 0,
  };
}

export function validateCreateSessionInput(input: {
  groupId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
}) {
  if (!isValidEntityId(input.groupId)) {
    throw new DomainValidationError('معرّف المجموعة غير صالح.', 'INVALID_GROUP_ID');
  }
  const title = sanitizeText(input.title || '', 150);
  if (title.length < 2) {
    throw new DomainValidationError('عنوان الحصة يجب أن يكون حرفين على الأقل.', 'INVALID_SESSION_TITLE');
  }
  assertValidSessionSchedule(input.date, input.startTime, input.endTime);

  return {
    groupId: input.groupId,
    title,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    room: sanitizeText(input.room || '', 80),
  };
}
