import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { enqueueAuditLog, type AuditActor } from './auditService';
import type { MemberRole, MemberStatus, OrganizationMember, StaffInvitation } from '@/src/types/domain';

export async function listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
  const path = `organizations/${organizationId}/members`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'members'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OrganizationMember);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listStaffInvitations(organizationId: string): Promise<StaffInvitation[]> {
  const path = `organizations/${organizationId}/invitations`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'invitations'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as StaffInvitation);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createStaffInvitation(
  organizationId: string,
  input: {
    email: string;
    role: Exclude<MemberRole, 'owner'>;
  },
  actor: AuditActor
): Promise<string> {
  const invitationId = generateId('inv');
  const path = `organizations/${organizationId}/invitations/${invitationId}`;
  const batch = writeBatch(db);
  const cleanEmail = sanitizeText(input.email.toLowerCase(), 200);

  batch.set(doc(db, 'organizations', organizationId, 'invitations', invitationId), {
    id: invitationId,
    organizationId,
    email: cleanEmail,
    role: input.role,
    invitedBy: actor.uid,
    invitedByName: sanitizeText(actor.displayName, 100),
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'staff.invited',
    'invitation',
    invitationId,
    `تم إرسال دعوة انضمام إلى ${cleanEmail} بدور (${input.role}).`
  );

  try {
    await batch.commit();
    return invitationId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function revokeStaffInvitation(
  organizationId: string,
  invitationId: string,
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}/invitations/${invitationId}`;
  const batch = writeBatch(db);

  batch.update(doc(db, 'organizations', organizationId, 'invitations', invitationId), {
    status: 'revoked',
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'staff.invitation_revoked',
    'invitation',
    invitationId,
    `تم إلغاء دعوة الانضمام (${invitationId}).`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateMemberRoleOrStatus(
  organizationId: string,
  targetUid: string,
  updates: {
    role?: Exclude<MemberRole, 'owner'>;
    status?: MemberStatus;
  },
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}/members/${targetUid}`;
  const batch = writeBatch(db);

  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (updates.role) payload.role = updates.role;
  if (updates.status) payload.status = updates.status;

  batch.update(doc(db, 'organizations', organizationId, 'members', targetUid), payload);
  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'staff.member_updated',
    'member',
    targetUid,
    `تم تحديث صلاحيات العضو (${targetUid}).`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
