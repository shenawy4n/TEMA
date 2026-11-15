import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  UserCheck,
  Layers,
  CalendarClock,
  ArrowDownLeft,
  Clock,
  Receipt,
  TrendingUp,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { MetricCard } from '@/src/components/ui/MetricCard';
import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { Button } from '@/src/components/ui/Button';
import { useTenant } from '@/src/hooks/useTenant';
import { listStudents } from '@/src/services/studentService';
import { listGroups, listOrganizationEnrollments } from '@/src/services/groupService';
import { listSessions } from '@/src/services/sessionService';
import { listAttendanceByOrganization } from '@/src/services/attendanceService';
import { listExpenses, listLedgerEntries, listPayments } from '@/src/services/financeService';
import { deriveFinancialSummaryFromLedger } from '@/src/lib/domain/ledger';
import { calculateAttendanceMetrics } from '@/src/lib/domain/scheduling';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatCurrencyEGP, formatNumber, getTodayIsoDate } from '@/src/lib/utils/format';
import { cn } from '@/src/lib/utils/cn';
import type {
  AttendanceRecord,
  ClassSession,
  ExpenseRecord,
  GroupEnrollment,
  LedgerEntry,
  PaymentRecord,
  Student,
  StudyGroup,
} from '@/src/types/domain';

type DateFilter = 'today' | 'month' | 'all';

