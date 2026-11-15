import { BarChart3, ClipboardCheck, Layers, ShieldCheck, Wallet } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Card } from '@/src/components/ui/Card';

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
