import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import type { MemberRole } from '../../src/types/domain';

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export interface VerifiedMembership {
  uid: string;
  organizationId: string;
  role: MemberRole;
  status: 'active' | 'invited' | 'suspended';
}

function getFirebaseAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }
  return initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export async function verifyFirebaseBearerToken(
  authorizationHeader: string | undefined
): Promise<{ ok: true; user: VerifiedUser; idToken: string } | { ok: false; status: number; error: string }> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing or invalid Authorization header.' };
  }

  const idToken = authorizationHeader.slice('Bearer '.length).trim();
  if (!idToken || idToken.length > 8192) {
    return { ok: false, status: 401, error: 'Invalid authentication token.' };
  }

  try {
    const app = getFirebaseAdminApp();
    const decoded = await getAuth(app).verifyIdToken(idToken, true);
    if (!decoded.email_verified) {
      return {
        ok: false,
        status: 403,
        error: 'Email verification is required before using protected operations.',
      };
    }

    return {
      ok: true,
      idToken,
      user: {
        uid: decoded.uid,
        email: decoded.email || '',
        emailVerified: Boolean(decoded.email_verified),
      },
    };
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized or expired session token.' };
  }
}

interface FirestoreStringField {
  stringValue?: string;
}

interface FirestoreRestDoc {
  fields?: {
    uid?: FirestoreStringField;
    organizationId?: FirestoreStringField;
    role?: FirestoreStringField;
    status?: FirestoreStringField;
  };
}

const VALID_ROLES = new Set<MemberRole>(['owner', 'teacher', 'assistant', 'accountant']);

export async function verifyActiveOrganizationMembership(
  organizationId: string,
  uid: string,
  idToken: string
): Promise<{ ok: true; membership: VerifiedMembership } | { ok: false; status: number; error: string }> {
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  const endpoint =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/${encodeURIComponent(databaseId)}/documents/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(uid)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (response.status === 403 || response.status === 404) {
      return { ok: false, status: 403, error: 'Active organization membership is required.' };
    }
    if (!response.ok) {
      return { ok: false, status: 503, error: 'Unable to verify organization membership.' };
    }

    const doc = (await response.json()) as FirestoreRestDoc;
    const role = doc.fields?.role?.stringValue as MemberRole | undefined;
    const status = doc.fields?.status?.stringValue;
    const docOrgId = doc.fields?.organizationId?.stringValue;
    const docUid = doc.fields?.uid?.stringValue;

    if (
      docUid !== uid ||
      docOrgId !== organizationId ||
      status !== 'active' ||
      !role ||
      !VALID_ROLES.has(role)
    ) {
      return { ok: false, status: 403, error: 'Membership is inactive or invalid.' };
    }

    return {
      ok: true,
      membership: {
        uid,
        organizationId,
        role,
        status: 'active',
      },
    };
  } catch {
    return { ok: false, status: 503, error: 'Membership verification service unavailable.' };
  }
}
