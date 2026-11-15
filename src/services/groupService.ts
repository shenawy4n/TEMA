import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { isValidEntityId, sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { DomainValidationError, egpToPiasters, piastersToEgp } from '@/src/lib/domain/money';
import { assertCanEnrollStudent, assertValidGroupTeacher } from '@/src/lib/domain/scheduling';
import { enqueueAuditLog, type AuditActor } from './auditService';
import {
  resolveActiveOrganizationInTx,
  resolveAuthorizedMemberInTx,
} from './tenantAuthority';
import type {
  GroupEnrollment,
  GroupStatus,
  OrganizationMember,
  Student,
  StudyGroup,
} from '@/src/types/domain';

export interface CreateGroupInput {
  name: string;
  subject: string;
  gradeLevel: string;
  teacherId: string;
  teacherName: string;
  capacity: number;
  scheduleSummary?: string;
  monthlyFee: number;
}

const VALID_GROUP_STATUSES = new Set<GroupStatus>(['active', 'paused', 'archived']);

export async function listGroups(organizationId: string): Promise<StudyGroup[]> {
  const path = `organizations/${organizationId}/groups`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'groups'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as StudyGroup);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listOrganizationEnrollments(organizationId: string): Promise<GroupEnrollment[]> {
  const path = `organizations/${organizationId}/enrollments`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'enrollments'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as GroupEnrollment);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listEnrollmentsByGroup(
  organizationId: string,
  groupId: string
): Promise<GroupEnrollment[]> {
  const path = `organizations/${organizationId}/enrollments`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'enrollments'),
      where('organizationId', '==', organizationId),
      where('groupId', '==', groupId),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as GroupEnrollment);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listEnrollmentsByStudent(
  organizationId: string,
  studentId: string
): Promise<GroupEnrollment[]> {
  const path = `organizations/${organizationId}/enrollments`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'enrollments'),
      where('organizationId', '==', organizationId),
      where('studentId', '==', studentId),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as GroupEnrollment);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createGroup(
  organizationId: string,
  input: CreateGroupInput,
  _actor?: AuditActor
): Promise<string> {
  const groupId = generateId('grp');
  const path = `organizations/${organizationId}/groups/${groupId}`;

  const name = sanitizeText(input.name || '', 120);
  const subject = sanitizeText(input.subject || '', 80);
  const gradeLevel = sanitizeText(input.gradeLevel || '', 60);

  if (name.length < 2 || subject.length < 1 || gradeLevel.length < 1) {
    throw new DomainValidationError('اسم المجموعة والمادة والصف الدراسي حقول مطلوبة.', 'INVALID_GROUP_INPUT');
  }
  if (!isValidEntityId(input.teacherId)) {
    throw new DomainValidationError('معرّف المدرس غير صالح.', 'INVALID_TEACHER_ID');
  }
  if (
    typeof input.capacity !== 'number' ||
    !Number.isFinite(input.capacity) ||
    !Number.isInteger(input.capacity) ||
    input.capacity < 1 ||
    input.capacity > 500
  ) {
    throw new DomainValidationError('سعة المجموعة يجب أن تكون عدداً صحيحاً بين 1 و 500.', 'INVALID_CAPACITY');
  }

  const feePiasters = egpToPiasters(input.monthlyFee, {
    allowZero: true,
    fieldLabel: 'الاشتراك الشهري',
  });
  const monthlyFee = piastersToEgp(feePiasters);

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'groups:create');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const teacherSnap = await tx.get(
        doc(db, 'organizations', organizationId, 'members', input.teacherId)
      );
      const teacherMember = teacherSnap.exists()
        ? (teacherSnap.data() as OrganizationMember)
        : null;
      const verifiedTeacher = assertValidGroupTeacher(teacherMember, organizationId);

      tx.set(doc(db, 'organizations', organizationId, 'groups', groupId), {
        id: groupId,
        organizationId,
        name,
        subject,
        gradeLevel,
        teacherId: verifiedTeacher.uid,
        teacherName: sanitizeText(verifiedTeacher.displayName, 100),
        capacity: input.capacity,
        studentCount: 0,
        scheduleSummary: sanitizeText(input.scheduleSummary || '', 150),
        monthlyFee,
        status: 'active',
        createdBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'group.created',
        entityType: 'group',
        entityId: groupId,
        summary: `تم إنشاء المجموعة "${name}".`,
        result: 'success',
        metadata: {
          after: {
            name,
            subject,
            gradeLevel,
            teacherId: verifiedTeacher.uid,
            capacity: input.capacity,
            monthlyFee,
          },
        },
      });
    });

    return groupId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateGroupStatus(
  organizationId: string,
  groupId: string,
  status: GroupStatus,
  _actor?: AuditActor
): Promise<void> {
  if (!isValidEntityId(groupId)) {
    throw new DomainValidationError('معرّف المجموعة غير صالح.', 'INVALID_GROUP_ID');
  }
  if (!VALID_GROUP_STATUSES.has(status)) {
    throw new DomainValidationError('حالة المجموعة غير صالحة.', 'INVALID_GROUP_STATUS');
  }

  const path = `organizations/${organizationId}/groups/${groupId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'groups:update');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const groupRef = doc(db, 'organizations', organizationId, 'groups', groupId);
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists()) {
        throw new DomainValidationError('المجموعة غير موجودة.', 'GROUP_NOT_FOUND', 404);
      }

      const existingGroup = groupSnap.data() as StudyGroup;
      if (existingGroup.status === status) return;

      tx.update(groupRef, {
        status,
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'group.status_updated',
        entityType: 'group',
        entityId: groupId,
        summary: `تم تحديث حالة المجموعة "${existingGroup.name}" إلى (${status}).`,
        result: 'success',
        metadata: {
          before: { status: existingGroup.status },
          after: { status },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function enrollStudentInGroup(
  organizationId: string,
  groupId: string,
  studentId: string
): Promise<string> {
  if (!isValidEntityId(groupId) || !isValidEntityId(studentId)) {
    throw new DomainValidationError('معرّف المجموعة أو الطالب غير صالح.', 'INVALID_ID');
  }

  const enrollmentId = `${groupId}_${studentId}`;
  const path = `organizations/${organizationId}/enrollments/${enrollmentId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(
        tx,
        organizationId,
        'groups:manage_enrollment'
      );
      await resolveActiveOrganizationInTx(tx, organizationId);

      const groupRef = doc(db, 'organizations', organizationId, 'groups', groupId);
      const studentRef = doc(db, 'organizations', organizationId, 'students', studentId);
      const enrollmentRef = doc(db, 'organizations', organizationId, 'enrollments', enrollmentId);

      const [groupSnap, studentSnap, enrollmentSnap] = await Promise.all([
        tx.get(groupRef),
        tx.get(studentRef),
        tx.get(enrollmentRef),
      ]);

      if (!groupSnap.exists()) {
        throw new DomainValidationError('المجموعة غير موجودة.', 'GROUP_NOT_FOUND', 404);
      }
      if (!studentSnap.exists()) {
        throw new DomainValidationError('الطالب غير موجود.', 'STUDENT_NOT_FOUND', 404);
      }

      const group = groupSnap.data() as StudyGroup;
      const student = studentSnap.data() as Student;
      const existingEnrollment = enrollmentSnap.exists()
        ? (enrollmentSnap.data() as GroupEnrollment)
        : null;

      assertCanEnrollStudent(group, student, existingEnrollment, group.studentCount);

      if (existingEnrollment) {
        tx.update(enrollmentRef, {
          studentName: student.fullName,
          groupName: group.name,
          status: 'active',
          enrolledBy: verifiedMember.uid,
          enrolledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(enrollmentRef, {
          id: enrollmentId,
          organizationId,
          groupId,
          studentId,
          studentName: student.fullName,
          groupName: group.name,
          status: 'active',
          enrolledBy: verifiedMember.uid,
          enrolledAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(groupRef, {
        studentCount: group.studentCount + 1,
        lastEnrollmentId: enrollmentId,
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'group.student_enrolled',
        entityType: 'enrollment',
        entityId: enrollmentId,
        summary: `تم تسجيل الطالب "${student.fullName}" في مجموعة "${group.name}".`,
        result: 'success',
        metadata: {
          before: { studentCount: group.studentCount },
          after: { studentCount: group.studentCount + 1, groupId, studentId },
        },
      });
    });

    return enrollmentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeStudentFromGroup(
  organizationId: string,
  groupId: string,
  studentId: string
): Promise<void> {
  if (!isValidEntityId(groupId) || !isValidEntityId(studentId)) {
    throw new DomainValidationError('معرّف المجموعة أو الطالب غير صالح.', 'INVALID_ID');
  }

  const enrollmentId = `${groupId}_${studentId}`;
  const path = `organizations/${organizationId}/enrollments/${enrollmentId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(
        tx,
        organizationId,
        'groups:manage_enrollment'
      );
      await resolveActiveOrganizationInTx(tx, organizationId);

      const groupRef = doc(db, 'organizations', organizationId, 'groups', groupId);
      const enrollmentRef = doc(db, 'organizations', organizationId, 'enrollments', enrollmentId);

      const [groupSnap, enrollmentSnap] = await Promise.all([
        tx.get(groupRef),
        tx.get(enrollmentRef),
      ]);

      if (!groupSnap.exists()) {
        throw new DomainValidationError('المجموعة غير موجودة.', 'GROUP_NOT_FOUND', 404);
      }
      if (!enrollmentSnap.exists()) {
        throw new DomainValidationError('الطالب غير مسجل في هذه المجموعة.', 'ENROLLMENT_NOT_FOUND', 404);
      }

      const group = groupSnap.data() as StudyGroup;
      const enrollment = enrollmentSnap.data() as GroupEnrollment;

      if (enrollment.status !== 'active') {
        throw new DomainValidationError('الطالب غير مسجل حالياً في هذه المجموعة.', 'ENROLLMENT_ALREADY_REMOVED', 409);
      }

      const nextCount = Math.max(0, group.studentCount - 1);

      tx.update(enrollmentRef, {
        status: 'removed',
        removedBy: verifiedMember.uid,
        removedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(groupRef, {
        studentCount: nextCount,
        lastEnrollmentId: enrollmentId,
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'group.student_removed',
        entityType: 'enrollment',
        entityId: enrollmentId,
        summary: `تم إزالة الطالب "${enrollment.studentName}" من مجموعة "${group.name}".`,
        result: 'success',
        metadata: {
          before: { studentCount: group.studentCount, status: 'active' },
          after: { studentCount: nextCount, status: 'removed' },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
