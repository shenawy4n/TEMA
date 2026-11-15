import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../server/app';
import type { TemaDataStore } from '../server/api/temaRoutes';
import { SERVER_TIMESTAMP_SENTINEL, type RestWriteInstruction } from '../server/api/firestoreRest';
import { DomainValidationError } from '../src/lib/domain/money';
import {
  assertPermission,
  assertVerifiedMembership,
  hasPermission,
  RBAC_MATRIX,
  sanitizeAuditMetadata,
  type TemaPermission,
} from '../src/lib/domain/rbac';
import {
  assertCanEnrollStudent,
  assertCanMarkAttendance,
  assertValidSessionSchedule,
  assertValidSessionTransition,
  calculateAttendanceMetrics,
  computeOrganizationCountReconciliation,
  isValidCalendarDate,
} from '../src/lib/domain/scheduling';
import type {
  AttendanceRecord,
  ClassSession,
  GroupEnrollment,
  MemberRole,
  Organization,
  OrganizationMember,
  Student,
  StudyGroup,
} from '../src/types/domain';

function createMemoryStore(initial: Record<string, Record<string, unknown>>) {
  const docs = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(initial)) docs.set(k, structuredClone(v));

  const store: TemaDataStore = {
    async getDoc<T>(docPath: string): Promise<T | null> {
      const val = docs.get(docPath);
      return val ? (structuredClone(val) as T) : null;
    },
    async listCollection<T>(colPath: string): Promise<T[]> {
      const prefix = `${colPath}/`;
      const out: T[] = [];
      for (const [k, v] of docs.entries()) {
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
          out.push(structuredClone(v) as T);
        }
      }
      return out;
    },
    async commitWrites(writes: RestWriteInstruction[]): Promise<void> {
      for (const w of writes) {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(w.data)) {
          clean[k] = v === SERVER_TIMESTAMP_SENTINEL ? '2026-11-15T12:00:00.000Z' : v;
        }
        if (w.type === 'set') {
          docs.set(w.path, clean);
        } else {
          docs.set(w.path, { ...(docs.get(w.path) ?? {}), ...clean });
        }
      }
    },
  };
  return { store, docs };
}

