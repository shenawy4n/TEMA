export class DomainValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code = 'VALIDATION_ERROR', status = 400) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = code;
    this.status = status;
  }
}

export const PIASTERS_PER_EGP = 100;
export const MAX_SAFE_AMOUNT_PIASTERS = 100_000_000; // 1,000,000 EGP upper sanity guard per single entry

/**
 * Converts a finite EGP amount to exact integer piasters (minor units).
 * Rejects NaN, Infinity, non-numeric values, negatives, and > 2 decimal places.
 */
export function egpToPiasters(amountEgp: unknown, options: { allowZero?: boolean; fieldLabel?: string } = {}): number {
  const { allowZero = false, fieldLabel = 'المبلغ' } = options;

  if (typeof amountEgp !== 'number' || !Number.isFinite(amountEgp)) {
    throw new DomainValidationError(`${fieldLabel} يجب أن يكون رقماً صحيحاً ومحدوداً.`, 'INVALID_NUMBER');
  }

  if (allowZero ? amountEgp < 0 : amountEgp <= 0) {
    throw new DomainValidationError(
      allowZero ? `${fieldLabel} لا يمكن أن يكون سالباً.` : `${fieldLabel} يجب أن يكون أكبر من صفر.`,
      'INVALID_AMOUNT'
    );
  }

  // Ensure no sub-piaster fractional precision tampering (max 2 decimals)
  const scaled = amountEgp * PIASTERS_PER_EGP;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new DomainValidationError(
      `${fieldLabel} يجب ألا يحتوي على أكثر من خانتين عشريتين (قروش).`,
      'INVALID_PRECISION'
    );
  }

  if (!Number.isSafeInteger(rounded) || rounded > MAX_SAFE_AMOUNT_PIASTERS) {
    throw new DomainValidationError(`${fieldLabel} يتجاوز الحد المسموح به.`, 'AMOUNT_OUT_OF_RANGE');
  }

  if (!allowZero && rounded <= 0) {
    throw new DomainValidationError(`${fieldLabel} يجب أن يكون قرشاً واحداً على الأقل.`, 'INVALID_AMOUNT');
  }

  return rounded;
}

export function assertPositivePiasters(piasters: unknown, fieldLabel = 'المبلغ بالقرش'): number {
  if (
    typeof piasters !== 'number' ||
    !Number.isFinite(piasters) ||
    !Number.isSafeInteger(piasters) ||
    piasters <= 0 ||
    piasters > MAX_SAFE_AMOUNT_PIASTERS
  ) {
    throw new DomainValidationError(`${fieldLabel} يجب أن يكون عدداً صحيحاً موجباً.`, 'INVALID_PIASTERS');
  }
  return piasters;
}

export function assertNonNegativePiasters(piasters: unknown, fieldLabel = 'المبلغ بالقرش'): number {
  if (
    typeof piasters !== 'number' ||
    !Number.isFinite(piasters) ||
    !Number.isSafeInteger(piasters) ||
    piasters < 0 ||
    piasters > MAX_SAFE_AMOUNT_PIASTERS
  ) {
    throw new DomainValidationError(`${fieldLabel} يجب أن يكون عدداً صحيحاً غير سالب.`, 'INVALID_PIASTERS');
  }
  return piasters;
}

export function piastersToEgp(piasters: number): number {
  assertNonNegativePiasters(piasters, 'القيمة بالقرش');
  return piasters / PIASTERS_PER_EGP;
}

export function resolveRecordPiasters(
  explicitPiasters: unknown,
  fallbackEgp: unknown
): number {
  if (typeof explicitPiasters === 'number' && Number.isSafeInteger(explicitPiasters) && explicitPiasters >= 0) {
    return explicitPiasters;
  }
  if (typeof fallbackEgp === 'number' && Number.isFinite(fallbackEgp) && fallbackEgp >= 0) {
    return Math.round(fallbackEgp * PIASTERS_PER_EGP);
  }
  return 0;
}

export function computePaymentBreakdown(
  totalAmountEgp: unknown,
  paidAmountEgp: unknown
): {
  amountPiasters: number;
  paidAmountPiasters: number;
  dueAmountPiasters: number;
  amount: number;
  paidAmount: number;
  dueAmount: number;
  status: 'posted' | 'partial' | 'pending';
} {
  const amountPiasters = egpToPiasters(totalAmountEgp, { allowZero: false, fieldLabel: 'إجمالي المستحق' });
  const paidAmountPiasters = egpToPiasters(paidAmountEgp, { allowZero: true, fieldLabel: 'المبلغ المدفوع' });

  if (paidAmountPiasters > amountPiasters) {
    throw new DomainValidationError(
      'المبلغ المدفوع لا يمكن أن يتجاوز إجمالي المستحق.',
      'OVERPAYMENT_NOT_ALLOWED'
    );
  }

  const dueAmountPiasters = amountPiasters - paidAmountPiasters;
  const status =
    dueAmountPiasters === 0 ? 'posted' : paidAmountPiasters > 0 ? 'partial' : 'pending';

  return {
    amountPiasters,
    paidAmountPiasters,
    dueAmountPiasters,
    amount: piastersToEgp(amountPiasters),
    paidAmount: piastersToEgp(paidAmountPiasters),
    dueAmount: piastersToEgp(dueAmountPiasters),
    status,
  };
}

