import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../server/app';
import type { TemaDataStore } from '../server/api/temaRoutes';
import { SERVER_TIMESTAMP_SENTINEL, type RestWriteInstruction } from '../server/api/firestoreRest';
import {
  computePaymentBreakdown,
  DomainValidationError,
  egpToPiasters,
  MAX_SAFE_AMOUNT_PIASTERS,
  resolveValidatedExpensePiasters,
  resolveValidatedPaymentPiasters,
} from '../src/lib/domain/money';
import {
  deriveFinancialSummaryFromLedger,
  deriveStudentLedgerBalance,
  validateAdjustmentAgainstPayment,
  validateSettlementAgainstPayment,
} from '../src/lib/domain/ledger';
import type { ExpenseRecord, LedgerEntry, MemberRole, PaymentRecord } from '../src/types/domain';

function createInMemoryStore(initialDocs: Record<string, Record<string, unknown>> = {}): {
  store: TemaDataStore;
  docs: Map<string, Record<string, unknown>>;
} {
  const docs = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(initialDocs)) {
    docs.set(k, structuredClone(v));
  }

  const resolveSentinels = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = v === SERVER_TIMESTAMP_SENTINEL ? '2026-11-15T12:00:00.000Z' : v;
    }
    return out;
  };

  const store: TemaDataStore = {
    async getDoc<T>(docPath: string): Promise<T | null> {
      const found = docs.get(docPath);
      return found ? (structuredClone(found) as T) : null;
    },
    async listCollection<T>(collectionPath: string): Promise<T[]> {
      const prefix = `${collectionPath}/`;
      const results: T[] = [];
      for (const [key, val] of docs.entries()) {
        if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
          results.push(structuredClone(val) as T);
        }
      }
      return results;
    },
    async commitWrites(writes: RestWriteInstruction[]): Promise<void> {
      for (const w of writes) {
        const cleanData = resolveSentinels(w.data);
        if (w.type === 'set') {
          docs.set(w.path, cleanData);
        } else {
          const prev = docs.get(w.path) ?? {};
          docs.set(w.path, { ...prev, ...cleanData });
        }
      }
    },
  };

  return { store, docs };
}

