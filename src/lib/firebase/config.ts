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
    // Force XHR long-polling so proxied/throttled networks (where WebChannel streams stall)
    // connect immediately without hitting the 10-second offline timeout.
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
      },
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

export async function testFirestoreConnection(): Promise<boolean> {
  if (connectionTested) return true;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('تعذر الاتصال بقاعدة بيانات Firestore. يرجى التحقق من إعدادات Firebase.');
      return false;
    }
    return true;
  }
}

if (typeof window !== 'undefined') {
  void testFirestoreConnection();
}
