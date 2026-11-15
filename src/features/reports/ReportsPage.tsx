import { useState } from 'react';
import { BarChart3, ClipboardCheck, Layers, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Card } from '@/src/components/ui/Card';
import { Button } from '@/src/components/ui/Button';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import {
  inspectOrganizationCountIntegrity,
  reconcileOrganizationCounts,
} from '@/src/services/reconciliationService';
import type { OrganizationReconciliationReport } from '@/src/lib/domain/scheduling';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { formatNumber } from '@/src/lib/utils/format';

const REPORT_CATEGORIES = [
  {
    title: 'التقارير المالية والتحصيل',
    description: 'تحليل التحصيلات الشهرية، المتأخرات حسب المجموعة، وتقارير صافي الربح والمصروفات بالجنيه المصري.',
    icon: Wallet,
    plannedItems: ['تقرير التحصيل الشهري التفصيلي', 'كشف المتأخرات والأرصدة المستحقة', 'ملخص المصروفات التشغيلية'],
  },
  {
    title: 'تقارير الحضور والالتزام',
    description: 'متابعة نسب حضور الطلاب، تنبيهات الغياب المتكرر، وتقارير التزام كل مجموعة دراسية.',
    icon: ClipboardCheck,
    plannedItems: ['نسبة الحضور لكل مجموعة', 'قائمة الطلاب الأكثر غياباً', 'تقرير حضور الحصص اليومي'],
  },
  {
    title: 'تقارير الأداء الأكاديمي والمجموعات',
    description: 'قياس الطاقة الاستيعابية للمجموعات، معدلات النمو، وأداء المدرسين في المراكز التعليمية.',
    icon: Layers,
    plannedItems: ['معدل إشغال القاعات والمجموعات', 'توزيع الطلاب على الصفوف الدراسية', 'مؤشرات التسرب والانقطاع'],
  },
  {
    title: 'سجل التدقيق والرقابة الإدارية',
    description: 'مراجعة جميع الحركات المالية والإدارية المسجلة من فريق العمل وتصديرها بصيغ قابلة للمراجعة.',
    icon: ShieldCheck,
    plannedItems: ['سجل القيود المالية الملغاة', 'سجل تعديلات الصلاحيات', 'تصدير التقارير (PDF / Excel)'],
  },
];

export function ReportsPage() {
  const { organization, membership } = useTenant();
  const { showToast } = useToast();
  const [report, setReport] = useState<OrganizationReconciliationReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const canReconcile = membership ? ['owner', 'accountant'].includes(membership.role) : false;

  const handleInspect = async () => {
    if (!organization || checking) return;
    setChecking(true);
    try {
      const result = await inspectOrganizationCountIntegrity(organization.id);
      setReport(result);
      showToast({
        type: result.hasDiscrepancies ? 'warning' : 'success',
        title: result.hasDiscrepancies ? 'تم رصد فروقات في العدادات' : 'كافة الأعداد متطابقة بدقة',
      });
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر فحص التطابق', message: getArabicErrorMessage(err) });
    } finally {
      setChecking(false);
    }
  };

  const handleReconcile = async () => {
    if (!organization || reconciling) return;
    setReconciling(true);
    try {
      await reconcileOrganizationCounts(organization.id);
      const updated = await inspectOrganizationCountIntegrity(organization.id);
      setReport(updated);
      showToast({ type: 'success', title: 'تمت مزامنة وإصلاح أعداد المنظمة والمجموعات' });
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر مزامنة الأعداد', message: getArabicErrorMessage(err) });
    } finally {
      setReconciling(false);
    }
  };

  return (
    <AppShell
      pageTitle="التقارير"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'التقارير' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="مركز التقارير والتحليلات"
          description="خريطة فئات التقارير التي سيتم تفعيلها تباعاً في المراحل القادمة بناءً على بيانات منظمتك الفعلية."
        />

        {canReconcile && (
          <Card className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  فحص ومطابقة سلامة الأعداد والبيانات
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  التحقق من تطابق إجمالي الطلاب والطلاب النشطين وتسجيلات المجموعات مع السجلات الفعلية.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  isLoading={checking}
                  onClick={() => void handleInspect()}
                >
                  فحص التطابق
                </Button>
                {report?.hasDiscrepancies && (
                  <Button
                    size="sm"
                    isLoading={reconciling}
                    onClick={() => void handleReconcile()}
                  >
                    إصلاح ومزامنة الأعداد
                  </Button>
                )}
              </div>
            </div>

            {report && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">إجمالي الطلاب الفعلي</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                    {formatNumber(report.actualTotalStudents)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">الطلاب النشطون</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {formatNumber(report.actualActiveStudents)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">إجمالي تسجيلات المجموعات</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                    {formatNumber(report.totalActiveGroupEnrollments)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">فروقات المجموعات</span>
                  <span className={report.hasDiscrepancies ? 'font-semibold text-amber-600' : 'font-semibold text-emerald-600'}>
                    {report.hasDiscrepancies ? `${formatNumber(report.groupDiscrepancies.length)} فرق` : 'لا توجد فروقات'}
                  </span>
                </div>
              </div>
            )}
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {REPORT_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <Card key={cat.title} className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-[#0F2942] dark:text-blue-400">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      {cat.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {cat.description}
                    </p>
                  </div>
                </div>

                <ul className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
                  {cat.plannedItems.map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"
                    >
                      <BarChart3 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
