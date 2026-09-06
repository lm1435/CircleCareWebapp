import { useNavigate } from 'react-router-dom';

export interface UseAuthBackResult {
  /** False only when there is no fallback AND no prior in-app history — the
   * caller should hide its back control entirely rather than render a dead
   * (or site-exiting) button. */
  canGoBack: boolean;
  /** Mirrors StandalonePageLayout's `handleBack` guard: history(-1) when there
   * is somewhere to go back to, otherwise the fallback route (if any). */
  goBack: () => void;
}

/**
 * Shared back-navigation guard for the signed-out auth screens.
 *
 * AuthGuard redirects unauthenticated visitors to /login with `replace`, so
 * /login can be the ONLY entry in `window.history` (e.g. a fresh tab, or a
 * bounced deep link). A bare `navigate(-1)` in that state is either a no-op
 * or — worse — pops the user off the site entirely. This hook mirrors
 * StandalonePageLayout's `handleBack`: go back through history when there is
 * history to go back through, otherwise land on `fallback` (when given).
 *
 * Pages with a sensible fallback (SignUp/Forgot/Reset/Verify → '/login')
 * always have somewhere to go, so `canGoBack` is always true for them and
 * their back button always renders. LoginPage is the root of the signed-out
 * flow and renders no back control at all, so it does not use this hook.
 */
export function useAuthBack(fallback?: string): UseAuthBackResult {
  const navigate = useNavigate();

  const canGoBack = window.history.length > 1 || Boolean(fallback);

  const goBack = (): void => {
    if (window.history.length <= 1) {
      if (fallback) navigate(fallback);
      return;
    }
    navigate(-1);
  };

  return { canGoBack, goBack };
}
