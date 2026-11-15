import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  label?: string;
  variant?: 'spinner' | 'table' | 'cards';
}

export function LoadingState({ label = 'جاري تحميل البيانات...', variant = 'spinner' }: LoadingStateProps) {
  if (variant === 'table') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {[1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center justify-between gap-4 px-5 py-4 animate-pulse">
              <div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-800 hidden sm:block" />
              <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((idx) => (
          <div
            key={idx}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 h-32 animate-pulse flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-24 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-9 w-9 rounded-lg bg-slate-200 dark:bg-slate-800" />
            </div>
            <div className="h-6 w-20 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-[#0F2942] dark:text-blue-400" />
      <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">{label}</p>
    </div>
  );
}
