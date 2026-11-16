import { DATE_PATTERN, isValidEntityId, sanitizeText } from '@/src/lib/firebase/validation';
import type {
  ExpenseCategory,
  ExpenseRecord,
  LedgerEntry,
  Organization,
  PaymentCategory,
  PaymentMethod,
  PaymentRecord,
} from '@/src/types/domain';
import {
  DomainValidationError,
  PIASTERS_PER_EGP,
  computePaymentBreakdown,
  egpToPiasters,
  piastersToEgp,
  resolveRecordPiasters,
} from './money';
import { isValidCalendarDate } from './scheduling';

export const VALID_PAYMENT_CATEGORIES = new Set<PaymentCategory>([
  'tuition',
  'materials',
  'registration',
  'other',
]);

export const VALID_PAYMENT_METHODS = new Set<PaymentMethod>([
  'cash',
  'vodafone_cash',
  'instapay',
  'bank_transfer',
  'card',
]);

export const VALID_EXPENSE_CATEGORIES = new Set<ExpenseCategory>([
  'rent',
  'salaries',
  'utilities',
  'printing',
  'marketing',
  'other',
]);

export interface ValidatedPaymentCreate {
  studentId: string;
  studentName: string;
  groupId: string;
  amountPiasters: number;
  paidAmountPiasters: number;
  dueAmountPiasters: number;
  amount: number;
  paidAmount: number;
  dueAmount: number;
  currency: 'EGP';
  category: PaymentCategory;
  method: PaymentMethod;
  status: 'posted' | 'partial' | 'pending';
  paymentDate: string;
  referenceNumber: string;
  notes: string;
  idempotencyKey?: string;
}

export function validateCreatePaymentInput(
  organization: Pick<Organization, 'id' | 'currency' | 'status'>,
  input: {
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
  },
  defaultDateIso: string
): ValidatedPaymentCreate {
  if (organization.status !== 'active') {
    throw new DomainValidationError('المنظمة موقوفة حالياً ولا يمكن تسجيل حركات مالية.', 'ORG_SUSPENDED', 403);
  }
  if (organization.currency !== 'EGP') {
    throw new DomainValidationError('العملة المدعومة للمنظمة هي الجنيه المصري (EGP) فقط.', 'CURRENCY_MISMATCH');
  }
  if (!isValidEntityId(input.studentId)) {
    throw new DomainValidationError('معرّف الطالب غير صالح.', 'INVALID_STUDENT_ID');
  }
  if (input.groupId && !isValidEntityId(input.groupId)) {
    throw new DomainValidationError('معرّف المجموعة غير صالح.', 'INVALID_GROUP_ID');
  }
  if (!VALID_PAYMENT_CATEGORIES.has(input.category)) {
    throw new DomainValidationError('تصنيف الدفعة غير صالح.', 'INVALID_PAYMENT_CATEGORY');
  }
  if (!VALID_PAYMENT_METHODS.has(input.method)) {
    throw new DomainValidationError('طريقة الدفع غير صالحة.', 'INVALID_PAYMENT_METHOD');
  }

  const paymentDate = input.paymentDate || defaultDateIso;
  if (!DATE_PATTERN.test(paymentDate) || !isValidCalendarDate(paymentDate)) {
    throw new DomainValidationError('تاريخ الدفعة غير صالح.', 'INVALID_PAYMENT_DATE');
  }

  if (input.idempotencyKey !== undefined && input.idempotencyKey !== '' && !isValidEntityId(input.idempotencyKey)) {
    throw new DomainValidationError('مفتاح منع التكرار (idempotencyKey) غير صالح.', 'INVALID_IDEMPOTENCY_KEY');
  }

  const studentName = sanitizeText(input.studentName || '', 120);
  if (studentName.length < 1) {
    throw new DomainValidationError('اسم الطالب مطلوب.', 'INVALID_STUDENT_NAME');
  }

  const breakdown = computePaymentBreakdown(input.amount, input.paidAmount);

  return {
    studentId: input.studentId,
    studentName,
    groupId: input.groupId || '',
    ...breakdown,
    currency: 'EGP',
    category: input.category,
    method: input.method,
    paymentDate,
    referenceNumber: sanitizeText(input.referenceNumber || '', 80),
    notes: sanitizeText(input.notes || '', 300),
    idempotencyKey: input.idempotencyKey || undefined,
  };
}

