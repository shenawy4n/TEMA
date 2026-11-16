import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
import { DomainValidationError } from '@/src/lib/domain/money';
import {
  computeOrganizationCountReconciliation,
  type OrganizationReconciliationReport,
} from '@/src/lib/domain/scheduling';
import { getOrganization } from './organizationService';
import { listStudents } from './studentService';
import { listGroups, listOrganizationEnrollments } from './groupService';
import { enqueueAuditLog } from './auditService';
import {
  resolveActiveOrganizationInTx,
  resolveAuthorizedMemberInTx,
} from './tenantAuthority';
import type { Organization } from '@/src/types/domain';

export async function inspectOrganizationCountIntegrity(
  organizationId: string
): Promise<OrganizationReconciliationReport> {
  const [org, students, groups, enrollments] = await Promise.all([
    getOrganization(organizationId),
    listStudents(organizationId),
    listGroups(organizationId),
    listOrganizationEnrollments(organizationId),
  ]);

  if (!org) {
    throw new Error('المنظمة غير موجودة.');
  }

  return computeOrganizationCountReconciliation(org, students, groups, enrollments);
}

/**
 * Reconciles organization student counters inside a client transaction, and delegates
 * group studentCount drift repair to the trusted server reconciliation endpoint because
 * direct client-side mutation of groups.studentCount without an enrollment proof is blocked.
 */
export async function reconcileOrganizationCounts(
  organizationId: string
): Promise<OrganizationReconciliationReport> {
  const path = `organizations/${organizationId}`;
  try {
    const [students, groups, enrollments] = await Promise.all([
      listStudents(organizationId),
      listGroups(organizationId),
      listOrganizationEnrollments(organizationId),
    ]);

    const initialReport = await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(
        tx,
        organizationId,
        'financial_reports:reconcile'
      );
      const org = await resolveActiveOrganizationInTx(tx, organizationId);

      // Re-read org inside transaction for serializability
      const freshOrgSnap = await tx.get(doc(db, 'organizations', organizationId));
      const freshOrg = freshOrgSnap.exists() ? (freshOrgSnap.data() as Organization) : org;

      const report = computeOrganizationCountReconciliation(
        freshOrg,
        students,
        groups,
        enrollments
      );

      const orgCountsMismatch =
        report.storedTotalStudents !== report.actualTotalStudents ||
        report.storedActiveStudents !== report.actualActiveStudents ||
        report.storedInactiveStudents !== report.actualInactiveStudents ||
        report.storedArchivedStudents !== report.actualArchivedStudents;

      if (orgCountsMismatch) {
        tx.update(doc(db, 'organizations', organizationId), {
          totalStudentsCount: report.actualTotalStudents,
          activeStudentsCount: report.actualActiveStudents,
          inactiveStudentsCount: report.actualInactiveStudents,
          archivedStudentsCount: report.actualArchivedStudents,
          updatedAt: serverTimestamp(),
        });

        enqueueAuditLog(tx, organizationId, verifiedMember, {
          action: 'organization.counts_reconciled',
          entityType: 'organization',
          entityId: organizationId,
          summary: `تمت مطابقة وتصحيح أعداد طلاب المنظمة (${report.actualTotalStudents} إجمالي).`,
          result: 'success',
          metadata: {
            before: {
              totalStudentsCount: report.storedTotalStudents,
              activeStudentsCount: report.storedActiveStudents,
            },
            after: {
              totalStudentsCount: report.actualTotalStudents,
              activeStudentsCount: report.actualActiveStudents,
              totalActiveGroupEnrollments: report.totalActiveGroupEnrollments,
            },
          },
        });
      }

      return report;
    });

    if (initialReport.groupDiscrepancies.length > 0) {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new DomainValidationError(
          'تعذر إتمام مطابقة عدادات المجموعات: الجلسة غير مصرح بها.',
          'UNAUTHENTICATED',
          401
        );
      }

      const res = await fetch(`/api/v1/organizations/${encodeURIComponent(organizationId)}/reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (!res.ok) {
        throw new DomainValidationError(
          'إصلاح فروقات عداد المجموعات يتطلب مسار الخادم الموثوق ولا يُسمح بتعديله مباشرة من العميل.',
          'SERVER_RECONCILE_REQUIRED',
          res.status
        );
      }
      const data = (await res.json()) as { report?: OrganizationReconciliationReport };
      if (data.report) {
        return data.report;
      }
    }

    return initialReport;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
