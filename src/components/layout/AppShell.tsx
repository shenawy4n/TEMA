import { useState, type ReactNode } from 'react';
import { useTenant } from '@/src/hooks/useTenant';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

interface AppShellProps {
  pageTitle: string;
  breadcrumbs: Array<{ label: string; to?: string }>;
  children: ReactNode;
}

export function AppShell({ pageTitle, breadcrumbs, children }: AppShellProps) {
  const { organization, membership } = useTenant();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        organization={organization}
        role={membership?.role ?? 'owner'}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          pageTitle={pageTitle}
          breadcrumbs={breadcrumbs}
          onOpenMobileMenu={() => setMobileOpen(true)}
        />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
