import { doc, getDoc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { enqueueAuditLog, type AuditActor } from './auditService';
import type {
  Organization,
  OrganizationMember,
  OrganizationType,
  ThemePreference,
  UserProfile,
} from '@/src/types/domain';

export interface CreateOrganizationInput {
  idempotencyKey?: string;
  name: string;
  type: OrganizationType;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  address?: string;
  themePreference: ThemePreference;
  academicYear: string;
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getOrganization(organizationId: string): Promise<Organization | null> {
  const path = `organizations/${organizationId}`;
  try {
    const snap = await getDoc(doc(db, 'organizations', organizationId));
    return snap.exists() ? (snap.data() as Organization) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getOrganizationMembership(
  organizationId: string,
  uid: string
): Promise<OrganizationMember | null> {
  const path = `organizations/${organizationId}/members/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'organizations', organizationId, 'members', uid));
    return snap.exists() ? (snap.data() as OrganizationMember) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function createOrganizationAtomic(
  uid: string,
  userEmail: string,
  existingOrgIds: string[],
  input: CreateOrganizationInput
): Promise<{ organizationId: string }> {
  const orgId = input.idempotencyKey || generateId('org');
  const orgRef = doc(db, 'organizations', orgId);
  const memberRef = doc(db, 'organizations', orgId, 'members', uid);
  const userRef = doc(db, 'users', uid);

  // Guard against duplicate creation if user retries with same idempotencyKey
  try {
    const existingOrg = await getDoc(orgRef);
    if (existingOrg.exists()) {
      return { organizationId: orgId };
    }
  } catch {
    // Non-existent doc may throw permission-denied under strict get rule before creation; proceed safely
  }

  const batch = writeBatch(db);
  const cleanOwnerName = sanitizeText(input.ownerName, 100);
  const cleanOrgName = sanitizeText(input.name, 120);
  const cleanAddress = input.address ? sanitizeText(input.address, 250) : '';

  const orgPayload: Record<string, unknown> = {
    id: orgId,
    name: cleanOrgName,
    type: input.type,
    ownerId: uid,
    ownerName: cleanOwnerName,
    phone: sanitizeText(input.phone, 30),
    email: sanitizeText(input.email || userEmail, 200),
    city: sanitizeText(input.city, 80),
    currency: 'EGP',
    language: 'ar',
    themePreference: input.themePreference,
    academicYear: sanitizeText(input.academicYear, 30),
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (cleanAddress.length > 0) {
    orgPayload.address = cleanAddress;
  }

  batch.set(orgRef, orgPayload);

  batch.set(memberRef, {
    uid,
    organizationId: orgId,
    displayName: cleanOwnerName,
    email: sanitizeText(userEmail, 200),
    role: 'owner',
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const nextOrgIds = existingOrgIds.includes(orgId)
    ? existingOrgIds.slice(0, 10)
    : [...existingOrgIds, orgId].slice(0, 10);

  batch.update(userRef, {
    displayName: cleanOwnerName,
    phone: sanitizeText(input.phone, 30),
    themePreference: input.themePreference,
    activeOrganizationId: orgId,
    organizationIds: nextOrgIds,
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    orgId,
    { uid, displayName: cleanOwnerName, role: 'owner' },
    'organization.created',
    'organization',
    orgId,
    `تم إنشاء المنظمة "${cleanOrgName}" وتعيين المالك الأول.`
  );

  try {
    await batch.commit();
    return { organizationId: orgId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organizations/${orgId}`);
  }
}

export async function updateOrganizationSettings(
  organizationId: string,
  updates: {
    name: string;
    ownerName: string;
    phone: string;
    email: string;
    city: string;
    address?: string;
    themePreference: ThemePreference;
    academicYear: string;
  },
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}`;
  const batch = writeBatch(db);
  const orgRef = doc(db, 'organizations', organizationId);

  const payload: Record<string, unknown> = {
    name: sanitizeText(updates.name, 120),
    ownerName: sanitizeText(updates.ownerName, 100),
    phone: sanitizeText(updates.phone, 30),
    email: sanitizeText(updates.email, 200),
    city: sanitizeText(updates.city, 80),
    address: sanitizeText(updates.address || '', 250),
    themePreference: updates.themePreference,
    academicYear: sanitizeText(updates.academicYear, 30),
    updatedAt: serverTimestamp(),
  };

  batch.update(orgRef, payload);
  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'organization.updated',
    'organization',
    organizationId,
    `تم تحديث إعدادات المنظمة (${payload.name as string}).`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateUserPreferences(
  uid: string,
  updates: {
    displayName?: string;
    phone?: string;
    themePreference?: ThemePreference;
  }
): Promise<void> {
  const path = `users/${uid}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (updates.displayName !== undefined) {
    payload.displayName = sanitizeText(updates.displayName, 100);
  }
  if (updates.phone !== undefined) {
    payload.phone = sanitizeText(updates.phone, 30);
  }
  if (updates.themePreference !== undefined) {
    payload.themePreference = updates.themePreference;
  }
  try {
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