export interface ValidatedStoredPaymentAmounts {
  amountPiasters: number;
  paidAmountPiasters: number;
  dueAmountPiasters: number;
  needsBackfill: {
    amountPiasters: boolean;
    paidAmountPiasters: boolean;
    dueAmountPiasters: boolean;
  };
}

/**
 * Validates and resolves exact integer piasters for an existing or legacy PaymentRecord.
 * Rejects corrupted/inconsistent amount <-> amountPiasters pairs and ensures legacy docs
 * without *Piasters cannot bypass financial invariants via zero defaults.
 */
export function resolveValidatedPaymentPiasters(record: {
  amount: unknown;
  paidAmount: unknown;
  dueAmount?: unknown;
  amountPiasters?: unknown;
  paidAmountPiasters?: unknown;
  dueAmountPiasters?: unknown;
}): ValidatedStoredPaymentAmounts {
  const hasExplicitAmount = typeof record.amountPiasters === 'number';
  const hasExplicitPaid = typeof record.paidAmountPiasters === 'number';
  const hasExplicitDue = typeof record.dueAmountPiasters === 'number';

  const derivedAmount = egpToPiasters(record.amount, {
    allowZero: false,
    fieldLabel: 'إجمالي الفاتورة',
  });
  const derivedPaid = egpToPiasters(record.paidAmount, {
    allowZero: true,
    fieldLabel: 'المبلغ المحصّل',
  });

  if (hasExplicitAmount) {
    const explicit = assertPositivePiasters(record.amountPiasters, 'إجمالي الفاتورة بالقرش');
    if (explicit !== derivedAmount) {
      throw new DomainValidationError(
        'عدم تطابق بين إجمالي الفاتورة بالجنيه وبالقرش.',
        'AMOUNT_PIASTERS_MISMATCH',
        409
      );
    }
  }

  if (hasExplicitPaid) {
    const explicitPaid = assertNonNegativePiasters(record.paidAmountPiasters, 'المبلغ المحصّل بالقرش');
    if (explicitPaid !== derivedPaid) {
      throw new DomainValidationError(
        'عدم تطابق بين المبلغ المحصّل بالجنيه وبالقرش.',
        'PAID_PIASTERS_MISMATCH',
        409
      );
    }
  }

  if (derivedPaid > derivedAmount) {
    throw new DomainValidationError(
      'سجل الدفعة غير متسق: المبلغ المحصّل يتجاوز إجمالي الفاتورة.',
      'INCONSISTENT_PAYMENT_RECORD',
      409
    );
  }

  const expectedDue = derivedAmount - derivedPaid;
  if (typeof record.dueAmount === 'number') {
    const derivedDue = egpToPiasters(record.dueAmount, {
      allowZero: true,
      fieldLabel: 'المبلغ المتبقي',
    });
    if (derivedDue !== expectedDue) {
      throw new DomainValidationError(
        'عدم تطابق بين المبلغ المتبقي وبقية مبالغ الفاتورة.',
        'DUE_PIASTERS_MISMATCH',
        409
      );
    }
  }

  if (hasExplicitDue) {
    const explicitDue = assertNonNegativePiasters(record.dueAmountPiasters, 'المبلغ المتبقي بالقرش');
    if (explicitDue !== expectedDue) {
      throw new DomainValidationError(
        'عدم تطابق في رصيد الاستحقاق المتبقي بالقرش.',
        'DUE_PIASTERS_MISMATCH',
        409
      );
    }
  }

  return {
    amountPiasters: derivedAmount,
    paidAmountPiasters: derivedPaid,
    dueAmountPiasters: expectedDue,
    needsBackfill: {
      amountPiasters: !hasExplicitAmount,
      paidAmountPiasters: !hasExplicitPaid,
      dueAmountPiasters: !hasExplicitDue,
    },
  };
}

/**
 * Validates and resolves exact integer piasters for an existing or legacy ExpenseRecord.
 */
export function resolveValidatedExpensePiasters(record: {
  amount: unknown;
  amountPiasters?: unknown;
}): {
  amountPiasters: number;
  needsBackfill: boolean;
} {
  const derivedAmount = egpToPiasters(record.amount, {
    allowZero: false,
    fieldLabel: 'قيمة المصروف',
  });
  const hasExplicit = typeof record.amountPiasters === 'number';
  if (hasExplicit) {
    const explicit = assertPositivePiasters(record.amountPiasters, 'قيمة المصروف بالقرش');
    if (explicit !== derivedAmount) {
      throw new DomainValidationError(
        'عدم تطابق بين قيمة المصروف بالجنيه وبالقرش.',
        'EXPENSE_PIASTERS_MISMATCH',
        409
      );
    }
  }
  return {
    amountPiasters: derivedAmount,
    needsBackfill: !hasExplicit,
  };
}
