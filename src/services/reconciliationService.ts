import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '@/src/lib/firebase/config';
import { handleFirestoreError, OperationType } from '@/src/lib/firebase/errors';
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
 * Reconciles organization student counters and every group's studentCount against
 * authoritative Student and GroupEnrollment records inside an atomic transaction.
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

    return await runTransaction(db, async (tx) => {
      const verifiedMember = await resolveAuthorizedMemberInTx(
        tx,
        organizationId,
        'financial_reports:reconcile'
      );
      const org = await resolveActiveOrganizationInTx(tx, organizationId);

      // Re-read org and groups inside transaction for serializability
      const freshOrgSnap = await tx.get(doc(db, 'organizations', organizationId));
      const freshOrg = freshOrgSnap.exists() ? (freshOrgSnap.data() as Organization) : org;

      const report = computeOrganizationCountReconciliation(
        freshOrg,
        students,
        groups,
        enrollments
      );

      if (report.hasDiscrepancies) {
        tx.update(doc(db, 'organizations', organizationId), {
          totalStudentsCount: report.actualTotalStudents,
          activeStudentsCount: report.actualActiveStudents,
          inactiveStudentsCount: report.actualInactiveStudents,
          archivedStudentsCount: report.actualArchivedStudents,
          updatedAt: serverTimestamp(),
        });

        for (const diff of report.groupDiscrepancies) {
          tx.update(doc(db, 'organizations', organizationId, 'groups', diff.groupId), {
            studentCount: diff.actualEnrolledCount,
            updatedAt: serverTimestamp(),
          });
        }

        enqueueAuditLog(tx, organizationId, verifiedMember, {
          action: 'organization.counts_reconciled',
          entityType: 'organization',
          entityId: organizationId,
          summary: `تمت مطابقة وتصحيح أعداد الطلاب (${report.actualTotalStudents} إجمالي، ${report.groupDiscrepancies.length} مجموعة مصححة).`,
          result: 'success',
          metadata: {
            before: {
              totalStudentsCount: report.storedTotalStudents,
              activeStudentsCount: report.storedActiveStudents,
              groupDiscrepancies: report.groupDiscrepancies.length,
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
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
