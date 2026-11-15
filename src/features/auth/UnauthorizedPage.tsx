import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';

export function UnauthorizedPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          غير مصرح لك بالوصول
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          لا يملك دورك الحالي داخل المنظمة صلاحية الوصول إلى هذه الصفحة. يرجى التواصل مع مالك المنظمة إذا كنت بحاجة إلى ترقية الصلاحيات.
        </p>
        <div className="pt-2">
          <Link to="/dashboard">
            <Button icon={<ArrowRight className="h-4 w-4" />}>العودة إلى لوحة التحكم</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
