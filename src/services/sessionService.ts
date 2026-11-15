import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { enqueueAuditLog, type AuditActor } from './auditService';
import type { ClassSession, SessionStatus } from '@/src/types/domain';

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
  actor: AuditActor
): Promise<string> {
  const sessionId = generateId('ses');
  const path = `organizations/${organizationId}/sessions/${sessionId}`;
  const batch = writeBatch(db);
  const title = sanitizeText(input.title, 150);

  batch.set(doc(db, 'organizations', organizationId, 'sessions', sessionId), {
    id: sessionId,
    organizationId,
    groupId: input.groupId,
    groupName: sanitizeText(input.groupName, 120),
    teacherId: input.teacherId,
    teacherName: sanitizeText(input.teacherName, 100),
    title,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    room: sanitizeText(input.room || '', 80),
    status: 'scheduled',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'session.created',
    'session',
    sessionId,
    `تم جدولة حصة "${title}" بتاريخ ${input.date}.`
  );

  try {
    await batch.commit();
    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSessionStatus(
  organizationId: string,
  sessionId: string,
  status: SessionStatus,
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}/sessions/${sessionId}`;
  const batch = writeBatch(db);
  batch.update(doc(db, 'organizations', organizationId, 'sessions', sessionId), {
    status,
    updatedAt: serverTimestamp(),
  });
  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'session.status_updated',
    'session',
    sessionId,
    `تم تغيير حالة الحصة إلى (${status}).`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
