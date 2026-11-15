import { type ReactNode } from 'react';
import { cn } from '@/src/lib/utils/cn';

interface MetricCardProps {
  label: string;
  value: string;
  helperText?: string;
  icon: ReactNode;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
}

const TONE_ICON_BG: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  primary: 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300',
  danger: 'bg-red-50 text-red-700 dark:bg-red-950/70 dark:text-red-300',
};

export function MetricCard({
  label,
  value,
  helperText,
  icon,
  tone = 'default',
}: MetricCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 leading-relaxed">
          {label}
        </span>
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            TONE_ICON_BG[tone]
          )}
        >
          {icon}
        </div>
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight">
          {value}
        </p>
        {helperText && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{helperText}</p>
        )}
      </div>
    </div>
  );
}