export interface ValidatedExpenseCreate {
  title: string;
  category: ExpenseCategory;
  amountPiasters: number;
  amount: number;
  currency: 'EGP';
  expenseDate: string;
  notes: string;
  idempotencyKey?: string;
}

export function validateCreateExpenseInput(
  organization: Pick<Organization, 'id' | 'currency' | 'status'>,
  input: {
    title: string;
    category: ExpenseCategory;
    amount: number;
    expenseDate: string;
    notes?: string;
    idempotencyKey?: string;
  }
): ValidatedExpenseCreate {
  if (organization.status !== 'active') {
    throw new DomainValidationError('المنظمة موقوفة حالياً ولا يمكن تسجيل مصروفات.', 'ORG_SUSPENDED', 403);
  }
  if (organization.currency !== 'EGP') {
    throw new DomainValidationError('العملة المدعومة للمنظمة هي الجنيه المصري (EGP) فقط.', 'CURRENCY_MISMATCH');
  }

  const title = sanitizeText(input.title || '', 150);
  if (title.length < 2) {
    throw new DomainValidationError('بيان المصروف يجب أن يكون حرفين على الأقل.', 'INVALID_EXPENSE_TITLE');
  }
  if (!VALID_EXPENSE_CATEGORIES.has(input.category)) {
    throw new DomainValidationError('تصنيف المصروف غير صالح.', 'INVALID_EXPENSE_CATEGORY');
  }
  if (!DATE_PATTERN.test(input.expenseDate) || !isValidCalendarDate(input.expenseDate)) {
    throw new DomainValidationError('تاريخ المصروف غير صالح.', 'INVALID_EXPENSE_DATE');
  }
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== '' && !isValidEntityId(input.idempotencyKey)) {
    throw new DomainValidationError('مفتاح منع التكرار (idempotencyKey) غير صالح.', 'INVALID_IDEMPOTENCY_KEY');
  }

  const amountPiasters = egpToPiasters(input.amount, { allowZero: false, fieldLabel: 'قيمة المصروف' });

  return {
    title,
    category: input.category,
    amountPiasters,
    amount: piastersToEgp(amountPiasters),
    currency: 'EGP',
    expenseDate: input.expenseDate,
    notes: sanitizeText(input.notes || '', 300),
    idempotencyKey: input.idempotencyKey || undefined,
  };
}

export function validateSettlementAgainstPayment(
  payment: PaymentRecord,
  installmentAmountEgp: number,
  method: PaymentMethod
): {
  installmentPiasters: number;
  newPaidPiasters: number;
  newDuePiasters: number;
  newPaidAmount: number;
  newDueAmount: number;
  nextStatus: 'posted' | 'partial';
} {
  if (payment.status === 'voided') {
    throw new DomainValidationError('لا يمكن سداد قيد مالي ملغى.', 'PAYMENT_VOIDED', 409);
  }
  if (payment.status === 'posted') {
    throw new DomainValidationError('هذه الدفعة محصّلة بالكامل وغير قابلة للتعديل.', 'PAYMENT_IMMUTABLE', 409);
  }
  if (!VALID_PAYMENT_METHODS.has(method)) {
    throw new DomainValidationError('طريقة الدفع غير صالحة.', 'INVALID_PAYMENT_METHOD');
  }

  const totalPiasters = resolveRecordPiasters(payment.amountPiasters, payment.amount);
  const currentPaidPiasters = resolveRecordPiasters(payment.paidAmountPiasters, payment.paidAmount);
  const currentDuePiasters = Math.max(0, totalPiasters - currentPaidPiasters);

  const installmentPiasters = egpToPiasters(installmentAmountEgp, {
    allowZero: false,
    fieldLabel: 'مبلغ السداد',
  });

  if (installmentPiasters > currentDuePiasters) {
    throw new DomainValidationError(
      'مبلغ السداد يتجاوز الرصيد المتبقي على الفاتورة.',
      'SETTLEMENT_EXCEEDS_DUE'
    );
  }

  const newPaidPiasters = currentPaidPiasters + installmentPiasters;
  const newDuePiasters = totalPiasters - newPaidPiasters;
  const nextStatus = newDuePiasters === 0 ? 'posted' : 'partial';

  return {
    installmentPiasters,
    newPaidPiasters,
    newDuePiasters,
    newPaidAmount: newPaidPiasters / PIASTERS_PER_EGP,
    newDueAmount: newDuePiasters / PIASTERS_PER_EGP,
    nextStatus,
  };
}

