import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, MailCheck, RefreshCw, LogOut } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { useAuth } from '@/src/hooks/useAuth';
import { useTenant } from '@/src/hooks/useTenant';
import { useToast } from '@/src/hooks/useToast';
import { logoutUser, resendVerification } from '@/src/services/authService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';

export function VerifyEmailPage() {
  const { user, reloadUser } = useAuth();
  const { refreshTenant } = useTenant();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  const handleCheckVerified = async () => {
    setChecking(true);
    try {
      const verified = await reloadUser();
      await refreshTenant();
      if (verified) {
        showToast({ type: 'success', title: 'تم تفعيل البريد الإلكتروني بنجاح' });
        navigate('/onboarding');
      } else {
        showToast({
          type: 'warning',
          title: 'لم يتم التفعيل بعد',
          message: 'يرجى الضغط على رابط التفعيل المرسل لبريدك أولاً.',
        });
      }
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر التحقق', message: getArabicErrorMessage(err) });
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (!user) return;
    setResending(true);
    try {
      await resendVerification(user);
      showToast({
        type: 'success',
        title: 'تم إعادة إرسال الرابط',
        message: `تحقق من بريدك: ${user.email}`,
      });
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر الإرسال', message: getArabicErrorMessage(err) });
    } finally {
      setResending(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  return (
    <AuthLayout
      title="تفعيل البريد الإلكتروني"
      subtitle="لحماية بيانات منظمتك وطلابك، تتطلب قواعد الأمان تفعيل البريد الإلكتروني قبل الوصول."
    >
      <div className="text-center space-y-5">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400">
          <MailCheck className="h-6 w-6" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            تم إرسال رابط التفعيل إلى:
          </p>
          <p className="text-sm font-mono-tabular text-blue-700 dark:text-blue-400">
            {user?.email || '—'}
          </p>
        </div>

        <div className="space-y-2.5 pt-2">
          <Button
            className="w-full"
            onClick={handleCheckVerified}
            isLoading={checking}
            icon={<CheckCircle2 className="h-4 w-4" />}
          >
            قمت بتفعيل البريد، متابعة
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleResend}
            isLoading={resending}
            icon={<RefreshCw className="h-4 w-4" />}
          >
            إعادة إرسال رابط التفعيل
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={handleLogout}
            icon={<LogOut className="h-4 w-4" />}
          >
            تسجيل الخروج واستخدام حساب آخر
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
