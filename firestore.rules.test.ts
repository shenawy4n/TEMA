import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'gen-lang-client-0151650891';
const ORG_ALPHA = 'org_alpha';
const ORG_BETA = 'org_beta';

const OWNER_A_UID = 'user_owner_a';
const ASSISTANT_A_UID = 'user_assistant_a';
const INACTIVE_A_UID = 'user_inactive_a';
const OWNER_B_UID = 'user_owner_b';
const UNVERIFIED_UID = 'user_unverified';

let testEnv: RulesTestEnvironment;

async function seedOrganizationsAndUsers() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Seed Org Alpha + Owner A + Assistant A + Inactive Member
    await setDoc(doc(db, 'organizations', ORG_ALPHA), {
      id: ORG_ALPHA,
      name: 'أكاديمية ألفا التعليمية',
      type: 'educational_center',
      ownerId: OWNER_A_UID,
      ownerName: 'أحمد علي',
      phone: '01001234567',
      email: 'owner.a@tema.edu.eg',
      city: 'القاهرة',
      currency: 'EGP',
      language: 'ar',
      themePreference: 'light',
      academicYear: '2026-2027',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_ALPHA, 'members', OWNER_A_UID), {
      uid: OWNER_A_UID,
      organizationId: ORG_ALPHA,
      displayName: 'أحمد علي',
      email: 'owner.a@tema.edu.eg',
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_ALPHA, 'members', ASSISTANT_A_UID), {
      uid: ASSISTANT_A_UID,
      organizationId: ORG_ALPHA,
      displayName: 'سارة محمود',
      email: 'assistant.a@tema.edu.eg',
      role: 'assistant',
      status: 'active',
      invitedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_ALPHA, 'members', INACTIVE_A_UID), {
      uid: INACTIVE_A_UID,
      organizationId: ORG_ALPHA,
      displayName: 'عضو موقوف',
      email: 'inactive.a@tema.edu.eg',
      role: 'teacher',
      status: 'suspended',
      invitedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_ALPHA, 'students', 'stu_alpha_1'), {
      id: 'stu_alpha_1',
      organizationId: ORG_ALPHA,
      fullName: 'يوسف حسن',
      phone: '01011112222',
      gradeLevel: 'الثالث الثانوي',
      status: 'active',
      createdBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_ALPHA, 'payments', 'pay_alpha_1'), {
      id: 'pay_alpha_1',
      organizationId: ORG_ALPHA,
      studentId: 'stu_alpha_1',
      studentName: 'يوسف حسن',
      amount: 500,
      paidAmount: 500,
      dueAmount: 0,
      currency: 'EGP',
      category: 'tuition',
      method: 'cash',
      status: 'posted',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_ALPHA, 'expenses', 'exp_alpha_1'), {
      id: 'exp_alpha_1',
      organizationId: ORG_ALPHA,
      title: 'إيجار القاعة',
      category: 'rent',
      amount: 3000,
      currency: 'EGP',
      status: 'posted',
      expenseDate: '2026-11-01',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Seed Org Beta + Owner B
    await setDoc(doc(db, 'organizations', ORG_BETA), {
      id: ORG_BETA,
      name: 'سنتر بيتا التعليمي',
      type: 'educational_center',
      ownerId: OWNER_B_UID,
      ownerName: 'كريم طارق',
      phone: '01201234567',
      email: 'owner.b@tema.edu.eg',
      city: 'الإسكندرية',
      currency: 'EGP',
      language: 'ar',
      themePreference: 'dark',
      academicYear: '2026-2027',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_BETA, 'members', OWNER_B_UID), {
      uid: OWNER_B_UID,
      organizationId: ORG_BETA,
      displayName: 'كريم طارق',
      email: 'owner.b@tema.edu.eg',
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_BETA, 'students', 'stu_beta_1'), {
      id: 'stu_beta_1',
      organizationId: ORG_BETA,
      fullName: 'مريم عادل',
      phone: '01222223333',
      gradeLevel: 'الثاني الثانوي',
      status: 'active',
      createdBy: OWNER_B_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

describe('TEMA Firestore Security Rules — Emulator Isolation & RBAC Verification', () => {
  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedOrganizationsAndUsers();
  });

  it('rejects cross-organization reads, queries, writes, and deletes between two independent owners', async () => {
    const ownerACtx = testEnv.authenticatedContext(OWNER_A_UID, {
      email: 'owner.a@tema.edu.eg',
      email_verified: true,
    });
    const ownerBCtx = testEnv.authenticatedContext(OWNER_B_UID, {
      email: 'owner.b@tema.edu.eg',
      email_verified: true,
    });

    const dbA = ownerACtx.firestore();
    const dbB = ownerBCtx.firestore();

    // Allowed within own org
    await assertSucceeds(getDoc(doc(dbA, 'organizations', ORG_ALPHA, 'students', 'stu_alpha_1')));
    await assertSucceeds(getDoc(doc(dbB, 'organizations', ORG_BETA, 'students', 'stu_beta_1')));

    // Denied across orgs
    await assertFails(getDoc(doc(dbB, 'organizations', ORG_ALPHA)));
    await assertFails(getDoc(doc(dbB, 'organizations', ORG_ALPHA, 'students', 'stu_alpha_1')));
    await assertFails(
      getDocs(
        query(
          collection(dbB, 'organizations', ORG_ALPHA, 'students'),
          where('organizationId', '==', ORG_ALPHA)
        )
      )
    );
    await assertFails(
      setDoc(doc(dbB, 'organizations', ORG_ALPHA, 'students', 'stu_injected'), {
        id: 'stu_injected',
        organizationId: ORG_ALPHA,
        fullName: 'طالب مخترق',
        phone: '01099998888',
        gradeLevel: 'الأول الثانوي',
        status: 'active',
        createdBy: OWNER_B_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(dbA, 'organizations', ORG_BETA, 'students', 'stu_beta_1'), {
        fullName: 'تعديل غير مصرح',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(deleteDoc(doc(dbA, 'organizations', ORG_BETA, 'students', 'stu_beta_1')));
  });

  it('rejects inactive (suspended) memberships from reading or writing organization resources', async () => {
    const inactiveCtx = testEnv.authenticatedContext(INACTIVE_A_UID, {
      email: 'inactive.a@tema.edu.eg',
      email_verified: true,
    });
    const dbInactive = inactiveCtx.firestore();

    await assertFails(getDoc(doc(dbInactive, 'organizations', ORG_ALPHA)));
    await assertFails(getDoc(doc(dbInactive, 'organizations', ORG_ALPHA, 'students', 'stu_alpha_1')));
    await assertFails(
      setDoc(doc(dbInactive, 'organizations', ORG_ALPHA, 'students', 'stu_by_inactive'), {
        id: 'stu_by_inactive',
        organizationId: ORG_ALPHA,
        fullName: 'طالب غير مصرح',
        phone: '01055556666',
        gradeLevel: 'الأول الثانوي',
        status: 'active',
        createdBy: INACTIVE_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects unverified email accounts on organization creation and tenant writes', async () => {
    const unverifiedCtx = testEnv.authenticatedContext(UNVERIFIED_UID, {
      email: 'unverified@tema.edu.eg',
      email_verified: false,
    });
    const dbUnverified = unverifiedCtx.firestore();

    const batch = writeBatch(dbUnverified);
    batch.set(doc(dbUnverified, 'organizations', 'org_unverified'), {
      id: 'org_unverified',
      name: 'مركز غير مفعل',
      type: 'independent_teacher',
      ownerId: UNVERIFIED_UID,
      ownerName: 'مستخدم غير مفعل',
      phone: '01033334444',
      email: 'unverified@tema.edu.eg',
      city: 'الجيزة',
      currency: 'EGP',
      language: 'ar',
      themePreference: 'light',
      academicYear: '2026-2027',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(dbUnverified, 'organizations', 'org_unverified', 'members', UNVERIFIED_UID), {
      uid: UNVERIFIED_UID,
      organizationId: 'org_unverified',
      displayName: 'مستخدم غير مفعل',
      email: 'unverified@tema.edu.eg',
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await assertFails(batch.commit());
    await assertFails(getDoc(doc(dbUnverified, 'organizations', ORG_ALPHA)));
  });

  it('enforces owner vs assistant permissions and blocks privilege escalation & financial tampering', async () => {
    const ownerACtx = testEnv.authenticatedContext(OWNER_A_UID, {
      email: 'owner.a@tema.edu.eg',
      email_verified: true,
    });
    const assistantACtx = testEnv.authenticatedContext(ASSISTANT_A_UID, {
      email: 'assistant.a@tema.edu.eg',
      email_verified: true,
    });

    const dbOwner = ownerACtx.firestore();
    const dbAssistant = assistantACtx.firestore();

    // Assistant CAN create and update students
    await assertSucceeds(
      setDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'students', 'stu_by_assistant'), {
        id: 'stu_by_assistant',
        organizationId: ORG_ALPHA,
        fullName: 'عمر طارق',
        phone: '01144445555',
        gradeLevel: 'الثالث الثانوي',
        status: 'active',
        createdBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // Assistant CANNOT delete students (owner only)
    await assertFails(deleteDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'students', 'stu_alpha_1')));

    // Owner CAN delete students
    await assertSucceeds(deleteDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'students', 'stu_by_assistant')));

    // Assistant CANNOT escalate own role to owner
    await assertFails(
      updateDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'members', ASSISTANT_A_UID), {
        role: 'owner',
        updatedAt: serverTimestamp(),
      })
    );

    // Assistant CANNOT access or create expenses (owner/accountant only)
    await assertFails(getDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'expenses', 'exp_alpha_1')));

    // Assistant CANNOT update/void posted payments (owner/accountant only), and nobody can delete payments
    await assertFails(
      updateDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'payments', 'pay_alpha_1'), {
        status: 'voided',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(deleteDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'payments', 'pay_alpha_1')));

    // Default-deny catch-all blocks arbitrary top-level paths
    await assertFails(getDoc(doc(dbOwner, 'test', 'connection')));
  });

  it('allows verified user to atomically create an organization with owner member, user update, and initial audit log', async () => {
    const founderUid = 'user_founder_1';
    const founderOrgId = 'org_founder_1';
    const founderCtx = testEnv.authenticatedContext(founderUid, {
      email: 'founder@tema.edu.eg',
      email_verified: true,
    });

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', founderUid), {
        uid: founderUid,
        displayName: 'مؤسس جديد',
        email: 'founder@tema.edu.eg',
        themePreference: 'light',
        organizationIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    const dbFounder = founderCtx.firestore();
    const batch = writeBatch(dbFounder);

    batch.set(doc(dbFounder, 'organizations', founderOrgId), {
      id: founderOrgId,
      name: 'سنتر المؤسس',
      type: 'educational_center',
      ownerId: founderUid,
      ownerName: 'مؤسس جديد',
      phone: '01012345678',
      email: 'founder@tema.edu.eg',
      city: 'القاهرة',
      currency: 'EGP',
      language: 'ar',
      themePreference: 'light',
      academicYear: '2026-2027',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(dbFounder, 'organizations', founderOrgId, 'members', founderUid), {
      uid: founderUid,
      organizationId: founderOrgId,
      displayName: 'مؤسس جديد',
      email: 'founder@tema.edu.eg',
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(dbFounder, 'users', founderUid), {
      displayName: 'مؤسس جديد',
      phone: '01012345678',
      themePreference: 'light',
      activeOrganizationId: founderOrgId,
      organizationIds: [founderOrgId],
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(dbFounder, 'organizations', founderOrgId, 'auditLogs', 'log_bootstrap_1'), {
      id: 'log_bootstrap_1',
      organizationId: founderOrgId,
      actorId: founderUid,
      actorName: 'مؤسس جديد',
      actorRole: 'owner',
      action: 'organization.created',
      entityType: 'organization',
      entityId: founderOrgId,
      summary: 'تم إنشاء المنظمة وتعيين المالك الأول.',
      createdAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });
});
