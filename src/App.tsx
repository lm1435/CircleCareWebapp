import { useEffect, type ReactElement } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUser } from '@/api/users';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuthStore } from '@/store/authStore';
import { router } from '@/router';
import i18n from '@/i18n';

/**
 * Applies the signed-in user's saved language preference to i18n. The detector
 * only knows the browser language (detection order is `['navigator']`, no
 * storage cache), so without this the UI ignores `users.language` and renders
 * in the browser locale / English fallback on every load — even when the
 * account is set to Spanish. Reuses the same `currentUser` query as ProfilePage
 * (shared cache, no extra request) so it also re-applies after a live profile
 * change, which invalidates that query. Mirrors useUpdateProfile, which only
 * calls changeLanguage at the moment the radio is toggled.
 */
function LanguageSync(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: user } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
  });

  const lang = user?.language;
  useEffect(() => {
    if (lang && lang !== i18n.language) {
      void i18n.changeLanguage(lang);
    }
  }, [lang]);

  return null;
}

export default function App(): ReactElement {
  // Boot-time silent cookie refresh (Task 9/10 decision: bootstrap is called
  // once at app level, not in AuthGuard). Single-flight inside the store, so
  // StrictMode's double effect invocation is harmless.
  useEffect(() => {
    void useAuthStore.getState().bootstrap();
  }, []);

  // Keep <html lang> in sync with the active i18n language (WCAG SC 3.1.1).
  // index.html hard-codes lang="en"; reflect the detected/selected language on
  // mount and whenever it changes so AT announces content in the right language.
  useEffect(() => {
    const applyLang = (lang: string): void => {
      document.documentElement.lang = lang;
    };
    applyLang(i18n.language);
    i18n.on('languageChanged', applyLang);
    return () => {
      i18n.off('languageChanged', applyLang);
    };
  }, []);

  return (
    // Root boundary (outside the Router) — last resort so a catastrophic render
    // error shows a friendly screen instead of a blank page. Route-level
    // boundaries inside the layouts keep the shell alive for ordinary page
    // errors; this only fires if one of those (or a provider) fails.
    <ErrorBoundary boundary="root">
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <LanguageSync />
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}
