import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, UserPlus } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { loginWithGoogle, registerWithEmail } from '@/src/services/authService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { EMAIL_PATTERN } from '@/src/lib/firebase/validation';
import { useToast } from '@/src/hooks/useToast';

export function RegisterPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (displayName.trim().length < 2) {
      setError('يرجى إدخال الاسم الكامل (حرفان على الأقل).');
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('يرجى إدخال بريد إلكتروني صحيح.');
      return;
    }
    if (password.length < 6) {
      setError('يجب أن تتكون كلمة المرور من 6 أحرف على الأقل.');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setIsSubmitting(true);
    try {
      await registerWithEmail(displayName, email, password);
      showToast({
        type: 'success',
        title: 'تم إنشاء الحساب',
        message: 'تم إرسال رابط التفعيل إلى بريدك الإلكتروني.',
      });
      navigate('/verify-email');
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleRegister = async () => {
    setError(null);
    setIsGoogleLoading(true);
    try {
      await loginWithGoogle();
      showToast({ type: 'success', title: 'تم إنشاء الحساب بنجاح' });
      navigate('/onboarding');
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <AuthLayout
      title="إنشاء حساب جديد في TEMA"
      subtitle="ابدأ بتأسيس منظمتك التعليمية في خطوات واضحة ومنظمة."
    >
      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300 leading-relaxed"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={handleGoogleRegister}
        isLoading={isGoogleLoading}
        disabled={isSubmitting}
      >
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
          />
        </svg>
        <span>التسجيل السريع بحساب Google</span>
      </Button>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-slate-800" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white dark:bg-slate-900 px-3 text-slate-500 dark:text-slate-400">
            أو التسجيل بالبريد الإلكتروني
          </span>
        </div>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        <Input
          label="الاسم الكامل"
          type="text"
          placeholder="مثال: أ. أحمد محمود"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />

        <Input
          label="البريد الإلكتروني"
          type="email"
          dir="ltr"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <Input
          label="كلمة المرور"
          type="password"
          dir="ltr"
          placeholder="6 أحرف على الأقل"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        <Input
          label="تأكيد كلمة المرور"
          type="password"
          dir="ltr"
          placeholder="أعد إدخال كلمة المرور"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />

        <Button
          type="submit"
          className="w-full"
          isLoading={isSubmitting}
          disabled={isGoogleLoading}
          icon={<UserPlus className="h-4 w-4" />}
        >
          إنشاء الحساب
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-600 dark:text-slate-400">
        لديك حساب بالفعل؟{' '}
        <Link to="/login" className="font-semibold text-blue-700 dark:text-blue-400 hover:underline">
          تسجيل الدخول
        </Link>
      </p>
    </AuthLayout>
  );
}