async function withServer(
  app: ReturnType<typeof createApiApp>,
  run: (baseUrl: string) => Promise<void>
) {
  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  try {
    const addr = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('TEMA RBAC, Scheduling, Enrollment, Count Integrity & API Tests', () => {
  it('1. enforces complete 9-domain RBAC matrix across owner, teacher, assistant, and accountant', () => {
    const allPermissions = Object.keys(RBAC_MATRIX) as TemaPermission[];
    expect(allPermissions.length).toBeGreaterThanOrEqual(30);

    // Owner has all permissions
    for (const perm of allPermissions) {
      expect(hasPermission('owner', perm)).toBe(true);
    }

    // Teacher cannot access payments, expenses, staff management, or audit logs
    expect(hasPermission('teacher', 'students:create')).toBe(true);
    expect(hasPermission('teacher', 'attendance:write')).toBe(true);
    expect(hasPermission('teacher', 'payments:read')).toBe(false);
    expect(hasPermission('teacher', 'expenses:create')).toBe(false);
    expect(hasPermission('teacher', 'staff:manage_members')).toBe(false);
    expect(hasPermission('teacher', 'students:delete')).toBe(false);

    // Assistant can collect payments & manage students/groups, but cannot reverse/void or manage expenses/staff
    expect(hasPermission('assistant', 'payments:create')).toBe(true);
    expect(hasPermission('assistant', 'payments:settle')).toBe(true);
    expect(hasPermission('assistant', 'payments:reverse')).toBe(false);
    expect(hasPermission('assistant', 'expenses:read')).toBe(false);
    expect(hasPermission('assistant', 'staff:invite')).toBe(false);

    // Accountant manages finance/reconciliation/audit, read-only on students/groups/sessions
    expect(hasPermission('accountant', 'payments:reverse')).toBe(true);
    expect(hasPermission('accountant', 'expenses:create')).toBe(true);
    expect(hasPermission('accountant', 'financial_reports:reconcile')).toBe(true);
    expect(hasPermission('accountant', 'audit_logs:read')).toBe(true);
    expect(hasPermission('accountant', 'students:create')).toBe(false);
    expect(hasPermission('accountant', 'attendance:write')).toBe(false);

    const suspendedMember: OrganizationMember = {
      uid: 'u1',
      organizationId: 'org_1',
      displayName: 'Suspended',
      email: 's@tema.edu.eg',
      role: 'owner',
      status: 'suspended',
      createdAt: null,
      updatedAt: null,
    };
    expect(() => assertVerifiedMembership(suspendedMember, 'org_1', 'u1')).toThrow(DomainValidationError);
    expect(() => assertPermission(suspendedMember, 'org_1', 'u1', 'students:read')).toThrow(
      DomainValidationError
    );
  });

  it('2. sanitizes audit metadata to strip credentials, tokens, and API key patterns', () => {
    const cleaned = sanitizeAuditMetadata({
      actionBy: 'owner',
      password: 'plain_password',
      apiKey: 'AIzaSyFakeKey12345678901234567890',
      authorizationHeader: 'Bearer eyJhbGciOi.fake.token',
      nested: {
        secretToken: 'should_drop',
        note: 'Bearer xyz123 and AIzaSyFakeKey12345678901234567890',
      },
    });
    expect(cleaned).toBeDefined();
    expect(cleaned).not.toHaveProperty('password');
    expect(cleaned).not.toHaveProperty('apiKey');
    expect(cleaned).not.toHaveProperty('authorizationHeader');
    const nested = cleaned?.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty('secretToken');
    expect(String(nested.note)).not.toContain('AIzaSyFakeKey');
    expect(String(nested.note)).toContain('[REDACTED]');
  });

  it('3. rejects invalid calendar dates, endTime <= startTime, and illegal session transitions', () => {
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
    expect(isValidCalendarDate('2025-02-29')).toBe(false);
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
    expect(isValidCalendarDate('2026-04-31')).toBe(false);

    expect(() => assertValidSessionSchedule('2026-02-30', '16:00', '18:00')).toThrow(
      DomainValidationError
    );
    expect(() => assertValidSessionSchedule('2026-11-20', '18:00', '16:00')).toThrow(
      DomainValidationError
    );
    expect(() => assertValidSessionSchedule('2026-11-20', '16:00', '16:00')).toThrow(
      DomainValidationError
    );

    expect(() => assertValidSessionTransition('cancelled', 'scheduled')).toThrow(DomainValidationError);
    expect(() => assertValidSessionTransition('completed', 'scheduled')).toThrow(DomainValidationError);
  });

  it('4. prevents duplicate/over-capacity enrollments, blocks cancelled-session attendance, and excludes cancelled sessions from metrics', () => {
    const group: StudyGroup = {
      id: 'grp_1',
      organizationId: 'org_1',
      name: 'فيزياء 3ث',
      subject: 'فيزياء',
      gradeLevel: 'الثالث الثانوي',
      teacherId: 't_1',
      teacherName: 'أ. محمد',
      capacity: 1,
      studentCount: 1,
      monthlyFee: 350,
      status: 'active',
      createdBy: 't_1',
      createdAt: null,
      updatedAt: null,
    };
    const student: Student = {
      id: 'stu_1',
      organizationId: 'org_1',
      fullName: 'يوسف',
      phone: '01011112222',
      gradeLevel: 'الثالث الثانوي',
      status: 'active',
      createdBy: 't_1',
      createdAt: null,
      updatedAt: null,
    };

    // Capacity exceeded when group.studentCount === capacity
    expect(() => assertCanEnrollStudent(group, student, null, 1)).toThrow(DomainValidationError);

    // Duplicate enrollment
    const activeEnr: GroupEnrollment = {
      id: 'grp_1_stu_1',
      organizationId: 'org_1',
      groupId: 'grp_1',
      studentId: 'stu_1',
      studentName: 'يوسف',
      groupName: 'فيزياء 3ث',
      status: 'active',
      enrolledBy: 't_1',
      enrolledAt: null,
      createdAt: null,
      updatedAt: null,
    };
    expect(() =>
      assertCanEnrollStudent({ ...group, capacity: 10 }, student, activeEnr, 1)
    ).toThrow(DomainValidationError);

    // Cancelled session & unenrolled student checks
    const cancelledSession: ClassSession = {
      id: 'ses_cancel',
      organizationId: 'org_1',
      groupId: 'grp_1',
      groupName: 'فيزياء 3ث',
      teacherId: 't_1',
      teacherName: 'أ. محمد',
      title: 'حصة ملغاة',
      date: '2026-11-20',
      startTime: '16:00',
      endTime: '18:00',
      status: 'cancelled',
      createdBy: 't_1',
      createdAt: null,
      updatedAt: null,
    };
    const activeSession: ClassSession = { ...cancelledSession, id: 'ses_ok', status: 'scheduled' };

    expect(() =>
      assertCanMarkAttendance({
        organizationId: 'org_1',
        session: cancelledSession,
        student,
        enrollment: activeEnr,
        status: 'present',
      })
    ).toThrow(DomainValidationError);

    expect(() =>
      assertCanMarkAttendance({
        organizationId: 'org_1',
        session: activeSession,
        student,
        enrollment: null,
        status: 'present',
      })
    ).toThrow(DomainValidationError);

    const records: AttendanceRecord[] = [
      {
        id: 'ses_cancel_stu_1',
        organizationId: 'org_1',
        sessionId: 'ses_cancel',
        studentId: 'stu_1',
        studentName: 'يوسف',
        groupId: 'grp_1',
        status: 'absent',
        recordedBy: 't_1',
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'ses_ok_stu_1',
        organizationId: 'org_1',
        sessionId: 'ses_ok',
        studentId: 'stu_1',
        studentName: 'يوسف',
        groupId: 'grp_1',
        status: 'present',
        recordedBy: 't_1',
        createdAt: null,
        updatedAt: null,
      },
    ];
    const metrics = calculateAttendanceMetrics(records, [cancelledSession, activeSession]);
    expect(metrics.total).toBe(1);
    expect(metrics.present).toBe(1);
    expect(metrics.absent).toBe(0);
    expect(metrics.attendanceRatePercent).toBe(100);
  });

  it('5. detects count discrepancies and reconciles stored counters via Express API', async () => {
    const org: Organization = {
      id: 'org_1',
      name: 'سنتر الأمل',
      type: 'educational_center',
      ownerId: 'uid_owner',
      ownerName: 'أ. كريم',
      phone: '01001234567',
      email: 'owner@tema.edu.eg',
      city: 'القاهرة',
      currency: 'EGP',
      language: 'ar',
      themePreference: 'light',
      academicYear: '2026-2027',
      status: 'active',
      totalStudentsCount: 99, // drifted!
      activeStudentsCount: 50, // drifted!
      inactiveStudentsCount: 0,
      archivedStudentsCount: 0,
      createdAt: null,
      updatedAt: null,
    };

    const students: Student[] = [
      {
        id: 'stu_1',
        organizationId: 'org_1',
        fullName: 'طالب 1',
        phone: '01011111111',
        gradeLevel: '3 ثانوي',
        status: 'active',
        createdBy: 'uid_owner',
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'stu_2',
        organizationId: 'org_1',
        fullName: 'طالب 2',
        phone: '01022222222',
        gradeLevel: '3 ثانوي',
        status: 'archived',
        createdBy: 'uid_owner',
        createdAt: null,
        updatedAt: null,
      },
    ];

    const groups: StudyGroup[] = [
      {
        id: 'grp_1',
        organizationId: 'org_1',
        name: 'مجموعة أ',
        subject: 'كيمياء',
        gradeLevel: '3 ثانوي',
        teacherId: 'uid_owner',
        teacherName: 'أ. كريم',
        capacity: 10,
        studentCount: 7, // drifted! actual active enrolled = 1
        monthlyFee: 300,
        status: 'active',
        createdBy: 'uid_owner',
        createdAt: null,
        updatedAt: null,
      },
    ];

    const enrollments: GroupEnrollment[] = [
      {
        id: 'grp_1_stu_1',
        organizationId: 'org_1',
        groupId: 'grp_1',
        studentId: 'stu_1',
        studentName: 'طالب 1',
        groupName: 'مجموعة أ',
        status: 'active',
        enrolledBy: 'uid_owner',
        enrolledAt: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'grp_1_stu_2',
        organizationId: 'org_1',
        groupId: 'grp_1',
        studentId: 'stu_2', // archived student should not count even if doc stayed active
        studentName: 'طالب 2',
        groupName: 'مجموعة أ',
        status: 'active',
        enrolledBy: 'uid_owner',
        enrolledAt: null,
        createdAt: null,
        updatedAt: null,
      },
    ];

    const report = computeOrganizationCountReconciliation(org, students, groups, enrollments);
    expect(report.hasDiscrepancies).toBe(true);
    expect(report.actualTotalStudents).toBe(2);
    expect(report.actualActiveStudents).toBe(1);
    expect(report.actualArchivedStudents).toBe(1);
    expect(report.groupDiscrepancies).toHaveLength(1);
    expect(report.groupDiscrepancies[0].actualEnrolledCount).toBe(1);

    const { store, docs } = createMemoryStore({
      'organizations/org_1': org as unknown as Record<string, unknown>,
      'organizations/org_1/students/stu_1': students[0] as unknown as Record<string, unknown>,
      'organizations/org_1/students/stu_2': students[1] as unknown as Record<string, unknown>,
      'organizations/org_1/groups/grp_1': groups[0] as unknown as Record<string, unknown>,
      'organizations/org_1/enrollments/grp_1_stu_1': enrollments[0] as unknown as Record<string, unknown>,
    });

    const roleByToken: Record<string, { uid: string; role: MemberRole }> = {
      tok_assistant: { uid: 'uid_assistant', role: 'assistant' },
      tok_owner: { uid: 'uid_owner', role: 'owner' },
    };

    const app = createApiApp({
      temaApiDeps: {
        store,
        verifyToken: async (h) => {
          const tok = h?.replace('Bearer ', '') ?? '';
          const entry = roleByToken[tok];
          if (!entry) return { ok: false, status: 401, error: 'Unauthorized' };
          return {
            ok: true,
            idToken: tok,
            user: { uid: entry.uid, email: 'u@tema.edu.eg', emailVerified: true },
          };
        },
        verifyMembership: async (orgId, uid, idToken) => {
          const entry = roleByToken[idToken];
          if (!entry || entry.uid !== uid || orgId !== 'org_1') {
            return { ok: false, status: 403, error: 'Forbidden' };
          }
          return {
            ok: true,
            membership: { uid, organizationId: orgId, role: entry.role, status: 'active' },
          };
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      // Assistant cannot trigger reconciliation
      const assRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/reconcile`, {
        method: 'POST',
        headers: { Authorization: 'Bearer tok_assistant' },
      });
      expect(assRes.status).toBe(403);

      // Owner triggers reconciliation -> repairs org & group studentCount
      const ownerRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/reconcile`, {
        method: 'POST',
        headers: { Authorization: 'Bearer tok_owner' },
      });
      expect(ownerRes.status).toBe(200);
      expect(docs.get('organizations/org_1')?.totalStudentsCount).toBe(2);
      expect(docs.get('organizations/org_1')?.activeStudentsCount).toBe(1);
      expect(docs.get('organizations/org_1/groups/grp_1')?.studentCount).toBe(1);

      // Duplicate enrollment blocked by /enrollments route
      const dupEnr = await fetch(`${baseUrl}/api/v1/organizations/org_1/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify({ groupId: 'grp_1', studentId: 'stu_1' }),
      });
      expect(dupEnr.status).toBe(409);
    });
  });
});
