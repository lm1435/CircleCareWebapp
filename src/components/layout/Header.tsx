import type { ReactElement } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui';
import { useCircles } from '@/hooks/useCircles';
import { useAuthStore, type AuthUser } from '@/store/authStore';
import { useMenu } from './useMenu';

/** Sections the circle switcher preserves when jumping between circles. */
const SECTIONS = ['calendar', 'activity', 'emergency', 'documents', 'members'] as const;
type Section = (typeof SECTIONS)[number];

function currentSection(pathname: string): Section {
  // /circles/:circleId/:section/... → ['circles', circleId, section, ...]
  const segments = pathname.split('/').filter(Boolean);
  const candidate = segments[2] ?? '';
  return (SECTIONS as readonly string[]).includes(candidate) ? (candidate as Section) : 'calendar';
}

function displayName(user: AuthUser | null): string {
  if (!user) return '';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.email;
}

function initialsOf(user: AuthUser | null): string {
  if (!user) return '?';
  const first = user.first_name?.trim().charAt(0) ?? '';
  const last = user.last_name?.trim().charAt(0) ?? '';
  const initials = `${first}${last}`.toUpperCase();
  return initials || user.email.charAt(0).toUpperCase() || '?';
}

function ChevronDownIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function MenuIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CheckIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-terracotta-deep"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function LogoutIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

const MENU_PANEL_CLASS =
  'absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-1 rounded-2xl border border-line bg-cream p-2 shadow-lg';

const MENU_ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm text-ink transition-colors hover:bg-bg-2';

function CircleSwitcher(): ReactElement {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const { circleId } = useParams<{ circleId: string }>();
  const { data: circles, isLoading, isError, refetch } = useCircles();
  const menu = useMenu();

  if (isLoading) {
    return <Skeleton className="h-11 w-40 rounded-full" />;
  }

  if (isError) {
    return (
      <div className="flex items-center gap-1 text-sm text-ink-3">
        <span>{t('header.circlesError')}</span>
        <button
          type="button"
          onClick={() => {
            void refetch();
          }}
          className="min-h-11 rounded-full px-3 text-sm font-medium text-terracotta-deep underline transition-colors hover:text-ink"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (!circles || circles.length === 0) {
    // No circles yet — the /circles page owns the empty state.
    return (
      <Link
        to="/circles"
        className="flex min-h-11 items-center rounded-full border border-line bg-bg px-4 text-sm text-ink no-underline transition-colors hover:bg-bg-2"
      >
        {t('nav.circles')}
      </Link>
    );
  }

  const current = circles.find((circle) => circle.id === circleId);
  const section = currentSection(location.pathname);

  const selectCircle = (id: string): void => {
    menu.close();
    navigate(`/circles/${id}/${section}`);
  };

  return (
    <div className="relative">
      <button
        ref={menu.buttonRef}
        type="button"
        onClick={menu.toggle}
        onKeyDown={menu.onButtonKeyDown}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={
          current ? `${t('header.switchCircle')}: ${current.name}` : t('header.switchCircle')
        }
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-full border border-line bg-bg px-3 text-sm text-ink transition-colors hover:bg-bg-2 sm:px-4"
      >
        <span className="max-w-[7rem] truncate sm:max-w-40">
          {current?.name ?? t('header.switchCircle')}
        </span>
        <ChevronDownIcon />
      </button>

      {menu.open && (
        <div
          ref={menu.menuRef}
          role="menu"
          aria-label={t('header.switchCircle')}
          onKeyDown={menu.onMenuKeyDown}
          className={MENU_PANEL_CLASS}
        >
          {circles.map((circle) => (
            <button
              key={circle.id}
              type="button"
              role="menuitem"
              onClick={() => selectCircle(circle.id)}
              className={`${MENU_ITEM_CLASS} justify-between`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{circle.name}</span>
                <span className="truncate text-xs text-ink-3">{circle.recipient_name}</span>
              </span>
              {circle.id === circleId && <CheckIcon />}
            </button>
          ))}
          <div role="presentation" className="mx-2 my-1 border-t border-line-2" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              menu.close();
              navigate('/circles');
            }}
            className={MENU_ITEM_CLASS}
          >
            {t('nav.circles')}
          </button>
        </div>
      )}
    </div>
  );
}

function UserMenu(): ReactElement {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const menu = useMenu();

  const handleLogout = async (): Promise<void> => {
    menu.close();
    // Defensive: the auth agent adds signOut() to the store in parallel.
    // Until it lands, fall back to clear() so logout still resets local state.
    const state: { signOut?: () => void | Promise<void>; clear?: () => void } =
      useAuthStore.getState();
    try {
      if (typeof state.signOut === 'function') {
        await state.signOut();
      } else {
        state.clear?.();
      }
    } finally {
      navigate('/login');
    }
  };

  return (
    <div className="relative">
      <button
        ref={menu.buttonRef}
        type="button"
        onClick={menu.toggle}
        onKeyDown={menu.onButtonKeyDown}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={t('header.account')}
        className="flex min-h-11 items-center gap-2 rounded-full px-1.5 transition-colors hover:bg-bg-2 sm:px-2"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terracotta-deep text-xs font-medium text-cream"
        >
          {initialsOf(user)}
        </span>
        <span className="hidden max-w-32 truncate text-sm text-ink md:block">
          {displayName(user)}
        </span>
        <ChevronDownIcon />
      </button>

      {menu.open && (
        <div
          ref={menu.menuRef}
          role="menu"
          aria-label={t('header.account')}
          onKeyDown={menu.onMenuKeyDown}
          className={MENU_PANEL_CLASS}
        >
          {user && (
            <div className="border-b border-line-2 px-3 pb-2 pt-1">
              <p className="m-0 truncate text-sm font-medium text-ink">{displayName(user)}</p>
              <p className="m-0 truncate text-xs text-ink-3">{user.email}</p>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void handleLogout();
            }}
            className={MENU_ITEM_CLASS}
          >
            <LogoutIcon />
            {t('header.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export interface HeaderProps {
  /** Whether the mobile nav drawer is open (controls aria-expanded). */
  navOpen?: boolean;
  /** Renders the hamburger trigger when provided (mobile breakpoints). */
  onToggleNav?: () => void;
}

export function Header({ navOpen = false, onToggleNav }: HeaderProps = {}): ReactElement {
  const { t } = useTranslation('common');

  return (
    <header className="flex items-center justify-between gap-3 border-b border-line bg-cream px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        {onToggleNav && (
          <button
            type="button"
            onClick={onToggleNav}
            aria-expanded={navOpen}
            aria-controls="mobile-nav"
            aria-label={t('menu.toggle')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-bg-2 lg:hidden"
          >
            <MenuIcon />
          </button>
        )}
        <Link to="/circles" className="flex min-h-11 min-w-0 items-center gap-2 px-1 no-underline">
          <img src="/icon.png" alt="" className="h-7 w-7 shrink-0 rounded-lg" />
          {/* Wordmark hides on the smallest screens so the header fits the circle
              switcher + account avatar without overflowing. */}
          <span className="serif hidden truncate text-lg text-ink sm:inline">{t('appName')}</span>
        </Link>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <CircleSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
