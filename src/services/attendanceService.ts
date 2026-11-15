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
import { DomainValidationError } from '@/src/lib/domain/money';
import { assertCanMarkAttendance } from '@/src/lib/domain/scheduling';
import { enqueueAuditLog, type AuditActor } from './auditService';
import {
  resolveActiveOrganizationInTx,
  resolveAuthorizedMemberInTx,
} from './tenantAuthority';
import type {
  AttendanceRecord,
  AttendanceStatus,
  ClassSession,
  GroupEnrollment,
  Student,
} from '@/src/types/domain';

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
  _actor?: AuditActor
): Promise<void> {
  if (!isValidEntityId(input.sessionId) || !isValidEntityId(input.studentId)) {
    throw new DomainValidationError('معرّف الحصة أو الطالب غير صالح.', 'INVALID_ID');
  }

  const attendanceId = `${input.sessionId}_${input.studentId}`;
  const path = `organizations/${organizationId}/attendance/${attendanceId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'attendance:write');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const sesRef = doc(db, 'organizations', organizationId, 'sessions', input.sessionId);
      const stuRef = doc(db, 'organizations', organizationId, 'students', input.studentId);
      const attRef = doc(db, 'organizations', organizationId, 'attendance', attendanceId);

      const [sesSnap, stuSnap, attSnap] = await Promise.all([
        tx.get(sesRef),
        tx.get(stuRef),
        tx.get(attRef),
      ]);

      const session = sesSnap.exists() ? (sesSnap.data() as ClassSession) : null;
      const student = stuSnap.exists() ? (stuSnap.data() as Student) : null;
      const enrollmentId = session ? `${session.groupId}_${input.studentId}` : '';
      const enrSnap = enrollmentId
        ? await tx.get(doc(db, 'organizations', organizationId, 'enrollments', enrollmentId))
        : null;
      const enrollment = enrSnap && enrSnap.exists() ? (enrSnap.data() as GroupEnrollment) : null;

      assertCanMarkAttendance({
        organizationId,
        session,
        student,
        enrollment,
        status: input.status,
      });

      const resolvedSession = session!;
      const resolvedStudent = student!;
      const cleanNote = sanitizeText(input.note || '', 300);

      if (attSnap.exists()) {
        const prev = attSnap.data() as AttendanceRecord;
        tx.update(attRef, {
          status: input.status,
          note: cleanNote,
          recordedBy: verifiedMember.uid,
          updatedAt: serverTimestamp(),
        });
        enqueueAuditLog(tx, organizationId, verifiedMember, {
          action: 'attendance.updated',
          entityType: 'attendance',
          entityId: attendanceId,
          summary: `تحديث حضور الطالب "${resolvedStudent.fullName}" إلى (${input.status}).`,
          result: 'success',
          metadata: {
            before: { status: prev.status },
            after: { status: input.status, sessionId: resolvedSession.id },
          },
        });
      } else {
        tx.set(attRef, {
          id: attendanceId,
          organizationId,
          sessionId: resolvedSession.id,
          studentId: resolvedStudent.id,
          studentName: resolvedStudent.fullName,
          groupId: resolvedSession.groupId,
          status: input.status,
          note: cleanNote,
          recordedBy: verifiedMember.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        enqueueAuditLog(tx, organizationId, verifiedMember, {
          action: 'attendance.recorded',
          entityType: 'attendance',
          entityId: attendanceId,
          summary: `تسجيل حضور الطالب "${resolvedStudent.fullName}" بالحالة (${input.status}).`,
          result: 'success',
          metadata: {
            after: {
              sessionId: resolvedSession.id,
              groupId: resolvedSession.groupId,
              status: input.status,
            },
          },
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function markBulkAttendance(
  organizationId: string,
  sessionId: string,
  entries: Array<{ studentId: string; status: AttendanceStatus; note?: string }>
): Promise<{ processedCount: number }> {
  if (!isValidEntityId(sessionId)) {
    throw new DomainValidationError('معرّف الحصة غير صالح.', 'INVALID_SESSION_ID');
  }
  if (entries.length === 0) {
    return { processedCount: 0 };
  }

  // Deduplicate entries by studentId (last entry wins) to prevent duplicate writes in same tx
  const dedupedByStudent = new Map<string, { studentId: string; status: AttendanceStatus; note?: string }>();
  for (const item of entries) {
    if (!isValidEntityId(item.studentId)) {
      throw new DomainValidationError('معرّف أحد الطلاب غير صالح.', 'INVALID_STUDENT_ID');
    }
    dedupedByStudent.set(item.studentId, item);
  }

  const uniqueEntries = Array.from(dedupedByStudent.values());
  // Keep each transaction <= 15 students so Firestore Rules unique get()/exists() evaluations stay below the 20-doc limit (member + session + 15 enrollments = 17).
  const chunkSize = 15;
  let totalProcessed = 0;

  try {
    for (let i = 0; i < uniqueEntries.length; i += chunkSize) {
      const chunk = uniqueEntries.slice(i, i + chunkSize);
      await runTransaction(db, async (tx) => {
        const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'attendance:write');
        await resolveActiveOrganizationInTx(tx, organizationId);

        const sesSnap = await tx.get(doc(db, 'organizations', organizationId, 'sessions', sessionId));
        const session = sesSnap.exists() ? (sesSnap.data() as ClassSession) : null;
        if (!session || session.organizationId !== organizationId) {
          throw new DomainValidationError('الحصة غير موجودة.', 'SESSION_NOT_FOUND', 404);
        }
        if (session.status === 'cancelled') {
          throw new DomainValidationError('لا يمكن تسجيل الحضور لحصة ملغاة.', 'SESSION_CANCELLED', 409);
        }

        const snapshots = await Promise.all(
          chunk.map(async (entry) => {
            const attendanceId = `${sessionId}_${entry.studentId}`;
            const enrollmentId = `${session.groupId}_${entry.studentId}`;
            const [stuSnap, enrSnap, attSnap] = await Promise.all([
              tx.get(doc(db, 'organizations', organizationId, 'students', entry.studentId)),
              tx.get(doc(db, 'organizations', organizationId, 'enrollments', enrollmentId)),
              tx.get(doc(db, 'organizations', organizationId, 'attendance', attendanceId)),
            ]);
            return { entry, attendanceId, stuSnap, enrSnap, attSnap };
          })
        );

        for (const item of snapshots) {
          const student = item.stuSnap.exists() ? (item.stuSnap.data() as Student) : null;
          const enrollment = item.enrSnap.exists() ? (item.enrSnap.data() as GroupEnrollment) : null;

          assertCanMarkAttendance({
            organizationId,
            session,
            student,
            enrollment,
            status: item.entry.status,
          });

          const attRef = doc(db, 'organizations', organizationId, 'attendance', item.attendanceId);
          const cleanNote = sanitizeText(item.entry.note || '', 300);

          if (item.attSnap.exists()) {
            tx.update(attRef, {
              status: item.entry.status,
              note: cleanNote,
              recordedBy: verifiedMember.uid,
              updatedAt: serverTimestamp(),
            });
          } else {
            tx.set(attRef, {
              id: item.attendanceId,
              organizationId,
              sessionId: session.id,
              studentId: student!.id,
              studentName: student!.fullName,
              groupId: session.groupId,
              status: item.entry.status,
              note: cleanNote,
              recordedBy: verifiedMember.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        }

        enqueueAuditLog(tx, organizationId, verifiedMember, {
          action: 'attendance.bulk_recorded',
          entityType: 'session',
          entityId: sessionId,
          summary: `تسجيل حضور جماعي لعدد ${chunk.length} طالب في حصة "${session.title}".`,
          result: 'success',
          metadata: {
            after: { sessionId, groupId: session.groupId, count: chunk.length },
          },
        });
      });

      totalProcessed += chunk.length;
    }

    return { processedCount: totalProcessed };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organizations/${organizationId}/attendance`);
  }
}
