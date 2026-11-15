import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { SIDEBAR_NAVIGATION } from '@/src/lib/constants/navigation';
import { BrandWordmark } from '@/src/components/ui/BrandWordmark';
import { cn } from '@/src/lib/utils/cn';
import type { MemberRole, Organization } from '@/src/types/domain';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  organization: Organization | null;
  role: MemberRole;
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  organization,
  role,
}: SidebarProps) {
  const visibleItems = SIDEBAR_NAVIGATION.filter((item) => item.allowedRoles.includes(role));

  const renderNavContent = (isMobile: boolean) => {
    const isCompact = !isMobile && collapsed;

    return (
      <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
        {/* Header */}
        <div
          className={cn(
            'flex h-16 items-center border-b border-slate-200 dark:border-slate-800 px-4',
            isCompact ? 'justify-center' : 'justify-between'
          )}
        >
          <BrandWordmark compact={isCompact} />
          {isMobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="إغلاق القائمة الجانبية"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={isCompact ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'}
              className="hidden lg:inline-flex rounded-lg p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isCompact ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Organization Context Summary */}
        {!isCompact && organization && (
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {organization.name}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {organization.type === 'independent_teacher' ? 'مدرس مستقل' : 'سنتر تعليمي'} · {organization.academicYear}
            </p>
          </div>
        )}

        {/* Navigation Links */}
        <nav aria-label="التنقل الرئيسي" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.id}
                to={item.path}
                onClick={isMobile ? onCloseMobile : undefined}
                title={isCompact ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
                    isCompact && 'justify-center px-2',
                    isActive
                      ? 'bg-[#0F2942] text-white dark:bg-blue-600 dark:text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  )
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!isCompact && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer Info */}
        {!isCompact && (
          <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              TEMA · إدارة التعليم · مصر (EGP)
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:block shrink-0 transition-[width] duration-200 ease-out',
          collapsed ? 'w-20' : 'w-64'
        )}
      >
        <div className="sticky top-0 h-screen">{renderNavContent(false)}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full shadow-2xl">
            {renderNavContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
