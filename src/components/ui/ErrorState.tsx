import { AlertTriangle, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message: string;
  variant?: 'error' | 'permission' | 'network';
  onRetry?: () => void;
}

export function ErrorState({
  title,
  message,
  variant = 'error',
  onRetry,
}: ErrorStateProps) {
  const Icon =
    variant === 'permission' ? ShieldAlert : variant === 'network' ? WifiOff : AlertTriangle;

  const defaultTitle =
    variant === 'permission'
      ? 'صلاحيات غير كافية'
      : variant === 'network'
      ? 'تعذر الاتصال بالشبكة'
      : 'تعذر تحميل البيانات';

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 px-6 py-10 text-center flex flex-col items-center justify-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 mb-4">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">
        {title || defaultTitle}
      </h3>
      <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5 max-w-md leading-relaxed">
        {message}
      </p>
      {onRetry && (
        <div className="mt-5">
          <Button variant="outline" size="sm" onClick={onRetry} icon={<RefreshCw className="h-4 w-4" />}>
            إعادة المحاولة
          </Button>
        </div>
      )}
    </div>
  );
}
