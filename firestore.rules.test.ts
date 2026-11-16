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
const ORG_SUSPENDED = 'org_suspended';

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
      amountPiasters: 50000,
      paidAmountPiasters: 50000,
      dueAmountPiasters: 0,
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
      amountPiasters: 300000,
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

    // Seed Suspended Org + Active Owner A membership inside it
    await setDoc(doc(db, 'organizations', ORG_SUSPENDED), {
      id: ORG_SUSPENDED,
      name: 'سنتر موقوف',
      type: 'educational_center',
      ownerId: OWNER_A_UID,
      ownerName: 'أحمد علي',
      phone: '01001234567',
      email: 'suspended@tema.edu.eg',
      city: 'القاهرة',
      currency: 'EGP',
      language: 'ar',
      themePreference: 'light',
      academicYear: '2026-2027',
      status: 'suspended',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_SUSPENDED, 'members', OWNER_A_UID), {
      uid: OWNER_A_UID,
      organizationId: ORG_SUSPENDED,
      displayName: 'أحمد علي',
      email: 'owner.a@tema.edu.eg',
      role: 'owner',
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_SUSPENDED, 'students', 'stu_susp_1'), {
      id: 'stu_susp_1',
      organizationId: ORG_SUSPENDED,
      fullName: 'طالب منظمة موقوفة',
      phone: '01088887777',
      gradeLevel: 'الثالث الثانوي',
      status: 'active',
      createdBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'organizations', ORG_SUSPENDED, 'payments', 'pay_susp_1'), {
      id: 'pay_susp_1',
      organizationId: ORG_SUSPENDED,
      studentId: 'stu_susp_1',
      studentName: 'طالب منظمة موقوفة',
      amount: 400,
      paidAmount: 400,
      dueAmount: 0,
      amountPiasters: 40000,
      paidAmountPiasters: 40000,
      dueAmountPiasters: 0,
      currency: 'EGP',
      category: 'tuition',
      method: 'cash',
      status: 'posted',
      recordedBy: OWNER_A_UID,
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

  it('rejects audit log actorRole forgery, arbitrary studentCount tampering, non-deterministic enrollment/attendance IDs, invalid sessions, and ledger mutation', async () => {
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

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'organizations', ORG_ALPHA, 'groups', 'grp_alpha_1'), {
        id: 'grp_alpha_1',
        organizationId: ORG_ALPHA,
        name: 'مجموعة الفيزياء',
        subject: 'فيزياء',
        gradeLevel: 'الثالث الثانوي',
        teacherId: OWNER_A_UID,
        teacherName: 'أحمد علي',
        capacity: 30,
        studentCount: 0,
        monthlyFee: 350,
        status: 'active',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'organizations', ORG_ALPHA, 'sessions', 'ses_cancelled_1'), {
        id: 'ses_cancelled_1',
        organizationId: ORG_ALPHA,
        groupId: 'grp_alpha_1',
        groupName: 'مجموعة الفيزياء',
        teacherId: OWNER_A_UID,
        teacherName: 'أحمد علي',
        title: 'حصة ملغاة',
        date: '2026-11-20',
        startTime: '16:00',
        endTime: '18:00',
        status: 'cancelled',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_1'), {
        id: 'ldg_1',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_alpha_1',
        studentId: 'stu_alpha_1',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'قيد استحقاق',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      });
    });

    // 1. Assistant cannot forge actorRole: 'owner' in auditLogs
    await assertFails(
      setDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'auditLogs', 'log_forged'), {
        id: 'log_forged',
        organizationId: ORG_ALPHA,
        actorId: ASSISTANT_A_UID,
        actorName: 'سارة محمود',
        actorRole: 'owner',
        action: 'student.created',
        entityType: 'student',
        entityId: 'stu_alpha_1',
        summary: 'تزوير الدور الوظيفي',
        createdAt: serverTimestamp(),
      })
    );

    // 2. Assistant cannot arbitrarily tamper with group studentCount
    await assertFails(
      updateDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_alpha_1'), {
        studentCount: 25,
        updatedAt: serverTimestamp(),
      })
    );

    // 3. Enrollment with non-deterministic ID is rejected
    await assertFails(
      setDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'random_id_1'), {
        id: 'random_id_1',
        organizationId: ORG_ALPHA,
        groupId: 'grp_alpha_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupName: 'مجموعة الفيزياء',
        status: 'active',
        enrolledBy: ASSISTANT_A_UID,
        enrolledAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 4. Session with endTime <= startTime is rejected
    await assertFails(
      setDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'sessions', 'ses_invalid_time'), {
        id: 'ses_invalid_time',
        organizationId: ORG_ALPHA,
        groupId: 'grp_alpha_1',
        groupName: 'مجموعة الفيزياء',
        teacherId: OWNER_A_UID,
        teacherName: 'أحمد علي',
        title: 'حصة وقت خاطئ',
        date: '2026-11-21',
        startTime: '18:00',
        endTime: '16:00',
        status: 'scheduled',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 5. Attendance on cancelled session or unenrolled student is rejected
    await assertFails(
      setDoc(doc(dbAssistant, 'organizations', ORG_ALPHA, 'attendance', 'ses_cancelled_1_stu_alpha_1'), {
        id: 'ses_cancelled_1_stu_alpha_1',
        organizationId: ORG_ALPHA,
        sessionId: 'ses_cancelled_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupId: 'grp_alpha_1',
        status: 'present',
        recordedBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 6. Ledger entries are strictly append-only (no updates or deletes)
    await assertFails(
      updateDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_1'), {
        amountPiasters: 100,
      })
    );
    await assertFails(deleteDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_1')));
  });

  it('blocks all access (even active owners) to suspended organizations across root document and subcollections', async () => {
    const ownerACtx = testEnv.authenticatedContext(OWNER_A_UID, {
      email: 'owner.a@tema.edu.eg',
      email_verified: true,
    });
    const dbOwner = ownerACtx.firestore();

    // User can read only their own membership doc so client UI can detect suspended status accurately
    await assertSucceeds(getDoc(doc(dbOwner, 'organizations', ORG_SUSPENDED, 'members', OWNER_A_UID)));

    // Organization root doc & updates are completely blocked when suspended
    await assertFails(getDoc(doc(dbOwner, 'organizations', ORG_SUSPENDED)));
    await assertFails(
      updateDoc(doc(dbOwner, 'organizations', ORG_SUSPENDED), {
        name: 'محاولة تعديل منظمة موقوفة',
        updatedAt: serverTimestamp(),
      })
    );

    // Subcollection reads, queries, and writes are all blocked when suspended
    await assertFails(getDoc(doc(dbOwner, 'organizations', ORG_SUSPENDED, 'students', 'stu_susp_1')));
    await assertFails(
      getDocs(
        query(
          collection(dbOwner, 'organizations', ORG_SUSPENDED, 'students'),
          where('organizationId', '==', ORG_SUSPENDED)
        )
      )
    );
    await assertFails(
      setDoc(doc(dbOwner, 'organizations', ORG_SUSPENDED, 'students', 'stu_susp_new'), {
        id: 'stu_susp_new',
        organizationId: ORG_SUSPENDED,
        fullName: 'طالب جديد غير مسموح',
        phone: '01077776666',
        gradeLevel: 'الثالث الثانوي',
        status: 'active',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(getDoc(doc(dbOwner, 'organizations', ORG_SUSPENDED, 'payments', 'pay_susp_1')));
    await assertFails(
      getDocs(
        query(
          collection(dbOwner, 'organizations', ORG_SUSPENDED, 'members'),
          where('organizationId', '==', ORG_SUSPENDED)
        )
      )
    );

    // Same user's active organization remains unaffected
    await assertSucceeds(getDoc(doc(dbOwner, 'organizations', ORG_ALPHA)));
  });

  it('enforces Step B ledgerEntries security: rejects orphan/duplicate/tampered ledger entries while preserving atomic payment, settlement, void, expense, and adjustment flows', async () => {
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

    // 1. Direct standalone ledger entry pointing to non-existent payment/expense is REJECTED (even for owner)
    await assertFails(
      setDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_missing_charge'), {
        id: 'pay_missing_charge',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_missing',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'قيد مالي مزور بدون فاتورة',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      })
    );

    // 2. Direct standalone ledger entry referencing already-existing pay_alpha_1 outside atomic batch is REJECTED
    await assertFails(
      setDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_alpha_1_charge'), {
        id: 'pay_alpha_1_charge',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_alpha_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'محاولة إعادة حقن قيد استحقاق',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      })
    );

    // 3. Atomic payment creation with random/duplicate ledger ID is REJECTED
    const nonDeterministicBatch = writeBatch(dbAssistant);
    nonDeterministicBatch.set(doc(dbAssistant, 'organizations', ORG_ALPHA, 'payments', 'pay_nondet_1'), {
      id: 'pay_nondet_1',
      organizationId: ORG_ALPHA,
      studentId: 'stu_alpha_1',
      studentName: 'يوسف حسن',
      groupId: '',
      amount: 500,
      paidAmount: 200,
      dueAmount: 300,
      amountPiasters: 50000,
      paidAmountPiasters: 20000,
      dueAmountPiasters: 30000,
      currency: 'EGP',
      category: 'tuition',
      method: 'cash',
      status: 'partial',
      recordedBy: ASSISTANT_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    nonDeterministicBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_random_spoof'),
      {
        id: 'ldg_random_spoof',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_nondet_1',
        studentId: 'stu_alpha_1',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'معرف عشوائي مكرر',
        recordedBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertFails(nonDeterministicBatch.commit());

    // 4. Atomic partial payment creation with mismatched ledger amount is REJECTED
    const mismatchedAmountBatch = writeBatch(dbAssistant);
    mismatchedAmountBatch.set(doc(dbAssistant, 'organizations', ORG_ALPHA, 'payments', 'pay_mismatch_1'), {
      id: 'pay_mismatch_1',
      organizationId: ORG_ALPHA,
      studentId: 'stu_alpha_1',
      studentName: 'يوسف حسن',
      groupId: '',
      amount: 500,
      paidAmount: 0,
      dueAmount: 500,
      amountPiasters: 50000,
      paidAmountPiasters: 0,
      dueAmountPiasters: 50000,
      currency: 'EGP',
      category: 'tuition',
      method: 'cash',
      status: 'pending',
      recordedBy: ASSISTANT_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    mismatchedAmountBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_mismatch_1_charge'),
      {
        id: 'pay_mismatch_1_charge',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_mismatch_1',
        studentId: 'stu_alpha_1',
        amountPiasters: 10000,
        amount: 100,
        currency: 'EGP',
        description: 'مبلغ قيد غير مطابق للفاتورة',
        recordedBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertFails(mismatchedAmountBatch.commit());

    // 5. Valid atomic partial payment creation by assistant SUCCEEDS
    const validCreateBatch = writeBatch(dbAssistant);
    validCreateBatch.set(doc(dbAssistant, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
      id: 'pay_flow_1',
      organizationId: ORG_ALPHA,
      studentId: 'stu_alpha_1',
      studentName: 'يوسف حسن',
      groupId: '',
      amount: 500,
      paidAmount: 200,
      dueAmount: 300,
      amountPiasters: 50000,
      paidAmountPiasters: 20000,
      dueAmountPiasters: 30000,
      currency: 'EGP',
      category: 'tuition',
      method: 'cash',
      status: 'partial',
      recordedBy: ASSISTANT_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    validCreateBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_flow_1_charge'),
      {
        id: 'pay_flow_1_charge',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_flow_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupId: '',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'استحقاق مالي للطالب',
        recordedBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    validCreateBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_flow_1_pay_init'),
      {
        id: 'pay_flow_1_pay_init',
        organizationId: ORG_ALPHA,
        entryType: 'payment',
        direction: 'credit',
        entityType: 'payment',
        entityId: 'pay_flow_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupId: '',
        amountPiasters: 20000,
        amount: 200,
        currency: 'EGP',
        relatedEntryId: 'pay_flow_1_charge',
        description: 'تحصيل دفعة أولى',
        recordedBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertSucceeds(validCreateBatch.commit());

    // 6. Assistant CANNOT create a payment adjustment (owner/accountant only)
    const assistantAdjBatch = writeBatch(dbAssistant);
    assistantAdjBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_adj_ass_1'),
      {
        id: 'ldg_adj_ass_1',
        organizationId: ORG_ALPHA,
        entryType: 'adjustment',
        direction: 'credit',
        entityType: 'payment',
        entityId: 'pay_flow_1',
        studentId: 'stu_alpha_1',
        groupId: '',
        amountPiasters: 5000,
        amount: 50,
        currency: 'EGP',
        idempotencyKey: 'ass_1',
        description: 'خصم غير مصرح من مساعد',
        recordedBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    assistantAdjBatch.set(doc(dbAssistant, 'organizations', ORG_ALPHA, 'idempotencyKeys', 'adj_ass_1'), {
      id: 'adj_ass_1',
      organizationId: ORG_ALPHA,
      entityType: 'ledger_entry',
      entityId: 'ldg_adj_ass_1',
      createdBy: ASSISTANT_A_UID,
      createdAt: serverTimestamp(),
    });
    await assertFails(assistantAdjBatch.commit());

    // 7. Owner valid adjustment WITHOUT atomic payments counter update FAILS,
    //    and spoofing payments counter without ledgerEntry FAILS
    const adjWithoutPaymentUpdate = writeBatch(dbOwner);
    adjWithoutPaymentUpdate.set(
      doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_adj_no_pay'),
      {
        id: 'ldg_adj_no_pay',
        organizationId: ORG_ALPHA,
        entryType: 'adjustment',
        direction: 'credit',
        entityType: 'payment',
        entityId: 'pay_flow_1',
        studentId: 'stu_alpha_1',
        groupId: '',
        amountPiasters: 5000,
        amount: 50,
        currency: 'EGP',
        idempotencyKey: 'no_pay_1',
        description: 'تسوية بدون تحديث عداد الفاتورة',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    adjWithoutPaymentUpdate.set(
      doc(dbOwner, 'organizations', ORG_ALPHA, 'idempotencyKeys', 'adj_no_pay_1'),
      {
        id: 'adj_no_pay_1',
        organizationId: ORG_ALPHA,
        entityType: 'ledger_entry',
        entityId: 'ldg_adj_no_pay',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertFails(adjWithoutPaymentUpdate.commit());

    await assertFails(
      updateDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
        adjustedCreditPiasters: 5000,
        adjustedDebitPiasters: 0,
        lastAdjustmentEntryId: 'ldg_adj_fake',
        updatedAt: serverTimestamp(),
      })
    );

    // 7b. Owner valid adjustment WITH atomic payment cumulative counter + idempotencyKeys lock SUCCEEDS,
    //     duplicate replay FAILS, and cumulative multi-adjustment overflow across different keys FAILS
    const ownerAdjBatch = writeBatch(dbOwner);
    ownerAdjBatch.update(doc(dbOwner, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
      adjustedCreditPiasters: 5000,
      adjustedDebitPiasters: 0,
      lastAdjustmentEntryId: 'ldg_adj_ok_1',
      updatedAt: serverTimestamp(),
    });
    ownerAdjBatch.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_adj_ok_1'), {
      id: 'ldg_adj_ok_1',
      organizationId: ORG_ALPHA,
      entryType: 'adjustment',
      direction: 'credit',
      entityType: 'payment',
      entityId: 'pay_flow_1',
      studentId: 'stu_alpha_1',
      groupId: '',
      amountPiasters: 5000,
      amount: 50,
      currency: 'EGP',
      idempotencyKey: 'ok_1',
      description: 'خصم معتمد من المالك',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
    });
    ownerAdjBatch.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'idempotencyKeys', 'adj_ok_1'), {
      id: 'adj_ok_1',
      organizationId: ORG_ALPHA,
      entityType: 'ledger_entry',
      entityId: 'ldg_adj_ok_1',
      createdBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(ownerAdjBatch.commit());

    // Second credit adjustment with different idempotencyKey within limit (50 + 450 = 500 EGP) SUCCEEDS
    const secondAdjWithinCap = writeBatch(dbOwner);
    secondAdjWithinCap.update(doc(dbOwner, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
      adjustedCreditPiasters: 50000,
      adjustedDebitPiasters: 0,
      lastAdjustmentEntryId: 'ldg_adj_ok_2',
      updatedAt: serverTimestamp(),
    });
    secondAdjWithinCap.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_adj_ok_2'), {
      id: 'ldg_adj_ok_2',
      organizationId: ORG_ALPHA,
      entryType: 'adjustment',
      direction: 'credit',
      entityType: 'payment',
      entityId: 'pay_flow_1',
      studentId: 'stu_alpha_1',
      groupId: '',
      amountPiasters: 45000,
      amount: 450,
      currency: 'EGP',
      idempotencyKey: 'ok_2',
      description: 'تسوية إضافية ضمن حد الفاتورة',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
    });
    secondAdjWithinCap.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'idempotencyKeys', 'adj_ok_2'), {
      id: 'adj_ok_2',
      organizationId: ORG_ALPHA,
      entityType: 'ledger_entry',
      entityId: 'ldg_adj_ok_2',
      createdBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(secondAdjWithinCap.commit());

    // Third credit adjustment with new key exceeding invoice total (500 + 1 = 501 > 500 EGP) FAILS
    const overflowAdjBatch = writeBatch(dbOwner);
    overflowAdjBatch.update(doc(dbOwner, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
      adjustedCreditPiasters: 50100,
      adjustedDebitPiasters: 0,
      lastAdjustmentEntryId: 'ldg_adj_overflow_3',
      updatedAt: serverTimestamp(),
    });
    overflowAdjBatch.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_adj_overflow_3'), {
      id: 'ldg_adj_overflow_3',
      organizationId: ORG_ALPHA,
      entryType: 'adjustment',
      direction: 'credit',
      entityType: 'payment',
      entityId: 'pay_flow_1',
      studentId: 'stu_alpha_1',
      groupId: '',
      amountPiasters: 100,
      amount: 1,
      currency: 'EGP',
      idempotencyKey: 'overflow_3',
      description: 'محاولة تجاوز إجمالي قيمة الفاتورة',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
    });
    overflowAdjBatch.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'idempotencyKeys', 'adj_overflow_3'), {
      id: 'adj_overflow_3',
      organizationId: ORG_ALPHA,
      entityType: 'ledger_entry',
      entityId: 'ldg_adj_overflow_3',
      createdBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
    });
    await assertFails(overflowAdjBatch.commit());

    const replayAdjBatch = writeBatch(dbOwner);
    replayAdjBatch.update(doc(dbOwner, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
      adjustedCreditPiasters: 55000,
      adjustedDebitPiasters: 0,
      lastAdjustmentEntryId: 'ldg_adj_ok_1',
      updatedAt: serverTimestamp(),
    });
    replayAdjBatch.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'ldg_adj_ok_1'), {
      id: 'ldg_adj_ok_1',
      organizationId: ORG_ALPHA,
      entryType: 'adjustment',
      direction: 'credit',
      entityType: 'payment',
      entityId: 'pay_flow_1',
      studentId: 'stu_alpha_1',
      groupId: '',
      amountPiasters: 5000,
      amount: 50,
      currency: 'EGP',
      idempotencyKey: 'ok_1',
      description: 'تكرار تسوية',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
    });
    await assertFails(replayAdjBatch.commit());

    // 8. Valid atomic settlement by assistant SUCCEEDS
    const validSettleBatch = writeBatch(dbAssistant);
    validSettleBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
      paidAmount: 500,
      dueAmount: 0,
      paidAmountPiasters: 50000,
      dueAmountPiasters: 0,
      status: 'posted',
      method: 'instapay',
      referenceNumber: 'INSTA-123',
      updatedAt: serverTimestamp(),
    });
    validSettleBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_flow_1_pay_50000'),
      {
        id: 'pay_flow_1_pay_50000',
        organizationId: ORG_ALPHA,
        entryType: 'payment',
        direction: 'credit',
        entityType: 'payment',
        entityId: 'pay_flow_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupId: '',
        amountPiasters: 30000,
        amount: 300,
        currency: 'EGP',
        description: 'سداد القسط المتبقي',
        recordedBy: ASSISTANT_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertSucceeds(validSettleBatch.commit());

    // 9. Valid atomic payment void + reversals by owner SUCCEEDS
    const validVoidBatch = writeBatch(dbOwner);
    validVoidBatch.update(doc(dbOwner, 'organizations', ORG_ALPHA, 'payments', 'pay_flow_1'), {
      status: 'voided',
      voidReason: 'إلغاء فاتورة للاختبار',
      voidedBy: OWNER_A_UID,
      voidedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    validVoidBatch.set(
      doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_flow_1_rev_charge'),
      {
        id: 'pay_flow_1_rev_charge',
        organizationId: ORG_ALPHA,
        entryType: 'reversal',
        direction: 'credit',
        entityType: 'payment',
        entityId: 'pay_flow_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupId: '',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'عكس الاستحقاق',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    validVoidBatch.set(
      doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'pay_flow_1_rev_paid'),
      {
        id: 'pay_flow_1_rev_paid',
        organizationId: ORG_ALPHA,
        entryType: 'reversal',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_flow_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupId: '',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'عكس التحصيل',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertSucceeds(validVoidBatch.commit());

    // 10. Expense charge spoofing studentId fails, while valid atomic expense create + void SUCCEED
    const spoofedExpenseBatch = writeBatch(dbOwner);
    spoofedExpenseBatch.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'expenses', 'exp_spoof_1'), {
      id: 'exp_spoof_1',
      organizationId: ORG_ALPHA,
      title: 'مصروف مزور',
      category: 'other',
      amount: 100,
      amountPiasters: 10000,
      currency: 'EGP',
      status: 'posted',
      expenseDate: '2026-11-16',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    spoofedExpenseBatch.set(
      doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'exp_spoof_1_charge'),
      {
        id: 'exp_spoof_1_charge',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'expense',
        entityId: 'exp_spoof_1',
        studentId: 'stu_alpha_1',
        amountPiasters: 10000,
        amount: 100,
        currency: 'EGP',
        description: 'حقن studentId داخل قيد مصروف',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertFails(spoofedExpenseBatch.commit());

    const validExpenseCreate = writeBatch(dbOwner);
    validExpenseCreate.set(doc(dbOwner, 'organizations', ORG_ALPHA, 'expenses', 'exp_flow_1'), {
      id: 'exp_flow_1',
      organizationId: ORG_ALPHA,
      title: 'طباعة ملازم',
      category: 'printing',
      amount: 250,
      amountPiasters: 25000,
      currency: 'EGP',
      status: 'posted',
      expenseDate: '2026-11-16',
      recordedBy: OWNER_A_UID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    validExpenseCreate.set(
      doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'exp_flow_1_charge'),
      {
        id: 'exp_flow_1_charge',
        organizationId: ORG_ALPHA,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'expense',
        entityId: 'exp_flow_1',
        amountPiasters: 25000,
        amount: 250,
        currency: 'EGP',
        description: 'مصروف تشغيلي: طباعة ملازم',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertSucceeds(validExpenseCreate.commit());

    const validExpenseVoid = writeBatch(dbOwner);
    validExpenseVoid.update(doc(dbOwner, 'organizations', ORG_ALPHA, 'expenses', 'exp_flow_1'), {
      status: 'voided',
      voidReason: 'إلغاء مصروف للاختبار',
      voidedBy: OWNER_A_UID,
      voidedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    validExpenseVoid.set(
      doc(dbOwner, 'organizations', ORG_ALPHA, 'ledgerEntries', 'exp_flow_1_rev_charge'),
      {
        id: 'exp_flow_1_rev_charge',
        organizationId: ORG_ALPHA,
        entryType: 'reversal',
        direction: 'credit',
        entityType: 'expense',
        entityId: 'exp_flow_1',
        amountPiasters: 25000,
        amount: 250,
        currency: 'EGP',
        description: 'عكس مصروف تشغيلي',
        recordedBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
      }
    );
    await assertSucceeds(validExpenseVoid.commit());
  });

  it('enforces Step C groups.studentCount hardening: rejects arbitrary/replay/over-capacity/cross-tenant tampering while allowing atomic enrollment lifecycle', async () => {
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

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
        id: 'grp_step_c_1',
        organizationId: ORG_ALPHA,
        name: 'مجموعة الكيمياء',
        subject: 'كيمياء',
        gradeLevel: 'الثالث الثانوي',
        teacherId: OWNER_A_UID,
        teacherName: 'أحمد علي',
        capacity: 1,
        studentCount: 0,
        monthlyFee: 300,
        status: 'active',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'organizations', ORG_ALPHA, 'groups', 'grp_paused_c'), {
        id: 'grp_paused_c',
        organizationId: ORG_ALPHA,
        name: 'مجموعة متوقفة',
        subject: 'أحياء',
        gradeLevel: 'الثالث الثانوي',
        teacherId: OWNER_A_UID,
        teacherName: 'أحمد علي',
        capacity: 10,
        studentCount: 0,
        monthlyFee: 300,
        status: 'paused',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'organizations', ORG_ALPHA, 'students', 'stu_alpha_2'), {
        id: 'stu_alpha_2',
        organizationId: ORG_ALPHA,
        fullName: 'سلمى إبراهيم',
        phone: '01066665555',
        gradeLevel: 'الثالث الثانوي',
        status: 'active',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'organizations', ORG_ALPHA, 'students', 'stu_archived_c'), {
        id: 'stu_archived_c',
        organizationId: ORG_ALPHA,
        fullName: 'طالب مؤرشف',
        phone: '01077778888',
        gradeLevel: 'الثالث الثانوي',
        status: 'archived',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    // 1. Even OWNER cannot directly update studentCount without atomic enrollment proof
    await assertFails(
      updateDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
        studentCount: 1,
        updatedAt: serverTimestamp(),
      })
    );

    // 2. Group creation with non-zero studentCount or pre-set lastEnrollmentId is REJECTED
    await assertFails(
      setDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'groups', 'grp_bad_init'), {
        id: 'grp_bad_init',
        organizationId: ORG_ALPHA,
        name: 'مجموعة بعداد مزور',
        subject: 'فيزياء',
        gradeLevel: 'الثالث الثانوي',
        teacherId: OWNER_A_UID,
        teacherName: 'أحمد علي',
        capacity: 10,
        studentCount: 5,
        monthlyFee: 300,
        status: 'active',
        createdBy: OWNER_A_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 3. Standalone enrollment creation without atomic group studentCount +1 is REJECTED
    await assertFails(
      setDoc(
        doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_step_c_1_stu_alpha_1'),
        {
          id: 'grp_step_c_1_stu_alpha_1',
          organizationId: ORG_ALPHA,
          groupId: 'grp_step_c_1',
          studentId: 'stu_alpha_1',
          studentName: 'يوسف حسن',
          groupName: 'مجموعة الكيمياء',
          status: 'active',
          enrolledBy: ASSISTANT_A_UID,
          enrolledAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      )
    );

    // 4. Atomic enrollment of archived student is REJECTED
    const archivedBatch = writeBatch(dbAssistant);
    archivedBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_step_c_1_stu_archived_c'),
      {
        id: 'grp_step_c_1_stu_archived_c',
        organizationId: ORG_ALPHA,
        groupId: 'grp_step_c_1',
        studentId: 'stu_archived_c',
        studentName: 'طالب مؤرشف',
        groupName: 'مجموعة الكيمياء',
        status: 'active',
        enrolledBy: ASSISTANT_A_UID,
        enrolledAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    archivedBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
      studentCount: 1,
      lastEnrollmentId: 'grp_step_c_1_stu_archived_c',
      updatedAt: serverTimestamp(),
    });
    await assertFails(archivedBatch.commit());

    // 5. Atomic enrollment into paused group is REJECTED
    const pausedBatch = writeBatch(dbAssistant);
    pausedBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_paused_c_stu_alpha_1'),
      {
        id: 'grp_paused_c_stu_alpha_1',
        organizationId: ORG_ALPHA,
        groupId: 'grp_paused_c',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupName: 'مجموعة متوقفة',
        status: 'active',
        enrolledBy: ASSISTANT_A_UID,
        enrolledAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    pausedBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_paused_c'), {
      studentCount: 1,
      lastEnrollmentId: 'grp_paused_c_stu_alpha_1',
      updatedAt: serverTimestamp(),
    });
    await assertFails(pausedBatch.commit());

    // 6. Cross-org enrollment pointing to stu_beta_1 is REJECTED
    const crossStudentBatch = writeBatch(dbAssistant);
    crossStudentBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_step_c_1_stu_beta_1'),
      {
        id: 'grp_step_c_1_stu_beta_1',
        organizationId: ORG_ALPHA,
        groupId: 'grp_step_c_1',
        studentId: 'stu_beta_1',
        studentName: 'مريم عادل',
        groupName: 'مجموعة الكيمياء',
        status: 'active',
        enrolledBy: ASSISTANT_A_UID,
        enrolledAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    crossStudentBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
      studentCount: 1,
      lastEnrollmentId: 'grp_step_c_1_stu_beta_1',
      updatedAt: serverTimestamp(),
    });
    await assertFails(crossStudentBatch.commit());

    // 7. Valid atomic enrollment SUCCEEDS (studentCount 0 -> 1)
    const validEnrollBatch = writeBatch(dbAssistant);
    validEnrollBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_step_c_1_stu_alpha_1'),
      {
        id: 'grp_step_c_1_stu_alpha_1',
        organizationId: ORG_ALPHA,
        groupId: 'grp_step_c_1',
        studentId: 'stu_alpha_1',
        studentName: 'يوسف حسن',
        groupName: 'مجموعة الكيمياء',
        status: 'active',
        enrolledBy: ASSISTANT_A_UID,
        enrolledAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    validEnrollBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
      studentCount: 1,
      lastEnrollmentId: 'grp_step_c_1_stu_alpha_1',
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(validEnrollBatch.commit());

    // 8. Replaying already-active enrollment to inflate studentCount (+1) is REJECTED
    await assertFails(
      updateDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
        studentCount: 2,
        lastEnrollmentId: 'grp_step_c_1_stu_alpha_1',
        updatedAt: serverTimestamp(),
      })
    );

    // 9. Over-capacity enrollment (capacity is 1, current count is 1) is REJECTED
    const overCapBatch = writeBatch(dbAssistant);
    overCapBatch.set(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_step_c_1_stu_alpha_2'),
      {
        id: 'grp_step_c_1_stu_alpha_2',
        organizationId: ORG_ALPHA,
        groupId: 'grp_step_c_1',
        studentId: 'stu_alpha_2',
        studentName: 'سلمى إبراهيم',
        groupName: 'مجموعة الكيمياء',
        status: 'active',
        enrolledBy: ASSISTANT_A_UID,
        enrolledAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    overCapBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
      studentCount: 2,
      lastEnrollmentId: 'grp_step_c_1_stu_alpha_2',
      updatedAt: serverTimestamp(),
    });
    await assertFails(overCapBatch.commit());

    // 10. Normal group metadata update (capacity 1 -> 2) with unchanged studentCount SUCCEEDS
    await assertSucceeds(
      updateDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
        capacity: 2,
        updatedAt: serverTimestamp(),
      })
    );

    // 11. Valid atomic removal SUCCEEDS (studentCount 1 -> 0) and replay decrement FAILS
    const validRemoveBatch = writeBatch(dbAssistant);
    validRemoveBatch.update(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_step_c_1_stu_alpha_1'),
      {
        status: 'removed',
        removedBy: ASSISTANT_A_UID,
        removedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    validRemoveBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
      studentCount: 0,
      lastEnrollmentId: 'grp_step_c_1_stu_alpha_1',
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(validRemoveBatch.commit());

    await assertFails(
      updateDoc(doc(dbOwner, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
        studentCount: 0,
        lastEnrollmentId: 'grp_step_c_1_stu_alpha_1',
        updatedAt: serverTimestamp(),
      })
    );

    // 12. Valid atomic re-enrollment (removed -> active) SUCCEEDS (studentCount 0 -> 1)
    const validReEnrollBatch = writeBatch(dbAssistant);
    validReEnrollBatch.update(
      doc(dbAssistant, 'organizations', ORG_ALPHA, 'enrollments', 'grp_step_c_1_stu_alpha_1'),
      {
        studentName: 'يوسف حسن',
        groupName: 'مجموعة الكيمياء',
        status: 'active',
        enrolledBy: ASSISTANT_A_UID,
        enrolledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
    );
    validReEnrollBatch.update(doc(dbAssistant, 'organizations', ORG_ALPHA, 'groups', 'grp_step_c_1'), {
      studentCount: 1,
      lastEnrollmentId: 'grp_step_c_1_stu_alpha_1',
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(validReEnrollBatch.commit());
  });
});
