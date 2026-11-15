import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Phone, GraduationCap, UserCheck } from 'lucide-react';
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
import { listAttendanceByStudent } from '@/src/services/attendanceService';
import { listPaymentsByStudent } from '@/src/services/financeService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatCurrencyEGP, formatDateArabic } from '@/src/lib/utils/format';
import type { AttendanceRecord, PaymentRecord, Student, StudentStatus } from '@/src/types/domain';

export function StudentProfilePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const { organization, membership } = useTenant();
  const { showToast } = useToast();

  const [student, setStudent] = useState<Student | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
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
        const [attData, payData] = await Promise.all([
          listAttendanceByStudent(organization.id, studentId),
          canViewPayments ? listPaymentsByStudent(organization.id, studentId) : Promise.resolve([]),
        ]);
        setAttendance(attData);
        setPayments(payData);
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

  const handleStatusChange = async (nextStatus: StudentStatus) => {
    if (!organization || !membership || !student) return;
    setUpdatingStatus(true);
    try {
      await updateStudentStatus(organization.id, student.id, nextStatus, {
        uid: membership.uid,
        displayName: membership.displayName,
        role: membership.role,
      });
      setStudent({ ...student, status: nextStatus });
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
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
                  سجل المدفوعات
                </h3>
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
                            {formatDateArabic(p.createdAt)} · {p.method}
                          </p>
                        </div>
                        <div className="text-left tabular-nums">
                          <p className="font-semibold">{formatCurrencyEGP(p.paidAmount)}</p>
                          {p.dueAmount > 0 && (
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