export interface ValidatedPaymentAdjustment {
  amountPiasters: number;
  amount: number;
  cleanReason: string;
  totalPiasters: number;
  paidPiasters: number;
  duePiasters: number;
  prevAdjustedCredit: number;
  prevAdjustedDebit: number;
  nextAdjustedCredit: number;
  nextAdjustedDebit: number;
  needsPiastersBackfill: boolean;
}

export function validateAdjustmentAgainstPayment(
  payment: PaymentRecord,
  adjustmentAmountEgp: number,
  direction: 'debit' | 'credit',
  reason: string,
  idempotencyKey?: string
): ValidatedPaymentAdjustment {
  if (payment.status === 'voided') {
    throw new DomainValidationError('لا يمكن إضافة تسوية لقيد ملغى.', 'PAYMENT_VOIDED', 409);
  }
  if (direction !== 'debit' && direction !== 'credit') {
    throw new DomainValidationError('اتجاه التسوية المحاسبية غير صالح.', 'INVALID_ADJUSTMENT_DIRECTION');
  }

  const cleanReason = sanitizeText(reason || '', 200);
  if (cleanReason.length < 3) {
    throw new DomainValidationError('يجب توضيح سبب التسوية المحاسبية.', 'ADJUSTMENT_REASON_REQUIRED');
  }

  if (
    idempotencyKey !== undefined &&
    idempotencyKey !== '' &&
    (!isValidEntityId(idempotencyKey) || idempotencyKey.length > 100)
  ) {
    throw new DomainValidationError('مفتاح منع التكرار (idempotencyKey) غير صالح.', 'INVALID_IDEMPOTENCY_KEY');
  }

  const amountPiasters = egpToPiasters(adjustmentAmountEgp, {
    allowZero: false,
    fieldLabel: 'قيمة التسوية',
  });
  const totalPiasters = resolveRecordPiasters(payment.amountPiasters, payment.amount);
  const paidPiasters = resolveRecordPiasters(payment.paidAmountPiasters, payment.paidAmount);
  const duePiasters = Math.max(0, totalPiasters - paidPiasters);

  const prevAdjustedCredit =
    typeof payment.adjustedCreditPiasters === 'number' && payment.adjustedCreditPiasters >= 0
      ? payment.adjustedCreditPiasters
      : 0;
  const prevAdjustedDebit =
    typeof payment.adjustedDebitPiasters === 'number' && payment.adjustedDebitPiasters >= 0
      ? payment.adjustedDebitPiasters
      : 0;

  const nextAdjustedCredit =
    direction === 'credit' ? prevAdjustedCredit + amountPiasters : prevAdjustedCredit;
  const nextAdjustedDebit =
    direction === 'debit' ? prevAdjustedDebit + amountPiasters : prevAdjustedDebit;

  if (direction === 'credit' && nextAdjustedCredit > totalPiasters) {
    throw new DomainValidationError(
      'مجموع التسويات الدائنة يتجاوز إجمالي قيمة الفاتورة.',
      'ADJUSTMENT_EXCEEDS_PAYMENT'
    );
  }

  if (direction === 'debit' && nextAdjustedDebit > totalPiasters) {
    throw new DomainValidationError(
      'مجموع التسويات المدينة يتجاوز إجمالي قيمة الفاتورة.',
      'ADJUSTMENT_EXCEEDS_PAYMENT'
    );
  }

  return {
    amountPiasters,
    amount: piastersToEgp(amountPiasters),
    cleanReason,
    totalPiasters,
    paidPiasters,
    duePiasters,
    prevAdjustedCredit,
    prevAdjustedDebit,
    nextAdjustedCredit,
    nextAdjustedDebit,
    needsPiastersBackfill: typeof payment.amountPiasters !== 'number',
  };
}

