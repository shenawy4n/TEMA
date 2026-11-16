import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext } from './AuthProvider';
import { ensureUserProfile } from '@/src/services/authService';
import { getOrganization, getOrganizationMembership } from '@/src/services/organizationService';
import { getArabicErrorMessage, isPermissionDeniedError } from '@/src/lib/firebase/errors';
import { resolveTenantAccessState } from '@/src/lib/domain/tenantAccess';
import type {
  Organization,
  OrganizationMember,
  TenantBlockReason,
  TenantContextValue,
  UserProfile,
} from '@/src/types/domain';

export const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const authCtx = useContext(AuthContext);
  const user = authCtx?.user ?? null;
  const isAuthReady = authCtx?.isAuthReady ?? false;
  const authRevision = authCtx?.authRevision ?? 0;

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMember | null>(null);
  const [tenantBlockReason, setTenantBlockReason] = useState<TenantBlockReason>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTenantState = useCallback(async () => {
    if (!isAuthReady) return;
    if (!user) {
      setUserProfile(null);
      setOrganization(null);
      setMembership(null);
      setTenantBlockReason(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setTenantBlockReason(null);

    try {
      const profile = await ensureUserProfile(user);
      setUserProfile(profile);

      if (profile.activeOrganizationId && user.emailVerified) {
        const [orgResult, memberResult] = await Promise.allSettled([
          getOrganization(profile.activeOrganizationId),
          getOrganizationMembership(profile.activeOrganizationId, user.uid),
        ]);

        const resolved = resolveTenantAccessState({
          orgResult,
          memberResult,
          isPermissionDenied: isPermissionDeniedError,
          formatError: getArabicErrorMessage,
        });

        setOrganization(resolved.organization);
        setMembership(resolved.membership);
        setTenantBlockReason(resolved.tenantBlockReason);
        setError(resolved.error);
      } else {
        setOrganization(null);
        setMembership(null);
        setTenantBlockReason(null);
      }
    } catch (err) {
      setError(getArabicErrorMessage(err));
      setOrganization(null);
      setMembership(null);
      setTenantBlockReason(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthReady, user, authRevision]);

  useEffect(() => {
    void loadTenantState();
  }, [loadTenantState]);

  const value = useMemo<TenantContextValue>(
    () => ({
      userProfile,
      organization,
      membership,
      tenantBlockReason,
      isLoading,
      error,
      refreshTenant: loadTenantState,
    }),
    [userProfile, organization, membership, tenantBlockReason, isLoading, error, loadTenantState]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
