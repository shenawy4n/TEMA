import { useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { PageHeader } from '@/src/components/layout/PageHeader';
import { Card } from '@/src/components/ui/Card';
import { Input } from '@/src/components/ui/Input';
import { Select } from '@/src/components/ui/Select';
import { Button } from '@/src/components/ui/Button';
import { useTenant } from '@/src/hooks/useTenant';
import { useTheme } from '@/src/hooks/useTheme';
import { useToast } from '@/src/hooks/useToast';
import { updateOrganizationSettings, updateUserPreferences } from '@/src/services/organizationService';
import { ACADEMIC_YEARS, EGYPT_CITIES } from '@/src/lib/constants/egypt';
import { ROLE_LABELS } from '@/src/lib/constants/roles';
import { getArabicErrorMessage } from '@/src/lib/firebase/errors';
import type { ThemePreference } from '@/src/types/domain';

export function SettingsPage() {
  const { organization, membership, userProfile, refreshTenant } = useTenant();
  const { preference, setThemePreference } = useTheme();
  const { showToast } = useToast();

  const isOwner = membership?.role === 'owner';

  const [orgName, setOrgName] = useState(organization?.name || '');
  const [ownerName, setOwnerName] = useState(organization?.ownerName || '');
  const [phone, setPhone] = useState(organization?.phone || '');
  const [email, setEmail] = useState(organization?.email || '');
  const [city, setCity] = useState(organization?.city || EGYPT_CITIES[0]);
  const [address, setAddress] = useState(organization?.address || '');
  const [academicYear, setAcademicYear] = useState(organization?.academicYear || ACADEMIC_YEARS[0]);
  const [savingOrg, setSavingOrg] = useState(false);

  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [userPhone, setUserPhone] = useState(userProfile?.phone || '');
  const [savingUser, setSavingUser] = useState(false);

  const handleSaveOrg = async (e: FormEvent) => {
    e.preventDefault();
    if (!organization || !membership || !isOwner || savingOrg) return;
    setSavingOrg(true);
    try {
      await updateOrganizationSettings(
        organization.id,
        {
          name: orgName,
          ownerName,
          phone,
          email,
          city,
          address,
          themePreference: preference,
          academicYear,
        },
        {
          uid: membership.uid,
          displayName: membership.displayName,
          role: membership.role,
        }
      );
      await refreshTenant();
      showToast({ type: 'success', title: 'تم حفظ إعدادات المنظمة' });
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر الحفظ', message: getArabicErrorMessage(err) });
    } finally {
      setSavingOrg(false);
    }
  };

  const handleSaveUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!userProfile || savingUser) return;
    setSavingUser(true);
    try {
      await updateUserPreferences(userProfile.uid, {
        displayName,
        phone: userPhone,
        themePreference: preference,
      });
      await refreshTenant();
      showToast({ type: 'success', title: 'تم تحديث تفضيلات الحساب' });
    } catch (err) {
      showToast({ type: 'error', title: 'تعذر التحديث', message: getArabicErrorMessage(err) });
    } finally {
      setSavingUser(false);
    }
  };

  return (
    <AppShell
      pageTitle="الإعدادات"
      breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'الإعدادات' }]}
    >
      <div className="space-y-6">
        <PageHeader
          title="إعدادات المنظمة والحساب"
          description="تخصيص بيانات المنظمة التعليمية، العام الدراسي، المظهر العام، وبيانات الحساب الشخصي."
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Organization Profile */}
          <Card>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
              ملف المنظمة التعليمية
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
              {isOwner
                ? 'يمكنك تعديل بيانات المنظمة والعام الدراسي من هنا.'
                : 'تعديل إعدادات المنظمة متاح لمالك المنظمة فقط.'}
            </p>

            <form onSubmit={handleSaveOrg} className="space-y-4">
              <Input
                label="اسم المنظمة"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                disabled={!isOwner}
                required
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="اسم المالك"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  disabled={!isOwner}
                  required
                />
                <Input
                  label="هاتف المنظمة"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={!isOwner}
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="المدينة"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={!isOwner}
                >
                  {EGYPT_CITIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Select
                  label="العام الدراسي"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  disabled={!isOwner}
                >
                  {ACADEMIC_YEARS.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                label="العنوان"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={!isOwner}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="العملة" value="الجنيه المصري (EGP)" disabled />
                <Input label="اللغة" value="العربية (RTL)" disabled />
              </div>

              {isOwner && (
                <div className="pt-2">
                  <Button type="submit" isLoading={savingOrg} icon={<Save className="h-4 w-4" />}>
                    حفظ إعدادات المنظمة
                  </Button>
                </div>
              )}
            </form>
          </Card>

          {/* User Preferences & Theme */}
          <Card>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
              الحساب وتفضيلات المظهر
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
              دورك في المنظمة: {membership ? ROLE_LABELS[membership.role] : '—'}
            </p>

            <form onSubmit={handleSaveUser} className="space-y-4">
              <Input
                label="الاسم الظاهر"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
              <Input label="البريد الإلكتروني" value={userProfile?.email || ''} dir="ltr" disabled />
              <Input
                label="رقم الهاتف الشخصي"
                dir="ltr"
                value={userPhone}
                onChange={(e) => setUserPhone(e.target.value)}
              />
              <Select
                label="مظهر الواجهة (Theme)"
                value={preference}
                onChange={(e) => setThemePreference(e.target.value as ThemePreference)}
              >
                <option value="light">الوضع الفاتح (Light)</option>
                <option value="dark">الوضع الداكن (Dark)</option>
                <option value="system">حسب إعدادات النظام</option>
              </Select>

              <div className="pt-2">
                <Button type="submit" isLoading={savingUser} icon={<Save className="h-4 w-4" />}>
                  حفظ تفضيلات الحساب
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
