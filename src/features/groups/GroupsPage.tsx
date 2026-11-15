import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Layers, Plus, UserPlus, UserMinus } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Button } from '@/src/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/src/components/ui/DataTable';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { Modal } from '@/src/components/ui/Modal';
import { Input } from '@/src/components/ui/Input';
import { Select } from '@/src/components/ui/Select';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import {
  createGroup,
  enrollStudentInGroup,
  listEnrollmentsByGroup,
  listGroups,
  removeStudentFromGroup,
  updateGroupStatus,
} from '@/src/services/groupService';
import { listStudents } from '@/src/services/studentService';
import { GRADE_LEVELS } from '@/src/lib/constants/egypt';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatCurrencyEGP, formatNumber } from '@/src/lib/utils/format';
import type { GroupEnrollment, GroupStatus, Student, StudyGroup } from '@/src/types/domain';

const GROUP_STATUS_LABELS: Record<GroupStatus, string> = {
  active: 'نشطة',
  paused: 'متوقفة مؤقتاً',
  archived: 'مؤرشفة',
};

export function GroupsPage() {
  const { organization, membership } = useTenant();
  const { showToast } = useToast();

  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState(GRADE_LEVELS[8]);
  const [capacity, setCapacity] = useState('30');
  const [monthlyFee, setMonthlyFee] = useState('350');
  const [scheduleSummary, setScheduleSummary] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Enrollment management modal
  const [manageGroup, setManageGroup] = useState<StudyGroup | null>(null);
  const [groupEnrollments, setGroupEnrollments] = useState<GroupEnrollment[]>([]);
  const [loadingEnrollments, setLoadingEnrollments] = useState(false);
  const [enrollStudentId, setEnrollStudentId] = useState('');
  const [enrollmentBusy, setEnrollmentBusy] = useState(false);

  const canCreate = membership ? ['owner', 'teacher', 'assistant'].includes(membership.role) : false;

  const loadGroups = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);
    try {
      const [data, stuData] = await Promise.all([
        listGroups(organization.id),
        listStudents(organization.id),
      ]);
      setGroups(data);
      setStudents(stuData.filter((s) => s.status === 'active'));
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const loadGroupEnrollments = useCallback(
    async (group: StudyGroup) => {
      if (!organization) return;
      setLoadingEnrollments(true);
      try {
        const list = await listEnrollmentsByGroup(organization.id, group.id);
        setGroupEnrollments(list);
      } catch (err) {
        showToast({ type: 'error', title: 'تعذر تحميل تسجيلات المجموعة', message: getArabicErrorMessage(err) });
      } finally {
        setLoadingEnrollments(false);
      }
    },
    [organization, showToast]
  );

  const openManageEnrollments = (group: StudyGroup) => {
    setManageGroup(group);
    setEnrollStudentId('');
    void loadGroupEnrollments(group);
  };

  const availableStudentsToEnroll = useMemo(() => {
    const enrolledIds = new Set(groupEnrollments.map((e) => e.studentId));
    return students.filter((s) => !enrolledIds.has(s.id));
  }, [students, groupEnrollments]);

  const handleEnrollStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !manageGroup || !enrollStudentId || enrollmentBusy) return;
    setEnrollmentBusy(true);
    try {
      await enrollStudentInGroup(organization.id, manageGroup.id, enrollStudentId);
      showToast({ type: 'success', title: 'تم تسجيل الطالب في المجموعة بنجاح' });
      setEnrollStudentId('');
      await Promise.all([loadGroupEnrollments(manageGroup), loadGroups()]);
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تسجيل الطالب', message: getArabicErrorMessage(err) });
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const handleRemoveEnrollment = async (studentId: string) => {
    if (!organization || !manageGroup || enrollmentBusy) return;
    setEnrollmentBusy(true);
    try {
      await removeStudentFromGroup(organization.id, manageGroup.id, studentId);
      showToast({ type: 'success', title: 'تمت إزالة الطالب من المجموعة' });
      await Promise.all([loadGroupEnrollments(manageGroup), loadGroups()]);
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر إزالة الطالب', message: getArabicErrorMessage(err) });
    } finally {
      setEnrollmentBusy(false);
    }
  };

  const handleStatusChange = async (group: StudyGroup, nextStatus: GroupStatus) => {
    if (!organization || !membership || !canCreate) return;
    try {
      await updateGroupStatus(organization.id, group.id, nextStatus, {
        uid: membership.uid,
        displayName: membership.displayName,
        role: membership.role,
      });
      showToast({ type: 'success', title: `تم تحديث حالة المجموعة (${GROUP_STATUS_LABELS[nextStatus]})` });
      await loadGroups();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تحديث حالة المجموعة', message: getArabicErrorMessage(err) });
    }
  };

  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !membership || submitting) return;
    setFormError(null);

    if (name.trim().length < 2 || subject.trim().length < 1) {
      setFormError('يرجى إدخال اسم المجموعة والمادة الدراسية.');
      return;
    }

    const parsedCapacity = Number(capacity);
    const parsedMonthlyFee = Number(monthlyFee);

    setSubmitting(true);
    try {
      await createGroup(
        organization.id,
        {
          name,
          subject,
          gradeLevel,
          teacherId: membership.uid,
          teacherName: membership.displayName,
          capacity: parsedCapacity,
          monthlyFee: parsedMonthlyFee,
          scheduleSummary,
        },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      showToast({ type: 'success', title: 'تم إنشاء المجموعة بنجاح' });
      setModalOpen(false);
      setName('');
      setSubject('');
      setScheduleSummary('');
      await loadGroups();
    } catch (err) {
      setFormError(getArabicErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataTableColumn<StudyGroup>[] = [
    {
      key: 'name',
      header: 'اسم المجموعة',
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{row.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {row.subject} · {row.gradeLevel}
          </p>
        </div>
      ),
    },
    {
      key: 'teacher',
      header: 'المدرس المسؤول',
      render: (row) => row.teacherName,
    },
    {
      key: 'capacity',
      header: 'العدد / السعة',
      numeric: true,
      render: (row) => (
        <span className="font-mono-tabular">
          {formatNumber(row.studentCount)} / {formatNumber(row.capacity)}
        </span>
      ),
    },
    {
      key: 'fee',
      header: 'الاشتراك الشهري',
      numeric: true,
      render: (row) => formatCurrencyEGP(row.monthlyFee),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => (
        canCreate ? (
          <Select
            aria-label={`حالة ${row.name}`}
            value={row.status}
            onChange={(e) => void handleStatusChange(row, e.target.value as GroupStatus)}
            className="text-xs py-1 px-2"
          >
            <option value="active">نشطة</option>
            <option value="paused">متوقفة مؤقتاً</option>
            <option value="archived">مؤرشفة</option>
          </Select>
        ) : (
          <span
            className={
              row.status === 'active'
                ? 'text-emerald-700 dark:text-emerald-400 text-xs font-medium'
                : 'text-amber-700 dark:text-amber-400 text-xs font-medium'
            }
          >
            {GROUP_STATUS_LABELS[row.status]}
          </span>
        )
      ),
    },
    {
      key: 'actions',
      header: 'الطلاب المسجلون',
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          icon={<UserPlus className="h-3.5 w-3.5" />}
          onClick={() => openManageEnrollments(row)}
        >
          إدارة ({formatNumber(row.studentCount)})
        </Button>
      ),
    },
  ];

  return (
    <AppShell
      pageTitle="المجموعات"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'المجموعات' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="المجموعات الدراسية"
          description="إدارة المجموعات والمدرسين المسؤولين والسعة الاستيعابية والاشتراكات الشهرية."
          actions={
            canCreate ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>
                إنشاء مجموعة
              </Button>
            ) : null
          }
        />

        {loading ? (
          <LoadingState variant="table" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadGroups} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-6 w-6" />}
            title="لا توجد مجموعات دراسية بعد"
            description="أنشئ مجموعاتك الدراسية لتنظيم الجدول الأسبوعي وتحديد السعة والاشتراك الشهري."
            action={
              canCreate ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>
                  إنشاء أول مجموعة
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable columns={columns} data={groups} rowKey={(row) => row.id} />
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="إنشاء مجموعة دراسية جديدة"
      >
        <form onSubmit={handleCreateGroup} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
              {formError}
            </div>
          )}

          <Input
            label="اسم المجموعة"
            placeholder="مثال: مجموعة أ — 3 ثانوي"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="المادة الدراسية"
              placeholder="مثال: الفيزياء"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
            <Select
              label="الصف الدراسي"
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="السعة القصوى (طالب)"
              type="number"
              min={1}
              max={500}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              required
            />
            <Input
              label="الاشتراك الشهري (ج.م)"
              type="number"
              min={0}
              value={monthlyFee}
              onChange={(e) => setMonthlyFee(e.target.value)}
              required
            />
          </div>

          <Input
            label="ملخص المواعيد (اختياري)"
            placeholder="مثال: السبت والثلاثاء 4:00 عصراً"
            value={scheduleSummary}
            onChange={(e) => setScheduleSummary(e.target.value)}
          />

          <div className="pt-3 flex items-center justify-end gap-2.5">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={submitting}>
              إلغاء
            </Button>
            <Button type="submit" isLoading={submitting}>
              حفظ المجموعة
            </Button>
          </div>
        </form>
      </Modal>

      {/* Group Enrollments Modal */}
      <Modal
        isOpen={Boolean(manageGroup)}
        onClose={() => setManageGroup(null)}
        title={`تسجيلات المجموعة — ${manageGroup?.name || ''}`}
      >
        {manageGroup && (
          <div className="space-y-4">
            {canCreate && manageGroup.status === 'active' && (
              <form onSubmit={handleEnrollStudent} className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    label="تسجيل طالب نشط"
                    value={enrollStudentId}
                    onChange={(e) => setEnrollStudentId(e.target.value)}
                  >
                    <option value="">اختر طالباً...</option>
                    {availableStudentsToEnroll.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} ({s.gradeLevel})
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  icon={<UserPlus className="h-4 w-4" />}
                  isLoading={enrollmentBusy}
                  disabled={!enrollStudentId}
                >
                  تسجيل
                </Button>
              </form>
            )}

            {loadingEnrollments ? (
              <LoadingState variant="table" />
            ) : groupEnrollments.length === 0 ? (
              <EmptyState
                title="لا يوجد طلاب مسجلون في هذه المجموعة"
                description="قم بتسجيل الطلاب النشطين في المجموعة للتمكن من تحضيرهم في الحصص."
              />
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-72 overflow-y-auto">
                {groupEnrollments.map((enr) => (
                  <div key={enr.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-900 dark:text-white">{enr.studentName}</span>
                    {canCreate && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<UserMinus className="h-3.5 w-3.5" />}
                        disabled={enrollmentBusy}
                        onClick={() => void handleRemoveEnrollment(enr.studentId)}
                      >
                        إزالة
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
