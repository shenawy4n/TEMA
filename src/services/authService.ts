import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import type { ThemePreference, UserProfile } from '@/src/types/domain';

const inFlightProfiles = new Map<string, Promise<UserProfile>>();

export async function ensureUserProfile(
  user: User,
  fallbackDisplayName?: string,
  preferredTheme: ThemePreference = 'light'
): Promise<UserProfile> {
  const existingPromise = inFlightProfiles.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const task = (async (): Promise<UserProfile> => {
    const path = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);

    const resolvedName = sanitizeText(
      fallbackDisplayName || user.displayName || user.email?.split('@')[0] || 'مستخدم TEMA',
      100
    );
    const resolvedEmail = sanitizeText(user.email || 'user@tema.edu.eg', 200);

    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        if (snap.exists()) {
          const existingData = snap.data() as UserProfile;
          if (fallbackDisplayName && existingData.displayName !== resolvedName) {
            tx.update(userRef, {
              displayName: resolvedName,
              updatedAt: serverTimestamp(),
            });
            return { ...existingData, displayName: resolvedName };
          }
          return existingData;
        }

        const newProfile = {
          uid: user.uid,
          displayName: resolvedName,
          email: resolvedEmail,
          themePreference: preferredTheme,
          organizationIds: [] as string[],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        tx.set(userRef, newProfile);
        return newProfile as UserProfile;
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  })();

  inFlightProfiles.set(user.uid, task);
  try {
    return await task;
  } finally {
    inFlightProfiles.delete(user.uid);
  }
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  await ensureUserProfile(cred.user);
  return cred.user;
}

export async function registerWithEmail(
  displayName: string,
  email: string,
  password: string
): Promise<User> {
  const cleanName = sanitizeText(displayName, 100);
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(cred.user, { displayName: cleanName });
  await ensureUserProfile(cred.user, cleanName);
  if (!cred.user.emailVerified) {
    await sendEmailVerification(cred.user);
  }
  return cred.user;
}

export async function loginWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(cred.user);
  return cred.user;
}

export async function sendResetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerification(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}
