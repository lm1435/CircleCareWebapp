/**
 * Reviewer-reported Critical (W6b follow-up).
 *
 * `src/App.tsx`'s single `<Suspense>` uses `FullPageSpinner` (which renders
 * `@/components/ui/Spinner`) as its `fallback`. `Spinner` used to call
 * `useTranslation('common')` with react-i18next's default `useSuspense: true`
 * — so on a Spanish-detected session whose `es` locale chunk (see
 * `src/i18n/index.ts`'s `esBackend`) hadn't landed yet, the FALLBACK ITSELF
 * suspended. React has nothing to fall back to when that happens: the result
 * was a blank white page for the entire time the chunk was in flight, not a
 * spinner.
 *
 * This builds an ISOLATED i18next + react-i18next instance — never the app's
 * shared `@/i18n` singleton, and via `I18nextProvider`, never global module
 * state either — wired to a backend whose `read()` NEVER calls its callback.
 * That's the `MODE=production` shape of `src/i18n/index.ts` (a real,
 * possibly-slow-or-stuck backend, no bundled resources) without needing to
 * fight that module's own `import.meta.env.MODE === 'test'` escape hatch,
 * which always wins inside vitest and would hide this exact bug.
 *
 * A sibling component in the SAME suspense boundary deliberately suspends
 * forever on that instance (default `useSuspense: true`) so the assertion is
 * meaningful: if `Spinner`'s fallback rendering worked only because nothing
 * ever asked it to suspend, this would pass vacuously.
 */
import { describe, expect, it } from 'vitest';
import { Suspense, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import type { BackendModule, ReadCallback } from 'i18next';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/Spinner';

// A locale chunk that never arrives: read() simply never invokes `callback`.
const neverResolvesBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read: (_language: string, _namespace: string, _callback: ReadCallback) => {
    // Deliberately empty — the promise/suspense this drives never settles.
  },
};

function buildStuckI18n() {
  const instance = createInstance();
  void instance
    .use(neverResolvesBackend)
    .use(initReactI18next)
    .init({
      lng: 'es',
      fallbackLng: false, // no fallback resources either — nothing ever resolves
      ns: ['common'],
      defaultNS: 'common',
      resources: {}, // nothing bundled — matches a real (non-test) session
      partialBundledLanguages: true,
      react: { useSuspense: true },
    });
  return instance;
}

/** Suspends forever on this instance — stands in for a real lazy page/ToastProvider. */
function StuckOnTranslation(): ReactElement {
  const { t } = useTranslation('common');
  return <p>{t('loading')}</p>;
}

describe('Spinner as a Suspense fallback (App.tsx FullPageSpinner)', () => {
  it('paints non-empty, accessible markup even while its sibling suspends on a namespace that never resolves', () => {
    const stuckI18n = buildStuckI18n();

    // No `label` prop: Spinner MUST call its own `t('loading')` against the
    // stuck instance for its aria-label, exercising the exact `useSuspense:
    // false` path this test is guarding. Passing an explicit label would let
    // Spinner skip that call entirely (`label ?? t('loading')`) and pass
    // vacuously even with the old, buggy `useSuspense: true` default.
    render(
      <I18nextProvider i18n={stuckI18n}>
        <Suspense fallback={<Spinner size={32} />}>
          <StuckOnTranslation />
        </Suspense>
      </I18nextProvider>
    );

    // The primary child can never commit — only the fallback should ever be
    // in the document, and it must be real, non-empty markup (not a blank
    // boundary), i.e. exactly the bug the reviewer reproduced.
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status.innerHTML.trim()).not.toBe('');
    expect(status.getAttribute('aria-label')?.length).toBeGreaterThan(0);

    // The suspended sibling never got to render its own content.
    expect(screen.queryByText('loading')).not.toBeInTheDocument();
  });
});
