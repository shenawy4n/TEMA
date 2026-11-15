import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  GraduationCap,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  LogOut,
  AlertCircle,
} from 'lucide-react';
import { BrandWordmark } from '@/src/components/ui/BrandWordmark';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Select } from '@/src/components/ui/Select';
import { useAuth } from '@/src/hooks/useAuth';
import { useTenant } from '@/src/hooks/useTenant';
import { useTheme } from '@/src/hooks/useTheme';
import { useToast } from '@/src/hooks/useToast';
import { createOrganizationAtomic } from '@/src/services/organizationService';
import { logoutUser } from '@/src/services/authService';
import { ACADEMIC_YEARS, EGYPT_CITIES } from '@/src/lib/constants/egypt';
import { EMAIL_PATTERN, EGYPT_PHONE_PATTERN } from '@/src/lib/firebase/validation';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import { generateId } from '@/src/lib/utils/format';
import { cn } from '@/src/lib/utils/cn';
import type { OrganizationType, ThemePreference } from '@/src/types/domain';

type WizardStep = 1 | 2 | 3 | 4;

export function OnboardingWizardPage() {
  const { user } = useAuth();
  const { userProfile, refreshTenant } = useTenant();
  const { preference, setThemePreference } = useTheme();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Stable idempotency key per wizard session prevents duplicate orgs on retries
  const idempotencyKey = useMemo(() => generateId('org'), []);

  const [step, setStep] = useState<WizardStep>(1);
  const [orgType, setOrgType] = useState<OrganizationType>('independent_teacher');
  const [orgName, setOrgName] = useState('');
  const [ownerName, setOwnerName] = useState(userProfile?.displayName || user?.displayName || '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [city, setCity] = useState(EGYPT_CITIES[0]);
  const [address, setAddress] = useState('');
  const [themePref, setThemePref] = useState<ThemePreference>(preference);
  const [academicYear, setAcademicYear] = useState(ACADEMIC_YEARS[0]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateStep2 = (): boolean => {
    if (orgName.trim().length < 2) {
      setError('يرجى إدخال اسم المنظمة أو اسم المدرس (حرفان على الأقل).');
      return false;
    }
    if (ownerName.trim().length < 2) {
      setError('يرجى إدخال اسم المالك.');
      return false;
    }
    if (!EGYPT_PHONE_PATTERN.test(phone.trim())) {
      setError('يرجى إدخال رقم هاتف صحيح (مثال: 01012345678).');
      return false;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('يرجى إدخال بريد إلكتروني صحيح.');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    setError(null);
    if (step === 2 && !validateStep2()) return;
    if (step < 4) setStep((prev) => (prev + 1) as WizardStep);
  };

  const handleBack = () => {
    setError(null);
    if (step > 1) setStep((prev) => (prev - 1) as WizardStep);
  };

  const handleCreateOrganization = async () => {
    if (!user || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      await createOrganizationAtomic(
        user.uid,
        user.email || email,
        userProfile?.organizationIds || [],
        {
          idempotencyKey,
          name: orgName,
          type: orgType,
          ownerName,
          phone,
          email,
          city,
          address,
          themePreference: themePref,
          academicYear,
        }
      );
      setThemePreference(themePref);
      await refreshTenant();
      showToast({
        type: 'success',
        title: 'تم تأسيس المنظمة بنجاح',
        message: 'مرحباً بك في لوحة تحكم TEMA.',
      });
      navigate('/dashboard');
    } catch (err) {
      setError(getArabicErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const stepsMeta = [
    { id: 1, title: 'نوع المنظمة' },
    { id: 2, title: 'بيانات المنظمة' },
    { id: 3, title: 'الإعدادات الأساسية' },
    { id: 4, title: 'المراجعة والإنشاء' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="h-16 px-4 sm:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between">
        <BrandWordmark />
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await logoutUser();
            navigate('/login');
          }}
          icon={<LogOut className="h-4 w-4" />}
        >
          تسجيل الخروج
        </Button>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            إعداد المنظمة التعليمية
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            أكمل الخطوات التالية لتخصيص بيئة عملك المعزولة في TEMA.
          </p>
        </div>

        {/* Stepper */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
          {stepsMeta.map((s) => {
            const isActive = step === s.id;
            const isDone = step > s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  'rounded-lg border px-3 py-2.5 flex items-center gap-2 text-xs font-medium transition-colors',
                  isActive
                    ? 'border-[#0F2942] bg-[#0F2942] text-white dark:border-blue-600 dark:bg-blue-600'
                    : isDone
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                )}
              >
                <span className="font-mono-tabular font-semibold">{s.id}.</span>
                <span className="truncate">{s.title}</span>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8">
          {error && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                اختر نوع المنظمة
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                يحدد هذا الاختيار هيكل الصلاحيات وإعدادات التشغيل الافتراضية.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setOrgType('independent_teacher')}
                  className={cn(
                    'rounded-xl border p-5 text-right transition-colors cursor-pointer flex flex-col gap-3',
                    orgType === 'independent_teacher'
                      ? 'border-[#0F2942] bg-blue-50/40 dark:border-blue-500 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0F2942] dark:bg-blue-600 text-white">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      مدرس مستقل
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      للمدرسين الذين يديرون مجموعاتهم وطلابهم ومساعديهم بشكل مستقل.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setOrgType('educational_center')}
                  className={cn(
                    'rounded-xl border p-5 text-right transition-colors cursor-pointer flex flex-col gap-3',
                    orgType === 'educational_center'
                      ? 'border-[#0F2942] bg-blue-50/40 dark:border-blue-500 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      سنتر تعليمي
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      للمراكز التعليمية التي تضم عدة مدرسين ومساعدين ومحاسبين وقاعات دراسية.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                بيانات المنظمة والتواصل
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <Input
                  label={orgType === 'independent_teacher' ? 'اسم الأكاديمية أو المدرس' : 'اسم السنتر التعليمي'}
                  placeholder={orgType === 'independent_teacher' ? 'مثال: أكاديمية أ. محمد علي للرياضيات' : 'مثال: سنتر النخبة التعليمي'}
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                />
                <Input
                  label="اسم المالك المسؤول"
                  placeholder="الاسم الكامل"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  required
                />
                <Input
                  label="رقم الهاتف"
                  type="tel"
                  dir="ltr"
                  placeholder="01012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
                <Input
                  label="البريد الإلكتروني للمنظمة"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Select
                  label="المحافظة / المدينة"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                >
                  {EGYPT_CITIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Input
                  label="العنوان التفصيلي (اختياري)"
                  placeholder="الحي، الشارع، رقم المبنى"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                الإعدادات الأساسية
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <Input label="العملة الافتراضية" value="الجنيه المصري (EGP)" disabled />
                <Input label="لغة الواجهة الافتراضية" value="العربية (RTL)" disabled />
                <Select
                  label="تفضيل المظهر"
                  value={themePref}
                  onChange={(e) => {
                    const next = e.target.value as ThemePreference;
                    setThemePref(next);
                    setThemePreference(next);
                  }}
                >
                  <option value="light">الوضع الفاتح</option>
                  <option value="dark">الوضع الداكن</option>
                  <option value="system">حسب إعدادات الجهاز</option>
                </Select>
                <Select
                  label="العام الدراسي"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                >
                  {ACADEMIC_YEARS.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  مراجعة البيانات قبل الإنشاء
                </h2>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">نوع المنظمة</dt>
                  <dd className="font-medium mt-0.5">
                    {orgType === 'independent_teacher' ? 'مدرس مستقل' : 'سنتر تعليمي'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">اسم المنظمة</dt>
                  <dd className="font-medium mt-0.5">{orgName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">اسم المالك</dt>
                  <dd className="font-medium mt-0.5">{ownerName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">الهاتف</dt>
                  <dd className="font-medium font-mono-tabular mt-0.5" dir="ltr">
                    {phone}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">المدينة</dt>
                  <dd className="font-medium mt-0.5">{city}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">العام الدراسي والعملة</dt>
                  <dd className="font-medium mt-0.5">
                    {academicYear} · EGP
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Footer Navigation */}
          <div className="mt-8 pt-5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            {step > 1 ? (
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isSubmitting}
                icon={<ArrowRight className="h-4 w-4" />}
              >
                السابق
              </Button>
            ) : (
              <div />
            )}

            {step < 4 ? (
              <Button onClick={handleNext} icon={<ArrowLeft className="h-4 w-4" />}>
                التالي
              </Button>
            ) : (
              <Button
                onClick={handleCreateOrganization}
                isLoading={isSubmitting}
                icon={<CheckCircle2 className="h-4 w-4" />}
              >
                تأسيس المنظمة والدخول
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
