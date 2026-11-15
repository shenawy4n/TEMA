import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import { sendResetPassword } from '@/src/services/authService';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { EMAIL_PATTERN } from '@/src/lib/firebase/validation';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('يرجى إدخال بريد إلكتروني صحيح.');
      return;
    }

    setIsSubmitting(true);
    try {
      await sendResetPassword(email);
      setSent(true);
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="استعادة كلمة المرور"
      subtitle="أدخل بريدك الإلكتروني المسجل وسنرسل لك رابطاً لإعادة تعيين كلمة المرور."
    >
      {sent ? (
        <div className="text-center space-y-4 py-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              تم إرسال رابط الاستعادة
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              يرجى فحص صندوق الوارد (أو الرسائل غير المرغوب فيها) للبريد{' '}
              <span className="font-mono-tabular font-medium text-slate-900 dark:text-slate-200">
                {email}
              </span>{' '}
              واتباع التعليمات لتعيين كلمة مرور جديدة.
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <Link to="/login">
              <Button className="w-full">العودة إلى تسجيل الدخول</Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setSent(false)}>
              إرسال لبريد إلكتروني آخر
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <Input
            label="البريد الإلكتروني"
            type="email"
            dir="ltr"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Button
            type="submit"
            className="w-full"
            isLoading={isSubmitting}
            icon={<Mail className="h-4 w-4" />}
          >
            إرسال رابط إعادة التعيين
          </Button>

          <div className="text-center pt-2">
            <Link
              to="/login"
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              العودة إلى تسجيل الدخول
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
