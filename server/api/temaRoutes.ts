import express, { type Request, type Response, type Router } from 'express';
import crypto from 'node:crypto';
import type {
  ExpenseCategory,
  ExpenseRecord,
  GroupEnrollment,
  LedgerEntry,
  Organization,
  OrganizationMember,
  PaymentCategory,
  PaymentMethod,
  PaymentRecord,
  Student,
  StudyGroup,
} from '../../src/types/domain';
import {
  DomainValidationError,
  piastersToEgp,
  resolveValidatedExpensePiasters,
  resolveValidatedPaymentPiasters,
} from '../../src/lib/domain/money';
import { assertPermission, sanitizeAuditMetadata, type TemaPermission } from '../../src/lib/domain/rbac';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import {
  validateAdjustmentAgainstPayment,
  validateCreateExpenseInput,
  validateCreatePaymentInput,
  validateSettlementAgainstPayment,
} from '../../src/lib/domain/ledger';
import {
  assertCanEnrollStudent,
  computeOrganizationCountReconciliation,
} from '../../src/lib/domain/scheduling';
import { isValidEntityId, sanitizeText } from '../../src/lib/firebase/validation';
import type { VerifiedMembership, VerifiedUser } from '../gemini/authVerifier';
import {
  SERVER_TIMESTAMP_SENTINEL,
  restCommitWrites,
  restGetDoc,
  restListCollection,
  type RestWriteInstruction,
} from './firestoreRest';

export interface TemaDataStore {
  getDoc<T>(docPath: string, idToken: string): Promise<T | null>;
  listCollection<T>(collectionPath: string, idToken: string): Promise<T[]>;
  commitWrites(writes: RestWriteInstruction[], idToken: string): Promise<void>;
}

export const firestoreRestDataStore: TemaDataStore = {
  getDoc: restGetDoc,
  listCollection: restListCollection,
  commitWrites: restCommitWrites,
};

export interface TemaApiDeps {
  verifyToken: (
    authorizationHeader: string | undefined
  ) => Promise<
    { ok: true; user: VerifiedUser; idToken: string } | { ok: false; status: number; error: string }
  >;
  verifyMembership: (
    organizationId: string,
    uid: string,
    idToken: string
  ) => Promise<
    { ok: true; membership: VerifiedMembership } | { ok: false; status: number; error: string }
  >;
  store: TemaDataStore;
}

function makeServerId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function adminCommitWrites(writes: RestWriteInstruction[]): Promise<void> {
  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({ projectId: firebaseConfig.projectId });
  const adminDb = getAdminFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
  const batch = adminDb.batch();

  const mapAdminPayload = (data: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      out[k] = v === SERVER_TIMESTAMP_SENTINEL ? FieldValue.serverTimestamp() : v;
    }
    return out;
  };

  for (const w of writes) {
    const cleanPath = w.path.replace(/^\/+/, '');
    const docRef = adminDb.doc(cleanPath);
    const payload = mapAdminPayload(w.data);
    if (w.type === 'set') {
      batch.set(docRef, payload);
    } else {
      batch.update(docRef, payload);
    }
  }

  await batch.commit();
}

function buildAuditWrite(
  orgId: string,
  member: VerifiedMembership,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    result: 'success' | 'denied' | 'failure';
    correlationId: string;
    metadata?: Record<string, unknown>;
  }
): RestWriteInstruction {
  const logId = makeServerId('log');
  const cleanMeta = sanitizeAuditMetadata(entry.metadata);
  const data: Record<string, unknown> = {
    id: logId,
    organizationId: orgId,
    actorId: member.uid,
    actorName: sanitizeText(member.displayName || 'مستخدم TEMA', 100),
    actorRole: member.role, // Always resolved from authoritative Firestore membership
    action: sanitizeText(entry.action, 100),
    entityType: sanitizeText(entry.entityType, 60),
    entityId: entry.entityId,
    summary: sanitizeText(entry.summary, 300),
    result: entry.result,
    correlationId: entry.correlationId,
    createdAt: SERVER_TIMESTAMP_SENTINEL,
  };
  if (cleanMeta) data.metadata = cleanMeta;

  return {
    type: 'set',
    path: `organizations/${orgId}/auditLogs/${logId}`,
    data,
  };
}

