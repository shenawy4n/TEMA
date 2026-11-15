import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { enqueueAuditLog, type AuditActor } from './auditService';
import type { GroupStatus, StudyGroup } from '@/src/types/domain';

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

export async function createGroup(
  organizationId: string,
  input: CreateGroupInput,
  actor: AuditActor
): Promise<string> {
  const groupId = generateId('grp');
  const path = `organizations/${organizationId}/groups/${groupId}`;
  const batch = writeBatch(db);
  const name = sanitizeText(input.name, 120);

  batch.set(doc(db, 'organizations', organizationId, 'groups', groupId), {
    id: groupId,
    organizationId,
    name,
    subject: sanitizeText(input.subject, 80),
    gradeLevel: sanitizeText(input.gradeLevel, 60),
    teacherId: input.teacherId,
    teacherName: sanitizeText(input.teacherName, 100),
    capacity: Math.max(1, Math.min(500, Math.round(input.capacity))),
    studentCount: 0,
    scheduleSummary: sanitizeText(input.scheduleSummary || '', 150),
    monthlyFee: Math.max(0, Number(input.monthlyFee) || 0),
    status: 'active',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'group.created',
    'group',
    groupId,
    `تم إنشاء المجموعة "${name}".`
  );

  try {
    await batch.commit();
    return groupId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateGroupStatus(
  organizationId: string,
  groupId: string,
  status: GroupStatus,
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}/groups/${groupId}`;
  const batch = writeBatch(db);
  batch.update(doc(db, 'organizations', organizationId, 'groups', groupId), {
    status,
    updatedAt: serverTimestamp(),
  });
  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'group.status_updated',
    'group',
    groupId,
    `تم تحديث حالة المجموعة إلى (${status}).`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
