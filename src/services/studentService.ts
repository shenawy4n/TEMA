import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { EGYPT_PHONE_PATTERN, isValidEntityId, sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { DomainValidationError } from '@/src/lib/domain/money';
import { enqueueAuditLog, type AuditActor } from './auditService';
import {
  resolveActiveOrganizationInTx,
  resolveAuthorizedMemberInTx,
} from './tenantAuthority';
import type { GroupEnrollment, Student, StudentStatus, StudyGroup } from '@/src/types/domain';

export interface CreateStudentInput {
  fullName: string;
  phone: string;
  guardianName?: string;
  guardianPhone?: string;
  gradeLevel: string;
  notes?: string;
}

const VALID_STUDENT_STATUSES = new Set<StudentStatus>(['active', 'inactive', 'archived']);

export async function listStudents(organizationId: string): Promise<Student[]> {
  const path = `organizations/${organizationId}/students`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'students'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Student);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function getStudentById(organizationId: string, studentId: string): Promise<Student | null> {
  const path = `organizations/${organizationId}/students/${studentId}`;
  try {
    const snap = await getDoc(doc(db, 'organizations', organizationId, 'students', studentId));
    return snap.exists() ? (snap.data() as Student) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createStudent(
  organizationId: string,
  input: CreateStudentInput,
  _actor?: AuditActor
): Promise<string> {
  const studentId = generateId('stu');
  const path = `organizations/${organizationId}/students/${studentId}`;

  const fullName = sanitizeText(input.fullName || '', 120);
  const phone = sanitizeText(input.phone || '', 30);
  const gradeLevel = sanitizeText(input.gradeLevel || '', 60);

  if (fullName.length < 2) {
    throw new DomainValidationError('الاسم الكامل للطالب يجب أن يكون حرفين على الأقل.', 'INVALID_STUDENT_NAME');
  }
  if (!EGYPT_PHONE_PATTERN.test(phone)) {
    throw new DomainValidationError('رقم هاتف الطالب غير صالح.', 'INVALID_PHONE');
  }
  if (gradeLevel.length < 1) {
    throw new DomainValidationError('الصف الدراسي مطلوب.', 'INVALID_GRADE_LEVEL');
  }

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'students:create');
      const org = await resolveActiveOrganizationInTx(tx, organizationId);

      const studentRef = doc(db, 'organizations', organizationId, 'students', studentId);
      const orgRef = doc(db, 'organizations', organizationId);

      const payload: Record<string, unknown> = {
        id: studentId,
        organizationId,
        fullName,
        phone,
        guardianName: sanitizeText(input.guardianName || '', 120),
        guardianPhone: sanitizeText(input.guardianPhone || '', 30),
        gradeLevel,
        status: 'active',
        notes: sanitizeText(input.notes || '', 500),
        createdBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const nextTotal = (typeof org.totalStudentsCount === 'number' ? org.totalStudentsCount : 0) + 1;
      const nextActive = (typeof org.activeStudentsCount === 'number' ? org.activeStudentsCount : 0) + 1;

      tx.set(studentRef, payload);
      tx.update(orgRef, {
        totalStudentsCount: nextTotal,
        activeStudentsCount: nextActive,
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'student.created',
        entityType: 'student',
        entityId: studentId,
        summary: `تم إضافة الطالب "${fullName}".`,
        result: 'success',
        metadata: {
          after: { fullName, gradeLevel, status: 'active' },
        },
      });
    });

    return studentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStudentStatus(
  organizationId: string,
  studentId: string,
  status: StudentStatus,
  _actor?: AuditActor
): Promise<void> {
  if (!isValidEntityId(studentId)) {
    throw new DomainValidationError('معرّف الطالب غير صالح.', 'INVALID_STUDENT_ID');
  }
  if (!VALID_STUDENT_STATUSES.has(status)) {
    throw new DomainValidationError('حالة الطالب غير صالحة.', 'INVALID_STUDENT_STATUS');
  }

  const path = `organizations/${organizationId}/students/${studentId}`;

  try {
    // Pre-query active enrollments for this student if moving away from active,
    // then verify and clean them up atomically inside the transaction.
    let candidateEnrollmentIds: string[] = [];
    if (status !== 'active') {
      const enrQuery = query(
        collection(db, 'organizations', organizationId, 'enrollments'),
        where('organizationId', '==', organizationId),
        where('studentId', '==', studentId),
        where('status', '==', 'active')
      );
      const enrSnap = await getDocs(enrQuery);
      candidateEnrollmentIds = enrSnap.docs.map((d) => d.id);
    }

    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'students:update');
      const org = await resolveActiveOrganizationInTx(tx, organizationId);

      const studentRef = doc(db, 'organizations', organizationId, 'students', studentId);
      const studentSnap = await tx.get(studentRef);
      if (!studentSnap.exists()) {
        throw new DomainValidationError('سجل الطالب غير موجود.', 'STUDENT_NOT_FOUND', 404);
      }

      const existingStudent = studentSnap.data() as Student;
      if (existingStudent.status === status) {
        return;
      }

      // Read any active group enrollments inside tx before writing
      const activeEnrollmentsToRemove: Array<{
        enrollment: GroupEnrollment;
        group: StudyGroup;
      }> = [];

      for (const enrId of candidateEnrollmentIds) {
        const enrRef = doc(db, 'organizations', organizationId, 'enrollments', enrId);
        const enrSnap = await tx.get(enrRef);
        if (!enrSnap.exists()) continue;
        const enr = enrSnap.data() as GroupEnrollment;
        if (enr.status !== 'active') continue;
        const grpRef = doc(db, 'organizations', organizationId, 'groups', enr.groupId);
        const grpSnap = await tx.get(grpRef);
        if (grpSnap.exists()) {
          activeEnrollmentsToRemove.push({
            enrollment: enr,
            group: grpSnap.data() as StudyGroup,
          });
        }
      }

      tx.update(studentRef, {
        status,
        updatedAt: serverTimestamp(),
      });

      // Maintain organization student status counters atomically
      const statusFieldMap: Record<StudentStatus, 'activeStudentsCount' | 'inactiveStudentsCount' | 'archivedStudentsCount'> = {
        active: 'activeStudentsCount',
        inactive: 'inactiveStudentsCount',
        archived: 'archivedStudentsCount',
      };

      const orgCounts: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
      };
      const prevField = statusFieldMap[existingStudent.status];
      const nextField = statusFieldMap[status];
      const prevCount = typeof org[prevField] === 'number' ? (org[prevField] as number) : 0;
      const nextCount = typeof org[nextField] === 'number' ? (org[nextField] as number) : 0;
      orgCounts[prevField] = Math.max(0, prevCount - 1);
      orgCounts[nextField] = nextCount + 1;

      tx.update(doc(db, 'organizations', organizationId), orgCounts);

      // Remove active group enrollments when student becomes inactive/archived so group counts stay accurate
      for (const { enrollment, group } of activeEnrollmentsToRemove) {
        const enrRef = doc(db, 'organizations', organizationId, 'enrollments', enrollment.id);
        const grpRef = doc(db, 'organizations', organizationId, 'groups', group.id);
        tx.update(enrRef, {
          status: 'removed',
          removedBy: verifiedMember.uid,
          removedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        tx.update(grpRef, {
          studentCount: Math.max(0, group.studentCount - 1),
          lastEnrollmentId: enrollment.id,
          updatedAt: serverTimestamp(),
        });
      }

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'student.status_updated',
        entityType: 'student',
        entityId: studentId,
        summary: `تم تغيير حالة الطالب "${existingStudent.fullName}" من (${existingStudent.status}) إلى (${status}).`,
        result: 'success',
        metadata: {
          before: { status: existingStudent.status },
          after: {
            status,
            removedEnrollmentsCount: activeEnrollmentsToRemove.length,
          },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
