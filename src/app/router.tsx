import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/src/hooks/useAuth';
import { useTenant } from '@/src/hooks/useTenant';
import { LoadingState } from '@/src/components/ui/LoadingState';
import { ErrorState } from '@/src/components/ui/ErrorState';
import { AppShell } from '@/src/components/layout/AppShell';
import { LoginPage } from '@/src/features/auth/LoginPage';
import { RegisterPage } from '@/src/features/auth/RegisterPage';
import { ForgotPasswordPage } from '@/src/features/auth/ForgotPasswordPage';
import { VerifyEmailPage } from '@/src/features/auth/VerifyEmailPage';
import { UnauthorizedPage } from '@/src/features/auth/UnauthorizedPage';
import { OnboardingWizardPage } from '@/src/features/onboarding/OnboardingWizardPage';
import { DashboardPage } from '@/src/features/dashboard/DashboardPage';
import { StudentsPage } from '@/src/features/students/StudentsPage';
import { StudentProfilePage } from '@/src/features/students/StudentProfilePage';
import { GroupsPage } from '@/src/features/groups/GroupsPage';
import { SessionsPage } from '@/src/features/sessions/SessionsPage';
import { AttendancePage } from '@/src/features/attendance/AttendancePage';
import { FinancePage } from '@/src/features/finance/FinancePage';
import { StaffPage } from '@/src/features/staff/StaffPage';
import { ReportsPage } from '@/src/features/reports/ReportsPage';
import { SettingsPage } from '@/src/features/settings/SettingsPage';
import type { MemberRole } from '@/src/types/domain';
import type { ReactNode } from 'react';

function FullScreenLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <LoadingState label="جاري التحقق من الجلسة وبيانات المنظمة..." />
    </div>
  );
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, isAuthReady } = useAuth();
  const { organization, membership, isLoading } = useTenant();

  if (!isAuthReady || (user && isLoading)) return <FullScreenLoading />;
  if (user) {
    if (!user.emailVerified) return <Navigate to="/verify-email" replace />;
    if (organization && membership) return <Navigate to="/dashboard" replace />;
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function VerifyEmailRoute() {
  const { user, isAuthReady } = useAuth();
  if (!isAuthReady) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified) return <Navigate to="/onboarding" replace />;
  return <VerifyEmailPage />;
}

function OnboardingRoute() {
  const { user, isAuthReady } = useAuth();
  const { organization, membership, isLoading } = useTenant();

  if (!isAuthReady || isLoading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verify-email" replace />;
  if (organization && membership) return <Navigate to="/dashboard" replace />;
  return <OnboardingWizardPage />;
}

function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles?: MemberRole[];
}) {
  const { user, isAuthReady } = useAuth();
  const { organization, membership, isLoading, error, refreshTenant } = useTenant();

  if (!isAuthReady || isLoading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verify-email" replace />;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full">
          <ErrorState message={error} onRetry={refreshTenant} />
        </div>
      </div>
    );
  }

  if (!organization || !membership) {
    return <Navigate to="/onboarding" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    return (
      <AppShell
        pageTitle="غير مصرح بالوصول"
        breadcrumbs={[{ label: 'الرئيسية', to: '/dashboard' }, { label: 'غير مصرح' }]}
      >
        <UnauthorizedPage />
      </AppShell>
    );
  }

  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnlyRoute>
            <ForgotPasswordPage />
          </PublicOnlyRoute>
        }
      />
      <Route path="/verify-email" element={<VerifyEmailRoute />} />
      <Route path="/onboarding" element={<OnboardingRoute />} />

      {/* Protected Tenant Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/students"
        element={
          <ProtectedRoute>
            <StudentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/students/:studentId"
        element={
          <ProtectedRoute>
            <StudentProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/groups"
        element={
          <ProtectedRoute allowedRoles={['owner', 'teacher', 'assistant']}>
            <GroupsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sessions"
        element={
          <ProtectedRoute allowedRoles={['owner', 'teacher', 'assistant']}>
            <SessionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/attendance"
        element={
          <ProtectedRoute allowedRoles={['owner', 'teacher', 'assistant']}>
            <AttendancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance"
        element={
          <ProtectedRoute allowedRoles={['owner', 'accountant', 'assistant']}>
            <FinancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/staff"
        element={
          <ProtectedRoute allowedRoles={['owner']}>
            <StaffPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute allowedRoles={['owner', 'accountant', 'teacher']}>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/unauthorized"
        element={
          <ProtectedRoute>
            <UnauthorizedPage />
          </ProtectedRoute>
        }
      />

      {/* Default & Fallback */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
