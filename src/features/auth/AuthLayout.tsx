import { type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { BrandWordmark } from '@/src/components/ui/BrandWordmark';
import { useTheme } from '@/src/hooks/useTheme';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="h-16 px-4 sm:px-8 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <BrandWordmark />
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="تبديل المظهر"
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{resolvedTheme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{subtitle}</p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
            {children}
          </div>

          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            TEMA · نظام إدارة التعليم للمعلمين المستقلين والمراكز التعليمية
          </p>
        </div>
      </main>
    </div>
  );
}
