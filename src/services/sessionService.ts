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
import { DomainValidationError } from '@/src/lib/domain/money';
import {
  assertValidGroupTeacher,
  assertValidSessionSchedule,
  assertValidSessionTransition,
  validateCreateSessionInput,
} from '@/src/lib/domain/scheduling';
import { enqueueAuditLog, type AuditActor } from './auditService';
import {
  resolveActiveOrganizationInTx,
  resolveAuthorizedMemberInTx,
} from './tenantAuthority';
import type {
  ClassSession,
  OrganizationMember,
  SessionRescheduleEntry,
  SessionStatus,
  StudyGroup,
} from '@/src/types/domain';

export interface CreateSessionInput {
  groupId: string;
  groupName: string;
  teacherId: string;
  teacherName: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string;
}

export async function listSessions(organizationId: string): Promise<ClassSession[]> {
  const path = `organizations/${organizationId}/sessions`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'sessions'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as ClassSession)
      .sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createSession(
  organizationId: string,
  input: CreateSessionInput,
  _actor?: AuditActor
): Promise<string> {
  const sessionId = generateId('ses');
  const path = `organizations/${organizationId}/sessions/${sessionId}`;

  const validated = validateCreateSessionInput(input);

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'sessions:create');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const groupRef = doc(db, 'organizations', organizationId, 'groups', validated.groupId);
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists()) {
        throw new DomainValidationError('المجموعة الدراسية غير موجودة.', 'GROUP_NOT_FOUND', 404);
      }
      const group = groupSnap.data() as StudyGroup;
      if (group.status !== 'active') {
        throw new DomainValidationError('لا يمكن جدولة حصة لمجموعة متوقفة أو مؤرشفة.', 'GROUP_NOT_ACTIVE', 409);
      }

      const teacherId = input.teacherId || group.teacherId;
      const teacherSnap = await tx.get(
        doc(db, 'organizations', organizationId, 'members', teacherId)
      );
      const teacherMember = teacherSnap.exists()
        ? (teacherSnap.data() as OrganizationMember)
        : null;
      const verifiedTeacher = assertValidGroupTeacher(teacherMember, organizationId);

      tx.set(doc(db, 'organizations', organizationId, 'sessions', sessionId), {
        id: sessionId,
        organizationId,
        groupId: group.id,
        groupName: group.name,
        teacherId: verifiedTeacher.uid,
        teacherName: sanitizeText(verifiedTeacher.displayName, 100),
        title: validated.title,
        date: validated.date,
        startTime: validated.startTime,
        endTime: validated.endTime,
        room: validated.room,
        status: 'scheduled',
        rescheduleHistory: [],
        createdBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'session.created',
        entityType: 'session',
        entityId: sessionId,
        summary: `تم جدولة حصة "${validated.title}" لمجموعة "${group.name}" بتاريخ ${validated.date}.`,
        result: 'success',
        metadata: {
          after: {
            groupId: group.id,
            teacherId: verifiedTeacher.uid,
            date: validated.date,
            startTime: validated.startTime,
            endTime: validated.endTime,
          },
        },
      });
    });

    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSessionStatus(
  organizationId: string,
  sessionId: string,
  status: SessionStatus,
  _actor?: AuditActor,
  reason?: string
): Promise<void> {
  if (!isValidEntityId(sessionId)) {
    throw new DomainValidationError('معرّف الحصة غير صالح.', 'INVALID_SESSION_ID');
  }
  const path = `organizations/${organizationId}/sessions/${sessionId}`;

  try {
    await runTransaction(db, async (tx) => {
      const permission = status === 'cancelled' ? 'sessions:cancel' : 'sessions:update';
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, permission);
      await resolveActiveOrganizationInTx(tx, organizationId);

      const sesRef = doc(db, 'organizations', organizationId, 'sessions', sessionId);
      const sesSnap = await tx.get(sesRef);
      if (!sesSnap.exists()) {
        throw new DomainValidationError('الحصة غير موجودة.', 'SESSION_NOT_FOUND', 404);
      }

      const existing = sesSnap.data() as ClassSession;
      assertValidSessionTransition(existing.status, status);
      if (existing.status === status) return;

      const updatePayload: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp(),
      };
      if (status === 'cancelled' && reason) {
        updatePayload.cancellationReason = sanitizeText(reason, 200);
      }

      tx.update(sesRef, updatePayload);

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: status === 'cancelled' ? 'session.cancelled' : 'session.status_updated',
        entityType: 'session',
        entityId: sessionId,
        summary: `تم تغيير حالة الحصة "${existing.title}" من (${existing.status}) إلى (${status}).`,
        result: 'success',
        metadata: {
          before: { status: existing.status },
          after: { status, cancellationReason: updatePayload.cancellationReason },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function rescheduleSession(
  organizationId: string,
  sessionId: string,
  updates: {
    date: string;
    startTime: string;
    endTime: string;
    room?: string;
    reason?: string;
  }
): Promise<void> {
  if (!isValidEntityId(sessionId)) {
    throw new DomainValidationError('معرّف الحصة غير صالح.', 'INVALID_SESSION_ID');
  }
  assertValidSessionSchedule(updates.date, updates.startTime, updates.endTime);
  const path = `organizations/${organizationId}/sessions/${sessionId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'sessions:update');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const sesRef = doc(db, 'organizations', organizationId, 'sessions', sessionId);
      const sesSnap = await tx.get(sesRef);
      if (!sesSnap.exists()) {
        throw new DomainValidationError('الحصة غير موجودة.', 'SESSION_NOT_FOUND', 404);
      }

      const existing = sesSnap.data() as ClassSession;
      if (existing.status !== 'scheduled') {
        throw new DomainValidationError(
          'يمكن إعادة جدولة الحصص التي حالتها "مجدولة" فقط.',
          'SESSION_NOT_RESCHEDULABLE',
          409
        );
      }

      const historyEntry: SessionRescheduleEntry = {
        fromDate: existing.date,
        fromStartTime: existing.startTime,
        fromEndTime: existing.endTime,
        toDate: updates.date,
        toStartTime: updates.startTime,
        toEndTime: updates.endTime,
        reason: sanitizeText(updates.reason || '', 150),
        changedBy: verifiedMember.uid,
        changedAt: new Date().toISOString(),
      };

      const nextHistory = [...(existing.rescheduleHistory || []), historyEntry].slice(-20);

      tx.update(sesRef, {
        date: updates.date,
        startTime: updates.startTime,
        endTime: updates.endTime,
        room: updates.room !== undefined ? sanitizeText(updates.room, 80) : existing.room || '',
        rescheduleHistory: nextHistory,
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'session.rescheduled',
        entityType: 'session',
        entityId: sessionId,
        summary: `تم تعديل موعد الحصة "${existing.title}" إلى ${updates.date} (${updates.startTime}-${updates.endTime}).`,
        result: 'success',
        metadata: {
          before: { date: existing.date, startTime: existing.startTime, endTime: existing.endTime },
          after: { date: updates.date, startTime: updates.startTime, endTime: updates.endTime },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
