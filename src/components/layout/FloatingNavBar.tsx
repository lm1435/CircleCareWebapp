import { useEffect, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '@/components/ui';

/**
 * Mobile `FLOATING_NAVBAR_HEIGHT` (64 phone / 72 tablet). Published to the
 * document as `--nav-h` so `<main>`'s bottom padding and the AddMenu's `bottom`
 * offset both read ONE number — mobile's `useNavBarBottomPadding` invariant:
 * if the bar's height and the reservation ever disagree, the last row of every
 * list slides under the pill.
 */
const NAV_HEIGHT_PHONE = '64px';
const NAV_HEIGHT_TABLET = '72px';
/** Mobile's `isTablet` boundary for the bar's height (spec §4.5). */
const TABLET_QUERY = '(min-width: 600px)';

/** Sections that light the CARE cell (spec §5.3 — mobile's Care top tabs). */
const CARE_SECTIONS = ['calendar', 'meds', 'tasks', 'notes'];
/** Sections that light the HEALTH cell (Emergency · Documents). */
const HEALTH_SECTIONS = ['emergency', 'documents'];

/** `/circles/:id/:section` → `section`, or '' for the overview index route. */
function sectionOf(pathname: string): string {
  return pathname.split('/').filter(Boolean)[2] ?? '';
}

const PILL =
  'fixed inset-x-5 bottom-[var(--nav-inset)] z-30 flex h-16 items-center ' +
  'rounded-full border-[1.5px] border-[rgba(26,25,22,0.18)] bg-[rgba(255,255,255,0.92)] px-2 ' +
  'shadow-xl backdrop-blur-[12px] min-[600px]:h-[72px] xl:hidden';

/** Mobile `styles.tabItem`: flex 1, centred column, 44 min, 2px gap. */
const CELL =
  'flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[44px] py-1 relative no-underline';

/** Mobile `styles.tabLabel`: 12/400 uppercase, tracking 1.2, 2px above. */
const LABEL = 'mt-0.5 text-xs uppercase tracking-[1.2px]';

/** Mobile `styles.activeDot`: a 4×4 ink disc pinned to the cell's top edge. */
const ACTIVE_DOT = 'absolute top-0 h-1 w-1 rounded-full bg-ink';

interface TabCellProps {
  to: string;
  active: boolean;
  icon: IconName;
  iconActive: IconName;
  label: string;
}

function TabCell({ to, active, icon, iconActive, label }: TabCellProps): ReactElement {
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} className={CELL}>
      {active && <span aria-hidden="true" className={ACTIVE_DOT} />}
      <Icon name={active ? iconActive : icon} size="chrome" />
      <span className={`${LABEL} ${active ? 'text-ink' : 'text-ink-2'}`}>{label}</span>
    </Link>
  );
}

export interface FloatingNavBarProps {
  circleId: string;
  /** Read-only members cannot create; NEW stays visible but inert (mobile parity). */
  canCreate?: boolean;
  /** AddMenu visibility — drives `aria-expanded` and the "+" 45° rotation. */
  addOpen: boolean;
  onToggleAdd: () => void;
  /** AIChatModal visibility — the AI cell reads as active while it is up. */
  assistantOpen?: boolean;
  onOpenAssistant: () => void;
  /**
   * Whether this viewer gets the AI entry at all (`src/lib/aiAccess.ts`).
   *
   * NOT the `canCreate` treatment: NEW stays visible-but-inert because the
   * action is one the viewer could regain, and the disabled affordance tells
   * them the app has one. A view-only member cannot change their own role, so
   * a dimmed AI cell would only advertise a door that is not theirs to open —
   * the cell is not rendered at all. Defaults false, like `canCreate`: a gate
   * that has not been told anything must fail closed.
   */
  canUseAssistant?: boolean;
}

/**
 * The bottom nav pill (spec §4.5 "FloatingNavBar"; mobile `FloatingNavBar`).
 *
 * Five cells: HOME · CARE · NEW · HEALTH · AI. HOME/CARE/HEALTH are routes;
 * NEW toggles the AddMenu and AI opens the assistant modal, so both are
 * buttons, not links. Rendered below 1024px only — the sidebar owns navigation
 * from `xl` up.
 *
 * NEW is content-sized (mobile's `createBtn` has no `flex: 1`), so the four tab
 * cells split what is left, four ways — the same geometry mobile measures its
 * label widths against.
 */
export function FloatingNavBar({
  circleId,
  canCreate = false,
  addOpen,
  onToggleAdd,
  assistantOpen = false,
  onOpenAssistant,
  canUseAssistant = false,
}: FloatingNavBarProps): ReactElement {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const section = sectionOf(pathname);
  const base = `/circles/${circleId}`;

  // Publish the bar's height so <main> can reserve it. jsdom ships no
  // `matchMedia`, so the phone height is the fallback rather than a crash.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      const tablet =
        typeof window.matchMedia === 'function' && window.matchMedia(TABLET_QUERY).matches;
      root.style.setProperty('--nav-h', tablet ? NAV_HEIGHT_TABLET : NAV_HEIGHT_PHONE);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      root.style.removeProperty('--nav-h');
    };
  }, []);

  return (
    <nav aria-label={t('nav.label')} data-testid="floating-nav" className={PILL}>
      <TabCell
        to={base}
        active={section === ''}
        icon="home-outline"
        iconActive="home"
        label={t('nav.home')}
      />
      <TabCell
        to={`${base}/calendar`}
        active={CARE_SECTIONS.includes(section)}
        icon="calendar-outline"
        iconActive="calendar"
        label={t('nav.careShort')}
      />

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={addOpen}
        aria-disabled={!canCreate}
        disabled={!canCreate}
        onClick={onToggleAdd}
        className={`flex min-w-[52px] flex-col items-center justify-center gap-0.5 min-h-[44px] px-2 py-1 text-ink${
          canCreate ? '' : ' opacity-50'
        }`}
      >
        <Icon
          name="add-outline"
          size="fab"
          className={`transition-transform duration-normal ease-spring motion-reduce:transition-none ${
            addOpen ? 'rotate-45' : ''
          }`.trim()}
        />
        <span className={LABEL}>{t('nav.new')}</span>
      </button>

      <TabCell
        to={`${base}/emergency`}
        active={HEALTH_SECTIONS.includes(section)}
        icon="medical-outline"
        iconActive="medical"
        label={t('nav.healthShort')}
      />

      {/* The assistant is a modal, not a route, so it can never be the router's
          active match — its "active" state is the modal being open. The sparkle
          stays coral either way: the bar's one warm mark (mobile parity).

          Absent, not disabled, when the viewer has no AI access — see
          `canUseAssistant` above. The four remaining cells simply re-split the
          bar (they are `flex-1`; NEW is content-sized either way). */}
      {canUseAssistant && (
        <button
          type="button"
          onClick={onOpenAssistant}
          aria-expanded={assistantOpen}
          className={CELL}
        >
          {assistantOpen && <span aria-hidden="true" className={ACTIVE_DOT} />}
          <Icon
            name={assistantOpen ? 'sparkles' : 'sparkles-outline'}
            size="chrome"
            className="text-coral-deep"
          />
          <span className={`${LABEL} ${assistantOpen ? 'text-ink' : 'text-ink-2'}`}>
            {t('nav.aiShort')}
          </span>
        </button>
      )}
    </nav>
  );
}
