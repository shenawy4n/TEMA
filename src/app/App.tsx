import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';
import { AuthProvider } from './providers/AuthProvider';
import { TenantProvider } from './providers/TenantProvider';
import { AppRouter } from './router';

export function TemaApp() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <TenantProvider>
            <BrowserRouter>
              <AppRouter />
            </BrowserRouter>
          </TenantProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
