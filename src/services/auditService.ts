import { collection, doc, getDocs, orderBy, query, serverTimestamp, where, type WriteBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import type { AuditLog, MemberRole } from '@/src/types/domain';

export interface AuditActor {
  uid: string;
  displayName: string;
  role: MemberRole;
}

export function enqueueAuditLog(
  batch: WriteBatch,
  organizationId: string,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  summary: string
): void {
  const logId = generateId('log');
  const ref = doc(db, 'organizations', organizationId, 'auditLogs', logId);
  batch.set(ref, {
    id: logId,
    organizationId,
    actorId: actor.uid,
    actorName: sanitizeText(actor.displayName, 100),
    actorRole: actor.role,
    action: sanitizeText(action, 100),
    entityType: sanitizeText(entityType, 60),
    entityId,
    summary: sanitizeText(summary, 300),
    createdAt: serverTimestamp(),
  });
}

export async function listAuditLogs(organizationId: string): Promise<AuditLog[]> {
  const path = `organizations/${organizationId}/auditLogs`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'auditLogs'),
      where('organizationId', '==', organizationId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as AuditLog);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