async function authorizeRequest(
  req: Request,
  res: Response,
  deps: TemaApiDeps,
  permission: TemaPermission
): Promise<{
  orgId: string;
  idToken: string;
  member: VerifiedMembership;
  org: Organization;
  correlationId: string;
} | null> {
  const correlationId = makeServerId('req');
  const orgId = req.params.orgId;
  if (!orgId || !isValidEntityId(orgId)) {
    res.status(400).json({ error: 'Invalid organizationId.', correlationId });
    return null;
  }

  const authResult = await deps.verifyToken(req.headers.authorization);
  if (!authResult.ok) {
    res.status(authResult.status).json({ error: authResult.error, correlationId });
    return null;
  }

  const memberResult = await deps.verifyMembership(orgId, authResult.user.uid, authResult.idToken);
  if (!memberResult.ok) {
    res.status(memberResult.status).json({ error: memberResult.error, correlationId });
    return null;
  }

  const memberAsDomain: OrganizationMember = {
    uid: memberResult.membership.uid,
    organizationId: memberResult.membership.organizationId,
    displayName: memberResult.membership.displayName || 'مستخدم TEMA',
    email: authResult.user.email,
    role: memberResult.membership.role,
    status: memberResult.membership.status,
    createdAt: null,
    updatedAt: null,
  };

  try {
    assertPermission(memberAsDomain, orgId, authResult.user.uid, permission);
  } catch (err) {
    const status = err instanceof DomainValidationError ? err.status : 403;
    const message = err instanceof Error ? err.message : 'Permission denied.';
    res.status(status).json({ error: message, correlationId });
    return null;
  }

  const org = await deps.store.getDoc<Organization>(`organizations/${orgId}`, authResult.idToken);
  if (!org || org.status !== 'active') {
    res.status(403).json({ error: 'Organization is missing or suspended.', correlationId });
    return null;
  }

  return {
    orgId,
    idToken: authResult.idToken,
    member: memberResult.membership,
    org,
    correlationId,
  };
}

function sendErrorResponse(res: Response, err: unknown, correlationId: string): void {
  if (err instanceof DomainValidationError) {
    res.status(err.status).json({ error: err.message, code: err.code, correlationId });
    return;
  }
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('FIRESTORE_COMMIT_ERROR_409') || msg.includes('ALREADY_EXISTS')) {
    res.status(409).json({ error: 'Concurrent write conflict or duplicate operation.', correlationId });
    return;
  }
  if (msg.includes('FIRESTORE_REST_ERROR_403') || msg.includes('FIRESTORE_COMMIT_ERROR_403')) {
    res.status(403).json({ error: 'Firestore denied the operation.', correlationId });
    return;
  }
  res.status(500).json({ error: 'Internal server error.', correlationId });
}

