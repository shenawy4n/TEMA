import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { enqueueAuditLog, type AuditActor } from './auditService';
import type { Student, StudentStatus } from '@/src/types/domain';

export interface CreateStudentInput {
  fullName: string;
  phone: string;
  guardianName?: string;
  guardianPhone?: string;
  gradeLevel: string;
  notes?: string;
}

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
  actor: AuditActor
): Promise<string> {
  const studentId = generateId('stu');
  const path = `organizations/${organizationId}/students/${studentId}`;
  const batch = writeBatch(db);
  const fullName = sanitizeText(input.fullName, 120);

  const payload: Record<string, unknown> = {
    id: studentId,
    organizationId,
    fullName,
    phone: sanitizeText(input.phone, 30),
    guardianName: sanitizeText(input.guardianName || '', 120),
    guardianPhone: sanitizeText(input.guardianPhone || '', 30),
    gradeLevel: sanitizeText(input.gradeLevel, 60),
    status: 'active',
    notes: sanitizeText(input.notes || '', 500),
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  batch.set(doc(db, 'organizations', organizationId, 'students', studentId), payload);
  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'student.created',
    'student',
    studentId,
    `تم إضافة الطالب "${fullName}".`
  );

  try {
    await batch.commit();
    return studentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStudentStatus(
  organizationId: string,
  studentId: string,
  status: StudentStatus,
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}/students/${studentId}`;
  const batch = writeBatch(db);

  batch.update(doc(db, 'organizations', organizationId, 'students', studentId), {
    status,
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'student.status_updated',
    'student',
    studentId,
    `تم تغيير حالة الطالب إلى (${status}).`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
