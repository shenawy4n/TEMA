import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Phone, GraduationCap, UserCheck, Layers, UserMinus, UserPlus } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Card } from '@/src/components/ui/Card';
import { Button } from '@/src/components/ui/Button';
import { Select } from '@/src/components/ui/Select';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import { getStudentById, updateStudentStatus } from '@/src/services/studentService';
import {
  enrollStudentInGroup,
  listEnrollmentsByStudent,
  listGroups,
  removeStudentFromGroup,
} from '@/src/services/groupService';
import { listAttendanceByStudent } from '@/src/services/attendanceService';
import { listLedgerEntriesByStudent, listPaymentsByStudent } from '@/src/services/financeService';
import { deriveStudentLedgerBalance } from '@/src/lib/domain/ledger';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatCurrencyEGP, formatDateArabic } from '@/src/lib/utils/format';
import type {
  AttendanceRecord,
  GroupEnrollment,
  LedgerEntry,
  PaymentRecord,
  Student,
  StudentStatus,
  StudyGroup,
} from '@/src/types/domain';

export function StudentProfilePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const { organization, membership } = useTenant();
  const { showToast } = useToast();

  const [student, setStudent] = useState<Student | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [enrollments, setEnrollments] = useState<GroupEnrollment[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const canEdit = membership ? ['owner', 'teacher', 'assistant'].includes(membership.role) : false;
  const canViewPayments = membership ? ['owner', 'accountant', 'assistant'].includes(membership.role) : false;

  const loadProfile = useCallback(async () => {
    if (!organization || !studentId) return;
    setLoading(true);
    setError(null);
    try {
      const stu = await getStudentById(organization.id, studentId);
      setStudent(stu);
      if (stu) {
        const [attData, payData, ledgerData, enrData, grpData] = await Promise.all([
          listAttendanceByStudent(organization.id, studentId),
          canViewPayments ? listPaymentsByStudent(organization.id, studentId) : Promise.resolve([]),
          canViewPayments ? listLedgerEntriesByStudent(organization.id, studentId) : Promise.resolve([]),
          listEnrollmentsByStudent(organization.id, studentId),
          listGroups(organization.id),
        ]);
        setAttendance(attData);
        setPayments(payData);
        setLedgerEntries(ledgerData);
        setEnrollments(enrData);
        setGroups(grpData.filter((g) => g.status === 'active'));
      }
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization, studentId, canViewPayments]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const studentBalance = useMemo(() => {
    if (!student) return null;
    return deriveStudentLedgerBalance(student.id, ledgerEntries, payments);
  }, [student, ledgerEntries, payments]);

  const availableGroups = useMemo(() => {
    const activeIds = new Set(enrollments.map((e) => e.groupId));
    return groups.filter((g) => !activeIds.has(g.id));
  }, [groups, enrollments]);

  const handleEnrollInGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !student || !selectedGroupId || enrollmentBusy) return;
    setEnrollmentBusy(true);
    try {
      await enrollStudentInGroup(organization.id, selectedGroupId, student.id);
      showToast({ type: 'success', title: 'تم تسجيل الطالب في المجموعة' });
      setSelectedGroupId('');
      await loadProfile();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تسجيل الطالب', message: getArabicErrorMessage(err) });
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const handleRemoveFromGroup = async (groupId: string) => {
    if (!organization || !student || enrollmentBusy) return;
    setEnrollmentBusy(true);
    try {
      await removeStudentFromGroup(organization.id, groupId, student.id);
      showToast({ type: 'success', title: 'تمت إزالة الطالب من المجموعة' });
      await loadProfile();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر إزالة الطالب', message: getArabicErrorMessage(err) });
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const handleStatusChange = async (nextStatus: StudentStatus) => {
    if (!organization || !membership || !student) return;
    setUpdatingStatus(true);
    try {
      await updateStudentStatus(organization.id, student.id, nextStatus, {
        uid: membership.uid,
        displayName: membership.displayName,
        role: membership.role,
      });
      await loadProfile();
      showToast({ type: 'success', title: 'تم تحديث حالة الطالب' });
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر التحديث', message: getArabicErrorMessage(err) });
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <AppShell
      pageTitle={student?.fullName || 'ملف الطالب'}
      breadcrumbs={[
        { label: 'الرئيسية', to: '/dashboard' },
        { label: 'الطلاب', to: '/students' },
        { label: student?.fullName || 'ملف الطالب' },
      ]}
    >
      <div className="space-y-6">
        <PageHeader
          title={student ? student.fullName : 'ملف الطالب'}
          description={student ? `الصف: ${student.gradeLevel} · تاريخ الانضمام: ${formatDateArabic(student.createdAt)}` : undefined}
          actions={
            <Link to="/students">
              <Button variant="outline" size="sm" icon={<ArrowRight className="h-4 w-4" />}>
                العودة للطلاب
              </Button>
            </Link>
          }
        />

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={loadProfile} />
        ) : !student ? (
          <EmptyState
            title="لم يتم العثور على الطالب"
            description="قد يكون سجل الطالب غير موجود أو تم نقله."
            action={
              <Link to="/students">
                <Button variant="outline">عرض كل الطلاب</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="space-y-5">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                البيانات الأساسية
              </h3>

              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                    <Phone className="h-4 w-4" />
                    <span>هاتف الطالب</span>
                  </dt>
                  <dd dir="ltr" className="font-mono-tabular font-medium">
                    {student.phone}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4" />
                    <span>الصف الدراسي</span>
                  </dt>
                  <dd className="font-medium">{student.gradeLevel}</dd>
                </div>
                {student.guardianName && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                      <UserCheck className="h-4 w-4" />
                      <span>ولي الأمر</span>
                    </dt>
                    <dd className="font-medium">{student.guardianName}</dd>
                  </div>
                )}
                {student.guardianPhone && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">هاتف ولي الأمر</dt>
                    <dd dir="ltr" className="font-mono-tabular font-medium">
                      {student.guardianPhone}
                    </dd>
                  </div>
                )}
              </dl>

              {canEdit && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                  <Select
                    label="حالة الطالب"
                    value={student.status}
                    disabled={updatingStatus}
                    onChange={(e) => handleStatusChange(e.target.value as StudentStatus)}
                  >
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                    <option value="archived">مؤرشف</option>
                  </Select>
                </div>
              )}
            </Card>

            <div className="lg:col-span-2 space-y-6">
              <Card>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
                    <Layers className="h-4 w-4 text-slate-500" />
                    <span>المجموعات المسجل بها</span>
                  </h3>
                </div>
                {canEdit && student.status === 'active' && availableGroups.length > 0 && (
                  <form onSubmit={handleEnrollInGroup} className="flex items-end gap-2 mb-4">
                    <div className="flex-1">
                      <Select
                        label="إضافة لمجموعة دراسية"
                        value={selectedGroupId}
                        onChange={(e) => setSelectedGroupId(e.target.value)}
                      >
                        <option value="">اختر مجموعة...</option>
                        {availableGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.studentCount}/{g.capacity})
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      icon={<UserPlus className="h-4 w-4" />}
                      isLoading={enrollmentBusy}
                      disabled={!selectedGroupId}
                    >
                      تسجيل
                    </Button>
                  </form>
                )}
                {enrollments.length === 0 ? (
                  <EmptyState
                    title="غير مسجل في أي مجموعة"
                    description="سجل الطالب في إحدى المجموعات النشطة ليظهر في قوائم الحضور."
                  />
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {enrollments.map((enr) => (
                      <div key={enr.id} className="py-2.5 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-900 dark:text-white">{enr.groupName}</span>
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<UserMinus className="h-3.5 w-3.5" />}
                            disabled={enrollmentBusy}
                            onClick={() => void handleRemoveFromGroup(enr.groupId)}
                          >
                            إزالة
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    سجل المدفوعات
                  </h3>
                  {canViewPayments && studentBalance && (
                    <div className="flex items-center gap-3 text-xs tabular-nums">
                      <span className="text-emerald-700 dark:text-emerald-400">
                        محصّل: {formatCurrencyEGP(studentBalance.totalCollectedEgp)}
                      </span>
                      <span className="text-amber-600 dark:text-amber-400">
                        متبقي: {formatCurrencyEGP(studentBalance.outstandingDueEgp)}
                      </span>
                    </div>
                  )}
                </div>
                {!canViewPayments ? (
                  <EmptyState
                    title="السجل المالي مقيد"
                    description="دورك الحالي لا يسمح بالاطلاع على المعاملات المالية."
                  />
                ) : payments.length === 0 ? (
                  <EmptyState
                    title="لا توجد مدفوعات مسجلة"
                    description="لم يتم تسجيل أي دفعات مالية لهذا الطالب حتى الآن."
                  />
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {payments.map((p) => (
                      <div key={p.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                        <div>
                          <p className="font-medium">{p.category}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {formatDateArabic(p.createdAt)} · {p.method} {p.status === 'voided' ? '· ملغى' : ''}
                          </p>
                        </div>
                        <div className="text-left tabular-nums">
                          <p className="font-semibold">{formatCurrencyEGP(p.paidAmount)}</p>
                          {p.dueAmount > 0 && p.status !== 'voided' && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              متبقي: {formatCurrencyEGP(p.dueAmount)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
                  سجل الحضور والغياب
                </h3>
                {attendance.length === 0 ? (
                  <EmptyState
                    title="لا توجد سجلات حضور"
                    description="لم يتم تسجيل حضور لهذا الطالب في أي حصة بعد."
                  />
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {attendance.map((att) => (
                      <div key={att.id} className="py-3 flex items-center justify-between text-sm">
                        <span>حصة: {att.sessionId}</span>
                        <span className="font-medium">
                          {att.status === 'present'
                            ? 'حاضر'
                            : att.status === 'late'
                            ? 'متأخر'
                            : att.status === 'excused'
                            ? 'بعذر'
                            : 'غائب'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
