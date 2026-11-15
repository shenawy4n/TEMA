import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDocFromServer,
  type Firestore,
  type FirestoreSettings,
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';

type ExtendedFirestoreSettings = FirestoreSettings & {
  useFetchStreams?: boolean;
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig &&
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'remixed-project-id'
);

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

function createFirestoreClient(): Firestore {
  try {
    if (typeof window !== 'undefined') {
      const browserSettings: ExtendedFirestoreSettings = {
        // Use classic XHR long-polling instead of Fetch ReadableStream to avoid 10s
        // WebChannel/stream stalls inside cross-origin iframes and buffered proxies.
        experimentalForceLongPolling: true,
        experimentalLongPollingOptions: { timeoutSeconds: 5 },
        useFetchStreams: false,
      };
      return initializeFirestore(
        app,
        browserSettings,
        firebaseConfig.firestoreDatabaseId
      );
    }
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
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
