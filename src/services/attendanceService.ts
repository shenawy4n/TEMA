import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { enqueueAuditLog, type AuditActor } from './auditService';
import type { AttendanceRecord, AttendanceStatus } from '@/src/types/domain';

export async function listAttendanceBySession(
  organizationId: string,
  sessionId: string
): Promise<AttendanceRecord[]> {
  const path = `organizations/${organizationId}/attendance`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'attendance'),
      where('organizationId', '==', organizationId),
      where('sessionId', '==', sessionId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as AttendanceRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listAttendanceByOrganization(organizationId: string): Promise<AttendanceRecord[]> {
  const path = `organizations/${organizationId}/attendance`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'attendance'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as AttendanceRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listAttendanceByStudent(
  organizationId: string,
  studentId: string
): Promise<AttendanceRecord[]> {
  const path = `organizations/${organizationId}/attendance`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'attendance'),
      where('organizationId', '==', organizationId),
      where('studentId', '==', studentId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as AttendanceRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function upsertAttendanceRecord(
  organizationId: string,
  input: {
    sessionId: string;
    studentId: string;
    studentName: string;
    groupId: string;
    status: AttendanceStatus;
    note?: string;
  },
  actor: AuditActor
): Promise<void> {
  const attendanceId = `${input.sessionId}_${input.studentId}`;
  const path = `organizations/${organizationId}/attendance/${attendanceId}`;
  const ref = doc(db, 'organizations', organizationId, 'attendance', attendanceId);

  let existsAlready = false;
  try {
    const snap = await getDoc(ref);
    existsAlready = snap.exists();
  } catch {
    existsAlready = false;
  }

  const batch = writeBatch(db);
  if (existsAlready) {
    batch.update(ref, {
      status: input.status,
      note: sanitizeText(input.note || '', 300),
      recordedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(ref, {
      id: attendanceId,
      organizationId,
      sessionId: input.sessionId,
      studentId: input.studentId,
      studentName: sanitizeText(input.studentName, 120),
      groupId: input.groupId,
      status: input.status,
      note: sanitizeText(input.note || '', 300),
      recordedBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'attendance.recorded',
    'attendance',
    attendanceId,
    `تسجيل حضور الطالب "${input.studentName}" بالحالة (${input.status}).`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
