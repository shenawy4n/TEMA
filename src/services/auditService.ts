import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { sanitizeAuditMetadata } from '@/src/lib/domain/rbac';
import type { AuditLog, AuditResult, MemberRole, OrganizationMember } from '@/src/types/domain';

export interface AuditActor {
  uid: string;
  displayName: string;
  role: MemberRole;
}

export interface AuditEntryInput {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  result?: AuditResult;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Appends an immutable, correlation-tagged audit entry using ONLY an authoritative
 * verified member record (or bootstrap owner during initial organization creation).
 */
export function enqueueAuditLog(
  writer: Pick<WriteBatch, 'set'> | Pick<Transaction, 'set'>,
  organizationId: string,
  actor: Pick<OrganizationMember, 'uid' | 'displayName' | 'role'> | AuditActor,
  actionOrEntry: string | AuditEntryInput,
  entityType?: string,
  entityId?: string,
  summary?: string
): string {
  const logId = generateId('log');
  const ref = doc(db, 'organizations', organizationId, 'auditLogs', logId);

  const entry: AuditEntryInput =
    typeof actionOrEntry === 'string'
      ? {
          action: actionOrEntry,
          entityType: entityType || 'unknown',
          entityId: entityId || organizationId,
          summary: summary || actionOrEntry,
          result: 'success',
        }
      : actionOrEntry;

  const correlationId = entry.correlationId || generateId('corr');
  const cleanMetadata = sanitizeAuditMetadata(entry.metadata);

  const payload: Record<string, unknown> = {
    id: logId,
    organizationId,
    actorId: actor.uid,
    actorName: sanitizeText(actor.displayName || 'مستخدم', 100),
    actorRole: actor.role,
    action: sanitizeText(entry.action, 100),
    entityType: sanitizeText(entry.entityType, 60),
    entityId: entry.entityId,
    summary: sanitizeText(entry.summary, 300),
    result: entry.result ?? 'success',
    correlationId,
    createdAt: serverTimestamp(),
  };

  if (cleanMetadata) {
    payload.metadata = cleanMetadata;
  }

  (writer as WriteBatch).set(ref, payload);
  return correlationId;
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