export function DashboardPage() {
  const { organization, membership } = useTenant();

  const [dateFilter, setDateFilter] = useState<DateFilter>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [enrollments, setEnrollments] = useState<GroupEnrollment[]>([]);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);

  const canViewPayments = membership ? ['owner', 'accountant', 'assistant'].includes(membership.role) : false;
  const canViewExpenses = membership ? ['owner', 'accountant'].includes(membership.role) : false;

  const loadDashboard = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);

    try {
      const [stuData, grpData, enrData, sesData, attData, payData, expData, ledgerData] = await Promise.all([
        listStudents(organization.id),
        listGroups(organization.id),
        listOrganizationEnrollments(organization.id),
        listSessions(organization.id),
        listAttendanceByOrganization(organization.id),
        canViewPayments ? listPayments(organization.id) : Promise.resolve([]),
        canViewExpenses ? listExpenses(organization.id) : Promise.resolve([]),
        canViewPayments ? listLedgerEntries(organization.id) : Promise.resolve([]),
      ]);

      setStudents(stuData);
      setGroups(grpData);
      setEnrollments(enrData);
      setSessions(sesData);
      setAttendance(attData);
      setPayments(payData);
      setExpenses(expData);
      setLedgerEntries(ledgerData);
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization, canViewPayments, canViewExpenses]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const todayIso = getTodayIsoDate();
  const currentMonthPrefix = todayIso.slice(0, 7);

  const metrics = useMemo(() => {
    const totalStudents = students.length;
    const activeStudents = students.filter((s) => s.status === 'active').length;
    const activeGroups = groups.filter((g) => g.status === 'active').length;
    const activeEnrollmentsCount = enrollments.filter((e) => e.status === 'active').length;
    const todaySessions = sessions.filter((s) => s.date === todayIso && s.status !== 'cancelled').length;

    const matchesDateFilter = (dateStr?: string, createdAt?: unknown): boolean => {
      if (dateFilter === 'all') return true;
      let iso = dateStr || '';
      if (!iso && createdAt && typeof createdAt === 'object' && 'toDate' in createdAt) {
        const d = (createdAt as { toDate: () => Date }).toDate();
        iso = d.toISOString().slice(0, 10);
      }
      if (!iso) return dateFilter === 'month';
      return dateFilter === 'today' ? iso === todayIso : iso.startsWith(currentMonthPrefix);
    };

    const filteredPayments = payments.filter((p) => matchesDateFilter(p.paymentDate, p.createdAt));
    const filteredExpenses = expenses.filter((e) => matchesDateFilter(e.expenseDate, e.createdAt));
    const filteredLedger = ledgerEntries.filter((entry) => matchesDateFilter(undefined, entry.createdAt));

    const periodFinance = deriveFinancialSummaryFromLedger(
      filteredLedger,
      filteredPayments,
      filteredExpenses
    );
    const overallFinance = deriveFinancialSummaryFromLedger(ledgerEntries, payments, expenses);

    return {
      totalStudents,
      activeStudents,
      activeGroups,
      activeEnrollmentsCount,
      todaySessions,
      totalCollected: periodFinance.collectedEgp,
      totalDue: overallFinance.outstandingEgp,
      totalExpenses: periodFinance.expensesEgp,
      netRevenue: periodFinance.netEgp,
    };
  }, [students, groups, enrollments, sessions, payments, expenses, ledgerEntries, dateFilter, todayIso, currentMonthPrefix]);

  const upcomingSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.date >= todayIso && s.status === 'scheduled')
        .slice(0, 5),
    [sessions, todayIso]
  );

  const recentPayments = useMemo(
    () => payments.slice(0, 5),
    [payments]
  );

  const attendanceSummary = useMemo(() => {
    const calculated = calculateAttendanceMetrics(attendance, sessions);
    return {
      total: calculated.total,
      present: calculated.present,
      late: calculated.late,
      absent: calculated.absent,
      rate: calculated.attendanceRatePercent,
    };
  }, [attendance, sessions]);

  const alerts = useMemo(() => {
    const list: Array<{ title: string; detail: string; to: string }> = [];
    if (students.length === 0) {
      list.push({
        title: 'ابدأ بإضافة طلابك',
        detail: 'لا يوجد طلاب مسجلون في المنظمة بعد.',
        to: '/students',
      });
    }
    if (groups.length === 0) {
      list.push({
        title: 'أنشئ مجموعتك الدراسية الأولى',
        detail: 'تساعدك المجموعات على ربط الحصص والطلاب والتحصيل الشهري.',
        to: '/groups',
      });
    }
    if (metrics.totalDue > 0) {
      list.push({
        title: 'مبالغ مستحقة قيد التحصيل',
        detail: `يوجد رصيد مستحق بقيمة ${formatCurrencyEGP(metrics.totalDue)} لدى الطلاب.`,
        to: '/finance',
      });
    }
    if (metrics.todaySessions > 0) {
      list.push({
        title: 'حصص مجدولة لليوم',
        detail: `لديك ${formatNumber(metrics.todaySessions)} حصة مجدولة اليوم بتاريخ ${todayIso}.`,
        to: '/sessions',
      });
    }
    return list;
  }, [students.length, groups.length, metrics.totalDue, metrics.todaySessions, todayIso]);

  return (
    <AppShell
      pageTitle="لوحة التحكم"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'لوحة التحكم' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title={`مرحباً، ${organization?.ownerName || 'بك في TEMA'}`}
          description="ملخص حي لبيانات الطلاب والمجموعات والحصص والموقف المالي من قاعدة البيانات."
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
                {(
                  [
                    { id: 'today', label: 'اليوم' },
                    { id: 'month', label: 'هذا الشهر' },
                    { id: 'all', label: 'كل الفترات' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDateFilter(tab.id)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap',
                      dateFilter === tab.id
                        ? 'bg-[#0F2942] text-white dark:bg-blue-600'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <Link to="/students">
                <Button size="sm" icon={<Plus className="h-4 w-4" />}>
                  إضافة طالب
                </Button>
              </Link>
            </div>
          }
        />

        {loading ? (
          <LoadingState variant="cards" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadDashboard} />
        ) : (
          <>
            {/* 8 KPI Metric Cards */}
            <section aria-label="المؤشرات الرئيسية" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="إجمالي الطلاب"
                value={formatNumber(metrics.totalStudents)}
                helperText="جميع الطلاب المسجلين بالمنظمة"
                icon={<Users className="h-5 w-5" />}
                tone="primary"
              />
              <MetricCard
                label="الطلاب النشطون"
                value={formatNumber(metrics.activeStudents)}
                helperText={`${formatNumber(metrics.activeEnrollmentsCount)} تسجيل نشط بالمجموعات`}
                icon={<UserCheck className="h-5 w-5" />}
                tone="success"
              />
              <MetricCard
                label="عدد المجموعات"
                value={formatNumber(metrics.activeGroups)}
                helperText={`من إجمالي ${formatNumber(groups.length)} مجموعة`}
                icon={<Layers className="h-5 w-5" />}
                tone="default"
              />
              <MetricCard
                label="حصص اليوم"
                value={formatNumber(metrics.todaySessions)}
                helperText={`تاريخ ${todayIso}`}
                icon={<CalendarClock className="h-5 w-5" />}
                tone="primary"
              />
              <MetricCard
                label="إجمالي التحصيل الشهري"
                value={canViewPayments ? formatCurrencyEGP(metrics.totalCollected) : 'مقيد'}
                helperText={canViewPayments ? 'المدفوعات المحصلة فعلياً' : 'يتطلب صلاحية مالية'}
                icon={<ArrowDownLeft className="h-5 w-5" />}
                tone="success"
              />
              <MetricCard
                label="المبالغ المستحقة"
                value={canViewPayments ? formatCurrencyEGP(metrics.totalDue) : 'مقيد'}
                helperText={canViewPayments ? 'أرصدة قيد السداد' : 'يتطلب صلاحية مالية'}
                icon={<Clock className="h-5 w-5" />}
                tone="warning"
              />
              <MetricCard
                label="المصروفات"
                value={canViewExpenses ? formatCurrencyEGP(metrics.totalExpenses) : 'مقيد'}
                helperText={canViewExpenses ? 'المصروفات التشغيلية المعتمدة' : 'للمالك والمحاسب فقط'}
                icon={<Receipt className="h-5 w-5" />}
                tone="danger"
              />
              <MetricCard
                label="صافي الإيرادات"
                value={canViewExpenses ? formatCurrencyEGP(metrics.netRevenue) : 'مقيد'}
                helperText={canViewExpenses ? 'التحصيل ناقص المصروفات' : 'للمالك والمحاسب فقط'}
                icon={<TrendingUp className="h-5 w-5" />}
                tone={metrics.netRevenue >= 0 ? 'success' : 'danger'}
              />
            </section>

            {/* Operational Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Upcoming Classes */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      الحصص القادمة
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      أقرب الحصص المجدولة في المنظمة
                    </p>
                  </div>
                  <Link
                    to="/sessions"
                    className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                  >
                    عرض الجدول
                  </Link>
                </div>

                {upcomingSessions.length === 0 ? (
                  <EmptyState
                    title="لا توجد حصص قادمة"
                    description="لم يتم جدولة حصص دراسية قادمة بعد. يمكنك إضافة أول حصة من صفحة الحصص والجدول."
                    action={
                      <Link to="/sessions">
                        <Button size="sm" variant="outline">
                          جدولة حصة
                        </Button>
                      </Link>
                    }
                  />
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {upcomingSessions.map((ses) => (
                      <div key={ses.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {ses.title}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {ses.groupName} · {ses.teacherName}
                          </p>
                        </div>
                        <div className="text-left shrink-0 font-mono-tabular text-xs text-slate-600 dark:text-slate-300">
                          <p>{ses.date}</p>
                          <p className="text-slate-500 dark:text-slate-400">
                            {ses.startTime} - {ses.endTime}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Recent Transactions */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      أحدث المعاملات المالية
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      سجل التحصيل الفعلي والمبالغ المسجلة
                    </p>
                  </div>
                  {canViewPayments && (
                    <Link
                      to="/finance"
                      className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                    >
                      إدارة الحسابات
                    </Link>
                  )}
                </div>

                {!canViewPayments ? (
                  <EmptyState
                    title="بيانات مالية مقيدة"
                    description="عرض تفاصيل المدفوعات متاح للمالك والمحاسب والمساعد الإداري فقط."
                  />
                ) : recentPayments.length === 0 ? (
                  <EmptyState
                    title="لا توجد معاملات مسجلة"
                    description="ستظهر هنا أحدث عمليات التحصيل والمستحقات بمجرد تسجيل أول دفعة مالية."
                    action={
                      <Link to="/finance">
                        <Button size="sm" variant="outline">
                          تسجيل دفعة
                        </Button>
                      </Link>
                    }
                  />
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {recentPayments.map((pay) => (
                      <div key={pay.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {pay.studentName}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {pay.status === 'posted'
                              ? 'محصّل بالكامل'
                              : pay.status === 'partial'
                              ? 'سداد جزئي'
                              : pay.status === 'voided'
                              ? 'ملغى'
                              : 'قيد التحصيل'}
                          </p>
                        </div>
                        <div className="text-left shrink-0 tabular-nums">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {formatCurrencyEGP(pay.paidAmount)}
                          </p>
                          {pay.dueAmount > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              متبقي: {formatCurrencyEGP(pay.dueAmount)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Attendance Overview */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      نظرة عامة على الحضور والغياب
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      إحصائيات سجلات الحضور المسجلة
                    </p>
                  </div>
                  <Link
                    to="/attendance"
                    className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
                  >
                    تسجيل الحضور
                  </Link>
                </div>

                {attendanceSummary.total === 0 ? (
                  <EmptyState
                    title="لا توجد سجلات حضور بعد"
                    description="عند تسجيل الحضور في الحصص ستظهر هنا نسبة الالتزام وتوزيع الحضور والغياب."
                  />
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">نسبة الالتزام</p>
                      <p className="text-xl font-bold tabular-nums mt-1 text-slate-900 dark:text-white">
                        {attendanceSummary.rate}%
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">حضور</p>
                      <p className="text-xl font-bold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
                        {formatNumber(attendanceSummary.present)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">تأخير</p>
                      <p className="text-xl font-bold tabular-nums mt-1 text-amber-600 dark:text-amber-400">
                        {formatNumber(attendanceSummary.late)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                      <p className="text-xs text-slate-500 dark:text-slate-400">غياب</p>
                      <p className="text-xl font-bold tabular-nums mt-1 text-red-600 dark:text-red-400">
                        {formatNumber(attendanceSummary.absent)}
                      </p>
                    </div>
                  </div>
                )}
              </Card>

              {/* Important Alerts */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      تنبيهات مهمة
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      مؤشرات تشغيلية تتطلب متابعة
                    </p>
                  </div>
                </div>

                {alerts.length === 0 ? (
                  <EmptyState
                    title="كل الأمور منتظمة"
                    description="لا توجد تنبيهات تشغيلية أو متأخرات تستدعي التدخل حالياً."
                  />
                ) : (
                  <div className="space-y-3">
                    {alerts.map((alert) => (
                      <Link
                        key={alert.title}
                        to={alert.to}
                        className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {alert.title}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {alert.detail}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
