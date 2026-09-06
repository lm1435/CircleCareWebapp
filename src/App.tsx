import { Suspense, useEffect, type ReactElement } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { getCurrentUser } from '@/api/users';
import { ToastProvider } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuthStore } from '@/store/authStore';
import { router } from '@/router';
import i18n from '@/i18n';

/**
 * Fallback for the single app-wide <Suspense> boundary below. It covers two
 * unrelated-but-compatible suspensions: (1) `src/router.tsx`'s authenticated
 * pages are `React.lazy` — their chunk needs a moment on first visit; (2)
 * `src/i18n/index.ts` loads the `es` locale on demand, so a component calling
 * `useTranslation` before that namespace resolves also suspends here (English
 * never does — it's bundled eagerly). Mirrors AuthGuard's bootstrapping
 * spinner so neither state reads as a different loading style.
 *
 * MUST NOT itself suspend: `Spinner` calls `useSuspense: false` for exactly
 * this reason (see its doc comment) — a `fallback` that suspends leaves
 * React with nothing to paint, i.e. a blank screen for the entire time the
 * `es` chunk (or a lazy page chunk) is in flight.
 */
function FullPageSpinner(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <Spinner size={32} />
    </main>
  );
}

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
        {/*
          <Suspense> is the OUTERMOST child of HelmetProvider — ABOVE
          QueryClientProvider/LanguageSync/ToastProvider, not just around
          <RouterProvider>. LanguageSync doesn't suspend itself, but
          ToastProvider (and anything else in this subtree) can call
          `useTranslation('common')`; if the es locale chunk (or a lazy page
          chunk) isn't ready yet and any of them sits ABOVE the boundary,
          React has nothing below it to keep painted and the WHOLE tree
          (including this boundary) unmounts to nothing — a blank page, not a
          spinner. Keeping everything that can suspend inside this single
          boundary is what makes the fallback actually show.
        */}
        <Suspense fallback={<FullPageSpinner />}>
          <QueryClientProvider client={queryClient}>
            <LanguageSync />
            <ToastProvider>
              {/*
                v7_startTransition: navigating to a not-yet-loaded lazy page
                marks the transition low-priority, so React keeps the CURRENT
                page's content painted (instead of dropping to this
                <Suspense>'s fallback and replacing the whole shell) until the
                next page's chunk arrives.
              */}
              <RouterProvider router={router} future={{ v7_startTransition: true }} />
            </ToastProvider>
          </QueryClientProvider>
        </Suspense>
      </HelmetProvider>
    </ErrorBoundary>
  );
}
