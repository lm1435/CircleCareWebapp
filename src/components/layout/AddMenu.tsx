import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '@/components/ui';
import { useMenu } from '@/hooks/useMenu';

/** The four things the "+" creates (mobile `AddMenu`'s `EventType`). */
export type AddMenuType = 'medication' | 'appointment' | 'task' | 'note';

interface AddMenuOption {
  type: AddMenuType;
  icon: IconName;
  /**
   * `bg-<tone>/19`: mobile paints each circle `color + '30'` (hex alpha 0x30 ≈
   * 19%) over the ink pill, a muted tint rather than a solid disc — a solid
   * clay circle read as bright orange against the black.
   *
   * FULL literal class strings, never `bg-${color}`: Tailwind scans source text
   * for candidates and cannot see an interpolation, so a computed name would
   * compile to nothing and the disc would render transparent.
   */
  circle: string;
}

/** Order and colours are mobile's `OPTIONS` (mobile/src/components/calendar/AddMenu.tsx). */
const OPTIONS: readonly AddMenuOption[] = [
  {
    type: 'medication',
    icon: 'medical-outline',
    circle: 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-clay/19',
  },
  {
    type: 'appointment',
    icon: 'calendar-outline',
    circle: 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-dusk/19',
  },
  {
    type: 'task',
    icon: 'checkbox-outline',
    circle: 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-moss/19',
  },
  {
    type: 'note',
    icon: 'pencil-outline',
    circle: 'inline-flex h-11 w-11 items-center justify-center rounded-full bg-dusk/19',
  },
];

/**
 * `bottom` — the floating pill above the mobile nav bar (mobile's placement).
 * `sidebar` — to the right of the desktop "New" button, whose box the caller
 * hands over as `anchorRef`; the pill is `fixed` at that box's measured rect.
 *
 * Both are `fixed`, and the whole menu (scrim + pill) renders through a portal
 * on <body>. It used to sit inline next to the trigger as `absolute left-full`,
 * which broke two ways inside the desktop rail: the rail is `overflow-y-auto`
 * (a non-visible overflow on one axis forces the other to `auto`, so the rail
 * is a scroll container that clips at its right edge — the pill was cut off at
 * 272px), and the rail is `sticky` (a stacking context with no z-index, so its
 * `fixed inset-0` scrim painted BENEATH the z-20 sticky header). Escaping the
 * rail's subtree fixes both.
 */
export type AddMenuAnchor = 'bottom' | 'sidebar';

const PILL_ANCHOR: Record<AddMenuAnchor, string> = {
  bottom:
    'fixed bottom-[calc(var(--nav-h,64px)+var(--nav-inset,0px)+16px)] left-1/2 -translate-x-1/2 max-w-[calc(100vw-40px)]',
  sidebar: 'fixed',
};

/** Gap between the sidebar trigger's right edge and the pill (the old `ml-2`). */
const SIDEBAR_GAP_PX = 8;

/**
 * Where a `sidebar`-anchored pill sits: the trigger's top edge, just past its
 * right edge. Re-measured on resize and on any scroll (capture phase — the
 * rail scrolls INSIDE itself, and `scroll` does not bubble), so the pill
 * tracks the button if the rail moves under it while open.
 */
function useSidebarPosition(
  active: boolean,
  anchorRef: RefObject<HTMLElement | null> | undefined
): CSSProperties | undefined {
  const [position, setPosition] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    if (!active) {
      setPosition(undefined);
      return;
    }
    const measure = (): void => {
      const rect = anchorRef?.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.top, left: rect.right + SIDEBAR_GAP_PX });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, anchorRef]);

  return position;
}

export interface AddMenuProps {
  open: boolean;
  onClose: () => void;
  onSelect: (type: AddMenuType) => void;
  anchor?: AddMenuAnchor;
  /** The `sidebar` trigger's box; the pill is fixed off its measured rect. Ignored for `bottom`. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Read-only members cannot create anything, so the menu does not exist for them. */
  canCreate?: boolean;
}

/**
 * The create pill (spec §4.5 "AddMenu"): an ink pill of four tinted discs that
 * rises out of the "+" control. Mobile parity — same four options in the same
 * order, the same 44×44 discs, and the same 250ms rise with a 40ms per-option
 * zoom stagger starting at 80ms.
 *
 * The label is the one arbitrary type size the app keeps (mobile's declared
 * 10/400 uppercase 0.8-tracked label), so this file is allowlisted for it in
 * `src/__tests__/bans/typeScale.test.ts`.
 */
