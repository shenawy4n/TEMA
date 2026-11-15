/**
 * TEMA Multi-Tenant Firestore Security Rules Verification Suite (Emulator Plan)
 *
 * Run with Firebase Emulator Suite:
 *   firebase emulators:exec --only firestore "npx vitest run firestore.rules.test.ts"
 *
 * Requires @firebase/rules-unit-testing in devDependencies when running in local CI/Emulator.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  actor: 'unauthenticated' | 'unverified' | 'outsider' | 'assistant' | 'teacher' | 'accountant' | 'owner';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED' | 'ALLOW';
  description: string;
}

export const DIRTY_DOZEN_SECURITY_CASES: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Reject ghost privilege fields on user creation',
    collection: 'users/user_a',
    actor: 'owner',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Payload includes unauthorized role/isAdmin fields rejected by hasOnly().',
  },
  {
    id: 2,
    name: 'Reject cross-user PII read',
    collection: 'users/user_b',
    actor: 'owner',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    description: 'User A attempts to read User B private profile document.',
  },
  {
    id: 3,
    name: 'Reject organization creation with spoofed ownerId',
    collection: 'organizations/org_1',
    actor: 'owner',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'ownerId != request.auth.uid is rejected.',
  },
  {
    id: 4,
    name: 'Reject orphan organization creation without atomic owner member',
    collection: 'organizations/org_1',
    actor: 'owner',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'existsAfter check requires atomic member bootstrap in the same writeBatch.',
  },
  {
    id: 5,
    name: 'Reject self-joining an existing organization as owner',
    collection: 'organizations/org_1/members/outsider_uid',
    actor: 'outsider',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Bootstrap owner rule forbids creating owner membership if org already exists.',
  },
  {
    id: 6,
    name: 'Reject role self-escalation by non-owner member',
    collection: 'organizations/org_1/members/assistant_uid',
    actor: 'assistant',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Assistant attempts to update role to owner.',
  },
  {
    id: 7,
    name: 'Reject cross-tenant student query/read',
    collection: 'organizations/org_1/students',
    actor: 'outsider',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    description: 'Authenticated member of org_2 cannot list org_1 students.',
  },
  {
    id: 8,
    name: 'Reject ID poisoning with oversized or invalid document ID',
    collection: 'organizations/org_1/students/' + 'a'.repeat(200),
    actor: 'owner',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'isValidId() rejects IDs longer than 128 chars or containing invalid characters.',
  },
  {
    id: 9,
    name: 'Reject permanent deletion of posted payment record',
    collection: 'organizations/org_1/payments/pay_1',
    actor: 'owner',
    operation: 'delete',
    expected: 'PERMISSION_DENIED',
    description: 'Financial records have allow delete: if false.',
  },
  {
    id: 10,
    name: 'Reject modification of voided payment record',
    collection: 'organizations/org_1/payments/pay_voided',
    actor: 'accountant',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Terminal state lock blocks any mutation once status == voided.',
  },
  {
    id: 11,
    name: 'Reject mutation or deletion of audit logs',
    collection: 'organizations/org_1/auditLogs/log_1',
    actor: 'owner',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    description: 'Audit logs are strictly append-only.',
  },
  {
    id: 12,
    name: 'Reject unverified email or client-forged timestamp',
    collection: 'organizations/org_1/expenses/exp_1',
    actor: 'unverified',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    description: 'Requires email_verified == true and createdAt == request.time.',
  },
];