export function createTemaApiRouter(deps: TemaApiDeps): Router {
  const router = express.Router();

  // POST /api/v1/organizations/:orgId/payments
  router.post('/organizations/:orgId/payments', async (req: Request, res: Response) => {
    const ctx = await authorizeRequest(req, res, deps, 'payments:create');
    if (!ctx) return;

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const validated = validateCreatePaymentInput(
        ctx.org,
        {
          studentId: String(body.studentId ?? ''),
          studentName: String(body.studentName ?? ''),
          groupId: typeof body.groupId === 'string' ? body.groupId : undefined,
          amount: body.amount as number,
          paidAmount: body.paidAmount as number,
          category: body.category as PaymentCategory,
          method: body.method as PaymentMethod,
          paymentDate: typeof body.paymentDate === 'string' ? body.paymentDate : undefined,
          referenceNumber: typeof body.referenceNumber === 'string' ? body.referenceNumber : undefined,
          notes: typeof body.notes === 'string' ? body.notes : undefined,
          idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
        },
        todayIso()
      );

      if (validated.idempotencyKey) {
        const keyDoc = await deps.store.getDoc<{ entityId?: string }>(
          `organizations/${ctx.orgId}/idempotencyKeys/pay_${validated.idempotencyKey}`,
          ctx.idToken
        );
        if (keyDoc?.entityId) {
          res.status(200).json({
            paymentId: keyDoc.entityId,
            deduplicated: true,
            correlationId: ctx.correlationId,
          });
          return;
        }
      }

      const student = await deps.store.getDoc<Student>(
        `organizations/${ctx.orgId}/students/${validated.studentId}`,
        ctx.idToken
      );
      if (!student || student.organizationId !== ctx.orgId) {
        throw new DomainValidationError('الطالب غير موجود في المنظمة.', 'STUDENT_NOT_FOUND', 404);
      }
      if (student.status !== 'active') {
        throw new DomainValidationError(
          student.status === 'archived'
            ? 'لا يمكن تسجيل فاتورة لطالب مؤرشف.'
            : 'لا يمكن تسجيل فاتورة لطالب غير نشط.',
          student.status === 'archived' ? 'STUDENT_ARCHIVED' : 'STUDENT_INACTIVE',
          409
        );
      }

      if (validated.groupId) {
        const [group, enrollment] = await Promise.all([
          deps.store.getDoc<StudyGroup>(
            `organizations/${ctx.orgId}/groups/${validated.groupId}`,
            ctx.idToken
          ),
          deps.store.getDoc<GroupEnrollment>(
            `organizations/${ctx.orgId}/enrollments/${validated.groupId}_${validated.studentId}`,
            ctx.idToken
          ),
        ]);
        if (!group || group.organizationId !== ctx.orgId) {
          throw new DomainValidationError('المجموعة المحددة غير موجودة في المنظمة.', 'GROUP_NOT_FOUND', 404);
        }
        if (!enrollment || enrollment.status !== 'active') {
          throw new DomainValidationError(
            'الطالب غير مسجل في المجموعة المحددة.',
            'STUDENT_NOT_ENROLLED_IN_GROUP',
            409
          );
        }
      }

      const paymentId = makeServerId('pay');
      const chargeEntryId = `${paymentId}_charge`;
      const writes: RestWriteInstruction[] = [
        {
          type: 'set',
          path: `organizations/${ctx.orgId}/payments/${paymentId}`,
          data: {
            id: paymentId,
            organizationId: ctx.orgId,
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
            ...(validated.idempotencyKey ? { idempotencyKey: validated.idempotencyKey } : {}),
            recordedBy: ctx.member.uid,
            createdAt: SERVER_TIMESTAMP_SENTINEL,
            updatedAt: SERVER_TIMESTAMP_SENTINEL,
          },
        },
        {
          type: 'set',
          path: `organizations/${ctx.orgId}/ledgerEntries/${chargeEntryId}`,
          data: {
            id: chargeEntryId,
            organizationId: ctx.orgId,
            entryType: 'charge',
            direction: 'debit',
            entityType: 'payment',
            entityId: paymentId,
            studentId: student.id,
            studentName: student.fullName,
            groupId: validated.groupId,
            amountPiasters: validated.amountPiasters,
            amount: validated.amount,
            currency: 'EGP',
            description: `استحقاق مالي (${validated.category}) للطالب "${student.fullName}"`,
            recordedBy: ctx.member.uid,
            createdAt: SERVER_TIMESTAMP_SENTINEL,
          },
        },
      ];

      if (validated.paidAmountPiasters > 0) {
        const payEntryId = `${paymentId}_pay_init`;
        writes.push({
          type: 'set',
          path: `organizations/${ctx.orgId}/ledgerEntries/${payEntryId}`,
          data: {
            id: payEntryId,
            organizationId: ctx.orgId,
            entryType: 'payment',
            direction: 'credit',
            entityType: 'payment',
            entityId: paymentId,
            studentId: student.id,
            studentName: student.fullName,
            groupId: validated.groupId,
            amountPiasters: validated.paidAmountPiasters,
            amount: validated.paidAmount,
            currency: 'EGP',
            description: `تحصيل دفعة (${validated.method}) للطالب "${student.fullName}"`,
            relatedEntryId: chargeEntryId,
            recordedBy: ctx.member.uid,
            createdAt: SERVER_TIMESTAMP_SENTINEL,
          },
        });
      }

      if (validated.idempotencyKey) {
        const keyDocId = `pay_${validated.idempotencyKey}`;
        writes.push({
          type: 'set',
          path: `organizations/${ctx.orgId}/idempotencyKeys/${keyDocId}`,
          data: {
            id: keyDocId,
            organizationId: ctx.orgId,
            entityType: 'payment',
            entityId: paymentId,
            createdBy: ctx.member.uid,
            createdAt: SERVER_TIMESTAMP_SENTINEL,
          },
        });
      }

      writes.push(
        buildAuditWrite(ctx.orgId, ctx.member, {
          action: 'payment.created',
          entityType: 'payment',
          entityId: paymentId,
          summary: `تسجيل عملية مالية للطالب "${student.fullName}" بقيمة ${validated.amount} ج.م.`,
          result: 'success',
          correlationId: ctx.correlationId,
          metadata: {
            after: {
              amountPiasters: validated.amountPiasters,
              paidAmountPiasters: validated.paidAmountPiasters,
              status: validated.status,
            },
          },
        })
      );

      try {
        await deps.store.commitWrites(writes, ctx.idToken);
      } catch (commitErr) {
        if (validated.idempotencyKey) {
          const racedKey = await deps.store.getDoc<{ entityId?: string }>(
            `organizations/${ctx.orgId}/idempotencyKeys/pay_${validated.idempotencyKey}`,
            ctx.idToken
          );
          if (racedKey?.entityId) {
            res.status(200).json({
              paymentId: racedKey.entityId,
              deduplicated: true,
              correlationId: ctx.correlationId,
            });
            return;
          }
        }
        throw commitErr;
      }
      res.status(201).json({ paymentId, status: validated.status, correlationId: ctx.correlationId });
    } catch (err) {
      sendErrorResponse(res, err, ctx.correlationId);
    }
  });

  // POST /api/v1/organizations/:orgId/payments/:paymentId/settle
  router.post(
    '/organizations/:orgId/payments/:paymentId/settle',
    async (req: Request, res: Response) => {
      const ctx = await authorizeRequest(req, res, deps, 'payments:settle');
      if (!ctx) return;

      try {
        const paymentId = req.params.paymentId;
        if (!paymentId || !isValidEntityId(paymentId)) {
          throw new DomainValidationError('معرّف الدفعة غير صالح.', 'INVALID_PAYMENT_ID');
        }

        const existing = await deps.store.getDoc<PaymentRecord>(
          `organizations/${ctx.orgId}/payments/${paymentId}`,
          ctx.idToken
        );
        if (!existing || existing.organizationId !== ctx.orgId) {
          throw new DomainValidationError('القيد المالي غير موجود.', 'PAYMENT_NOT_FOUND', 404);
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const method = body.method as PaymentMethod;
        const settlement = validateSettlementAgainstPayment(
          existing,
          body.installmentAmount as number,
          method
        );

        const entryId = `${paymentId}_pay_${settlement.newPaidPiasters}`;
        const installmentEgp = piastersToEgp(settlement.installmentPiasters);

        await deps.store.commitWrites(
          [
            {
              type: 'update',
              path: `organizations/${ctx.orgId}/payments/${paymentId}`,
              data: {
                paidAmount: settlement.newPaidAmount,
                dueAmount: settlement.newDueAmount,
                paidAmountPiasters: settlement.newPaidPiasters,
                dueAmountPiasters: settlement.newDuePiasters,
                status: settlement.nextStatus,
                method,
                referenceNumber: sanitizeText(
                  typeof body.referenceNumber === 'string'
                    ? body.referenceNumber
                    : existing.referenceNumber || '',
                  80
                ),
                updatedAt: SERVER_TIMESTAMP_SENTINEL,
                ...(settlement.needsAmountBackfill
                  ? { amountPiasters: settlement.totalPiasters }
                  : {}),
              },
            },
            {
              type: 'set',
              path: `organizations/${ctx.orgId}/ledgerEntries/${entryId}`,
              data: {
                id: entryId,
                organizationId: ctx.orgId,
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
                recordedBy: ctx.member.uid,
                createdAt: SERVER_TIMESTAMP_SENTINEL,
              },
            },
            buildAuditWrite(ctx.orgId, ctx.member, {
              action: 'payment.settled',
              entityType: 'payment',
              entityId: paymentId,
              summary: `سداد قسط بقيمة ${installmentEgp} ج.م للطالب "${existing.studentName}".`,
              result: 'success',
              correlationId: ctx.correlationId,
              metadata: {
                before: { status: existing.status, paidAmount: existing.paidAmount },
                after: { status: settlement.nextStatus, paidAmount: settlement.newPaidAmount },
              },
            }),
          ],
          ctx.idToken
        );

        res.status(200).json({
          paymentId,
          status: settlement.nextStatus,
          paidAmount: settlement.newPaidAmount,
          dueAmount: settlement.newDueAmount,
          correlationId: ctx.correlationId,
        });
      } catch (err) {
        sendErrorResponse(res, err, ctx.correlationId);
      }
    }
  );

  // POST /api/v1/organizations/:orgId/payments/:paymentId/adjust
  router.post(
    '/organizations/:orgId/payments/:paymentId/adjust',
    async (req: Request, res: Response) => {
      const ctx = await authorizeRequest(req, res, deps, 'payments:adjust');
      if (!ctx) return;

      try {
        const paymentId = req.params.paymentId;
        if (!paymentId || !isValidEntityId(paymentId)) {
          throw new DomainValidationError('معرّف الدفعة غير صالح.', 'INVALID_PAYMENT_ID');
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const direction = body.direction as 'debit' | 'credit';
        const rawKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
        const effectiveKey = rawKey.length > 0 ? rawKey : makeServerId('adj');
        const keyDocId = `adj_${effectiveKey}`;

        if (rawKey.length > 0) {
          const existingKey = await deps.store.getDoc<{ entityId?: string }>(
            `organizations/${ctx.orgId}/idempotencyKeys/${keyDocId}`,
            ctx.idToken
          );
          if (existingKey?.entityId) {
            res.status(200).json({
              entryId: existingKey.entityId,
              deduplicated: true,
              correlationId: ctx.correlationId,
            });
            return;
          }
        }

        const existing = await deps.store.getDoc<PaymentRecord>(
          `organizations/${ctx.orgId}/payments/${paymentId}`,
          ctx.idToken
        );
        if (!existing || existing.organizationId !== ctx.orgId) {
          throw new DomainValidationError('القيد المالي غير موجود.', 'PAYMENT_NOT_FOUND', 404);
        }

        const validatedAdj = validateAdjustmentAgainstPayment(
          existing,
          body.adjustmentAmount as number,
          direction,
          typeof body.reason === 'string' ? body.reason : '',
          effectiveKey
        );

        const entryId = `ldg_adj_${effectiveKey}`;
        const payUpdateData: Record<string, unknown> = {
          adjustedCreditPiasters: validatedAdj.nextAdjustedCredit,
          adjustedDebitPiasters: validatedAdj.nextAdjustedDebit,
          lastAdjustmentEntryId: entryId,
          updatedAt: SERVER_TIMESTAMP_SENTINEL,
          ...(validatedAdj.needsPiastersBackfill
            ? {
                amountPiasters: validatedAdj.totalPiasters,
                paidAmountPiasters: validatedAdj.paidPiasters,
                dueAmountPiasters: validatedAdj.duePiasters,
              }
            : {}),
        };

        try {
          await deps.store.commitWrites(
            [
              {
                type: 'update',
                path: `organizations/${ctx.orgId}/payments/${paymentId}`,
                data: payUpdateData,
              },
              {
                type: 'set',
                path: `organizations/${ctx.orgId}/ledgerEntries/${entryId}`,
                data: {
                  id: entryId,
                  organizationId: ctx.orgId,
                  entryType: 'adjustment',
                  direction,
                  entityType: 'payment',
                  entityId: paymentId,
                  studentId: existing.studentId,
                  studentName: existing.studentName,
                  groupId: existing.groupId || '',
                  amountPiasters: validatedAdj.amountPiasters,
                  amount: validatedAdj.amount,
                  currency: 'EGP',
                  idempotencyKey: effectiveKey,
                  description: `تسوية محاسبية (${direction}): ${validatedAdj.cleanReason}`,
                  recordedBy: ctx.member.uid,
                  createdAt: SERVER_TIMESTAMP_SENTINEL,
                },
              },
              {
                type: 'set',
                path: `organizations/${ctx.orgId}/idempotencyKeys/${keyDocId}`,
                data: {
                  id: keyDocId,
                  organizationId: ctx.orgId,
                  entityType: 'ledger_entry',
                  entityId: entryId,
                  createdBy: ctx.member.uid,
                  createdAt: SERVER_TIMESTAMP_SENTINEL,
                },
              },
              buildAuditWrite(ctx.orgId, ctx.member, {
                action: 'payment.adjusted',
                entityType: 'ledger_entry',
                entityId: entryId,
                summary: `تسوية محاسبية (${direction}) بقيمة ${validatedAdj.amount} ج.م على القيد ${paymentId}.`,
                result: 'success',
                correlationId: ctx.correlationId,
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
                  },
                },
              }),
            ],
            ctx.idToken
          );
        } catch (commitErr) {
          if (rawKey.length > 0) {
            const racedKey = await deps.store.getDoc<{ entityId?: string }>(
              `organizations/${ctx.orgId}/idempotencyKeys/${keyDocId}`,
              ctx.idToken
            );
            if (racedKey?.entityId) {
              res.status(200).json({
                entryId: racedKey.entityId,
                deduplicated: true,
                correlationId: ctx.correlationId,
              });
              return;
            }
          }
          throw commitErr;
        }

        res.status(201).json({
          entryId,
          paymentId,
          direction,
          amountPiasters: validatedAdj.amountPiasters,
          adjustedCreditPiasters: validatedAdj.nextAdjustedCredit,
          adjustedDebitPiasters: validatedAdj.nextAdjustedDebit,
          correlationId: ctx.correlationId,
        });
      } catch (err) {
        sendErrorResponse(res, err, ctx.correlationId);
      }
    }
  );

  // POST /api/v1/organizations/:orgId/payments/:paymentId/void
  router.post(
    '/organizations/:orgId/payments/:paymentId/void',
    async (req: Request, res: Response) => {
      const ctx = await authorizeRequest(req, res, deps, 'payments:reverse');
      if (!ctx) return;

      try {
        const paymentId = req.params.paymentId;
        if (!paymentId || !isValidEntityId(paymentId)) {
          throw new DomainValidationError('معرّف الدفعة غير صالح.', 'INVALID_PAYMENT_ID');
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const cleanReason = sanitizeText(typeof body.reason === 'string' ? body.reason : '', 200);
        if (cleanReason.length < 3) {
          throw new DomainValidationError('سبب الإلغاء مطلوب (3 أحرف على الأقل).', 'VOID_REASON_REQUIRED');
        }

        const existing = await deps.store.getDoc<PaymentRecord>(
          `organizations/${ctx.orgId}/payments/${paymentId}`,
          ctx.idToken
        );
        if (!existing || existing.organizationId !== ctx.orgId) {
          throw new DomainValidationError('القيد المالي غير موجود.', 'PAYMENT_NOT_FOUND', 404);
        }
        if (existing.status === 'voided') {
          throw new DomainValidationError('هذا القيد المالي ملغى بالفعل.', 'ALREADY_VOIDED', 409);
        }

        const resolved = resolveValidatedPaymentPiasters(existing);
        const totalPiasters = resolved.amountPiasters;
        const paidPiasters = resolved.paidAmountPiasters;
        const duePiasters = resolved.dueAmountPiasters;
        const chargeReversalId = `${paymentId}_rev_charge`;

        const writes: RestWriteInstruction[] = [
          {
            type: 'update',
            path: `organizations/${ctx.orgId}/payments/${paymentId}`,
            data: {
              status: 'voided',
              voidReason: cleanReason,
              voidedBy: ctx.member.uid,
              voidedAt: SERVER_TIMESTAMP_SENTINEL,
              updatedAt: SERVER_TIMESTAMP_SENTINEL,
              ...(resolved.needsBackfill.amountPiasters ? { amountPiasters: totalPiasters } : {}),
              ...(resolved.needsBackfill.paidAmountPiasters ? { paidAmountPiasters: paidPiasters } : {}),
              ...(resolved.needsBackfill.dueAmountPiasters ? { dueAmountPiasters: duePiasters } : {}),
            },
          },
          {
            type: 'set',
            path: `organizations/${ctx.orgId}/ledgerEntries/${chargeReversalId}`,
            data: {
              id: chargeReversalId,
              organizationId: ctx.orgId,
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
              recordedBy: ctx.member.uid,
              createdAt: SERVER_TIMESTAMP_SENTINEL,
            },
          },
        ];

        if (paidPiasters > 0) {
          const payReversalId = `${paymentId}_rev_paid`;
          writes.push({
            type: 'set',
            path: `organizations/${ctx.orgId}/ledgerEntries/${payReversalId}`,
            data: {
              id: payReversalId,
              organizationId: ctx.orgId,
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
              recordedBy: ctx.member.uid,
              createdAt: SERVER_TIMESTAMP_SENTINEL,
            },
          });
        }

        writes.push(
          buildAuditWrite(ctx.orgId, ctx.member, {
            action: 'payment.voided',
            entityType: 'payment',
            entityId: paymentId,
            summary: `عكس وإلغاء القيد المالي (${paymentId}) — ${cleanReason}`,
            result: 'success',
            correlationId: ctx.correlationId,
            metadata: {
              before: { status: existing.status },
              after: { status: 'voided', voidReason: cleanReason },
            },
          })
        );

        await deps.store.commitWrites(writes, ctx.idToken);
        res.status(200).json({ paymentId, status: 'voided', correlationId: ctx.correlationId });
      } catch (err) {
        sendErrorResponse(res, err, ctx.correlationId);
      }
    }
  );

  // POST /api/v1/organizations/:orgId/expenses
  router.post('/organizations/:orgId/expenses', async (req: Request, res: Response) => {
    const ctx = await authorizeRequest(req, res, deps, 'expenses:create');
    if (!ctx) return;

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const validated = validateCreateExpenseInput(ctx.org, {
        title: String(body.title ?? ''),
        category: body.category as ExpenseCategory,
        amount: body.amount as number,
        expenseDate: String(body.expenseDate ?? ''),
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      });

      if (validated.idempotencyKey) {
        const keyDoc = await deps.store.getDoc<{ entityId?: string }>(
          `organizations/${ctx.orgId}/idempotencyKeys/exp_${validated.idempotencyKey}`,
          ctx.idToken
        );
        if (keyDoc?.entityId) {
          res.status(200).json({
            expenseId: keyDoc.entityId,
            deduplicated: true,
            correlationId: ctx.correlationId,
          });
          return;
        }
      }

      const expenseId = makeServerId('exp');
      const entryId = `${expenseId}_charge`;
      const writes: RestWriteInstruction[] = [
        {
          type: 'set',
          path: `organizations/${ctx.orgId}/expenses/${expenseId}`,
          data: {
            id: expenseId,
            organizationId: ctx.orgId,
            title: validated.title,
            category: validated.category,
            amount: validated.amount,
            amountPiasters: validated.amountPiasters,
            currency: 'EGP',
            status: 'posted',
            expenseDate: validated.expenseDate,
            notes: validated.notes,
            ...(validated.idempotencyKey ? { idempotencyKey: validated.idempotencyKey } : {}),
            recordedBy: ctx.member.uid,
            createdAt: SERVER_TIMESTAMP_SENTINEL,
            updatedAt: SERVER_TIMESTAMP_SENTINEL,
          },
        },
        {
          type: 'set',
          path: `organizations/${ctx.orgId}/ledgerEntries/${entryId}`,
          data: {
            id: entryId,
            organizationId: ctx.orgId,
            entryType: 'charge',
            direction: 'debit',
            entityType: 'expense',
            entityId: expenseId,
            amountPiasters: validated.amountPiasters,
            amount: validated.amount,
            currency: 'EGP',
            description: `مصروف تشغيلي: ${validated.title}`,
            recordedBy: ctx.member.uid,
            createdAt: SERVER_TIMESTAMP_SENTINEL,
          },
        },
      ];

      if (validated.idempotencyKey) {
        const keyDocId = `exp_${validated.idempotencyKey}`;
        writes.push({
          type: 'set',
          path: `organizations/${ctx.orgId}/idempotencyKeys/${keyDocId}`,
          data: {
            id: keyDocId,
            organizationId: ctx.orgId,
            entityType: 'expense',
            entityId: expenseId,
            createdBy: ctx.member.uid,
            createdAt: SERVER_TIMESTAMP_SENTINEL,
          },
        });
      }

      writes.push(
        buildAuditWrite(ctx.orgId, ctx.member, {
          action: 'expense.created',
          entityType: 'expense',
          entityId: expenseId,
          summary: `تسجيل مصروف "${validated.title}" بقيمة ${validated.amount} ج.م.`,
          result: 'success',
          correlationId: ctx.correlationId,
          metadata: { after: { amountPiasters: validated.amountPiasters } },
        })
      );

      try {
        await deps.store.commitWrites(writes, ctx.idToken);
      } catch (commitErr) {
        if (validated.idempotencyKey) {
          const racedKey = await deps.store.getDoc<{ entityId?: string }>(
            `organizations/${ctx.orgId}/idempotencyKeys/exp_${validated.idempotencyKey}`,
            ctx.idToken
          );
          if (racedKey?.entityId) {
            res.status(200).json({
              expenseId: racedKey.entityId,
              deduplicated: true,
              correlationId: ctx.correlationId,
            });
            return;
          }
        }
        throw commitErr;
      }
      res.status(201).json({ expenseId, correlationId: ctx.correlationId });
    } catch (err) {
      sendErrorResponse(res, err, ctx.correlationId);
    }
  });

  // POST /api/v1/organizations/:orgId/expenses/:expenseId/void
  router.post(
    '/organizations/:orgId/expenses/:expenseId/void',
    async (req: Request, res: Response) => {
      const ctx = await authorizeRequest(req, res, deps, 'expenses:reverse');
      if (!ctx) return;

      try {
        const expenseId = req.params.expenseId;
        if (!expenseId || !isValidEntityId(expenseId)) {
          throw new DomainValidationError('معرّف المصروف غير صالح.', 'INVALID_EXPENSE_ID');
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const cleanReason = sanitizeText(typeof body.reason === 'string' ? body.reason : '', 200);
        if (cleanReason.length < 3) {
          throw new DomainValidationError('سبب الإلغاء مطلوب (3 أحرف على الأقل).', 'VOID_REASON_REQUIRED');
        }

        const existing = await deps.store.getDoc<ExpenseRecord>(
          `organizations/${ctx.orgId}/expenses/${expenseId}`,
          ctx.idToken
        );
        if (!existing || existing.organizationId !== ctx.orgId) {
          throw new DomainValidationError('قيد المصروف غير موجود.', 'EXPENSE_NOT_FOUND', 404);
        }
        if (existing.status === 'voided') {
          throw new DomainValidationError('هذا المصروف ملغى بالفعل.', 'ALREADY_VOIDED', 409);
        }

        const resolved = resolveValidatedExpensePiasters(existing);
        const amountPiasters = resolved.amountPiasters;
        const reversalId = `${expenseId}_rev_charge`;

        const writes: RestWriteInstruction[] = [
          {
            type: 'update',
            path: `organizations/${ctx.orgId}/expenses/${expenseId}`,
            data: {
              status: 'voided',
              voidReason: cleanReason,
              voidedBy: ctx.member.uid,
              voidedAt: SERVER_TIMESTAMP_SENTINEL,
              updatedAt: SERVER_TIMESTAMP_SENTINEL,
              ...(resolved.needsBackfill ? { amountPiasters } : {}),
            },
          },
          {
            type: 'set',
            path: `organizations/${ctx.orgId}/ledgerEntries/${reversalId}`,
            data: {
              id: reversalId,
              organizationId: ctx.orgId,
              entryType: 'reversal',
              direction: 'credit',
              entityType: 'expense',
              entityId: expenseId,
              amountPiasters,
              amount: piastersToEgp(amountPiasters),
              currency: 'EGP',
              description: `عكس مصروف (${existing.title}): ${cleanReason}`,
              recordedBy: ctx.member.uid,
              createdAt: SERVER_TIMESTAMP_SENTINEL,
            },
          },
          buildAuditWrite(ctx.orgId, ctx.member, {
            action: 'expense.voided',
            entityType: 'expense',
            entityId: expenseId,
            summary: `عكس وإلغاء قيد المصروف (${expenseId}) — ${cleanReason}`,
            result: 'success',
            correlationId: ctx.correlationId,
            metadata: {
              before: { status: existing.status },
              after: { status: 'voided', voidReason: cleanReason },
            },
          }),
        ];

        await deps.store.commitWrites(writes, ctx.idToken);
        res.status(200).json({ expenseId, status: 'voided', correlationId: ctx.correlationId });
      } catch (err) {
        sendErrorResponse(res, err, ctx.correlationId);
      }
    }
  );

  // POST /api/v1/organizations/:orgId/enrollments
  router.post('/organizations/:orgId/enrollments', async (req: Request, res: Response) => {
    const ctx = await authorizeRequest(req, res, deps, 'groups:manage_enrollment');
    if (!ctx) return;

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const groupId = String(body.groupId ?? '');
      const studentId = String(body.studentId ?? '');
      if (!isValidEntityId(groupId) || !isValidEntityId(studentId)) {
        throw new DomainValidationError('معرّف المجموعة أو الطالب غير صالح.', 'INVALID_ID');
      }

      const enrollmentId = `${groupId}_${studentId}`;
      const [group, student, existingEnrollment] = await Promise.all([
        deps.store.getDoc<StudyGroup>(`organizations/${ctx.orgId}/groups/${groupId}`, ctx.idToken),
        deps.store.getDoc<Student>(`organizations/${ctx.orgId}/students/${studentId}`, ctx.idToken),
        deps.store.getDoc<GroupEnrollment>(
          `organizations/${ctx.orgId}/enrollments/${enrollmentId}`,
          ctx.idToken
        ),
      ]);

      if (!group) throw new DomainValidationError('المجموعة غير موجودة.', 'GROUP_NOT_FOUND', 404);
      if (!student) throw new DomainValidationError('الطالب غير موجود.', 'STUDENT_NOT_FOUND', 404);

      assertCanEnrollStudent(group, student, existingEnrollment, group.studentCount);

      const writes: RestWriteInstruction[] = [
        existingEnrollment
          ? {
              type: 'update',
              path: `organizations/${ctx.orgId}/enrollments/${enrollmentId}`,
              data: {
                studentName: student.fullName,
                groupName: group.name,
                status: 'active',
                enrolledBy: ctx.member.uid,
                enrolledAt: SERVER_TIMESTAMP_SENTINEL,
                updatedAt: SERVER_TIMESTAMP_SENTINEL,
              },
            }
          : {
              type: 'set',
              path: `organizations/${ctx.orgId}/enrollments/${enrollmentId}`,
              data: {
                id: enrollmentId,
                organizationId: ctx.orgId,
                groupId,
                studentId,
                studentName: student.fullName,
                groupName: group.name,
                status: 'active',
                enrolledBy: ctx.member.uid,
                enrolledAt: SERVER_TIMESTAMP_SENTINEL,
                createdAt: SERVER_TIMESTAMP_SENTINEL,
                updatedAt: SERVER_TIMESTAMP_SENTINEL,
              },
            },
        {
          type: 'update',
          path: `organizations/${ctx.orgId}/groups/${groupId}`,
          data: {
            studentCount: group.studentCount + 1,
            lastEnrollmentId: enrollmentId,
            updatedAt: SERVER_TIMESTAMP_SENTINEL,
          },
        },
        buildAuditWrite(ctx.orgId, ctx.member, {
          action: 'group.student_enrolled',
          entityType: 'enrollment',
          entityId: enrollmentId,
          summary: `تسجيل الطالب "${student.fullName}" في مجموعة "${group.name}".`,
          result: 'success',
          correlationId: ctx.correlationId,
          metadata: {
            before: { studentCount: group.studentCount },
            after: { studentCount: group.studentCount + 1 },
          },
        }),
      ];

      await deps.store.commitWrites(writes, ctx.idToken);
      res.status(201).json({
        enrollmentId,
        studentCount: group.studentCount + 1,
        correlationId: ctx.correlationId,
      });
    } catch (err) {
      sendErrorResponse(res, err, ctx.correlationId);
    }
  });

  // POST /api/v1/organizations/:orgId/reconcile
  router.post('/organizations/:orgId/reconcile', async (req: Request, res: Response) => {
    const ctx = await authorizeRequest(req, res, deps, 'financial_reports:reconcile');
    if (!ctx) return;

    try {
      const [students, groups, enrollments] = await Promise.all([
        deps.store.listCollection<Student>(`organizations/${ctx.orgId}/students`, ctx.idToken),
        deps.store.listCollection<StudyGroup>(`organizations/${ctx.orgId}/groups`, ctx.idToken),
        deps.store.listCollection<GroupEnrollment>(
          `organizations/${ctx.orgId}/enrollments`,
          ctx.idToken
        ),
      ]);

      const report = computeOrganizationCountReconciliation(ctx.org, students, groups, enrollments);
      if (report.hasDiscrepancies) {
        const writes: RestWriteInstruction[] = [
          {
            type: 'update',
            path: `organizations/${ctx.orgId}`,
            data: {
              totalStudentsCount: report.actualTotalStudents,
              activeStudentsCount: report.actualActiveStudents,
              inactiveStudentsCount: report.actualInactiveStudents,
              archivedStudentsCount: report.actualArchivedStudents,
              updatedAt: SERVER_TIMESTAMP_SENTINEL,
            },
          },
          ...report.groupDiscrepancies.map(
            (diff): RestWriteInstruction => ({
              type: 'update',
              path: `organizations/${ctx.orgId}/groups/${diff.groupId}`,
              data: {
                studentCount: diff.actualEnrolledCount,
                updatedAt: SERVER_TIMESTAMP_SENTINEL,
              },
            })
          ),
          buildAuditWrite(ctx.orgId, ctx.member, {
            action: 'organization.counts_reconciled',
            entityType: 'organization',
            entityId: ctx.orgId,
            summary: `مطابقة وتصحيح الأعداد (${report.actualTotalStudents} طالب).`,
            result: 'success',
            correlationId: ctx.correlationId,
            metadata: {
              after: {
                totalStudentsCount: report.actualTotalStudents,
                groupDiscrepanciesFixed: report.groupDiscrepancies.length,
              },
            },
          }),
        ];
        if (deps.store === firestoreRestDataStore && report.groupDiscrepancies.length > 0) {
          await adminCommitWrites(writes);
        } else {
          await deps.store.commitWrites(writes, ctx.idToken);
        }
      }

      res.status(200).json({ report, correlationId: ctx.correlationId });
    } catch (err) {
      sendErrorResponse(res, err, ctx.correlationId);
    }
  });

  return router;
}
