import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/src/lib/firebase/config';

export interface AuthContextValue {
  user: User | null;
  isAuthReady: boolean;
  authRevision: number;
  reloadUser: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthReady(true);
      setAuthRevision((prev) => prev + 1);
    });
    return () => unsubscribe();
  }, []);

  const reloadUser = useCallback(async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    await current.reload();
    if (current.emailVerified) {
      await current.getIdToken(true);
    }
    setUser(current);
    setAuthRevision((prev) => prev + 1);
    return current.emailVerified;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthReady, authRevision, reloadUser }),
    [user, isAuthReady, authRevision, reloadUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
