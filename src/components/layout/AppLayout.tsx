import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { AppDownloadBanner } from './AppDownloadBanner';
import { NeedsCircleSelectionBanner } from '@/components/NeedsCircleSelectionBanner';
import { AIChatModal } from '@/components/ai/AIChatModal';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function CloseIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Authenticated layout shell (plan Task 13): download banner + header on top,
 * sidebar left, page content in <main>. Below xl the sidebar becomes a
 * focus-trapped hamburger drawer (Escape closes, body scroll locked).
 * No UI state is persisted to storage.
 */
export function AppLayout(): ReactElement {
  const { t } = useTranslation('common');
  const { circleId } = useParams<{ circleId: string }>();
  const [navOpen, setNavOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  // Close the drawer on any navigation.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Drawer behavior: focus trap, Escape to close, body scroll lock,
  // focus restored to the trigger on close.
  useEffect(() => {
    if (!navOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const getFocusables = (): HTMLElement[] =>
      Array.from(drawer?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    getFocusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = getFocusables();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !drawer?.contains(active)) {
          event.preventDefault();
          last?.focus();
        }
      } else if (active === last || !drawer?.contains(active)) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [navOpen]);

  return (
    <div className="grid min-h-screen grid-rows-[auto_auto_1fr] overflow-x-hidden bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-cream focus:px-5 focus:py-3 focus:text-sm focus:text-ink focus:shadow-lg"
      >
        {t('skipToContent')}
      </a>

      <AppDownloadBanner />

      <Header navOpen={navOpen} onToggleNav={() => setNavOpen((open) => !open)} />

      {/* grid-cols-1 (minmax(0,1fr)) is required on mobile: without an explicit
          column the implicit `auto` track grows to the content's max-content
          width, so a wide child like the calendar makes <main> balloon past the
          viewport and the whole page scrolls sideways. The 0-min column clamps
          <main> to the viewport so wide content scrolls inside its own card. */}
      <div className="grid grid-cols-1 xl:grid-cols-[16rem_1fr]">
        <Sidebar variant="desktop" onOpenAssistant={() => setAiOpen(true)} />
        <main id="main" className="min-w-0">
          <NeedsCircleSelectionBanner />
          {/* Page-level boundary: a single page's render error shows the fallback
              inside <main> while the header + sidebar stay usable. Keyed by path
              so navigating to another route auto-clears a caught error. */}
          <ErrorBoundary boundary="circle-page" key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <div
            aria-hidden="true"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-ink/40 animate-[fade-in_240ms_ease-out]"
          />
          <div
            ref={drawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.label')}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-bg shadow-xl animate-[drawer-in_280ms_cubic-bezier(0.2,0.7,0.2,1)]"
          >
            <div className="flex items-center justify-between p-2">
              <Link
                to={circleId ? `/circles/${circleId}` : '/circles'}
                aria-label={t('appName')}
                onClick={() => setNavOpen(false)}
                className="flex min-h-11 min-w-0 items-center gap-2 px-1 no-underline"
              >
                <img src="/icon.png" alt="" className="h-7 w-7 shrink-0 rounded-lg" />
                <span className="serif truncate text-lg text-ink">{t('appName')}</span>
              </Link>
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                aria-label={t('menu.close')}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-bg-2"
              >
                <CloseIcon />
              </button>
            </div>
            <Sidebar
              variant="drawer"
              onNavigate={() => setNavOpen(false)}
              onOpenAssistant={() => {
                setNavOpen(false);
                setAiOpen(true);
              }}
            />
          </div>
        </div>
      )}

      {circleId && (
        <AIChatModal circleId={circleId} isOpen={aiOpen} onClose={() => setAiOpen(false)} />
      )}
    </div>
  );
}
