import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Wallet, Ban } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { MetricCard } from '@/src/components/ui/MetricCard';
import { Button } from '@/src/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/src/components/ui/DataTable';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { Modal } from '@/src/components/ui/Modal';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';
import { Input } from '@/src/components/ui/Input';
import { Select } from '@/src/components/ui/Select';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import {
  createExpense,
  createPayment,
  listExpenses,
  listPayments,
  voidExpense,
  voidPayment,
} from '@/src/services/financeService';
import { listStudents } from '@/src/services/studentService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatCurrencyEGP, formatDateArabic, getTodayIsoDate } from '@/src/lib/utils/format';
import { cn } from '@/src/lib/utils/cn';
import type {
  ExpenseCategory,
  ExpenseRecord,
  PaymentCategory,
  PaymentMethod,
  PaymentRecord,
  Student,
} from '@/src/types/domain';

type FinanceTab = 'payments' | 'expenses';

export function FinancePage() {
  const { organization, membership } = useTenant();
  const { showToast } = useToast();

  const [tab, setTab] = useState<FinanceTab>('payments');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [expModalOpen, setExpModalOpen] = useState(false);

  // Payment form
  const [studentId, setStudentId] = useState('');
  const [payAmount, setPayAmount] = useState('350');
  const [paidAmount, setPaidAmount] = useState('350');
  const [payCategory, setPayCategory] = useState<PaymentCategory>('tuition');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [submittingPay, setSubmittingPay] = useState(false);

  // Expense form
  const [expTitle, setExpTitle] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('rent');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(getTodayIsoDate());
  const [expNotes, setExpNotes] = useState('');
  const [submittingExp, setSubmittingExp] = useState(false);

  // Void dialog
  const [voidTarget, setVoidTarget] = useState<{ type: 'payment' | 'expense'; id: string; label: string } | null>(null);
  const [voiding, setVoiding] = useState(false);

  const canManageExpenses = membership ? ['owner', 'accountant'].includes(membership.role) : false;

  const loadFinance = useCallback(async () => {
    if (!organization) return;
    setLoading(true);
    setError(null);
    try {
      const [payData, expData, stuData] = await Promise.all([
        listPayments(organization.id),
        canManageExpenses ? listExpenses(organization.id) : Promise.resolve([]),
        listStudents(organization.id),
      ]);
      setPayments(payData);
      setExpenses(expData);
      setStudents(stuData);
      if (stuData.length > 0 && !studentId) setStudentId(stuData[0].id);
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organization, canManageExpenses, studentId]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  const summary = useMemo(() => {
    const activePays = payments.filter((p) => p.status !== 'voided');
    const activeExps = expenses.filter((e) => e.status !== 'voided');
    const collected = activePays.reduce((s, p) => s + p.paidAmount, 0);
    const outstanding = activePays.reduce((s, p) => s + p.dueAmount, 0);
    const totalExpenses = activeExps.reduce((s, e) => s + e.amount, 0);
    return { collected, outstanding, totalExpenses, net: collected - totalExpenses };
  }, [payments, expenses]);

  const handleAddPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !membership || submittingPay) return;
    const stu = students.find((s) => s.id === studentId);
    if (!stu) {
      showToast({ type: 'error', title: 'اختر طالباً أولاً' });
      return;
    }

    setSubmittingPay(true);
    try {
      await createPayment(
        organization.id,
        {
          studentId: stu.id,
          studentName: stu.fullName,
          amount: Number(payAmount) || 0,
          paidAmount: Number(paidAmount) || 0,
          category: payCategory,
          method: payMethod,
          referenceNumber: payRef,
          notes: payNotes,
        },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      showToast({ type: 'success', title: 'تم تسجيل الدفعة المالية' });
      setPayModalOpen(false);
      setPayRef('');
      setPayNotes('');
      await loadFinance();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تسجيل الدفعة', message: getArabicErrorMessage(err) });
    } finally {
      setSubmittingPay(false);
    }
  };

  const handleAddExpense = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !membership || submittingExp) return;
    setSubmittingExp(true);
    try {
      await createExpense(
        organization.id,
        {
          title: expTitle,
          category: expCategory,
          amount: Number(expAmount) || 0,
          expenseDate: expDate,
          notes: expNotes,
        },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      showToast({ type: 'success', title: 'تم تسجيل المصروف' });
      setExpModalOpen(false);
      setExpTitle('');
      setExpAmount('');
      setExpNotes('');
      await loadFinance();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر تسجيل المصروف', message: getArabicErrorMessage(err) });
    } finally {
      setSubmittingExp(false);
    }
  };

  const handleConfirmVoid = async () => {
    if (!organization || !membership || !voidTarget) return;
    setVoiding(true);
    try {
      const actor = {
        uid: membership.uid,
        displayName: membership.displayName,
        role: membership.role,
      };
      if (voidTarget.type === 'payment') {
        await voidPayment(organization.id, voidTarget.id, 'إلغاء محاسبي معتمد', actor);
      } else {
        await voidExpense(organization.id, voidTarget.id, 'إلغاء محاسبي معتمد', actor);
      }
      showToast({ type: 'success', title: 'تم إلغاء القيد مع الحفاظ على سجل التدقيق' });
      setVoidTarget(null);
      await loadFinance();
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر إلغاء القيد', message: getArabicErrorMessage(err) });
    } finally {
      setVoiding(false);
    }
  };

  const paymentColumns: DataTableColumn<PaymentRecord>[] = [
    {
      key: 'student',
      header: 'الطالب',
      render: (r) => <span className="font-semibold">{r.studentName}</span>,
    },
    {
      key: 'paid',
      header: 'المحصّل',
      numeric: true,
      render: (r) => formatCurrencyEGP(r.paidAmount),
    },
    {
      key: 'due',
      header: 'المتبقي (مستحق)',
      numeric: true,
      render: (r) => (
        <span className={r.dueAmount > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
          {formatCurrencyEGP(r.dueAmount)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => (
        <span
          className={cn(
            'text-xs font-medium',
            r.status === 'posted' && 'text-emerald-700 dark:text-emerald-400',
            r.status === 'partial' && 'text-amber-700 dark:text-amber-400',
            r.status === 'pending' && 'text-red-700 dark:text-red-400',
            r.status === 'voided' && 'text-slate-400 line-through'
          )}
        >
          {r.status === 'posted'
            ? 'محصّل'
            : r.status === 'partial'
            ? 'سداد جزئي'
            : r.status === 'pending'
            ? 'مستحق'
            : 'ملغى'}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      render: (r) => <span className="text-xs text-slate-500">{formatDateArabic(r.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'إجراء',
      render: (r) =>
        canManageExpenses && r.status !== 'voided' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Ban className="h-3.5 w-3.5" />}
            onClick={() => setVoidTarget({ type: 'payment', id: r.id, label: r.studentName })}
          >
            إلغاء قيد
          </Button>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  const expenseColumns: DataTableColumn<ExpenseRecord>[] = [
    {
      key: 'title',
      header: 'بيان المصروف',
      render: (r) => <span className="font-semibold">{r.title}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      render: (r) => formatCurrencyEGP(r.amount),
    },
    {
      key: 'date',
      header: 'تاريخ المصروف',
      numeric: true,
      render: (r) => <span className="font-mono-tabular text-xs">{r.expenseDate}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => (
        <span className={r.status === 'posted' ? 'text-xs font-medium text-slate-700 dark:text-slate-300' : 'text-xs text-slate-400 line-through'}>
          {r.status === 'posted' ? 'معتمد' : 'ملغى'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      render: (r) =>
        r.status !== 'voided' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Ban className="h-3.5 w-3.5" />}
            onClick={() => setVoidTarget({ type: 'expense', id: r.id, label: r.title })}
          >
            إلغاء قيد
          </Button>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <AppShell
      pageTitle="الحسابات والمدفوعات"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'الحسابات والمدفوعات' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="الإدارة المالية (EGP)"
          description="فصل واضح بين التحصيلات الفعلية والمبالغ المستحقة والمصروفات مع منع الحذف النهائي للقيود."
          actions={
            <div className="flex items-center gap-2">
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPayModalOpen(true)}>
                تسجيل دفعة
              </Button>
              {canManageExpenses && (
                <Button
                  variant="outline"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => setExpModalOpen(true)}
                >
                  تسجيل مصروف
                </Button>
              )}
            </div>
          }
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="إجمالي التحصيلات الفعلية"
            value={formatCurrencyEGP(summary.collected)}
            icon={<Wallet className="h-5 w-5" />}
            tone="success"
          />
          <MetricCard
            label="المبالغ المستحقة (الذمم)"
            value={formatCurrencyEGP(summary.outstanding)}
            icon={<Wallet className="h-5 w-5" />}
            tone="warning"
          />
          <MetricCard
            label="إجمالي المصروفات"
            value={canManageExpenses ? formatCurrencyEGP(summary.totalExpenses) : 'مقيد'}
            icon={<Wallet className="h-5 w-5" />}
            tone="danger"
          />
          <MetricCard
            label="الصافي المالي"
            value={canManageExpenses ? formatCurrencyEGP(summary.net) : 'مقيد'}
            icon={<Wallet className="h-5 w-5" />}
            tone={summary.net >= 0 ? 'primary' : 'danger'}
          />
        </div>

        {/* Segmented Tabs */}
        <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
          <button
            type="button"
            onClick={() => setTab('payments')}
            className={cn(
              'px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer',
              tab === 'payments'
                ? 'bg-[#0F2942] text-white dark:bg-blue-600'
                : 'text-slate-600 dark:text-slate-400'
            )}
          >
            سجل المدفوعات والمستحقات
          </button>
          {canManageExpenses && (
            <button
              type="button"
              onClick={() => setTab('expenses')}
              className={cn(
                'px-4 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer',
                tab === 'expenses'
                  ? 'bg-[#0F2942] text-white dark:bg-blue-600'
                  : 'text-slate-600 dark:text-slate-400'
              )}
            >
              سجل المصروفات
            </button>
          )}
        </div>

        {loading ? (
          <LoadingState variant="table" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadFinance} />
        ) : tab === 'payments' ? (
          payments.length === 0 ? (
            <EmptyState
              title="لا توجد مدفوعات مسجلة"
              description="ابدأ بتسجيل أول دفعة مالية لطالب لمتابعة التحصيل والأرصدة المستحقة."
            />
          ) : (
            <DataTable columns={paymentColumns} data={payments} rowKey={(r) => r.id} />
          )
        ) : expenses.length === 0 ? (
          <EmptyState
            title="لا توجد مصروفات مسجلة"
            description="سجل المصروفات التشغيلية مثل الإيجار والرواتب والطباعة لاحتساب صافي الإيرادات بدقة."
          />
        ) : (
          <DataTable columns={expenseColumns} data={expenses} rowKey={(r) => r.id} />
        )}
      </div>

      {/* Add Payment Modal */}
      <Modal isOpen={payModalOpen} onClose={() => setPayModalOpen(false)} title="تسجيل دفعة مالية">
        <form onSubmit={handleAddPayment} className="space-y-4">
          {students.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              يرجى إضافة طالب واحد على الأقل قبل تسجيل المدفوعات.
            </p>
          ) : (
            <>
              <Select label="الطالب" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
              </Select>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="إجمالي المستحق (ج.م)"
                  type="number"
                  min={1}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  required
                />
                <Input
                  label="المبلغ المدفوع فعلياً (ج.م)"
                  type="number"
                  min={0}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="البند"
                  value={payCategory}
                  onChange={(e) => setPayCategory(e.target.value as PaymentCategory)}
                >
                  <option value="tuition">اشتراك شهري</option>
                  <option value="materials">ملازم ومطبوعات</option>
                  <option value="registration">رسوم تسجيل</option>
                  <option value="other">أخرى</option>
                </Select>
                <Select
                  label="طريقة الدفع"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                >
                  <option value="cash">نقدي (كاش)</option>
                  <option value="vodafone_cash">فودافون كاش</option>
                  <option value="instapay">إنستاباي (InstaPay)</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="card">بطاقة بنكية</option>
                </Select>
              </div>
              <Input
                label="رقم مرجعي (اختياري)"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
              />
              <Input
                label="ملاحظات (اختياري)"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
              />
            </>
          )}
          <div className="pt-3 flex items-center justify-end gap-2.5">
            <Button variant="outline" onClick={() => setPayModalOpen(false)}>
              إلغاء
            </Button>
            {students.length > 0 && (
              <Button type="submit" isLoading={submittingPay}>
                حفظ الدفعة
              </Button>
            )}
          </div>
        </form>
      </Modal>

      {/* Add Expense Modal */}
      <Modal isOpen={expModalOpen} onClose={() => setExpModalOpen(false)} title="تسجيل مصروف تشغيلي">
        <form onSubmit={handleAddExpense} className="space-y-4">
          <Input
            label="بيان المصروف"
            placeholder="مثال: إيجار القاعة لشهر نوفمبر"
            value={expTitle}
            onChange={(e) => setExpTitle(e.target.value)}
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="التصنيف"
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
            >
              <option value="rent">إيجار</option>
              <option value="salaries">رواتب</option>
              <option value="utilities">مرافق وكهرباء</option>
              <option value="printing">طباعة</option>
              <option value="marketing">تسويق</option>
              <option value="other">أخرى</option>
            </Select>
            <Input
              label="المبلغ (ج.م)"
              type="number"
              min={1}
              value={expAmount}
              onChange={(e) => setExpAmount(e.target.value)}
              required
            />
          </div>
          <Input
            label="تاريخ المصروف"
            type="date"
            dir="ltr"
            value={expDate}
            onChange={(e) => setExpDate(e.target.value)}
            required
          />
          <Input label="ملاحظات (اختياري)" value={expNotes} onChange={(e) => setExpNotes(e.target.value)} />
          <div className="pt-3 flex items-center justify-end gap-2.5">
            <Button variant="outline" onClick={() => setExpModalOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" isLoading={submittingExp}>
              حفظ المصروف
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(voidTarget)}
        onClose={() => setVoidTarget(null)}
        onConfirm={handleConfirmVoid}
        isDanger
        isLoading={voiding}
        title="تأكيد إلغاء القيد المالي"
        message={`سيتم تعليم القيد (${voidTarget?.label || ''}) كـ "ملغى" مع الاحتفاظ به في سجل التدقيق المالي دون حذفه نهائياً. هل تريد المتابعة؟`}
        confirmLabel="نعم، إلغاء القيد"
      />
    </AppShell>
  );
}
