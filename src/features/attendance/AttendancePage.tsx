import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Card } from '@/src/components/ui/Card';
import { Select } from '@/src/components/ui/Select';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import { listSessions } from '@/src/services/sessionService';
import { listStudents } from '@/src/services/studentService';
import { listAttendanceBySession, upsertAttendanceRecord } from '@/src/services/attendanceService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { cn } from '@/src/lib/utils/cn';
import type { AttendanceRecord, AttendanceStatus, ClassSession, Student } from '@/src/types/domain';

const STATUS_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'present', label: 'حاضر' },
  { value: 'late', label: 'متأخر' },
  { value: 'absent', label: 'غائب' },
  { value: 'excused', label: 'بعذر' },
];

export function AttendancePage() {
  const { organization, membership } = useTenant();
  const { showToast } = useToast();

  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canMark = membership ? ['owner', 'teacher', 'assistant'].includes(membership.role) : false;

  const loadInitial = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);
    try {
      const [sesData, stuData] = await Promise.all([
        listSessions(organization.id),
        listStudents(organization.id),
      ]);
      setSessions(sesData);
      setStudents(stuData.filter((s) => s.status === 'active'));
      if (sesData.length > 0 && !selectedSessionId) {
        setSelectedSessionId(sesData[0].id);
      }
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization, selectedSessionId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!organization || !selectedSessionId) return;
    let active = true;
    listAttendanceBySession(organization.id, selectedSessionId)
      .then((data) => {
        if (active) setRecords(data);
      })
      .catch((err) => {
        if (active) showToast({ type: 'error', title: 'تعذر تحميل الحضور', message: getArabicErrorMessage(err) });
      });
    return () => {
      active = false;
    };
  }, [organization, selectedSessionId, showToast]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const recordByStudent = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records) map.set(r.studentId, r);
    return map;
  }, [records]);

  const handleMark = async (student: Student, status: AttendanceStatus) => {
    if (!organization || !membership || !selectedSession || !canMark) return;
    setSavingStudentId(student.id);
    try {
      await upsertAttendanceRecord(
        organization.id,
        {
          sessionId: selectedSession.id,
          studentId: student.id,
          studentName: student.fullName,
          groupId: selectedSession.groupId,
          status,
        },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      const updated = await listAttendanceBySession(organization.id, selectedSession.id);
      setRecords(updated);
      showToast({ type: 'success', title: `تم تسجيل (${student.fullName})` });
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تسجيل الحضور', message: getArabicErrorMessage(err) });
    } finally {
      setSavingStudentId(null);
    }
  };

  return (
    <AppShell
      pageTitle="الحضور والغياب"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'الحضور والغياب' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="تسجيل الحضور والغياب"
          description="اختر الحصة المجدولة ثم حدد حالة حضور كل طالب."
        />

        {loading ? (
          <LoadingState variant="table" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadInitial} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-6 w-6" />}
            title="لا توجد حصص لتسجيل الحضور"
            description="يرجى جدولة حصة دراسية أولاً من صفحة الحصص والجدول."
          />
        ) : (
          <div className="space-y-5">
            <Card>
              <div className="max-w-md">
                <Select
                  label="اختر الحصة الدراسية"
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} — {s.groupName} ({s.date} · {s.startTime})
                    </option>
                  ))}
                </Select>
              </div>
            </Card>

            {students.length === 0 ? (
              <EmptyState
                title="لا يوجد طلاب نشطون"
                description="أضف طلاباً نشطين أولاً لتظهر أسماؤهم في قائمة التحضير."
              />
            ) : (
              <Card padding="none">
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {students.map((student) => {
                    const currentStatus = recordByStudent.get(student.id)?.status;
                    const isSaving = savingStudentId === student.id;

                    return (
                      <div
                        key={student.id}
                        className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {student.fullName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {student.gradeLevel} · <span dir="ltr">{student.phone}</span>
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {STATUS_OPTIONS.map((opt) => {
                            const active = currentStatus === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                disabled={!canMark || isSaving}
                                onClick={() => handleMark(student, opt.value)}
                                className={cn(
                                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap',
                                  active
                                    ? opt.value === 'present'
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : opt.value === 'late'
                                      ? 'bg-amber-600 text-white border-amber-600'
                                      : opt.value === 'absent'
                                      ? 'bg-red-600 text-white border-red-600'
                                      : 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                                )}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
