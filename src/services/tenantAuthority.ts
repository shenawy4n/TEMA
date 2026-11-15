import { doc, type Transaction } from 'firebase/firestore';
import { auth, db } from '@/src/lib/firebase/config';
import { isValidEntityId } from '@/src/lib/firebase/validation';
import { DomainValidationError } from '@/src/lib/domain/money';
import { assertPermission, type TemaPermission } from '@/src/lib/domain/rbac';
import type { Organization, OrganizationMember } from '@/src/types/domain';

export function requireVerifiedCallerUid(): string {
  const user = auth.currentUser;
  if (!user) {
    throw new DomainValidationError('يجب تسجيل الدخول أولاً لتنفيذ هذه العملية.', 'UNAUTHENTICATED', 401);
  }
  if (!user.emailVerified) {
    throw new DomainValidationError(
      'يجب تأكيد البريد الإلكتروني أولاً قبل تنفيذ عمليات محمية.',
      'EMAIL_NOT_VERIFIED',
      403
    );
  }
  return user.uid;
}

export function assertValidOrganizationId(organizationId: string): void {
  if (!isValidEntityId(organizationId)) {
    throw new DomainValidationError('معرّف المنظمة غير صالح.', 'INVALID_ORGANIZATION_ID', 400);
  }
}

/**
 * Resolves the caller's authoritative membership document directly from Firestore inside
 * a transaction (never trusting frontend-supplied roles or actor metadata) and enforces RBAC.
 */
export async function resolveAuthorizedMemberInTx(
  tx: Transaction,
  organizationId: string,
  permission: TemaPermission
): Promise<OrganizationMember> {
  assertValidOrganizationId(organizationId);
  const callerUid = requireVerifiedCallerUid();

  const memberRef = doc(db, 'organizations', organizationId, 'members', callerUid);
  const memberSnap = await tx.get(memberRef);
  const member = memberSnap.exists() ? (memberSnap.data() as OrganizationMember) : null;

  return assertPermission(member, organizationId, callerUid, permission);
}

export async function resolveActiveOrganizationInTx(
  tx: Transaction,
  organizationId: string
): Promise<Organization> {
  assertValidOrganizationId(organizationId);
  const orgRef = doc(db, 'organizations', organizationId);
  const orgSnap = await tx.get(orgRef);
  if (!orgSnap.exists()) {
    throw new DomainValidationError('المنظمة غير موجودة.', 'ORG_NOT_FOUND', 404);
  }
  const org = orgSnap.data() as Organization;
  if (org.status !== 'active') {
    throw new DomainValidationError('المنظمة موقوفة حالياً.', 'ORG_SUSPENDED', 403);
  }
  return org;
}
