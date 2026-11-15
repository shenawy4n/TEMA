import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { sanitizeText } from '@/src/lib/firebase/validation';
import { generateId } from '@/src/lib/utils/format';
import { enqueueAuditLog, type AuditActor } from './auditService';
import type {
  ExpenseCategory,
  ExpenseRecord,
  PaymentCategory,
  PaymentMethod,
  PaymentRecord,
} from '@/src/types/domain';

export interface CreatePaymentInput {
  studentId: string;
  studentName: string;
  groupId?: string;
  amount: number;
  paidAmount: number;
  category: PaymentCategory;
  method: PaymentMethod;
  referenceNumber?: string;
  notes?: string;
}

export interface CreateExpenseInput {
  title: string;
  category: ExpenseCategory;
  amount: number;
  expenseDate: string;
  notes?: string;
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

export async function createPayment(
  organizationId: string,
  input: CreatePaymentInput,
  actor: AuditActor
): Promise<string> {
  const paymentId = generateId('pay');
  const path = `organizations/${organizationId}/payments/${paymentId}`;
  const batch = writeBatch(db);

  const amount = Math.max(1, Number(input.amount));
  const paidAmount = Math.max(0, Math.min(amount, Number(input.paidAmount)));
  const dueAmount = Math.max(0, amount - paidAmount);
  const status = dueAmount === 0 ? 'posted' : paidAmount > 0 ? 'partial' : 'pending';
  const studentName = sanitizeText(input.studentName, 120);

  batch.set(doc(db, 'organizations', organizationId, 'payments', paymentId), {
    id: paymentId,
    organizationId,
    studentId: input.studentId,
    studentName,
    groupId: input.groupId || '',
    amount,
    paidAmount,
    dueAmount,
    currency: 'EGP',
    category: input.category,
    method: input.method,
    status,
    referenceNumber: sanitizeText(input.referenceNumber || '', 80),
    notes: sanitizeText(input.notes || '', 300),
    recordedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'payment.created',
    'payment',
    paymentId,
    `تسجيل عملية مالية للطالب "${studentName}" بقيمة ${amount} ج.م (محصّل: ${paidAmount} ج.م).`
  );

  try {
    await batch.commit();
    return paymentId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function voidPayment(
  organizationId: string,
  paymentId: string,
  reason: string,
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}/payments/${paymentId}`;
  const batch = writeBatch(db);

  batch.update(doc(db, 'organizations', organizationId, 'payments', paymentId), {
    status: 'voided',
    notes: sanitizeText(reason, 300),
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'payment.voided',
    'payment',
    paymentId,
    `تم إلغاء قيد الدفعة (${paymentId}) — السبب: ${sanitizeText(reason, 120)}.`
  );

  try {
    await batch.commit();
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
  actor: AuditActor
): Promise<string> {
  const expenseId = generateId('exp');
  const path = `organizations/${organizationId}/expenses/${expenseId}`;
  const batch = writeBatch(db);
  const title = sanitizeText(input.title, 150);
  const amount = Math.max(1, Number(input.amount));

  batch.set(doc(db, 'organizations', organizationId, 'expenses', expenseId), {
    id: expenseId,
    organizationId,
    title,
    category: input.category,
    amount,
    currency: 'EGP',
    status: 'posted',
    expenseDate: input.expenseDate,
    notes: sanitizeText(input.notes || '', 300),
    recordedBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'expense.created',
    'expense',
    expenseId,
    `تسجيل مصروف "${title}" بقيمة ${amount} ج.م.`
  );

  try {
    await batch.commit();
    return expenseId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function voidExpense(
  organizationId: string,
  expenseId: string,
  reason: string,
  actor: AuditActor
): Promise<void> {
  const path = `organizations/${organizationId}/expenses/${expenseId}`;
  const batch = writeBatch(db);

  batch.update(doc(db, 'organizations', organizationId, 'expenses', expenseId), {
    status: 'voided',
    notes: sanitizeText(reason, 300),
    updatedAt: serverTimestamp(),
  });

  enqueueAuditLog(
    batch,
    organizationId,
    actor,
    'expense.voided',
    'expense',
    expenseId,
    `تم إلغاء قيد المصروف (${expenseId}) — السبب: ${sanitizeText(reason, 120)}.`
  );

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
