import type { MemberRole, OrganizationMember } from '@/src/types/domain';
import { DomainValidationError } from './money';

export type TemaPermission =
  // 1. Students
  | 'students:read'
  | 'students:create'
  | 'students:update'
  | 'students:delete'
  // 2. Groups & Enrollments
  | 'groups:read'
  | 'groups:create'
  | 'groups:update'
  | 'groups:delete'
  | 'groups:manage_enrollment'
  // 3. Sessions
  | 'sessions:read'
  | 'sessions:create'
  | 'sessions:update'
  | 'sessions:cancel'
  | 'sessions:delete'
  // 4. Attendance
  | 'attendance:read'
  | 'attendance:write'
  // 5. Payments & Ledger
  | 'payments:read'
  | 'payments:create'
  | 'payments:settle'
  | 'payments:reverse'
  | 'payments:adjust'
  // 6. Expenses
  | 'expenses:read'
  | 'expenses:create'
  | 'expenses:reverse'
  // 7. Staff & Members
  | 'staff:read'
  | 'staff:invite'
  | 'staff:manage_members'
  // 8. Organization Settings
  | 'org_settings:read'
  | 'org_settings:update'
  // 9. Financial Reports, Reconciliation & Audit Logs
  | 'financial_reports:read'
  | 'financial_reports:reconcile'
  | 'audit_logs:read';

export const RBAC_MATRIX: Record<TemaPermission, ReadonlySet<MemberRole>> = {
  'students:read': new Set(['owner', 'teacher', 'assistant', 'accountant']),
  'students:create': new Set(['owner', 'teacher', 'assistant']),
  'students:update': new Set(['owner', 'teacher', 'assistant']),
  'students:delete': new Set(['owner']),

  'groups:read': new Set(['owner', 'teacher', 'assistant', 'accountant']),
  'groups:create': new Set(['owner', 'teacher', 'assistant']),
  'groups:update': new Set(['owner', 'teacher', 'assistant']),
  'groups:delete': new Set(['owner']),
  'groups:manage_enrollment': new Set(['owner', 'teacher', 'assistant']),

  'sessions:read': new Set(['owner', 'teacher', 'assistant', 'accountant']),
  'sessions:create': new Set(['owner', 'teacher', 'assistant']),
  'sessions:update': new Set(['owner', 'teacher', 'assistant']),
  'sessions:cancel': new Set(['owner', 'teacher', 'assistant']),
  'sessions:delete': new Set(['owner']),

  'attendance:read': new Set(['owner', 'teacher', 'assistant', 'accountant']),
  'attendance:write': new Set(['owner', 'teacher', 'assistant']),

  'payments:read': new Set(['owner', 'accountant', 'assistant']),
  'payments:create': new Set(['owner', 'accountant', 'assistant']),
  'payments:settle': new Set(['owner', 'accountant', 'assistant']),
  'payments:reverse': new Set(['owner', 'accountant']),
  'payments:adjust': new Set(['owner', 'accountant']),

  'expenses:read': new Set(['owner', 'accountant']),
  'expenses:create': new Set(['owner', 'accountant']),
  'expenses:reverse': new Set(['owner', 'accountant']),

  'staff:read': new Set(['owner']),
  'staff:invite': new Set(['owner']),
  'staff:manage_members': new Set(['owner']),

  'org_settings:read': new Set(['owner', 'teacher', 'assistant', 'accountant']),
  'org_settings:update': new Set(['owner']),

  'financial_reports:read': new Set(['owner', 'accountant']),
  'financial_reports:reconcile': new Set(['owner', 'accountant']),
  'audit_logs:read': new Set(['owner', 'accountant']),
};

export const VALID_MEMBER_ROLES = new Set<MemberRole>([
  'owner',
  'teacher',
  'assistant',
  'accountant',
]);

export function hasPermission(role: MemberRole | undefined | null, permission: TemaPermission): boolean {
  if (!role || !VALID_MEMBER_ROLES.has(role)) {
    return false;
  }
  return RBAC_MATRIX[permission].has(role);
}

export function assertVerifiedMembership(
  member: OrganizationMember | null | undefined,
  organizationId: string,
  callerUid: string
): OrganizationMember {
  if (
    !member ||
    member.uid !== callerUid ||
    member.organizationId !== organizationId ||
    member.status !== 'active' ||
    !VALID_MEMBER_ROLES.has(member.role)
  ) {
    throw new DomainValidationError(
      'ليست لديك عضوية نشطة صالحة داخل هذه المنظمة.',
      'MEMBERSHIP_REQUIRED',
      403
    );
  }
  return member;
}

export function assertPermission(
  member: OrganizationMember | null | undefined,
  organizationId: string,
  callerUid: string,
  permission: TemaPermission
): OrganizationMember {
  const verified = assertVerifiedMembership(member, organizationId, callerUid);
  if (!hasPermission(verified.role, permission)) {
    throw new DomainValidationError(
      'صلاحيات دورك الوظيفي لا تسمح بتنفيذ هذا الإجراء.',
      'PERMISSION_DENIED',
      403
    );
  }
  return verified;
}

const SENSITIVE_METADATA_KEY_PATTERN = /(password|passcode|token|secret|api[_-]?key|authorization|credential|private[_-]?key)/i;

export function sanitizeAuditMetadata(
  raw: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const sanitizeValue = (val: unknown, depth: number): unknown => {
    if (depth > 3) return '[TRUNCATED]';
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      return val
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
        .slice(0, 200);
    }
    if (typeof val === 'number' || typeof val === 'boolean') return val;
    if (Array.isArray(val)) {
      return val.slice(0, 10).map((item) => sanitizeValue(item, depth + 1));
    }
    if (typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>).slice(0, 20)) {
        if (SENSITIVE_METADATA_KEY_PATTERN.test(k)) continue;
        out[k.slice(0, 50)] = sanitizeValue(v, depth + 1);
      }
      return out;
    }
    return String(val).slice(0, 100);
  };

  const cleaned = sanitizeValue(raw, 0) as Record<string, unknown>;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
