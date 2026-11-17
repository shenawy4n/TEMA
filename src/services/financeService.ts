import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { isValidEntityId, sanitizeText } from '@/src/lib/firebase/validation';
import { generateId, getTodayIsoDate } from '@/src/lib/utils/format';
import {
  DomainValidationError,
  piastersToEgp,
  resolveValidatedExpensePiasters,
  resolveValidatedPaymentPiasters,
} from '@/src/lib/domain/money';
import {
  validateAdjustmentAgainstPayment,
  validateCreateExpenseInput,
  validateCreatePaymentInput,
  validateSettlementAgainstPayment,
} from '@/src/lib/domain/ledger';
import { enqueueAuditLog, type AuditActor } from './auditService';
import {
  resolveActiveOrganizationInTx,
  resolveAuthorizedMemberInTx,
} from './tenantAuthority';
import type {
  ExpenseCategory,
  ExpenseRecord,
  GroupEnrollment,
  LedgerEntry,
  PaymentCategory,
  PaymentMethod,
  PaymentRecord,
  Student,
} from '@/src/types/domain';

export interface CreatePaymentInput {
  studentId: string;
  studentName: string;
  groupId?: string;
  amount: number;
  paidAmount: number;
  category: PaymentCategory;
  method: PaymentMethod;
  paymentDate?: string;
  referenceNumber?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface CreateExpenseInput {
  title: string;
  category: ExpenseCategory;
  amount: number;
  expenseDate: string;
  notes?: string;
  idempotencyKey?: string;
}

export async function listPayments(organizationId: string): Promise<PaymentRecord[]> {
  const path = `organizations/${organizationId}/payments`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'payments'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PaymentRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listPaymentsByStudent(
  organizationId: string,
  studentId: string
): Promise<PaymentRecord[]> {
  const path = `organizations/${organizationId}/payments`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'payments'),
      where('organizationId', '==', organizationId),
      where('studentId', '==', studentId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PaymentRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listLedgerEntries(organizationId: string): Promise<LedgerEntry[]> {
  const path = `organizations/${organizationId}/ledgerEntries`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'ledgerEntries'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as LedgerEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listLedgerEntriesByStudent(
  organizationId: string,
  studentId: string
): Promise<LedgerEntry[]> {
  const path = `organizations/${organizationId}/ledgerEntries`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'ledgerEntries'),
      where('organizationId', '==', organizationId),
      where('studentId', '==', studentId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as LedgerEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createPayment(
  organizationId: string,
  input: CreatePaymentInput,
  _actor?: AuditActor
): Promise<string> {
  const generatedPaymentId = generateId('pay');
  const path = `organizations/${organizationId}/payments/${generatedPaymentId}`;

  try {
    return await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'payments:create');
      const org = await resolveActiveOrganizationInTx(tx, organizationId);

      const validated = validateCreatePaymentInput(org, input, getTodayIsoDate());

      // Check idempotency key inside transaction to prevent duplicate billing
      if (validated.idempotencyKey) {
        const keyDocId = `pay_${validated.idempotencyKey}`;
        const keyRef = doc(db, 'organizations', organizationId, 'idempotencyKeys', keyDocId);
        const keySnap = await tx.get(keyRef);
        if (keySnap.exists()) {
          const existing = keySnap.data() as { entityId?: string };
          if (existing.entityId) {
            return existing.entityId;
          }
        }
      }

      const studentRef = doc(db, 'organizations', organizationId, 'students', validated.studentId);
      const studentSnap = await tx.get(studentRef);
      if (!studentSnap.exists()) {
        throw new DomainValidationError('الطالب المحدد غير موجود في المنظمة.', 'STUDENT_NOT_FOUND', 404);
      }
      const student = studentSnap.data() as Student;
      if (student.organizationId !== organizationId) {
        throw new DomainValidationError('الطالب المحدد لا ينتمي لهذه المنظمة.', 'TENANT_MISMATCH', 403);
      }
      if (student.status !== 'active') {
        throw new DomainValidationError(
          student.status === 'archived'
            ? 'لا يمكن إنشاء فاتورة جديدة لطالب مؤرشف.'
            : 'لا يمكن إنشاء فاتورة جديدة لطالب غير نشط.',
          student.status === 'archived' ? 'STUDENT_ARCHIVED' : 'STUDENT_INACTIVE',
          409
        );
      }

      if (validated.groupId) {
        const groupRef = doc(db, 'organizations', organizationId, 'groups', validated.groupId);
        const enrollmentRef = doc(
          db,
          'organizations',
          organizationId,
          'enrollments',
          `${validated.groupId}_${validated.studentId}`
        );
        const [groupSnap, enrSnap] = await Promise.all([tx.get(groupRef), tx.get(enrollmentRef)]);
        if (!groupSnap.exists()) {
          throw new DomainValidationError('المجموعة المحددة غير موجودة في المنظمة.', 'GROUP_NOT_FOUND', 404);
        }
        const enr = enrSnap.exists() ? (enrSnap.data() as GroupEnrollment) : null;
        if (!enr || enr.status !== 'active') {
          throw new DomainValidationError(
            'الطالب غير مسجل في المجموعة المحددة لهذه الدفعة.',
            'STUDENT_NOT_ENROLLED_IN_GROUP',
            409
          );
        }
      }

      const paymentRef = doc(db, 'organizations', organizationId, 'payments', generatedPaymentId);
      const paymentPayload: Record<string, unknown> = {
        id: generatedPaymentId,
        organizationId,
        studentId: student.id,
        studentName: student.fullName,
        groupId: validated.groupId,
        amount: validated.amount,
        paidAmount: validated.paidAmount,
        dueAmount: validated.dueAmount,
        amountPiasters: validated.amountPiasters,
        paidAmountPiasters: validated.paidAmountPiasters,
        dueAmountPiasters: validated.dueAmountPiasters,
        adjustedCreditPiasters: 0,
        adjustedDebitPiasters: 0,
        currency: 'EGP',
        category: validated.category,
        method: validated.method,
        status: validated.status,
        paymentDate: validated.paymentDate,
        referenceNumber: validated.referenceNumber,
        notes: validated.notes,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (validated.idempotencyKey) {
        paymentPayload.idempotencyKey = validated.idempotencyKey;
      }

      tx.set(paymentRef, paymentPayload);

      // Immutable Ledger Entry 1: Charge (Debit receivable)
      const chargeEntryId = `${generatedPaymentId}_charge`;
      tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', chargeEntryId), {
        id: chargeEntryId,
        organizationId,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: generatedPaymentId,
        studentId: student.id,
        studentName: student.fullName,
        groupId: validated.groupId,
        amountPiasters: validated.amountPiasters,
        amount: validated.amount,
        currency: 'EGP',
        description: `استحقاق مالي (${validated.category}) للطالب "${student.fullName}"`,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
      });

      // Immutable Ledger Entry 2: Collected Payment (Credit receivable) if paid > 0
      if (validated.paidAmountPiasters > 0) {
        const payEntryId = `${generatedPaymentId}_pay_init`;
        tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', payEntryId), {
          id: payEntryId,
          organizationId,
          entryType: 'payment',
          direction: 'credit',
          entityType: 'payment',
          entityId: generatedPaymentId,
          studentId: student.id,
          studentName: student.fullName,
          groupId: validated.groupId,
          amountPiasters: validated.paidAmountPiasters,
          amount: validated.paidAmount,
          currency: 'EGP',
          description: `تحصيل دفعة (${validated.method}) للطالب "${student.fullName}"`,
          relatedEntryId: chargeEntryId,
          recordedBy: verifiedMember.uid,
          createdAt: serverTimestamp(),
        });
      }

      if (validated.idempotencyKey) {
        const keyDocId = `pay_${validated.idempotencyKey}`;
        tx.set(doc(db, 'organizations', organizationId, 'idempotencyKeys', keyDocId), {
          id: keyDocId,
          organizationId,
          entityType: 'payment',
          entityId: generatedPaymentId,
          createdBy: verifiedMember.uid,
          createdAt: serverTimestamp(),
        });
      }

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'payment.created',
        entityType: 'payment',
        entityId: generatedPaymentId,
        summary: `تسجيل عملية مالية للطالب "${student.fullName}" بقيمة ${validated.amount} ج.م (محصّل: ${validated.paidAmount} ج.م).`,
        result: 'success',
        metadata: {
          after: {
            studentId: student.id,
            amountPiasters: validated.amountPiasters,
            paidAmountPiasters: validated.paidAmountPiasters,
            dueAmountPiasters: validated.dueAmountPiasters,
            status: validated.status,
            method: validated.method,
          },
        },
      });

