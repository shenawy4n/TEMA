import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';

export const isFirebaseConfigured = Boolean(
  firebaseConfig &&
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'remixed-project-id'
);

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

function createFirestoreClient(): Firestore {
  try {
    return initializeFirestore(
      app,
      { experimentalAutoDetectLongPolling: true },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreClient();
export const auth = getAuth(app);
auth.languageCode = 'ar';

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

let connectionTested = false;
let inFlightConnectionTest: Promise<boolean> | null = null;

function waitForBootReadiness(): Promise<void> {
  const waitForLoad =
    typeof document === 'undefined' || document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          window.addEventListener('load', () => resolve(), { once: true });
          setTimeout(resolve, 2500);
        });

  const waitForAuth = Promise.race([
    auth.authStateReady().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);

  return Promise.all([waitForLoad, waitForAuth]).then(() => undefined);
}

export async function testFirestoreConnection(): Promise<boolean> {
  if (!isFirebaseConfigured) return false;
  if (connectionTested) return true;
  if (inFlightConnectionTest) return inFlightConnectionTest;

  inFlightConnectionTest = (async () => {
    try {
      if (typeof window !== 'undefined') {
        await waitForBootReadiness();
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false;
      }
      await getDocFromServer(doc(db, 'test', 'connection'));
      connectionTested = true;
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('the client is offline')
      ) {
        console.error('تعذر الاتصال بقاعدة بيانات Firestore. يرجى التحقق من إعدادات Firebase.');
        return false;
      }
      connectionTested = true;
      return true;
    } finally {
      inFlightConnectionTest = null;
    }
  })();

  return inFlightConnectionTest;
}

if (typeof window !== 'undefined') {
  void testFirestoreConnection();
}
