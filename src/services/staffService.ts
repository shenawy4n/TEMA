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
import { EMAIL_PATTERN, isValidEntityId, sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { DomainValidationError } from '@/src/lib/domain/money';
import { VALID_MEMBER_ROLES } from '@/src/lib/domain/rbac';
import { enqueueAuditLog, type AuditActor } from './auditService';
import {
  resolveActiveOrganizationInTx,
  resolveAuthorizedMemberInTx,
} from './tenantAuthority';
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
  _actor?: AuditActor
): Promise<string> {
  const invitationId = generateId('inv');
  const path = `organizations/${organizationId}/invitations/${invitationId}`;
  const cleanEmail = sanitizeText(input.email.toLowerCase(), 200);

  if (!EMAIL_PATTERN.test(cleanEmail)) {
    throw new DomainValidationError('البريد الإلكتروني المدخل غير صالح.', 'INVALID_EMAIL');
  }
  if (input.role === ('owner' as MemberRole) || !VALID_MEMBER_ROLES.has(input.role)) {
    throw new DomainValidationError('الدور الوظيفي للدعوة غير صالح.', 'INVALID_ROLE');
  }

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'staff:invite');
      await resolveActiveOrganizationInTx(tx, organizationId);

      tx.set(doc(db, 'organizations', organizationId, 'invitations', invitationId), {
        id: invitationId,
        organizationId,
        email: cleanEmail,
        role: input.role,
        invitedBy: verifiedMember.uid,
        invitedByName: sanitizeText(verifiedMember.displayName, 100),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'staff.invited',
        entityType: 'invitation',
        entityId: invitationId,
        summary: `تم إرسال دعوة انضمام إلى ${cleanEmail} بدور (${input.role}).`,
        result: 'success',
        metadata: {
          after: { email: cleanEmail, role: input.role, status: 'pending' },
        },
      });
    });

    return invitationId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function revokeStaffInvitation(
  organizationId: string,
  invitationId: string,
  _actor?: AuditActor
): Promise<void> {
  if (!isValidEntityId(invitationId)) {
    throw new DomainValidationError('معرّف الدعوة غير صالح.', 'INVALID_INVITATION_ID');
  }
  const path = `organizations/${organizationId}/invitations/${invitationId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'staff:invite');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const invRef = doc(db, 'organizations', organizationId, 'invitations', invitationId);
      const invSnap = await tx.get(invRef);
      if (!invSnap.exists()) {
        throw new DomainValidationError('الدعوة غير موجودة.', 'INVITATION_NOT_FOUND', 404);
      }
      const existing = invSnap.data() as StaffInvitation;
      if (existing.status !== 'pending') {
        throw new DomainValidationError('يمكن إلغاء الدعوات قيد الانتظار فقط.', 'INVITATION_NOT_PENDING', 409);
      }

      tx.update(invRef, {
        status: 'revoked',
        updatedAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'staff.invitation_revoked',
        entityType: 'invitation',
        entityId: invitationId,
        summary: `تم إلغاء دعوة الانضمام (${existing.email}).`,
        result: 'success',
        metadata: {
          before: { status: existing.status },
          after: { status: 'revoked' },
        },
      });
    });
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
  _actor?: AuditActor
): Promise<void> {
  if (!isValidEntityId(targetUid)) {
    throw new DomainValidationError('معرّف العضو غير صالح.', 'INVALID_MEMBER_ID');
  }
  const path = `organizations/${organizationId}/members/${targetUid}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(
        tx,
        organizationId,
        'staff:manage_members'
      );
      await resolveActiveOrganizationInTx(tx, organizationId);

      if (targetUid === verifiedMember.uid) {
        throw new DomainValidationError(
          'لا يمكن لمالك المنظمة تعديل دوره أو إيقاف عضويته بنفسه.',
          'SELF_ROLE_MODIFICATION_FORBIDDEN',
          403
        );
      }

      const targetRef = doc(db, 'organizations', organizationId, 'members', targetUid);
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists()) {
        throw new DomainValidationError('سجل العضو غير موجود.', 'MEMBER_NOT_FOUND', 404);
      }

      const existing = targetSnap.data() as OrganizationMember;
      if (existing.role === 'owner') {
        throw new DomainValidationError(
          'لا يمكن تغيير صلاحيات أو إيقاف مالك المنظمة.',
          'OWNER_PROTECTED',
          403
        );
      }

      const payload: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
      };
      if (updates.role) {
        if (updates.role === ('owner' as MemberRole) || !VALID_MEMBER_ROLES.has(updates.role)) {
          throw new DomainValidationError('الدور المحدد غير مسموح به.', 'INVALID_ROLE');
        }
        payload.role = updates.role;
      }
      if (updates.status) {
        if (!['active', 'invited', 'suspended'].includes(updates.status)) {
          throw new DomainValidationError('حالة العضوية غير صالحة.', 'INVALID_STATUS');
        }
        payload.status = updates.status;
      }

      tx.update(targetRef, payload);
      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'staff.member_updated',
        entityType: 'member',
        entityId: targetUid,
        summary: `تم تحديث صلاحيات العضو "${existing.displayName}".`,
        result: 'success',
        metadata: {
          before: { role: existing.role, status: existing.status },
          after: {
            role: (updates.role ?? existing.role) as MemberRole,
            status: updates.status ?? existing.status,
          },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