      return generatedPaymentId;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function settlePaymentInstallment(
  organizationId: string,
  paymentId: string,
  installmentAmountEgp: number,
  method: PaymentMethod,
  referenceNumber = ''
): Promise<void> {
  if (!isValidEntityId(paymentId)) {
    throw new DomainValidationError('معرّف الدفعة غير صالح.', 'INVALID_PAYMENT_ID');
  }
  const path = `organizations/${organizationId}/payments/${paymentId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'payments:settle');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const payRef = doc(db, 'organizations', organizationId, 'payments', paymentId);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) {
        throw new DomainValidationError('القيد المالي غير موجود.', 'PAYMENT_NOT_FOUND', 404);
      }

      const existing = paySnap.data() as PaymentRecord;
      if (existing.organizationId !== organizationId) {
        throw new DomainValidationError('القيد المالي لا يتبع هذه المنظمة.', 'TENANT_MISMATCH', 403);
      }
      const settlement = validateSettlementAgainstPayment(existing, installmentAmountEgp, method);

      const settleUpdate: Record<string, unknown> = {
        paidAmount: settlement.newPaidAmount,
        dueAmount: settlement.newDueAmount,
        paidAmountPiasters: settlement.newPaidPiasters,
        dueAmountPiasters: settlement.newDuePiasters,
        status: settlement.nextStatus,
        method,
        referenceNumber: sanitizeText(referenceNumber || existing.referenceNumber || '', 80),
        updatedAt: serverTimestamp(),
      };
      if (settlement.needsAmountBackfill) {
        settleUpdate.amountPiasters = settlement.totalPiasters;
      }

      tx.update(payRef, settleUpdate);

      const entryId = `${paymentId}_pay_${settlement.newPaidPiasters}`;
      const installmentEgp = piastersToEgp(settlement.installmentPiasters);
      tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', entryId), {
        id: entryId,
        organizationId,
        entryType: 'payment',
        direction: 'credit',
        entityType: 'payment',
        entityId: paymentId,
        studentId: existing.studentId,
        studentName: existing.studentName,
        groupId: existing.groupId || '',
        amountPiasters: settlement.installmentPiasters,
        amount: installmentEgp,
        currency: 'EGP',
        description: `سداد قسط إضافي (${method}) للفاتورة ${paymentId}`,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'payment.settled',
        entityType: 'payment',
        entityId: paymentId,
        summary: `سداد قسط بقيمة ${installmentEgp} ج.م للطالب "${existing.studentName}".`,
        result: 'success',
        metadata: {
          before: {
            paidAmount: existing.paidAmount,
            dueAmount: existing.dueAmount,
            status: existing.status,
          },
          after: {
            paidAmount: settlement.newPaidAmount,
            dueAmount: settlement.newDueAmount,
            status: settlement.nextStatus,
            installmentEgp,
          },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createPaymentAdjustment(
  organizationId: string,
  paymentId: string,
  adjustmentAmountEgp: number,
  direction: 'debit' | 'credit',
  reason: string,
  idempotencyKey?: string
): Promise<string> {
  if (!isValidEntityId(paymentId)) {
    throw new DomainValidationError('معرّف الدفعة غير صالح.', 'INVALID_PAYMENT_ID');
  }
  const cleanReasonPrecheck = sanitizeText(reason || '', 200);
  if (cleanReasonPrecheck.length < 3) {
    throw new DomainValidationError('يجب توضيح سبب التسوية المحاسبية.', 'ADJUSTMENT_REASON_REQUIRED');
  }
  if (
    idempotencyKey !== undefined &&
    idempotencyKey !== '' &&
    (!isValidEntityId(idempotencyKey) || idempotencyKey.length > 100)
  ) {
    throw new DomainValidationError('مفتاح منع التكرار (idempotencyKey) غير صالح.', 'INVALID_IDEMPOTENCY_KEY');
  }

  const effectiveKey = idempotencyKey && idempotencyKey.length > 0 ? idempotencyKey : generateId('adj');
  const entryId = `ldg_adj_${effectiveKey}`;
  const keyDocId = `adj_${effectiveKey}`;
  const path = `organizations/${organizationId}/ledgerEntries/${entryId}`;

  try {
    return await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'payments:adjust');
      await resolveActiveOrganizationInTx(tx, organizationId);

      if (idempotencyKey && idempotencyKey.length > 0) {
        const keyRef = doc(db, 'organizations', organizationId, 'idempotencyKeys', keyDocId);
        const keySnap = await tx.get(keyRef);
        if (keySnap.exists()) {
          const existingKey = keySnap.data() as { entityId?: string };
          if (existingKey.entityId) {
            return existingKey.entityId;
          }
        }
      }

      const payRef = doc(db, 'organizations', organizationId, 'payments', paymentId);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) {
        throw new DomainValidationError('القيد المالي غير موجود.', 'PAYMENT_NOT_FOUND', 404);
      }
      const payment = paySnap.data() as PaymentRecord;
      if (payment.organizationId !== organizationId) {
        throw new DomainValidationError('القيد المالي لا يتبع هذه المنظمة.', 'TENANT_MISMATCH', 403);
      }
      const validatedAdj = validateAdjustmentAgainstPayment(
        payment,
        adjustmentAmountEgp,
        direction,
        cleanReasonPrecheck,
        effectiveKey
      );

      const payUpdate: Record<string, unknown> = {
        adjustedCreditPiasters: validatedAdj.nextAdjustedCredit,
        adjustedDebitPiasters: validatedAdj.nextAdjustedDebit,
        lastAdjustmentEntryId: entryId,
        updatedAt: serverTimestamp(),
      };
      if (validatedAdj.needsPiastersBackfill) {
        payUpdate.amountPiasters = validatedAdj.totalPiasters;
        payUpdate.paidAmountPiasters = validatedAdj.paidPiasters;
        payUpdate.dueAmountPiasters = validatedAdj.duePiasters;
      }

      tx.update(payRef, payUpdate);

      tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', entryId), {
        id: entryId,
        organizationId,
        entryType: 'adjustment',
        direction,
        entityType: 'payment',
        entityId: paymentId,
        studentId: payment.studentId,
        studentName: payment.studentName,
        groupId: payment.groupId || '',
        amountPiasters: validatedAdj.amountPiasters,
        amount: validatedAdj.amount,
        currency: 'EGP',
        idempotencyKey: effectiveKey,
        description: `تسوية محاسبية (${direction}): ${validatedAdj.cleanReason}`,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
      });

      tx.set(doc(db, 'organizations', organizationId, 'idempotencyKeys', keyDocId), {
        id: keyDocId,
        organizationId,
        entityType: 'ledger_entry',
        entityId: entryId,
        createdBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'payment.adjusted',
        entityType: 'ledger_entry',
        entityId: entryId,
        summary: `تسوية محاسبية (${direction}) بقيمة ${validatedAdj.amount} ج.م على القيد ${paymentId}.`,
        result: 'success',
        metadata: {
          before: {
            adjustedCreditPiasters: validatedAdj.prevAdjustedCredit,
            adjustedDebitPiasters: validatedAdj.prevAdjustedDebit,
          },
          after: {
            paymentId,
            direction,
            amountPiasters: validatedAdj.amountPiasters,
            adjustedCreditPiasters: validatedAdj.nextAdjustedCredit,
            adjustedDebitPiasters: validatedAdj.nextAdjustedDebit,
            reason: validatedAdj.cleanReason,
          },
        },
      });

      return entryId;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function voidPayment(
  organizationId: string,
  paymentId: string,
  reason: string,
  _actor?: AuditActor
): Promise<void> {
  if (!isValidEntityId(paymentId)) {
    throw new DomainValidationError('معرّف الدفعة غير صالح.', 'INVALID_PAYMENT_ID');
  }
  const cleanReason = sanitizeText(reason || '', 200);
  if (cleanReason.length < 3) {
    throw new DomainValidationError('يجب إدخال سبب واضح لإلغاء القيد المالي.', 'VOID_REASON_REQUIRED');
  }

  const path = `organizations/${organizationId}/payments/${paymentId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'payments:reverse');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const payRef = doc(db, 'organizations', organizationId, 'payments', paymentId);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) {
        throw new DomainValidationError('القيد المالي غير موجود.', 'PAYMENT_NOT_FOUND', 404);
      }
      const existing = paySnap.data() as PaymentRecord;
      if (existing.organizationId !== organizationId) {
        throw new DomainValidationError('القيد المالي لا يتبع هذه المنظمة.', 'TENANT_MISMATCH', 403);
      }
      if (existing.status === 'voided') {
        throw new DomainValidationError('هذا القيد المالي ملغى بالفعل.', 'ALREADY_VOIDED', 409);
      }