export interface StudentLedgerBalance {
  studentId: string;
  totalChargedPiasters: number;
  totalCollectedPiasters: number;
  totalReversedPiasters: number;
  netAdjustmentPiasters: number;
  outstandingDuePiasters: number;
  totalChargedEgp: number;
  totalCollectedEgp: number;
  outstandingDueEgp: number;
}

export interface OrganizationFinancialSummary {
  collectedPiasters: number;
  chargedPiasters: number;
  outstandingPiasters: number;
  expensesPiasters: number;
  netPiasters: number;
  collectedEgp: number;
  chargedEgp: number;
  outstandingEgp: number;
  expensesEgp: number;
  netEgp: number;
  source: 'ledger' | 'hybrid';
}

/**
 * Derives authoritative balances from immutable LedgerEntries.
 * For backward compatibility with legacy Payment/Expense docs created before ledgerEntries existed,
 * any payment/expense ID not represented in ledgerEntries is synthesized as its equivalent ledger impact.
 */
export function deriveFinancialSummaryFromLedger(
  ledgerEntries: LedgerEntry[],
  payments: PaymentRecord[],
  expenses: ExpenseRecord[]
): OrganizationFinancialSummary {
  let chargedPiasters = 0;
  let collectedPiasters = 0;
  let expensesPiasters = 0;

  const paymentIdsWithLedger = new Set<string>();
  const expenseIdsWithLedger = new Set<string>();

  for (const entry of ledgerEntries) {
    const piasters = resolveRecordPiasters(entry.amountPiasters, entry.amount);
    if (entry.entityType === 'payment') {
      paymentIdsWithLedger.add(entry.entityId);
      if (entry.entryType === 'charge') {
        chargedPiasters += entry.direction === 'debit' ? piasters : -piasters;
      } else if (entry.entryType === 'payment') {
        collectedPiasters += entry.direction === 'credit' ? piasters : -piasters;
      } else if (entry.entryType === 'reversal') {
        if (entry.direction === 'credit') {
          // Reversing a charge
          chargedPiasters -= piasters;
        } else {
          // Reversing a collected payment
          collectedPiasters -= piasters;
        }
      } else if (entry.entryType === 'adjustment') {
        // Debit adjustment increases charge; credit adjustment reduces charge
        chargedPiasters += entry.direction === 'debit' ? piasters : -piasters;
      }
    } else if (entry.entityType === 'expense') {
      expenseIdsWithLedger.add(entry.entityId);
      if (entry.entryType === 'charge') {
        expensesPiasters += entry.direction === 'debit' ? piasters : -piasters;
      } else if (entry.entryType === 'reversal') {
        expensesPiasters -= piasters;
      } else if (entry.entryType === 'adjustment') {
        expensesPiasters += entry.direction === 'debit' ? piasters : -piasters;
      }
    }
  }

  let usedLegacyFallback = false;
  for (const p of payments) {
    if (paymentIdsWithLedger.has(p.id) || p.status === 'voided') continue;
    usedLegacyFallback = true;
    chargedPiasters += resolveRecordPiasters(p.amountPiasters, p.amount);
    collectedPiasters += resolveRecordPiasters(p.paidAmountPiasters, p.paidAmount);
  }

  for (const e of expenses) {
    if (expenseIdsWithLedger.has(e.id) || e.status === 'voided') continue;
    usedLegacyFallback = true;
    expensesPiasters += resolveRecordPiasters(e.amountPiasters, e.amount);
  }

  chargedPiasters = Math.max(0, chargedPiasters);
  collectedPiasters = Math.max(0, collectedPiasters);
  expensesPiasters = Math.max(0, expensesPiasters);
  const outstandingPiasters = Math.max(0, chargedPiasters - collectedPiasters);
  const netPiasters = collectedPiasters - expensesPiasters;

  return {
    collectedPiasters,
    chargedPiasters,
    outstandingPiasters,
    expensesPiasters,
    netPiasters,
    collectedEgp: collectedPiasters / PIASTERS_PER_EGP,
    chargedEgp: chargedPiasters / PIASTERS_PER_EGP,
    outstandingEgp: outstandingPiasters / PIASTERS_PER_EGP,
    expensesEgp: expensesPiasters / PIASTERS_PER_EGP,
    netEgp: netPiasters / PIASTERS_PER_EGP,
    source: usedLegacyFallback ? 'hybrid' : 'ledger',
  };
}