async function withServer(
  app: ReturnType<typeof createApiApp>,
  run: (baseUrl: string) => Promise<void>
) {
  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  try {
    const addr = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('TEMA Financial Integrity — Unit & Express API Tests', () => {
  it('1. converts EGP to exact integer piasters and rejects 0, negative, NaN, Infinity, >2 decimals, and overpayment', () => {
    expect(egpToPiasters(350)).toBe(35000);
    expect(egpToPiasters(199.95)).toBe(19995);
    expect(egpToPiasters(0, { allowZero: true })).toBe(0);

    expect(() => egpToPiasters(0)).toThrow(DomainValidationError);
    expect(() => egpToPiasters(-50)).toThrow(DomainValidationError);
    expect(() => egpToPiasters(Number.NaN)).toThrow(DomainValidationError);
    expect(() => egpToPiasters(Number.POSITIVE_INFINITY)).toThrow(DomainValidationError);
    expect(() => egpToPiasters(10.125)).toThrow(DomainValidationError);

    expect(() => computePaymentBreakdown(500, 600)).toThrow(DomainValidationError);
    expect(() => computePaymentBreakdown(500, -10)).toThrow(DomainValidationError);

    const partial = computePaymentBreakdown(500, 200);
    expect(partial).toEqual({
      amountPiasters: 50000,
      paidAmountPiasters: 20000,
      dueAmountPiasters: 30000,
      amount: 500,
      paidAmount: 200,
      dueAmount: 300,
      status: 'partial',
    });
  });

  it('2. validates installment settlement and enforces immutability once posted or voided', () => {
    const partialPayment: PaymentRecord = {
      id: 'pay_1',
      organizationId: 'org_1',
      studentId: 'stu_1',
      studentName: 'يوسف حسن',
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
      recordedBy: 'uid_1',
      createdAt: null,
      updatedAt: null,
    };

    expect(() => validateSettlementAgainstPayment(partialPayment, 350, 'cash')).toThrow(
      DomainValidationError
    );

    const settled = validateSettlementAgainstPayment(partialPayment, 300, 'instapay');
    expect(settled.newPaidPiasters).toBe(50000);
    expect(settled.newDuePiasters).toBe(0);
    expect(settled.nextStatus).toBe('posted');

    const postedPayment: PaymentRecord = {
      ...partialPayment,
      paidAmount: 500,
      dueAmount: 0,
      paidAmountPiasters: 50000,
      dueAmountPiasters: 0,
      status: 'posted',
    };
    expect(() => validateSettlementAgainstPayment(postedPayment, 10, 'cash')).toThrow(
      DomainValidationError
    );
  });

  it('3. derives organization & student balances from immutable ledger entries including reversals and adjustments', () => {
    const entries: LedgerEntry[] = [
      {
        id: 'ldg_1',
        organizationId: 'org_1',
        entryType: 'charge',
        direction: 'debit',
        entityType: 'payment',
        entityId: 'pay_1',
        studentId: 'stu_1',
        amountPiasters: 50000,
        amount: 500,
        currency: 'EGP',
        description: 'charge',
        recordedBy: 'uid_1',
        createdAt: null,
      },
      {
        id: 'ldg_2',
        organizationId: 'org_1',
        entryType: 'payment',
        direction: 'credit',
        entityType: 'payment',
        entityId: 'pay_1',
        studentId: 'stu_1',
        amountPiasters: 30000,
        amount: 300,
        currency: 'EGP',
        description: 'payment',
        recordedBy: 'uid_1',
        createdAt: null,
      },
      {
        id: 'ldg_3',
        organizationId: 'org_1',
        entryType: 'adjustment',
        direction: 'credit',
        entityType: 'payment',
        entityId: 'pay_1',
        studentId: 'stu_1',
        amountPiasters: 5000,
        amount: 50,
        currency: 'EGP',
        description: 'discount 50 EGP',
        recordedBy: 'uid_1',
        createdAt: null,
      },
      {
        id: 'ldg_4',
        organizationId: 'org_1',
        entryType: 'charge',
        direction: 'debit',
        entityType: 'expense',
        entityId: 'exp_1',
        amountPiasters: 10000,
        amount: 100,
        currency: 'EGP',
        description: 'printing',
        recordedBy: 'uid_1',
        createdAt: null,
      },
    ];

    const summary = deriveFinancialSummaryFromLedger(entries, [], []);
    expect(summary.chargedEgp).toBe(450);
    expect(summary.collectedEgp).toBe(300);
    expect(summary.outstandingEgp).toBe(150);
    expect(summary.expensesEgp).toBe(100);
    expect(summary.netEgp).toBe(200);
    expect(summary.source).toBe('ledger');

    const stuBal = deriveStudentLedgerBalance('stu_1', entries, []);
    expect(stuBal.totalChargedEgp).toBe(450);
    expect(stuBal.totalCollectedEgp).toBe(300);
    expect(stuBal.outstandingDueEgp).toBe(150);
  });

  it('4. Express /api/v1 payment lifecycle: creates with ledger+idempotency, settles partial, voids with reversal, and enforces RBAC', async () => {
    const { store, docs } = createInMemoryStore({
      'organizations/org_1': {
        id: 'org_1',
        name: 'أكاديمية النخبة',
        currency: 'EGP',
        status: 'active',
      },
      'organizations/org_1/students/stu_1': {
        id: 'stu_1',
        organizationId: 'org_1',
        fullName: 'أحمد طارق',
        status: 'active',
      },
    });

    const roleByToken: Record<string, { uid: string; role: MemberRole }> = {
      tok_assistant: { uid: 'uid_assistant', role: 'assistant' },
      tok_teacher: { uid: 'uid_teacher', role: 'teacher' },
      tok_accountant: { uid: 'uid_accountant', role: 'accountant' },
    };

    const app = createApiApp({
      temaApiDeps: {
        store,
        verifyToken: async (authHeader) => {
          const tok = authHeader?.replace('Bearer ', '') ?? '';
          const entry = roleByToken[tok];
          if (!entry) return { ok: false, status: 401, error: 'Unauthorized' };
          return {
            ok: true,
            idToken: tok,
            user: { uid: entry.uid, email: `${entry.role}@tema.edu.eg`, emailVerified: true },
          };
        },
        verifyMembership: async (orgId, uid, idToken) => {
          const entry = roleByToken[idToken];
          if (!entry || entry.uid !== uid || orgId !== 'org_1') {
            return { ok: false, status: 403, error: 'Membership denied' };
          }
          return {
            ok: true,
            membership: {
              uid,
              organizationId: orgId,
              displayName: entry.role,
              role: entry.role,
              status: 'active',
            },
          };
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      // Teacher cannot create payments
      const teacherRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_teacher' },
        body: JSON.stringify({
          studentId: 'stu_1',
          studentName: 'أحمد طارق',
          amount: 500,
          paidAmount: 200,
          category: 'tuition',
          method: 'cash',
        }),
      });
      expect(teacherRes.status).toBe(403);

      // Assistant creates partial payment with idempotencyKey
      const payBody = {
        studentId: 'stu_1',
        studentName: 'أحمد طارق',
        amount: 500,
        paidAmount: 200,
        category: 'tuition',
        method: 'cash',
        idempotencyKey: 'idem_test_1',
      };
      const createRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify(payBody),
      });
      expect(createRes.status).toBe(201);
      const createdJson = (await createRes.json()) as { paymentId: string; status: string };
      expect(createdJson.status).toBe('partial');

      // Duplicate submission with same idempotencyKey returns deduplicated paymentId
      const dupRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify(payBody),
      });
      expect(dupRes.status).toBe(200);
      const dupJson = (await dupRes.json()) as { paymentId: string; deduplicated: boolean };
      expect(dupJson.deduplicated).toBe(true);
      expect(dupJson.paymentId).toBe(createdJson.paymentId);

      // Overpayment settlement rejected (remaining is 300)
      const overSettle = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${createdJson.paymentId}/settle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: JSON.stringify({ installmentAmount: 350, method: 'instapay' }),
        }
      );
      expect(overSettle.status).toBe(400);

      // Valid settlement completes payment to 'posted'
      const validSettle = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${createdJson.paymentId}/settle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: JSON.stringify({ installmentAmount: 300, method: 'instapay' }),
        }
      );
      expect(validSettle.status).toBe(200);
      const settledJson = (await validSettle.json()) as { status: string; paidAmount: number; dueAmount: number };
      expect(settledJson.status).toBe('posted');
      expect(settledJson.paidAmount).toBe(500);
      expect(settledJson.dueAmount).toBe(0);

      // Assistant CANNOT void a payment (owner/accountant only)
      const assistantVoid = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${createdJson.paymentId}/void`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: JSON.stringify({ reason: 'خطأ في الإدخال' }),
        }
      );
      expect(assistantVoid.status).toBe(403);

      // Accountant voids payment -> status becomes voided and ledger nets to 0
      const accVoid = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${createdJson.paymentId}/void`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: JSON.stringify({ reason: 'إلغاء فاتورة مكررة' }),
        }
      );
      expect(accVoid.status).toBe(200);

      const ledgerEntries = await store.listCollection<LedgerEntry>(
        'organizations/org_1/ledgerEntries',
        'tok_accountant'
      );
      const payDocs = await store.listCollection<PaymentRecord>(
        'organizations/org_1/payments',
        'tok_accountant'
      );
      const finalSummary = deriveFinancialSummaryFromLedger(ledgerEntries, payDocs, []);
      expect(finalSummary.chargedEgp).toBe(0);
      expect(finalSummary.collectedEgp).toBe(0);
      expect(finalSummary.outstandingEgp).toBe(0);

      // Verify deterministic anti-duplication ledger IDs for payment lifecycle
      const paymentLedgerIds = ledgerEntries.map((e) => e.id).sort();
      expect(paymentLedgerIds).toEqual(
        [
          `${createdJson.paymentId}_charge`,
          `${createdJson.paymentId}_pay_init`,
          `${createdJson.paymentId}_pay_50000`,
          `${createdJson.paymentId}_rev_charge`,
          `${createdJson.paymentId}_rev_paid`,
        ].sort()
      );

      // Expense creation allowed for accountant, blocked for assistant
      const assExp = await fetch(`${baseUrl}/api/v1/organizations/org_1/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify({
          title: 'طباعة مذكرات',
          category: 'printing',
          amount: 250,
          expenseDate: '2026-11-15',
        }),
      });
      expect(assExp.status).toBe(403);

      const accExp = await fetch(`${baseUrl}/api/v1/organizations/org_1/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
        body: JSON.stringify({
          title: 'طباعة مذكرات',
          category: 'printing',
          amount: 250,
          expenseDate: '2026-11-15',
        }),
      });
      expect(accExp.status).toBe(201);
      const expJson = (await accExp.json()) as { expenseId: string };
      expect(docs.has(`organizations/org_1/ledgerEntries/${expJson.expenseId}_charge`)).toBe(true);
      expect(docs.size).toBeGreaterThan(5);
    });
  });

  it('5. validateAdjustmentAgainstPayment enforces cumulative credit and debit bounds per payment', () => {
    const basePayment: PaymentRecord = {
      id: 'pay_adj_unit_1',
      organizationId: 'org_1',
      studentId: 'stu_1',
      studentName: 'يوسف حسن',
      amount: 500,
      paidAmount: 200,
      dueAmount: 300,
      amountPiasters: 50000,
      paidAmountPiasters: 20000,
      dueAmountPiasters: 30000,
      adjustedCreditPiasters: 40000,
      adjustedDebitPiasters: 10000,
      currency: 'EGP',
      category: 'tuition',
      method: 'cash',
      status: 'partial',
      recordedBy: 'uid_1',
      createdAt: null,
      updatedAt: null,
    };

    // Within remaining credit allowance (400 + 100 = 500 <= 500) -> SUCCEEDS
    const validCredit = validateAdjustmentAgainstPayment(
      basePayment,
      100,
      'credit',
      'خصم متبقي ضمن الحد',
      'k_credit_1'
    );
    expect(validCredit.nextAdjustedCredit).toBe(50000);
    expect(validCredit.nextAdjustedDebit).toBe(10000);

    // Exceeds cumulative credit limit (400 + 100.01 > 500) -> THROWS
    expect(() =>
      validateAdjustmentAgainstPayment(
        basePayment,
        100.01,
        'credit',
        'محاولة تجاوز إجمالي الفاتورة',
        'k_credit_2'
      )
    ).toThrow(DomainValidationError);

    // Exceeds cumulative debit limit (100 + 401 > 500) -> THROWS
    expect(() =>
      validateAdjustmentAgainstPayment(
        basePayment,
        401,
        'debit',
        'محاولة تجاوز حد التسوية المدينة',
        'k_debit_over'
      )
    ).toThrow(DomainValidationError);

    // Voided payment -> THROWS
    expect(() =>
      validateAdjustmentAgainstPayment(
        { ...basePayment, status: 'voided' },
        10,
        'credit',
        'تسوية على فاتورة ملغاة',
        'k_voided'
      )
    ).toThrow(DomainValidationError);
  });

  it('6. Express /api/v1 payment adjustment endpoint enforces RBAC, idempotency, and cumulative cap across multiple keys', async () => {
    const { store, docs } = createInMemoryStore({
      'organizations/org_1': {
        id: 'org_1',
        name: 'أكاديمية النخبة',
        currency: 'EGP',
        status: 'active',
      },
      'organizations/org_1/students/stu_1': {
        id: 'stu_1',
        organizationId: 'org_1',
        fullName: 'أحمد طارق',
        status: 'active',
      },
    });

    const roleByToken: Record<string, { uid: string; role: MemberRole }> = {
      tok_assistant: { uid: 'uid_assistant', role: 'assistant' },
      tok_accountant: { uid: 'uid_accountant', role: 'accountant' },
    };

    const app = createApiApp({
      temaApiDeps: {
        store,
        verifyToken: async (authHeader) => {
          const tok = authHeader?.replace('Bearer ', '') ?? '';
          const entry = roleByToken[tok];
          if (!entry) return { ok: false, status: 401, error: 'Unauthorized' };
          return {
            ok: true,
            idToken: tok,
            user: { uid: entry.uid, email: `${entry.role}@tema.edu.eg`, emailVerified: true },
          };
        },
        verifyMembership: async (orgId, uid, idToken) => {
          const entry = roleByToken[idToken];
          if (!entry || entry.uid !== uid || orgId !== 'org_1') {
            return { ok: false, status: 403, error: 'Membership denied' };
          }
          return {
            ok: true,
            membership: {
              uid,
              organizationId: orgId,
              displayName: entry.role,
              role: entry.role,
              status: 'active',
            },
          };
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      // Create 500 EGP payment
      const createRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify({
          studentId: 'stu_1',
          studentName: 'أحمد طارق',
          amount: 500,
          paidAmount: 100,
          category: 'tuition',
          method: 'cash',
        }),
      });
      expect(createRes.status).toBe(201);
      const { paymentId } = (await createRes.json()) as { paymentId: string };

      // Assistant CANNOT adjust payment (owner/accountant only)
      const assAdj = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${paymentId}/adjust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: JSON.stringify({
            adjustmentAmount: 100,
            direction: 'credit',
            reason: 'خصم مساعد غير مصرح',
            idempotencyKey: 'api_adj_ass_1',
          }),
        }
      );
      expect(assAdj.status).toBe(403);

      // Adjustment 1: 300 EGP credit -> 201
      const adj1 = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${paymentId}/adjust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: JSON.stringify({
            adjustmentAmount: 300,
            direction: 'credit',
            reason: 'خصم معتمد دفعة 1',
            idempotencyKey: 'api_adj_k1',
          }),
        }
      );
      expect(adj1.status).toBe(201);
      const adj1Json = (await adj1.json()) as {
        entryId: string;
        adjustedCreditPiasters: number;
      };
      expect(adj1Json.adjustedCreditPiasters).toBe(30000);

      // Replay Adjustment 1 with same idempotencyKey -> deduplicated 200 without inflating counter
      const adj1Replay = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${paymentId}/adjust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: JSON.stringify({
            adjustmentAmount: 300,
            direction: 'credit',
            reason: 'خصم معتمد دفعة 1',
            idempotencyKey: 'api_adj_k1',
          }),
        }
      );
      expect(adj1Replay.status).toBe(200);
      const adj1ReplayJson = (await adj1Replay.json()) as { deduplicated: boolean };
      expect(adj1ReplayJson.deduplicated).toBe(true);

      // Adjustment 2 with NEW key: 200 EGP credit (cumulative 300 + 200 = 500 == amount) -> 201
      const adj2 = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${paymentId}/adjust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: JSON.stringify({
            adjustmentAmount: 200,
            direction: 'credit',
            reason: 'خصم معتمد دفعة 2',
            idempotencyKey: 'api_adj_k2',
          }),
        }
      );
      expect(adj2.status).toBe(201);

      // Adjustment 3 with NEW key: 1 EGP credit (cumulative 501 > 500) -> 400 CUMULATIVE_LIMIT_EXCEEDED
      const adj3 = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/payments/${paymentId}/adjust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: JSON.stringify({
            adjustmentAmount: 1,
            direction: 'credit',
            reason: 'تجاوز الحد المسموح',
            idempotencyKey: 'api_adj_k3',
          }),
        }
      );
      expect(adj3.status).toBe(400);
      const adj3Json = (await adj3.json()) as { code?: string };
      expect(adj3Json.code).toBe('ADJUSTMENT_EXCEEDS_PAYMENT');

      const storedPayment = docs.get(`organizations/org_1/payments/${paymentId}`) as
        | { adjustedCreditPiasters?: number }
        | undefined;
      expect(storedPayment?.adjustedCreditPiasters).toBe(50000);
    });
  });

  it('7. legacy payment/expense handling rejects corrupted/mismatched records and safely resolves missing *Piasters without migration', () => {
    // Legacy Payment without *Piasters fields resolves cleanly and flags backfill
    const legacyPayment: PaymentRecord = {
      id: 'pay_legacy_1',
      organizationId: 'org_1',
      studentId: 'stu_1',
      studentName: 'طالب قديم',
      amount: 350.5,
      paidAmount: 100.25,
      dueAmount: 250.25,
      currency: 'EGP',
      category: 'tuition',
      method: 'cash',
      status: 'partial',
      recordedBy: 'uid_1',
      createdAt: null,
      updatedAt: null,
    };
    const resolvedLegacy = resolveValidatedPaymentPiasters(legacyPayment);
    expect(resolvedLegacy.amountPiasters).toBe(35050);
    expect(resolvedLegacy.paidAmountPiasters).toBe(10025);
    expect(resolvedLegacy.dueAmountPiasters).toBe(25025);
    expect(resolvedLegacy.needsBackfill).toEqual({
      amountPiasters: true,
      paidAmountPiasters: true,
      dueAmountPiasters: true,
    });

    // Settling legacy payment succeeds and requests amountPiasters backfill
    const settleLegacy = validateSettlementAgainstPayment(legacyPayment, 250.25, 'instapay');
    expect(settleLegacy.needsAmountBackfill).toBe(true);
    expect(settleLegacy.totalPiasters).toBe(35050);
    expect(settleLegacy.newPaidPiasters).toBe(35050);
    expect(settleLegacy.nextStatus).toBe('posted');

    // Tampered record with mismatched amount <-> amountPiasters is REJECTED (not bypassed via defaults)
    expect(() =>
      resolveValidatedPaymentPiasters({
        ...legacyPayment,
        amountPiasters: 100, // tampered! should be 35050
      })
    ).toThrow(DomainValidationError);

    // Corrupted legacy record with zero or negative amount or >MAX_SAFE_AMOUNT_PIASTERS is REJECTED
    expect(() =>
      resolveValidatedPaymentPiasters({
        ...legacyPayment,
        amount: 0,
        paidAmount: 0,
        dueAmount: 0,
      })
    ).toThrow(DomainValidationError);
    expect(() => egpToPiasters(MAX_SAFE_AMOUNT_PIASTERS / 100 + 1)).toThrow(DomainValidationError);

    // Legacy Expense without amountPiasters resolves cleanly; mismatched throws
    const legacyExpense: ExpenseRecord = {
      id: 'exp_legacy_1',
      organizationId: 'org_1',
      title: 'صيانة',
      category: 'other',
      amount: 199.95,
      currency: 'EGP',
      status: 'posted',
      expenseDate: '2026-10-01',
      recordedBy: 'uid_1',
      createdAt: null,
      updatedAt: null,
    };
    expect(resolveValidatedExpensePiasters(legacyExpense)).toEqual({
      amountPiasters: 19995,
      needsBackfill: true,
    });
    expect(() =>
      resolveValidatedExpensePiasters({ ...legacyExpense, amountPiasters: 500 })
    ).toThrow(DomainValidationError);

    // Hybrid ledger + legacy summary never double counts covered records and reads uncovered legacy ones safely
    const hybrid = deriveFinancialSummaryFromLedger([], [legacyPayment], [legacyExpense]);
    expect(hybrid.source).toBe('hybrid');
    expect(hybrid.chargedEgp).toBe(350.5);
    expect(hybrid.collectedEgp).toBe(100.25);
    expect(hybrid.outstandingEgp).toBe(250.25);
    expect(hybrid.expensesEgp).toBe(199.95);
    expect(hybrid.netEgp).toBe(-99.7);
  });

  it('8. Step D API hardening: blocks archived/inactive students, unenrolled groups, enforces expense void RBAC, and deduplicates concurrent races', async () => {
    const docs = new Map<string, Record<string, unknown>>(
      Object.entries({
        'organizations/org_1': {
          id: 'org_1',
          name: 'سنتر المستقبل',
          currency: 'EGP',
          status: 'active',
        },
        'organizations/org_1/students/stu_active': {
          id: 'stu_active',
          organizationId: 'org_1',
          fullName: 'سيف محمود',
          status: 'active',
        },
        'organizations/org_1/students/stu_archived': {
          id: 'stu_archived',
          organizationId: 'org_1',
          fullName: 'طالب مؤرشف',
          status: 'archived',
        },
        'organizations/org_1/students/stu_inactive': {
          id: 'stu_inactive',
          organizationId: 'org_1',
          fullName: 'طالب موقوف',
          status: 'inactive',
        },
        'organizations/org_1/groups/grp_1': {
          id: 'grp_1',
          organizationId: 'org_1',
          name: 'فيزياء 3ث',
          status: 'active',
        },
      })
    );

    // Atomic store enforcing exists:false precondition on set writes (simulating Firestore :commit)
    const atomicStore: TemaDataStore = {
      async getDoc<T>(docPath: string): Promise<T | null> {
        const found = docs.get(docPath);
        return found ? (structuredClone(found) as T) : null;
      },
      async listCollection<T>(collectionPath: string): Promise<T[]> {
        const prefix = `${collectionPath}/`;
        const out: T[] = [];
        for (const [k, v] of docs.entries()) {
          if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
            out.push(structuredClone(v) as T);
          }
        }
        return out;
      },
      async commitWrites(writes: RestWriteInstruction[]): Promise<void> {
        for (const w of writes) {
          if (w.type === 'set' && docs.has(w.path)) {
            throw new Error('FIRESTORE_COMMIT_ERROR_409 ALREADY_EXISTS');
          }
          if (w.type === 'update' && !docs.has(w.path)) {
            throw new Error('FIRESTORE_COMMIT_ERROR_404 NOT_FOUND');
          }
        }
        for (const w of writes) {
          const clean: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(w.data)) {
            clean[k] = v === SERVER_TIMESTAMP_SENTINEL ? '2026-11-17T12:00:00.000Z' : v;
          }
          if (w.type === 'set') {
            docs.set(w.path, clean);
          } else {
            docs.set(w.path, { ...(docs.get(w.path) ?? {}), ...clean });
          }
        }
      },
    };

    const roleByToken: Record<string, { uid: string; role: MemberRole }> = {
      tok_assistant: { uid: 'uid_assistant', role: 'assistant' },
      tok_accountant: { uid: 'uid_accountant', role: 'accountant' },
    };

    const app = createApiApp({
      temaApiDeps: {
        store: atomicStore,
        verifyToken: async (authHeader) => {
          const tok = authHeader?.replace('Bearer ', '') ?? '';
          const entry = roleByToken[tok];
          if (!entry) return { ok: false, status: 401, error: 'Unauthorized' };
          return {
            ok: true,
            idToken: tok,
            user: { uid: entry.uid, email: `${entry.role}@tema.edu.eg`, emailVerified: true },
          };
        },
        verifyMembership: async (orgId, uid, idToken) => {
          const entry = roleByToken[idToken];
          if (!entry || entry.uid !== uid || orgId !== 'org_1') {
            return { ok: false, status: 403, error: 'Membership denied' };
          }
          return {
            ok: true,
            membership: {
              uid,
              organizationId: orgId,
              displayName: entry.role,
              role: entry.role,
              status: 'active',
            },
          };
        },
      },
    });

    await withServer(app, async (baseUrl) => {
      // 1. Archived student rejected (409 STUDENT_ARCHIVED)
      const archivedRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify({
          studentId: 'stu_archived',
          studentName: 'طالب مؤرشف',
          amount: 300,
          paidAmount: 300,
          category: 'tuition',
          method: 'cash',
        }),
      });
      expect(archivedRes.status).toBe(409);

      // 2. Inactive student rejected (409 STUDENT_INACTIVE)
      const inactiveRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify({
          studentId: 'stu_inactive',
          studentName: 'طالب موقوف',
          amount: 300,
          paidAmount: 300,
          category: 'tuition',
          method: 'cash',
        }),
      });
      expect(inactiveRes.status).toBe(409);

      // 3. Payment referencing group where student is NOT enrolled rejected (409)
      const unenrolledGroupRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
        body: JSON.stringify({
          studentId: 'stu_active',
          studentName: 'سيف محمود',
          groupId: 'grp_1',
          amount: 300,
          paidAmount: 300,
          category: 'tuition',
          method: 'cash',
        }),
      });
      expect(unenrolledGroupRes.status).toBe(409);

      // 4. Zero / negative / >2-decimal payment amounts rejected (400)
      for (const badAmount of [0, -100, 99.129]) {
        const badRes = await fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: JSON.stringify({
            studentId: 'stu_active',
            studentName: 'سيف محمود',
            amount: badAmount,
            paidAmount: 0,
            category: 'tuition',
            method: 'cash',
          }),
        });
        expect(badRes.status).toBe(400);
      }

      // 5. Concurrent parallel duplicate payment submissions with same idempotencyKey commit ONCE
      const payPayload = JSON.stringify({
        studentId: 'stu_active',
        studentName: 'سيف محمود',
        amount: 400,
        paidAmount: 150,
        category: 'tuition',
        method: 'cash',
        idempotencyKey: 'race_pay_1',
      });
      const [p1, p2, p3] = await Promise.all([
        fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: payPayload,
        }),
        fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: payPayload,
        }),
        fetch(`${baseUrl}/api/v1/organizations/org_1/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: payPayload,
        }),
      ]);
      const pStatuses = [p1.status, p2.status, p3.status].sort();
      expect(pStatuses).toEqual([200, 200, 201]);
      const pBodies = await Promise.all([p1.json(), p2.json(), p3.json()]) as Array<{ paymentId: string }>;
      expect(new Set(pBodies.map((b) => b.paymentId)).size).toBe(1);

      // 6. Concurrent parallel duplicate expense submissions with same idempotencyKey commit ONCE
      const expPayload = JSON.stringify({
        title: 'كهرباء السنتر',
        category: 'utilities',
        amount: 600,
        expenseDate: '2026-11-17',
        idempotencyKey: 'race_exp_1',
      });
      const [e1, e2] = await Promise.all([
        fetch(`${baseUrl}/api/v1/organizations/org_1/expenses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: expPayload,
        }),
        fetch(`${baseUrl}/api/v1/organizations/org_1/expenses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: expPayload,
        }),
      ]);
      expect([e1.status, e2.status].sort()).toEqual([200, 201]);
      const eBodies = await Promise.all([e1.json(), e2.json()]) as Array<{ expenseId: string }>;
      expect(eBodies[0].expenseId).toBe(eBodies[1].expenseId);
      const expenseId = eBodies[0].expenseId;

      // 7. Assistant CANNOT void an expense (403); Accountant CAN void ONCE (200), double-void blocked (409)
      const assVoidExp = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/expenses/${expenseId}/void`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_assistant' },
          body: JSON.stringify({ reason: 'محاولة غير مصرح بها' }),
        }
      );
      expect(assVoidExp.status).toBe(403);

      const accVoidExp = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/expenses/${expenseId}/void`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: JSON.stringify({ reason: 'فاتورة مكررة' }),
        }
      );
      expect(accVoidExp.status).toBe(200);
      expect(docs.has(`organizations/org_1/ledgerEntries/${expenseId}_rev_charge`)).toBe(true);

      const doubleVoidExp = await fetch(
        `${baseUrl}/api/v1/organizations/org_1/expenses/${expenseId}/void`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_accountant' },
          body: JSON.stringify({ reason: 'محاولة إلغاء ثانية' }),
        }
      );
      expect(doubleVoidExp.status).toBe(409);

      // Summary: voided expense nets to 0, payment still shows 400 charged / 150 collected / 250 due
      const finalLedger = await atomicStore.listCollection<LedgerEntry>(
        'organizations/org_1/ledgerEntries',
        'tok_accountant'
      );
      const summary = deriveFinancialSummaryFromLedger(finalLedger, [], []);
      expect(summary.chargedEgp).toBe(400);
      expect(summary.collectedEgp).toBe(150);
      expect(summary.outstandingEgp).toBe(250);
      expect(summary.expensesEgp).toBe(0);
    });
  });
});