      const resolved = resolveValidatedPaymentPiasters(existing);
      const totalPiasters = resolved.amountPiasters;
      const paidPiasters = resolved.paidAmountPiasters;
      const duePiasters = resolved.dueAmountPiasters;

      // Keep original amount/paidAmount/dueAmount intact; mark status='voided' and record formal reversal ledger entries
      const voidPayUpdate: Record<string, unknown> = {
        status: 'voided',
        voidReason: cleanReason,
        voidedBy: verifiedMember.uid,
        voidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (resolved.needsBackfill.amountPiasters) {
        voidPayUpdate.amountPiasters = totalPiasters;
      }
      if (resolved.needsBackfill.paidAmountPiasters) {
        voidPayUpdate.paidAmountPiasters = paidPiasters;
      }
      if (resolved.needsBackfill.dueAmountPiasters) {
        voidPayUpdate.dueAmountPiasters = duePiasters;
      }
      tx.update(payRef, voidPayUpdate);

      const chargeReversalId = `${paymentId}_rev_charge`;
      tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', chargeReversalId), {
        id: chargeReversalId,
        organizationId,
        entryType: 'reversal',
        direction: 'credit',
        entityType: 'payment',
        entityId: paymentId,
        studentId: existing.studentId,
        studentName: existing.studentName,
        groupId: existing.groupId || '',
        amountPiasters: totalPiasters,
        amount: piastersToEgp(totalPiasters),
        currency: 'EGP',
        description: `عكس قيد الاستحقاق (${paymentId}): ${cleanReason}`,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
      });

      if (paidPiasters > 0) {
        const payReversalId = `${paymentId}_rev_paid`;
        tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', payReversalId), {
          id: payReversalId,
          organizationId,
          entryType: 'reversal',
          direction: 'debit',
          entityType: 'payment',
          entityId: paymentId,
          studentId: existing.studentId,
          studentName: existing.studentName,
          groupId: existing.groupId || '',
          amountPiasters: paidPiasters,
          amount: piastersToEgp(paidPiasters),
          currency: 'EGP',
          description: `عكس تحصيل دفعة (${paymentId}): ${cleanReason}`,
          recordedBy: verifiedMember.uid,
          createdAt: serverTimestamp(),
        });
      }

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'payment.voided',
        entityType: 'payment',
        entityId: paymentId,
        summary: `تم عكس وإلغاء قيد الدفعة (${paymentId}) — السبب: ${cleanReason}.`,
        result: 'success',
        metadata: {
          before: { status: existing.status, amount: existing.amount, paidAmount: existing.paidAmount },
          after: { status: 'voided', voidReason: cleanReason },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function listExpenses(organizationId: string): Promise<ExpenseRecord[]> {
  const path = `organizations/${organizationId}/expenses`;
  try {
    const q = query(
      collection(db, 'organizations', organizationId, 'expenses'),
      where('organizationId', '==', organizationId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ExpenseRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function createExpense(
  organizationId: string,
  input: CreateExpenseInput,
  _actor?: AuditActor
): Promise<string> {
  const expenseId = generateId('exp');
  const path = `organizations/${organizationId}/expenses/${expenseId}`;

  try {
    return await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'expenses:create');
      const org = await resolveActiveOrganizationInTx(tx, organizationId);

      const validated = validateCreateExpenseInput(org, input);

      if (validated.idempotencyKey) {
        const keyDocId = `exp_${validated.idempotencyKey}`;
        const keyRef = doc(db, 'organizations', organizationId, 'idempotencyKeys', keyDocId);
        const keySnap = await tx.get(keyRef);
        if (keySnap.exists()) {
          const existing = keySnap.data() as { entityId?: string };
          if (existing.entityId) {
            return existing.entityId;
          }
        }
      }

      const payload: Record<string, unknown> = {
        id: expenseId,
        organizationId,
        title: validated.title,
        category: validated.category,
        amount: validated.amount,
        amountPiasters: validated.amountPiasters,
        currency: 'EGP',
        status: 'posted',
        expenseDate: validated.expenseDate,
        notes: validated.notes,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (validated.idempotencyKey) {
        payload.idempotencyKey = validated.idempotencyKey;
      }

      tx.set(doc(db, 'organizations', organizationId, 'expenses', expenseId), payload);

      const entryId = `${expenseId}_charge`;
      tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', entryId), {
        id: entryId,
        organizationId,
        entryType: 'charge',
        direction: 'debit',
        entityType: 'expense',
        entityId: expenseId,
        amountPiasters: validated.amountPiasters,
        amount: validated.amount,
        currency: 'EGP',
        description: `مصروف تشغيلي: ${validated.title}`,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
      });

      if (validated.idempotencyKey) {
        const keyDocId = `exp_${validated.idempotencyKey}`;
        tx.set(doc(db, 'organizations', organizationId, 'idempotencyKeys', keyDocId), {
          id: keyDocId,
          organizationId,
          entityType: 'expense',
          entityId: expenseId,
          createdBy: verifiedMember.uid,
          createdAt: serverTimestamp(),
        });
      }

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'expense.created',
        entityType: 'expense',
        entityId: expenseId,
        summary: `تسجيل مصروف "${validated.title}" بقيمة ${validated.amount} ج.م.`,
        result: 'success',
        metadata: {
          after: {
            title: validated.title,
            category: validated.category,
            amountPiasters: validated.amountPiasters,
            expenseDate: validated.expenseDate,
          },
        },
      });

      return expenseId;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function voidExpense(
  organizationId: string,
  expenseId: string,
  reason: string,
  _actor?: AuditActor
): Promise<void> {
  if (!isValidEntityId(expenseId)) {
    throw new DomainValidationError('معرّف المصروف غير صالح.', 'INVALID_EXPENSE_ID');
  }
  const cleanReason = sanitizeText(reason || '', 200);
  if (cleanReason.length < 3) {
    throw new DomainValidationError('يجب إدخال سبب واضح لإلغاء المصروف.', 'VOID_REASON_REQUIRED');
  }

  const path = `organizations/${organizationId}/expenses/${expenseId}`;

  try {
    await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(tx, organizationId, 'expenses:reverse');
      await resolveActiveOrganizationInTx(tx, organizationId);

      const expRef = doc(db, 'organizations', organizationId, 'expenses', expenseId);
      const expSnap = await tx.get(expRef);
      if (!expSnap.exists()) {
        throw new DomainValidationError('قيد المصروف غير موجود.', 'EXPENSE_NOT_FOUND', 404);
      }

      const existing = expSnap.data() as ExpenseRecord;
      if (existing.organizationId !== organizationId) {
        throw new DomainValidationError('قيد المصروف لا يتبع هذه المنظمة.', 'TENANT_MISMATCH', 403);
      }
      if (existing.status === 'voided') {
        throw new DomainValidationError('هذا المصروف ملغى بالفعل.', 'ALREADY_VOIDED', 409);
      }

      const resolved = resolveValidatedExpensePiasters(existing);
      const amountPiasters = resolved.amountPiasters;

      const voidExpUpdate: Record<string, unknown> = {
        status: 'voided',
        voidReason: cleanReason,
        voidedBy: verifiedMember.uid,
        voidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (resolved.needsBackfill) {
        voidExpUpdate.amountPiasters = amountPiasters;
      }
      tx.update(expRef, voidExpUpdate);

      const reversalId = `${expenseId}_rev_charge`;
      tx.set(doc(db, 'organizations', organizationId, 'ledgerEntries', reversalId), {
        id: reversalId,
        organizationId,
        entryType: 'reversal',
        direction: 'credit',
        entityType: 'expense',
        entityId: expenseId,
        amountPiasters,
        amount: piastersToEgp(amountPiasters),
        currency: 'EGP',
        description: `عكس مصروف (${existing.title}): ${cleanReason}`,
        recordedBy: verifiedMember.uid,
        createdAt: serverTimestamp(),
      });

      enqueueAuditLog(tx, organizationId, verifiedMember, {
        action: 'expense.voided',
        entityType: 'expense',
        entityId: expenseId,
        summary: `تم عكس وإلغاء قيد المصروف (${expenseId}) — السبب: ${cleanReason}.`,
        result: 'success',
        metadata: {
          before: { status: existing.status, amount: existing.amount },
          after: { status: 'voided', voidReason: cleanReason },
        },
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