export function deriveStudentLedgerBalance(
  studentId: string,
  ledgerEntries: LedgerEntry[],
  payments: PaymentRecord[]
): StudentLedgerBalance {
  const studentEntries = ledgerEntries.filter(
    (e) => e.entityType === 'payment' && e.studentId === studentId
  );
  const studentPayments = payments.filter((p) => p.studentId === studentId);

  let totalChargedPiasters = 0;
  let totalCollectedPiasters = 0;
  let totalReversedPiasters = 0;
  let netAdjustmentPiasters = 0;
  const coveredPaymentIds = new Set<string>();

  for (const entry of studentEntries) {
    coveredPaymentIds.add(entry.entityId);
    const piasters = resolveRecordPiasters(entry.amountPiasters, entry.amount);
    if (entry.entryType === 'charge') {
      totalChargedPiasters += piasters;
    } else if (entry.entryType === 'payment') {
      totalCollectedPiasters += piasters;
    } else if (entry.entryType === 'reversal') {
      if (entry.direction === 'credit') {
        totalChargedPiasters -= piasters;
      } else {
        totalCollectedPiasters -= piasters;
        totalReversedPiasters += piasters;
      }
    } else if (entry.entryType === 'adjustment') {
      const signed = entry.direction === 'debit' ? piasters : -piasters;
      totalChargedPiasters += signed;
      netAdjustmentPiasters += signed;
    }
  }

  for (const p of studentPayments) {
    if (coveredPaymentIds.has(p.id) || p.status === 'voided') continue;
    totalChargedPiasters += resolveRecordPiasters(p.amountPiasters, p.amount);
    totalCollectedPiasters += resolveRecordPiasters(p.paidAmountPiasters, p.paidAmount);
  }

  totalChargedPiasters = Math.max(0, totalChargedPiasters);
  totalCollectedPiasters = Math.max(0, totalCollectedPiasters);
  const outstandingDuePiasters = Math.max(0, totalChargedPiasters - totalCollectedPiasters);

  return {
    studentId,
    totalChargedPiasters,
    totalCollectedPiasters,
    totalReversedPiasters,
    netAdjustmentPiasters,
    outstandingDuePiasters,
    totalChargedEgp: totalChargedPiasters / PIASTERS_PER_EGP,
    totalCollectedEgp: totalCollectedPiasters / PIASTERS_PER_EGP,
    outstandingDueEgp: outstandingDuePiasters / PIASTERS_PER_EGP,
  };
}
