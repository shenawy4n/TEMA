import type { Organization, OrganizationMember, TenantBlockReason } from '@/src/types/domain';

export function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    if (typeof error === 'string') {
      return (
        error.includes('permission-denied') ||
        error.includes('Missing or insufficient permissions')
      );
    }
    return false;
  }

  const code =
    'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return true;
  }

  if (error instanceof Error) {
    const msg = error.message;
    if (
      msg.includes('permission-denied') ||
      msg.includes('Missing or insufficient permissions')
    ) {
      return true;
    }
    try {
      const parsed = JSON.parse(msg) as { error?: unknown };
      if (
        typeof parsed.error === 'string' &&
        (parsed.error.includes('permission-denied') ||
          parsed.error.includes('Missing or insufficient permissions'))
      ) {
        return true;
      }
    } catch {
      // Not JSON
    }
  }

  return false;
}

export interface ResolveTenantAccessInput {
  orgResult: PromiseSettledResult<Organization | null>;
  memberResult: PromiseSettledResult<OrganizationMember | null>;
  isPermissionDenied: (error: unknown) => boolean;
  formatError: (error: unknown) => string;
}

export interface ResolvedTenantAccessState {
  organization: Organization | null;
  membership: OrganizationMember | null;
  tenantBlockReason: TenantBlockReason;
  error: string | null;
}

export function resolveTenantAccessState({
  orgResult,
  memberResult,
  isPermissionDenied,
  formatError,
}: ResolveTenantAccessInput): ResolvedTenantAccessState {
  if (memberResult.status === 'rejected') {
    if (!isPermissionDenied(memberResult.reason)) {
      return {
        organization: null,
        membership: null,
        tenantBlockReason: null,
        error: formatError(memberResult.reason),
      };
    }
    if (orgResult.status === 'rejected' && !isPermissionDenied(orgResult.reason)) {
      return {
        organization: null,
        membership: null,
        tenantBlockReason: null,
        error: formatError(orgResult.reason),
      };
    }
    return {
      organization: null,
      membership: null,
      tenantBlockReason: null,
      error: null,
    };
  }

  const member = memberResult.value;
  if (!member) {
    if (orgResult.status === 'rejected' && !isPermissionDenied(orgResult.reason)) {
      return {
        organization: null,
        membership: null,
        tenantBlockReason: null,
        error: formatError(orgResult.reason),
      };
    }
    return {
      organization: null,
      membership: null,
      tenantBlockReason: null,
      error: null,
    };
  }

  if (member.status !== 'active') {
    return {
      organization: null,
      membership: member,
      tenantBlockReason: 'membership_suspended',
      error: null,
    };
  }

  if (orgResult.status === 'rejected') {
    if (isPermissionDenied(orgResult.reason)) {
      return {
        organization: null,
        membership: member,
        tenantBlockReason: 'organization_suspended',
        error: null,
      };
    }
    return {
      organization: null,
      membership: null,
      tenantBlockReason: null,
      error: formatError(orgResult.reason),
    };
  }

  const org = orgResult.value;
  if (!org) {
    return {
      organization: null,
      membership: null,
      tenantBlockReason: null,
      error: null,
    };
  }

  if (org.status !== 'active') {
    return {
      organization: null,
      membership: member,
      tenantBlockReason: 'organization_suspended',
      error: null,
    };
  }

  return {
    organization: org,
    membership: member,
    tenantBlockReason: null,
    error: null,
  };
}