export function AddMenu({
  open,
  onClose,
  onSelect,
  anchor = 'bottom',
  anchorRef,
  canCreate = false,
}: AddMenuProps): ReactElement | null {
  const { t } = useTranslation('common');
  /** The control that had focus when the menu opened, to hand it back on close. */
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const shown = open && canCreate;
  const sidebarPosition = useSidebarPosition(shown && anchor === 'sidebar', anchorRef);

  // The roving arrow/Home/End focus, the Escape-closes-and-restores-focus
  // path, and Tab-closes-the-menu all come from the shared `useMenu` (the
  // header's circle switcher and user menu, and `MoreMenu`, use the same
  // hook) — this pill lays its options out in a row, so `orientation:
  // 'horizontal'` swaps in ArrowLeft/ArrowRight for the roving keys.
  //
  // `useMenu`'s own `open` state is intentionally never toggled here — this
  // menu's visibility is the `open` PROP, owned by the caller (the Sidebar's
  // or FloatingNavBar's "New" button), not by this hook. `onOpenChange` only
  // fires when the hook closes itself from a key it handles (Escape or Tab
  // while focus is inside the panel), so those get forwarded to the real
  // `onClose`.
  const menu = useMenu({
    orientation: 'horizontal',
    onOpenChange: (isOpen) => {
      if (!isOpen) onClose();
    },
  });

  // Focus in on open, focus back out on close. Runs on every open/close edge —
  // NOT on mount — so a menu that is never opened never steals focus.
  useEffect(() => {
    if (shown && !wasOpen.current) {
      wasOpen.current = true;
      restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
      menu.menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
      return;
    }
    if (!shown && wasOpen.current) {
      wasOpen.current = false;
      restoreRef.current?.focus();
      restoreRef.current = null;
    }
  }, [shown, menu.menuRef]);

  // Escape closes from anywhere while the menu is up — the pill is not a focus
  // trap, so the key cannot be left to the menu element's own handler (that
  // handler — `menu.onMenuKeyDown` below — only ever sees the key while focus
  // is inside the panel; this covers every other case, e.g. focus still on
  // the backdrop).
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shown, onClose]);

  if (!shown) return null;

  const select = (type: AddMenuType): void => {
    onSelect(type);
    onClose();
  };

  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-testid="add-menu-backdrop"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-overlay animate-[fade-in_200ms_ease-out] motion-reduce:animate-none"
      />
      {/* A named landmark, because the pill is portalled to <body> and so no
          longer inside the rail's <aside> (or any landmark): axe's `region`
          rule flags every visible node outside a landmark, live region, or
          dialog. `display: contents` keeps it out of layout so the pill's own
          `fixed` box is what positions. */}
      <div role="region" aria-label={t('nav.new')} className="contents">
        <div
          ref={menu.menuRef}
          role="menu"
          aria-orientation="horizontal"
          aria-label={t('nav.new')}
          data-testid="add-menu-pill"
          onKeyDown={menu.onMenuKeyDown}
          style={anchor === 'sidebar' ? sidebarPosition : undefined}
          className={`${PILL_ANCHOR[anchor]} z-50 flex gap-5 rounded-full bg-ink px-5 py-3 shadow-xl animate-[rise-in_250ms_var(--ease-spring)] motion-reduce:animate-none`}
        >
          {OPTIONS.map((option, index) => (
            <button
              key={option.type}
              type="button"
              role="menuitem"
              // NO `aria-label` HERE, DELIBERATELY. The pill shows mobile's short
              // label ("Med", "Appt") because four options have to fit one row.
              // Naming the button "Appointment" over a visible "Appt" fails WCAG
              // 2.5.3 Label in Name (AA): the accessible name must CONTAIN the
              // visible text, and "Appointment" does not contain "Appt" — which
              // breaks speech input ("click Appt" would match nothing). So the
              // visible short label IS the name, and the full word rides along as
              // `title`: a hover tooltip for sighted users and the accessible
              // DESCRIPTION for everyone else ("Appt, menu item, Appointment").
              title={t(`addMenu.${option.type}`)}
              onClick={() => select(option.type)}
              style={{ animationDelay: `${80 + index * 40}ms` }}
              className="flex min-w-[48px] min-h-[48px] flex-col items-center justify-center gap-1 active:opacity-70 animate-[zoom-in_200ms_var(--ease-spring)] [animation-fill-mode:both] motion-reduce:animate-none"
            >
              <span className={option.circle}>
                <Icon name={option.icon} size="chrome" className="text-cream" />
              </span>
              <span className="text-2xs tracking-[0.8px] uppercase text-cream/80">
                {t(`addMenu.${option.type}Short`)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
