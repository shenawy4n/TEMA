import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Plus, CheckCircle2, Ban, Clock } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { Modal } from '@/src/components/ui/Modal';
import { Input } from '@/src/components/ui/Input';
import { Select } from '@/src/components/ui/Select';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import {
  createSession,
  listSessions,
  rescheduleSession,
  updateSessionStatus,
} from '@/src/services/sessionService';
import { listGroups } from '@/src/services/groupService';
import { assertValidSessionSchedule } from '@/src/lib/domain/scheduling';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { getTodayIsoDate } from '@/src/lib/utils/format';
import type { ClassSession, SessionStatus, StudyGroup } from '@/src/types/domain';

const WEEK_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  scheduled: 'مجدولة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export function SessionsPage() {
  const { organization, membership } = useTenant();
  const { showToast } = useToast();

  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(getTodayIsoDate());
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('18:00');
  const [room, setRoom] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [rescheduleTarget, setRescheduleTarget] = useState<ClassSession | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduling, setRescheduling] = useState(false);

  const canCreate = membership ? ['owner', 'teacher', 'assistant'].includes(membership.role) : false;

  const activeGroups = useMemo(() => groups.filter((g) => g.status === 'active'), [groups]);

  const loadData = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);
    try {
      const [sesData, grpData] = await Promise.all([
        listSessions(organization.id),
        listGroups(organization.id),
      ]);
      setSessions(sesData);
      setGroups(grpData);
      const activeList = grpData.filter((g) => g.status === 'active');
      if (activeList.length > 0 && (!groupId || !activeList.some((g) => g.id === groupId))) {
        setGroupId(activeList[0].id);
      }
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization, groupId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const todayIso = getTodayIsoDate();
  const todaySessions = useMemo(() => sessions.filter((s) => s.date === todayIso), [sessions, todayIso]);
  const upcomingSessions = useMemo(() => sessions.filter((s) => s.date >= todayIso), [sessions, todayIso]);

  const handleCreateSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !membership || submitting) return;
    setFormError(null);

    const selectedGroup = activeGroups.find((g) => g.id === groupId);
    if (!selectedGroup) {
      setFormError('يرجى اختيار مجموعة دراسية نشطة أولاً.');
      return;
    }
    if (title.trim().length < 2) {
      setFormError('يرجى إدخال عنوان الحصة.');
      return;
    }
    try {
      assertValidSessionSchedule(date, startTime, endTime);
    } catch (err) {
      setFormError(getArabicErrorMessage(err));
      return;
    }

    setSubmitting(true);
    try {
      await createSession(
        organization.id,
        {
          groupId: selectedGroup.id,
          groupName: selectedGroup.name,
          teacherId: selectedGroup.teacherId,
          teacherName: selectedGroup.teacherName,
          title,
          date,
          startTime,
          endTime,
          room,
        },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      showToast({ type: 'success', title: 'تم جدولة الحصة بنجاح' });
      setModalOpen(false);
      setTitle('');
      setRoom('');
      await loadData();
    } catch (err) {
      setFormError(getArabicErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSessionStatus = async (ses: ClassSession, nextStatus: SessionStatus) => {
    if (!organization || !membership || !canCreate) return;
    try {
      await updateSessionStatus(
        organization.id,
        ses.id,
        nextStatus,
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        },
        nextStatus === 'cancelled' ? 'إلغاء من جدول الحصص' : undefined
      );
      showToast({ type: 'success', title: `تم تحديث حالة الحصة إلى (${SESSION_STATUS_LABELS[nextStatus]})` });
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تحديث الحصة', message: getArabicErrorMessage(err) });
    }
  };

  const openReschedule = (ses: ClassSession) => {
    setRescheduleTarget(ses);
    setRescheduleDate(ses.date);
    setRescheduleStart(ses.startTime);
    setRescheduleEnd(ses.endTime);
    setRescheduleReason('');
  };

  const handleReschedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !rescheduleTarget || rescheduling) return;
    try {
      assertValidSessionSchedule(rescheduleDate, rescheduleStart, rescheduleEnd);
    } catch (err) {
      showToast({ type: 'error', title: 'بيانات الموعد غير صالحة', message: getArabicErrorMessage(err) });
      return;
    }

    setRescheduling(true);
    try {
      await rescheduleSession(organization.id, rescheduleTarget.id, {
        date: rescheduleDate,
        startTime: rescheduleStart,
        endTime: rescheduleEnd,
        reason: rescheduleReason,
      });
      showToast({ type: 'success', title: 'تم إعادة جدولة الحصة' });
      setRescheduleTarget(null);
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تعديل الموعد', message: getArabicErrorMessage(err) });
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <AppShell
      pageTitle="الحصص والجدول"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'الحصص والجدول' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="الحصص والجدول الدراسي"
          description="متابعة جدول اليوم والحصص القادمة والتخطيط الأسبوعي للمجموعات."
          actions={
            canCreate ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModalOpen(true)}>
                جدولة حصة
              </Button>
            ) : null
          }
        />

        {loading ? (
          <LoadingState variant="table" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadData} />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Schedule */}
              <Card>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
                  جدول اليوم ({todayIso})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  الحصص المجدولة لتاريخ اليوم
                </p>

                {todaySessions.length === 0 ? (
                  <EmptyState
                    icon={<CalendarClock className="h-6 w-6" />}
                    title="لا توجد حصص مجدولة اليوم"
                    description="يمكنك جدولة حصة جديدة لأي مجموعة من زر جدولة حصة."
                  />
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {todaySessions.map((ses) => (
                      <div key={ses.id} className="py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{ses.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {ses.groupName} {ses.room ? `· قاعة ${ses.room}` : ''}
                          </p>
                        </div>
                        <span className="font-mono-tabular text-xs font-medium text-slate-700 dark:text-slate-300">
                          {ses.startTime} - {ses.endTime}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Upcoming Sessions */}
              <Card>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
                  الحصص القادمة
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  كافة الحصص القادمة المرتبطة بالمجموعات
                </p>

                {upcomingSessions.length === 0 ? (
                  <EmptyState
                    icon={<CalendarClock className="h-6 w-6" />}
                    title="لا توجد حصص قادمة"
                    description="ستظهر هنا جميع الحصص القادمة فور إضافتها."
                  />
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {upcomingSessions.map((ses) => (
                      <div key={ses.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">
                            {ses.title}{' '}
                            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                              ({SESSION_STATUS_LABELS[ses.status]})
                            </span>
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {ses.groupName} · {ses.teacherName}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-left font-mono-tabular text-xs">
                            <p className="font-medium">{ses.date}</p>
                            <p className="text-slate-500 dark:text-slate-400">
                              {ses.startTime} - {ses.endTime}
                            </p>
                          </div>
                          {canCreate && ses.status === 'scheduled' && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                title="تعديل الموعد"
                                icon={<Clock className="h-3.5 w-3.5" />}
                                onClick={() => openReschedule(ses)}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                title="إكمال الحصة"
                                icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                                onClick={() => void handleSessionStatus(ses, 'completed')}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                title="إلغاء الحصة"
                                icon={<Ban className="h-3.5 w-3.5 text-red-600" />}
                                onClick={() => void handleSessionStatus(ses, 'cancelled')}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Weekly Calendar Shell */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    التقويم الأسبوعي (عرض تخطيطي)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    توزيع أيام الأسبوع — سيتم إضافة السحب والإفلات والتكرار التلقائي في المرحلة القادمة.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {WEEK_DAYS.map((day) => (
                  <div
                    key={day}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3 min-h-[110px]"
                  >
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-800">
                      {day}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3">
                      عرض أسبوعي مبدئي
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="جدولة حصة جديدة">
        <form onSubmit={handleCreateSession} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
              {formError}
            </div>
          )}

          {activeGroups.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              يجب وجود مجموعة دراسية نشطة واحدة على الأقل قبل جدولة الحصص.
            </p>
          ) : (
            <>
              <Select
                label="المجموعة الدراسية"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                {activeGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.subject})
                  </option>
                ))}
              </Select>

              <Input
                label="عنوان الحصة / الدرس"
                placeholder="مثال: مراجعة الفصل الأول"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  label="التاريخ"
                  type="date"
                  dir="ltr"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
                <Input
                  label="من الساعة"
                  type="time"
                  dir="ltr"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
                <Input
                  label="إلى الساعة"
                  type="time"
                  dir="ltr"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>

              <Input
                label="القاعة / المكان (اختياري)"
                placeholder="مثال: قاعة 2"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
              />
            </>
          )}

          <div className="pt-3 flex items-center justify-end gap-2.5">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={submitting}>
              إلغاء
            </Button>
            {activeGroups.length > 0 && (
              <Button type="submit" isLoading={submitting}>
                حفظ الحصة
              </Button>
            )}
          </div>
        </form>
      </Modal>

      {/* Reschedule Session Modal */}
      <Modal
        isOpen={Boolean(rescheduleTarget)}
        onClose={() => setRescheduleTarget(null)}
        title={`إعادة جدولة الحصة — ${rescheduleTarget?.title || ''}`}
      >
        {rescheduleTarget && (
          <form onSubmit={handleReschedule} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="التاريخ الجديد"
                type="date"
                dir="ltr"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                required
              />
              <Input
                label="من الساعة"
                type="time"
                dir="ltr"
                value={rescheduleStart}
                onChange={(e) => setRescheduleStart(e.target.value)}
                required
              />
              <Input
                label="إلى الساعة"
                type="time"
                dir="ltr"
                value={rescheduleEnd}
                onChange={(e) => setRescheduleEnd(e.target.value)}
                required
              />
            </div>
            <Input
              label="سبب تعديل الموعد (اختياري)"
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
            />
            <div className="pt-3 flex items-center justify-end gap-2.5">
              <Button variant="outline" onClick={() => setRescheduleTarget(null)} disabled={rescheduling}>
                إلغاء
              </Button>
              <Button type="submit" isLoading={rescheduling}>
                حفظ الموعد الجديد
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </AppShell>
  );
}
