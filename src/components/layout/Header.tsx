import { useState, type ReactElement } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, ConfirmDialog, Icon, Skeleton } from '@/components/ui';
import type { IconName } from '@/components/ui';
import { useCircles } from '@/hooks/useCircles';
import { useAuthStore, type AuthUser } from '@/store/authStore';
import { useMenu } from '@/hooks/useMenu';
import { Wordmark } from './Wordmark';

/** Sections the circle switcher preserves when jumping between circles. */
const SECTIONS = [
  'calendar',
  'meds',
  'tasks',
  'notes',
  'activity',
  'emergency',
  'documents',
  'vitals',
  'members',
  'settings',
] as const;
type Section = (typeof SECTIONS)[number];

/**
 * The section segment of a circle URL, or '' for the overview (index) route.
 * Switching circles keeps you on the same section. An unknown/empty segment
 * means you're on the overview, so we return '' to keep you on the new circle's
 * overview rather than silently dumping you onto calendar.
 */
function currentSection(pathname: string): Section | '' {
  // /circles/:circleId/:section/... → ['circles', circleId, section, ...]
  const segments = pathname.split('/').filter(Boolean);
  const candidate = segments[2] ?? '';
  return (SECTIONS as readonly string[]).includes(candidate) ? (candidate as Section) : '';
}

function displayName(user: AuthUser | null): string {
  if (!user) return '';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.email;
}

// Spec §5.1 — the two dropdown panels are the same shell: white r16, 1px
// line-2 hairline, shadow-lg, 8px padding, `modal-in` entrance (skipped under
// reduced motion), items at the 44 touch minimum with r12.
// Declared as module constants rather than inline `className="…"` literals so
// the shell lives in ONE place.
const MENU_PANEL_CLASS =
  'absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-1 rounded-lg border border-line-2 bg-cream p-2 shadow-lg animate-[modal-in_200ms_var(--ease-spring)] motion-reduce:animate-none';

const MENU_ITEM_CLASS =
  'flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-left text-md text-ink transition-colors hover:bg-bg-2';

/** Spec §5.1: 44 min-height, r-full, 1px line, bg fill, spring press. */
const SWITCHER_TRIGGER_CLASS =
  'flex min-h-[44px] min-w-0 items-center gap-2 rounded-full border border-line bg-bg px-4 text-md text-ink transition-[background-color,transform] duration-fast ease-spring hover:bg-bg-2 active:scale-[0.97]';

/** Same shell as the trigger, for the no-circles-yet fallback link. */
const SWITCHER_LINK_CLASS = `${SWITCHER_TRIGGER_CLASS} no-underline`;

/**
 * Spec §5.3: Vitals, Members and Circle settings leave the sidebar at the
 * narrow breakpoints, so the switcher menu carries them there (mirroring
 * mobile, where they are reached from Home and the circle menu). Where the
 * sidebar is present it already lists them, so these rows hide (`xl:hidden`)
 * rather than offer a second door to the same page in the same viewport.
 */
type CircleSectionItem = Extract<Section, 'vitals' | 'members' | 'settings'>;

