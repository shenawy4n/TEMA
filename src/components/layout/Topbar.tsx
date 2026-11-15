import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  User as UserIcon,
} from 'lucide-react';
import { useTheme } from '@/src/hooks/useTheme';
import { useAuth } from '@/src/hooks/useAuth';
import { useTenant } from '@/src/hooks/useTenant';
import { logoutUser } from '@/src/services/authService';
import { SIDEBAR_NAVIGATION } from '@/src/lib/constants/navigation';
import { ROLE_LABELS } from '@/src/lib/constants/roles';
import { cn } from '@/src/lib/utils/cn';

interface TopbarProps {
  pageTitle: string;
  breadcrumbs: Array<{ label: string; to?: string }>;
  onOpenMobileMenu: () => void;
}

export function Topbar({ pageTitle, breadcrumbs, onOpenMobileMenu }: TopbarProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { userProfile, organization, membership } = useTenant();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
      if (searchRef.current && !searchRef.current.contains(target)) setSearchFocused(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchResults = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const role = membership?.role ?? 'owner';
    const items = SIDEBAR_NAVIGATION.filter((item) => item.allowedRoles.includes(role));
    if (!term) return [];
    return items.filter((item) => item.label.toLowerCase().includes(term) || item.path.includes(term));
  }, [searchTerm, membership?.role]);

  const handleLogout = async () => {
    setProfileOpen(false);
    await logoutUser();
    navigate('/login');
  };

  const displayName = userProfile?.displayName || user?.displayName || 'مستخدم TEMA';
  const roleLabel = membership ? ROLE_LABELS[membership.role] : 'عضو';

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-4 sm:px-6 flex items-center justify-between gap-4">
      {/* Right Zone (Start in RTL): Mobile Menu + Page Title & Breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="فتح القائمة الجانبية"
          className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer shrink-0"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0">
          <nav aria-label="مسار التنقل" className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            {breadcrumbs.map((crumb, idx) => (
              <span key={crumb.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {idx > 0 && <span aria-hidden="true">/</span>}
                {crumb.to ? (
                  <Link
                    to={crumb.to}
                    className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-slate-700 dark:text-slate-300 font-medium">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
          <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
            {pageTitle}
          </h1>
        </div>
      </div>

      {/* Left Zone (End in RTL): Global Search + Notifications + Theme + Profile */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Global Quick Search */}
        <div ref={searchRef} className="relative hidden md:block w-60 lg:w-72">
          <Search className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={searchTerm}
            onFocus={() => setSearchFocused(true)}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="انتقال سريع إلى قسم..."
            aria-label="البحث السريع في النظام"
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 pr-9 pl-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:bg-white dark:focus:bg-slate-900 transition-colors"
          />
          {searchFocused && searchTerm.trim().length > 0 && (
            <div className="absolute left-0 right-0 top-11 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1.5 z-40">
              {searchResults.length > 0 ? (
                searchResults.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        navigate(item.path);
                        setSearchTerm('');
                        setSearchFocused(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-right cursor-pointer"
                    >
                      <Icon className="h-4 w-4 text-slate-500" />
                      <span>{item.label}</span>
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  لا توجد نتائج مطابقة في القائمة.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={resolvedTheme === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
          title={resolvedTheme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Notifications Button */}
        <div ref={notifRef} className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen((prev) => !prev)}
            aria-label="الإشعارات"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Bell className="h-4 w-4" />
          </button>

          {notifOpen && (
            <div className="absolute left-0 top-11 w-80 max-w-[90vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4 z-40">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">التنبيهات</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {organization?.name || 'المنظمة'}
                </span>
              </div>
              <div className="py-6 text-center">
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  لا توجد تنبيهات جديدة غير مقروءة حالياً. ستظهر تنبيهات الحصص والمستحقات المالية هنا تلقائياً.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div ref={profileRef} className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((prev) => !prev)}
            className={cn(
              'inline-flex items-center gap-2 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer'
            )}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0F2942] dark:bg-blue-600 text-white text-xs font-bold shrink-0">
              {displayName.charAt(0)}
            </div>
            <div className="hidden sm:flex flex-col items-start text-right leading-tight max-w-[120px]">
              <span className="text-xs font-semibold text-slate-900 dark:text-white truncate w-full">
                {displayName}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate w-full">
                {roleLabel}
              </span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          </button>

          {profileOpen && (
            <div className="absolute left-0 top-11 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl py-2 z-40">
              <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {displayName}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {user?.email}
                </p>
                <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-1 font-medium">
                  {roleLabel} · {organization?.name}
                </p>
              </div>
              <div className="py-1">
                <Link
                  to="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Settings className="h-4 w-4 text-slate-500" />
                  <span>إعدادات المنظمة والحساب</span>
                </Link>
                <Link
                  to="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <UserIcon className="h-4 w-4 text-slate-500" />
                  <span>الملف الشخصي</span>
                </Link>
              </div>
              <div className="border-t border-slate-200 dark:border-slate-800 pt-1">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
