import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';

export interface AuthGuardProps {
  children: ReactNode;
}

/**
 * Guards authenticated routes (Task 10).
 *
 * NOTE: the boot-time silent cookie refresh (`authStore.bootstrap()`) is kicked
 * off ONCE at app level in src/App.tsx — this guard only renders the resolution
 * states:
 * - while bootstrapping: centered spinner (no flash of the login page)
 * - unauthenticated: redirect to /login, preserving the intended location in
 *   router state so LoginPage can return the user after sign-in
 * - authenticated: children
 */
export function AuthGuard({ children }: AuthGuardProps): ReactElement {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner size={32} />
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
