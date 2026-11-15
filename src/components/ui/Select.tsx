import { type SelectHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/src/lib/utils/cn';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, id, className, children, ...props }, ref) => {
    const selectId = id || props.name;
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-slate-800 dark:text-slate-200"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full h-10 rounded-lg border px-3 text-sm transition-colors',
            'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100',
            'focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 dark:focus:border-blue-500',
            error
              ? 'border-red-500 dark:border-red-500'
              : 'border-slate-300 dark:border-slate-700',
            'disabled:bg-slate-100 dark:disabled:bg-slate-800/60 disabled:cursor-not-allowed',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
