import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, RefreshCw, ShieldBan, UserX } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { useAuth } from '@/src/hooks/useAuth';
import { useToast } from '@/src/hooks/useToast';
import { logoutUser } from '@/src/services/authService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import type { TenantBlockReason } from '@/src/types/domain';

interface SuspendedOrganizationPageProps {
  reason: Exclude<TenantBlockReason, null>;
  onRefresh: () => Promise<void>;
}

export function SuspendedOrganizationPage({ reason, onRefresh }: SuspendedOrganizationPageProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const isOrgSuspended = reason === 'organization_suspended';

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch (err) {
      showToast({
        type: 'error',
        title: 'تعذر التحقق من الحالة',
        message: getArabicErrorMessage(err),
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutUser();
      navigate('/login');
    } catch (err) {
      showToast({
        type: 'error',
        title: 'تعذر تسجيل الخروج',
        message: getArabicErrorMessage(err),
      });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <AuthLayout
      title={isOrgSuspended ? 'تم تعليق الوصول إلى المنظمة' : 'تم إيقاف عضويتك داخل المنظمة'}
      subtitle={
        isOrgSuspended
          ? 'حساب المنظمة موقوف حالياً ولا يمكن قراءة بيانات الطلاب أو الحصص أو المعاملات المالية.'
          : 'عضويتك الحالية ليست في حالة نشطة، لذلك تم تقييد الوصول إلى مساحة العمل لحين تفعيلها.'
      }
    >
      <div className="text-center space-y-5" data-testid="suspended-tenant-state">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400">
          {isOrgSuspended ? <ShieldBan className="h-6 w-6" /> : <UserX className="h-6 w-6" />}
        </div>

        <div className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {isOrgSuspended
              ? 'يرجى التواصل مع إدارة المنصة أو الدعم الفني لإعادة تفعيل حالة المنظمة قبل استئناف العمل.'
              : 'يرجى التواصل مع مالك المنظمة لمراجعة حالة عضويتك وإعادة تفعيل صلاحية الدخول.'}
          </p>
          {user?.email ? (
            <p className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
              {user.email}
            </p>
          ) : null}
        </div>

        <div className="space-y-2.5 pt-2">
          <Button
            className="w-full"
            onClick={handleRefresh}
            isLoading={refreshing}
            icon={<RefreshCw className="h-4 w-4" />}
          >
            إعادة التحقق من الحالة
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={handleLogout}
            isLoading={loggingOut}
            icon={<LogOut className="h-4 w-4" />}
          >
            تسجيل الخروج واستخدام حساب آخر
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
