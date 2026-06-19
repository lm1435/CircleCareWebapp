import { useAuthStore } from '@/store/authStore';
import type { AuthUser } from '@/store/authStore';

export interface UseAuthResult {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  signOut: () => Promise<void>;
}

/**
 * Thin selector wrapper over the auth store (Task 9).
 * Individual selectors keep re-renders minimal; no inline `?? []`/`?? {}`
 * fallbacks (Zustand selector reference rule).
 */
export function useAuth(): UseAuthResult {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const signOut = useAuthStore((state) => state.signOut);

  return { user, isAuthenticated, isBootstrapping, signOut };
}
