import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, CheckCircle2, PauseCircle, Archive } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Button } from '@/src/components/ui/Button';
import { SearchInput } from '@/src/components/ui/SearchInput';
import { Select } from '@/src/components/ui/Select';
import { Input } from '@/src/components/ui/Input';
import { DataTable, type DataTableColumn } from '@/src/components/ui/DataTable';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { Modal } from '@/src/components/ui/Modal';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import { createStudent, listStudents } from '@/src/services/studentService';
import { GRADE_LEVELS } from '@/src/lib/constants/egypt';
import { EGYPT_PHONE_PATTERN } from '@/src/lib/firebase/validation';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatDateArabic } from '@/src/lib/utils/format';
import type { Student, StudentStatus } from '@/src/types/domain';

const STATUS_LABELS: Record<StudentStatus, string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  archived: 'مؤرشف',
};

export function StudentsPage() {
  const { organization, membership } = useTenant();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [gradeLevel, setGradeLevel] = useState(GRADE_LEVELS[8]);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canCreate = membership ? ['owner', 'teacher', 'assistant'].includes(membership.role) : false;

  const loadStudents = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listStudents(organization.id);
      setStudents(data);
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (gradeFilter !== 'all' && s.gradeLevel !== gradeFilter) return false;
      if (q) {
        const matches =
          s.fullName.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q) ||
          (s.guardianPhone || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [students, search, statusFilter, gradeFilter]);

  const handleAddStudent = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !membership || submitting) return;
    setFormError(null);

    if (fullName.trim().length < 2) {
      setFormError('يرجى إدخال اسم الطالب بالكامل.');
      return;
    }
    if (!EGYPT_PHONE_PATTERN.test(phone.trim())) {
      setFormError('يرجى إدخال رقم هاتف طالب صحيح.');
      return;
    }

    setSubmitting(true);
    try {
      await createStudent(
        organization.id,
        {
          fullName,
          phone,
          guardianName,
          guardianPhone,
          gradeLevel,
          notes,
        },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      showToast({ type: 'success', title: 'تم إضافة الطالب بنجاح' });
      setModalOpen(false);
      setFullName('');
      setPhone('');
      setGuardianName('');
      setGuardianPhone('');
      setNotes('');
      await loadStudents();
    } catch (err) {
      setFormError(getArabicErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: DataTableColumn<Student>[] = [
    {
      key: 'fullName',
      header: 'اسم الطالب',
      render: (row) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{row.fullName}</p>
          {row.guardianName && (
            <p className="text-xs text-slate-500 dark:text-slate-400">ولي الأمر: {row.guardianName}</p>
          )}
        </div>
      ),
    },
    {
      key: 'gradeLevel',
      header: 'الصف الدراسي',
      render: (row) => row.gradeLevel,
    },
    {
      key: 'phone',
      header: 'رقم الهاتف',
      numeric: true,
      render: (row) => (
        <span dir="ltr" className="font-mono-tabular text-xs">
          {row.phone}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => {
        const Icon =
          row.status === 'active'
            ? CheckCircle2
            : row.status === 'inactive'
            ? PauseCircle
            : Archive;
        const tone =
          row.status === 'active'
            ? 'text-emerald-700 dark:text-emerald-400'
            : row.status === 'inactive'
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-slate-500 dark:text-slate-400';

        return (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{STATUS_LABELS[row.status]}</span>
          </span>
        );
      },
    },
    {
      key: 'createdAt',
      header: 'تاريخ التسجيل',
      render: (row) => (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {formatDateArabic(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <AppShell
      pageTitle="الطلاب"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'الطلاب' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="إدارة الطلاب"
          description="عرض والبحث عن الطلاب المسجلين في المنظمة والوصول إلى ملف كل طالب."
          actions={
            canCreate ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>
                إضافة طالب
              </Button>
            ) : null
          }
        />

        {/* Filters Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="بحث باسم الطالب أو رقم الهاتف..."
          />
          <Select
            aria-label="تصفية حسب المرحلة"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
          >
            <option value="all">كل الصفوف الدراسية</option>
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select
            aria-label="تصفية حسب الحالة"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | StudentStatus)}
          >
            <option value="all">جميع الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
            <option value="archived">مؤرشف</option>
          </Select>
        </div>

        {loading ? (
          <LoadingState variant="table" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadStudents} />
        ) : filteredStudents.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={students.length === 0 ? 'لا يوجد طلاب مسجلون بعد' : 'لا توجد نتائج مطابقة'}
            description={
              students.length === 0
                ? 'ابدأ بإضافة أول طالب في منظمتك لمتابعة الحضور والمدفوعات والمجموعات.'
                : 'جرّب تعديل كلمات البحث أو الفلاتر الحالية.'
            }
            action={
              students.length === 0 && canCreate ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>
                  إضافة أول طالب
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            columns={columns}
            data={filteredStudents}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/students/${row.id}`)}
          />
        )}
      </div>

      {/* Add Student Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="إضافة طالب جديد"
        description="سيتم ربط الطالب تلقائياً بالمنظمة الحالية مع تسجيل عملية التدقيق."
      >
        <form onSubmit={handleAddStudent} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
              {formError}
            </div>
          )}

          <Input
            label="الاسم الكامل للطالب"
            placeholder="مثال: يوسف أحمد حسن"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="رقم هاتف الطالب"
              dir="ltr"
              placeholder="01012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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
              label="اسم ولي الأمر (اختياري)"
              placeholder="الاسم"
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
            />
            <Input
              label="هاتف ولي الأمر (اختياري)"
              dir="ltr"
              placeholder="010..."
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
            />
          </div>

          <Input
            label="ملاحظات إضافية (اختياري)"
            placeholder="أي ملاحظات أكاديمية أو إدارية"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="pt-3 flex items-center justify-end gap-2.5">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={submitting}>
              إلغاء
            </Button>
            <Button type="submit" isLoading={submitting}>
              حفظ الطالب
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