const CIRCLE_SECTIONS: ReadonlyArray<{ section: CircleSectionItem; icon: IconName }> = [
  { section: 'vitals', icon: 'heart-outline' },
  { section: 'members', icon: 'people-outline' },
  { section: 'settings', icon: 'settings-outline' },
];

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
          className="min-h-[44px] rounded-full px-3 text-sm font-medium text-coral-deep underline transition-colors hover:text-ink"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  if (!circles || circles.length === 0) {
    // No circles yet — the /circles page owns the empty state.
    return (
      <Link to="/circles" className={SWITCHER_LINK_CLASS}>
        {t('nav.allCircles')}
      </Link>
    );
  }

  const current = circles.find((circle) => circle.id === circleId);
  const section = currentSection(location.pathname);
  // Literal `t('nav.…')` calls, not `t(key)` — a variable key is invisible to
  // the static translation-key audit.
  const sectionLabel: Record<CircleSectionItem, string> = {
    vitals: t('nav.vitals'),
    members: t('nav.members'),
    settings: t('nav.settings'),
  };

  const selectCircle = (id: string): void => {
    menu.close();
    navigate(section ? `/circles/${id}/${section}` : `/circles/${id}`);
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
        className={SWITCHER_TRIGGER_CLASS}
      >
        <span className="max-w-[7rem] truncate sm:max-w-40">
          {current?.name ?? t('header.switchCircle')}
        </span>
        <Icon name="chevron-down" size="inline" />
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
              <span className="min-w-0 truncate">{circle.name}</span>
              {circle.id === circleId && (
                <Icon name="checkmark" size="inline" className="text-ink" />
              )}
            </button>
          ))}
          <div role="presentation" className="mx-2 my-1 border-t border-line-2" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              menu.close();
              // `fromSwitcher` tells /circles this arrival was deliberate, so it
              // skips the single-circle auto-redirect that would otherwise bounce
              // the user straight back into the circle they just left (Task 13).
              navigate('/circles', { state: { fromSwitcher: true } });
            }}
            className={MENU_ITEM_CLASS}
          >
            {t('nav.allCircles')}
          </button>
          {circleId &&
            CIRCLE_SECTIONS.map(({ section: target, icon }) => (
              <button
                key={target}
                type="button"
                role="menuitem"
                onClick={() => {
                  menu.close();
                  navigate(`/circles/${circleId}/${target}`);
                }}
                className={`${MENU_ITEM_CLASS} xl:hidden`}
              >
                <Icon name={icon} size="row" />
                {sectionLabel[target]}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function UserMenu(): ReactElement {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const menu = useMenu();
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const handleLogout = async (): Promise<void> => {
    setConfirmingLogout(false);
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
        className="flex min-h-[44px] items-center gap-2 rounded-full px-1.5 transition-colors hover:bg-bg-2 sm:px-2"
      >
        {/* Spec §5.1 puts the account avatar at 32; `xs` is 28, so the size is
            forced here (the established convention at this call site). */}
        <Avatar size="xs" className="h-8! w-8!" name={displayName(user)} />
        <span className="hidden max-w-32 truncate text-md text-ink md:block">
          {displayName(user)}
        </span>
        <Icon name="chevron-down" size="inline" />
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
              menu.close();
              navigate('/profile');
            }}
            className={MENU_ITEM_CLASS}
          >
            <Icon name="person-outline" size="row" />
            {t('nav.profile')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              menu.close();
              navigate('/help');
            }}
            className={MENU_ITEM_CLASS}
          >
            <Icon name="help-circle-outline" size="row" />
            {t('nav.help')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // Spec §5.6: signing out is one click from every page, so it asks
              // first. The menu closes; the dialog owns the decision.
              //
              // close(TRUE) — the refocus is load-bearing, not a nicety. It runs
              // synchronously, so the trigger holds focus by the time the dialog
              // mounts and captures `document.activeElement` as the element to
              // restore to on close. Without it the menu item unmounts in the
              // same commit, focus falls to <body>, and cancelling strands a
              // keyboard user at the top of the document.
              menu.close(true);
              setConfirmingLogout(true);
            }}
            className={MENU_ITEM_CLASS}
          >
            <Icon name="log-out-outline" size="row" />
            {t('header.logout')}
          </button>
        </div>
      )}

      {confirmingLogout && (
        <ConfirmDialog
          variant="confirm"
          icon="log-out-outline"
          title={t('header.logoutConfirmTitle')}
          message={t('header.logoutConfirmBody')}
          confirmLabel={t('header.logout')}
          cancelLabel={t('cancel')}
          // Without this the × inherits "Cancel" and the dialog has two
          // controls with the same accessible name.
          closeLabel={t('close')}
          onConfirm={() => {
            void handleLogout();
          }}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </div>
  );
}

export interface HeaderProps {
  /**
   * @deprecated Unused. The hamburger is gone (spec §5.1) — `FloatingNavBar`
   * replaces the drawer below the sidebar breakpoint. Kept only so `AppLayout`
   * still type-checks until Task 11 rewrites it; remove both props then.
   */
  navOpen?: boolean;
  /** @deprecated Unused — see `navOpen`. */
  onToggleNav?: () => void;
}

export function Header(_props: HeaderProps = {}): ReactElement {
  const { circleId } = useParams<{ circleId: string }>();
  // Inside a circle the brand returns to that circle's overview (mirrors mobile's
  // home tab); elsewhere it goes to the circle picker.
  const brandTo = circleId ? `/circles/${circleId}` : '/circles';

  return (
    <header className="sticky top-0 z-20 flex h-[60px] items-center justify-between gap-3 border-b border-line bg-cream px-4 sm:px-6">
      <Wordmark to={brandTo} />

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <CircleSwitcher />
        <UserMenu />
      </div>
    </header>
  );
}
