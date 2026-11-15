import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/src/lib/utils/cn';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

export interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      window.setTimeout(() => {
        dismissToast(id);
      }, 4500);
    },
    [dismissToast]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 left-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100%-2rem)] pointer-events-none"
      >
        {toasts.map((toast) => {
          const Icon =
            toast.type === 'success'
              ? CheckCircle2
              : toast.type === 'error'
              ? AlertCircle
              : toast.type === 'warning'
              ? AlertTriangle
              : Info;

          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-lg border p-3.5 shadow-sm transition-all',
                'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100',
                toast.type === 'success' && 'border-emerald-200 dark:border-emerald-800/70',
                toast.type === 'error' && 'border-red-200 dark:border-red-800/70',
                toast.type === 'warning' && 'border-amber-200 dark:border-amber-800/70',
                toast.type === 'info' && 'border-blue-200 dark:border-blue-800/70'
              )}
            >
              <Icon
                className={cn(
                  'h-5 w-5 shrink-0 mt-0.5',
                  toast.type === 'success' && 'text-emerald-600 dark:text-emerald-400',
                  toast.type === 'error' && 'text-red-600 dark:text-red-400',
                  toast.type === 'warning' && 'text-amber-600 dark:text-amber-400',
                  toast.type === 'info' && 'text-blue-600 dark:text-blue-400'
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="إغلاق الإشعار"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
