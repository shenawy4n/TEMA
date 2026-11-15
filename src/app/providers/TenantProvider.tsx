import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext } from './AuthProvider';
import { ensureUserProfile } from '@/src/services/authService';
import { getOrganization, getOrganizationMembership } from '@/src/services/organizationService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import type { Organization, OrganizationMember, TenantContextValue, UserProfile } from '@/src/types/domain';

export const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const authCtx = useContext(AuthContext);
  const user = authCtx?.user ?? null;
  const isAuthReady = authCtx?.isAuthReady ?? false;
  const authRevision = authCtx?.authRevision ?? 0;

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTenantState = useCallback(async () => {
    if (!isAuthReady) return;
    if (!user) {
      setUserProfile(null);
      setOrganization(null);
      setMembership(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const profile = await ensureUserProfile(user);
      setUserProfile(profile);

      if (profile.activeOrganizationId && user.emailVerified) {
        const [org, member] = await Promise.all([
          getOrganization(profile.activeOrganizationId),
          getOrganizationMembership(profile.activeOrganizationId, user.uid),
        ]);

        if (org && member && member.status === 'active') {
          setOrganization(org);
          setMembership(member);
        } else {
          setOrganization(null);
          setMembership(null);
        }
      } else {
        setOrganization(null);
        setMembership(null);
      }
    } catch (err) {
      setError(getArabicErrorMessage(err));
      setOrganization(null);
      setMembership(null);
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
      isLoading,
      error,
      refreshTenant: loadTenantState,
    }),
    [userProfile, organization, membership, isLoading, error, loadTenantState]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
