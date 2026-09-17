import {
  useId,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useMenu } from '@/hooks/useMenu';
import { Icon } from './Icon';
import type { IconName } from './iconNames';

export interface MoreMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /** Optional leading glyph, rendered at the `row` (20px) size. */
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}

/** A hairline between two groups of items. */
export interface MoreMenuDivider {
  divider: true;
  id?: string;
}

export type MoreMenuEntry = MoreMenuItem | MoreMenuDivider;

/**
 * Everything a custom trigger must spread onto its `<button>` for the menu to
 * work. `aria-controls` is `undefined` while the menu is shut — the panel does
 * not exist yet, and a dangling idref is invalid ARIA — so spread the whole
 * object rather than picking fields off it.
 */
export interface MoreMenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

export interface MoreMenuProps {
  items: MoreMenuEntry[];
  /** Accessible label for the default trigger. Defaults to `t('common:more')`. */
  label?: string;
  /**
   * Replaces the default 44×44 ellipsis button — for the labelled filter/sort
   * pills (Tasks, Vitals, Medications). The panel anchors below it exactly the
   * same way. Name the trigger yourself: `label` is not applied to it.
   */
  renderTrigger?: (props: MoreMenuTriggerProps) => ReactNode;
  /** Panel alignment relative to the trigger. Defaults to `'right'`. */
  align?: 'left' | 'right';
  /**
   * Override the automatic up/down measurement. `'auto'` (default) measures
   * against the nearest CLIPPING ancestor — see the flip-up note below —
   * falling back to the viewport. `'up'`/`'down'` skip measurement entirely
   * and pin the panel.
   */
  placement?: 'auto' | 'up' | 'down';
  className?: string;
}

/** `mt-1` / `mb-1` — the gap the panel keeps between itself and the trigger. */
const ANCHOR_GAP = 4;
/** Breathing room kept between the panel and the boundary's edge. */
const EDGE_GUTTER = 8;
/** `min-h-[44px]` on every item — the smallest hit target the menu presents. */
const ITEM_MIN_HEIGHT = 44;
/**
 * The panel's own chrome, all of it INSIDE `max-height`: `p-1` top and bottom
 * (4px each) plus the 1px border on each edge, because the app is
 * `box-sizing: border-box`.
 */
const PANEL_CHROME = 2 * 4 + 2 * 1;
/**
 * The shortest capped panel that can still scroll one whole item into view —
 * the FLOOR below which capping is not containment but breakage. Measured on
 * /vitals: an `Accordion` collapse wrapper around a single reading row is an
 * 82px box, which left 11px after the gap and the gutter; the panel duly
 * capped to 11px, the "Delete" item laid out at 487–530 — outside its own
 * scrollport — and `elementFromPoint` over it returned the section, not the
 * item. Present, and dead for a pointer.
 */
const MIN_USABLE_PANEL = ITEM_MIN_HEIGHT + PANEL_CHROME;

interface Bounds {
  top: number;
  bottom: number;
}

interface PanelLayout {
  up: boolean;
  /** `null` when the panel fits as-is and needs no cap. */
  maxHeight: number | null;
}

/**
 * Does `el` clip its overflowing children in the BLOCK axis?
 *
 * `overflowY` is the only correct signal — the `overflow` shorthand computes
 * to two values when the axes differ (`AppLayout`'s `overflow-x-clip` shell
 * computes to `clip visible`, which clips nothing vertically), so reading the
 * shorthand would invent boundaries that don't exist.
 *
 * A `[role="dialog"]` ancestor counts regardless: `Modal`'s panel is
 * `overflow-hidden` and its role is the cheap, reliable hook for it.
 */
function clipsVertically(el: HTMLElement): boolean {
  if (el.getAttribute('role') === 'dialog') return true;
  const overflowY = window.getComputedStyle(el).overflowY;
  return overflowY !== '' && overflowY !== 'visible';
}

/**
 * The box the panel must stay inside: the nearest ancestor that clips,
 * INTERSECTED with the viewport — a tall scroll container reaches well below
 * the fold, and "inside the container" is no use if it is also below the
 * window. With no clipping ancestor the viewport is the whole answer.
 *
 * `<body>` / `<html>` are deliberately NOT candidates. A modal scroll-lock
 * sets `overflow: hidden` on the body, and the body's rect is the DOCUMENT
 * height, not the visible one — treating it as the boundary would hand back a
 * box far taller than the window and defeat the measurement entirely.
 */
function boundsFor(trigger: HTMLElement): Bounds {
  for (let el = trigger.parentElement; el; el = el.parentElement) {
    if (el === document.body || el === document.documentElement) break;
    if (clipsVertically(el)) {
      const rect = el.getBoundingClientRect();
      return { top: Math.max(rect.top, 0), bottom: Math.min(rect.bottom, window.innerHeight) };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

interface Fit {
  up: boolean;
  /** Room available on the chosen side, after the gap and the gutter. */
  room: number;
}

/**
 * Which side of the trigger to open on inside `bounds`, and how much room that
 * side actually has.
 *
 * Down is the default and wins whenever the panel fits there. Up only when the
 * panel actually fits above INSIDE the same box — the pre-fix code flipped on
 * viewport space alone, which is exactly how the Members page put "Cancel
 * invite" outside its `overflow-hidden` Sheet and made it unclickable. When it
 * fits neither way, the roomier side.
 */
function fitWithin(rect: DOMRect, bounds: Bounds, height: number): Fit {
  const roomBelow = Math.max(bounds.bottom - rect.bottom - ANCHOR_GAP - EDGE_GUTTER, 0);
  const roomAbove = Math.max(rect.top - bounds.top - ANCHOR_GAP - EDGE_GUTTER, 0);
  const up = height <= roomBelow ? false : height <= roomAbove ? true : roomAbove > roomBelow;
  return { up, room: up ? roomAbove : roomBelow };
}

/**
 * Pick a direction and, when the panel can't fit whole, the height to cap it
 * at so it scrolls internally instead of being cut off.
 *
 * Ordering — the clip box FIRST, the viewport as the fallback:
 *
 *  1. If the panel fits inside the clipping ancestor, place it there. Nothing
 *     is capped and nothing about the markup changes.
 *  2. If it doesn't fit but the box still leaves a USABLE scrollport
 *     (`MIN_USABLE_PANEL` — one whole item plus the panel's own chrome), cap
 *     to that and let the panel scroll inside the box.
 *  3. If the roomier side is below that floor, the box is not a viable
 *     boundary at all: an 82px accordion wrapper around a 44px trigger has no
 *     usable room in EITHER direction, and "cap to whatever is left" bottoms
 *     out at 11px — a control that looks present and cannot be operated by
 *     pointer, which is worse than visual overflow. Escalate to the viewport
 *     and measure again there, capping only against that boundary.
 *
 * A cap below the floor is never applied: if even the viewport is that
 * cramped, the panel overflows rather than becoming an inoperable sliver.
 */
function chooseLayout(
  rect: DOMRect,
  bounds: Bounds,
  viewport: Bounds,
  height: number
): PanelLayout {
  // A trigger sitting outside its own boundary means the geometry can't be
  // trusted (a mid-scroll measurement, a mocked/degenerate rect). Fall back to
  // the pre-clip-aware rule rather than doing arithmetic on nonsense.
  if (rect.top < bounds.top || rect.bottom > bounds.bottom) {
    return { up: rect.bottom + height > bounds.bottom, maxHeight: null };
  }
  const inBox = fitWithin(rect, bounds, height);
  if (height <= inBox.room) return { up: inBox.up, maxHeight: null };
  if (inBox.room >= MIN_USABLE_PANEL) return { up: inBox.up, maxHeight: inBox.room };

  const inViewport = fitWithin(rect, viewport, height);
  if (height <= inViewport.room) return { up: inViewport.up, maxHeight: null };
  return {
    up: inViewport.up,
    maxHeight: inViewport.room >= MIN_USABLE_PANEL ? inViewport.room : null,
  };
}

const BASE_ITEM_CLASS =
  'flex w-full items-center gap-3 rounded-md px-3 min-h-[44px] text-left text-md';

const ENABLED_CLASS = {
  normal: 'text-ink hover:bg-bg-2 focus-visible:bg-bg-2',
  danger: 'text-terracotta-deep hover:bg-terracotta-soft focus-visible:bg-terracotta-soft',
} as const;

// Disabled items keep their at-rest text color but drop the hover fill and
// dim via opacity — no `disabled` attribute (see renderItem below), so this
// must carry its own "don't look interactive" signal.
const DISABLED_CLASS = {
  normal: 'text-ink opacity-50 cursor-not-allowed',
  danger: 'text-terracotta-deep opacity-50 cursor-not-allowed',
} as const;

function isDivider(entry: MoreMenuEntry): entry is MoreMenuDivider {
  return 'divider' in entry && entry.divider === true;
}

function itemClasses(item: MoreMenuItem): string {
  const tone = item.danger ? 'danger' : 'normal';
  const state = item.disabled ? DISABLED_CLASS[tone] : ENABLED_CLASS[tone];
  return [BASE_ITEM_CLASS, state].join(' ');
}

/**
 * Overflow menu (WAI-ARIA menu-button, via useMenu). The default trigger is a
 * 44×44 `ellipsis-horizontal` icon button named by `label`; the panel opens
 * BELOW it and flips above only when there is no room underneath AND there is
 * room above (measured once per open, spec §4.5) — both measured against the
 * nearest CLIPPING ancestor, falling back to the viewport. See `placement` to
 * skip measurement entirely.
 *
 * FOLLOW-UP: the panel is rendered inline (`absolute`), so it can never leave
 * its clipping ancestor — the measurement below only keeps it INSIDE one,
 * shrinking it to fit when the box is short, and refusing to shrink it below
 * `MIN_USABLE_PANEL` (escaping the box instead) when even that is impossible.
 * Portalling the panel to `document.body` is the complete answer, but it is a
 * much larger change: stacking order, scroll-follow and resize repositioning,
 * and the focus handling it would have to keep in step with `Modal`'s focus
 * trap. Deferred deliberately.
 *
 * What that leaves: a call site whose clip is DECORATIVE should drop it (see
 * MembersPage / CareTeam) and the panel is then free. A call site whose clip is
 * LOAD-BEARING — VitalsPage's rows sit in the `Accordion`'s `0fr→1fr` collapse
 * wrapper, which cannot simply lose its `overflow-hidden` — keeps the clip, and
 * an escalated panel is still PAINTED clipped by it. It is operable there
 * (uncapped, so the browser can scroll the item into view, and the keyboard
 * path is untouched) but not fully visible; that is the same rendering the page
 * shipped before the cap existed. The portal, or an `Accordion` that stops
 * clipping once it is fully open, is what actually makes it visible.
 *
 * Grouping: pass an explicit `{ divider: true }` entry to control the
 * hairlines yourself and the list renders in the order given. With no explicit
 * divider the legacy behavior applies — `danger` items sink to the bottom
 * behind one hairline — so existing call sites keep their layout.
 *
 * Disabled items follow the WAI-ARIA "disabled menuitem" pattern: they stay
 * in the DOM and focusable (`aria-disabled`, no native `disabled`) so arrow
 * navigation and Home/End keep working across them; only activation
 * (click / Enter / Space via `onClick`) is suppressed. A native `disabled`
 * button can't receive `.focus()`, which would otherwise leave the whole
 * menu keyboard-dead whenever the first item happened to be disabled.
 */
export function MoreMenu({
  items,
  label,
  renderTrigger,
  align = 'right',
  placement = 'auto',
  className,
}: MoreMenuProps): ReactElement {
  const { t } = useTranslation();
  const menu = useMenu();
  const menuId = useId();
  const [layout, setLayout] = useState<PanelLayout>({ up: false, maxHeight: null });

  // Measure after the panel is in the DOM but before paint, so the flipped
  // panel never renders in the wrong place for a frame.
  useLayoutEffect(() => {
    if (!menu.open) return;
    if (placement !== 'auto') {
      setLayout({ up: placement === 'up', maxHeight: null });
      return;
    }
    const trigger = menu.buttonRef.current;
    const panel = menu.menuRef.current;
    if (!trigger || !panel) {
      setLayout({ up: false, maxHeight: null });
      return;
    }
    // The viewport is the wrong boundary whenever an ancestor clips: a Modal's
    // `overflow-hidden` panel (D-health.md §9.2's fix for a different clip),
    // an `Accordion` body, or a `Sheet ... overflow-hidden` row list. That
    // last one is how the Members page shipped an unclickable "Cancel invite"
    // — the panel had room in the WINDOW, flipped up on that basis, and 64% of
    // it landed outside the list's own clip rect, unpainted.
    setLayout(
      chooseLayout(
        trigger.getBoundingClientRect(),
        boundsFor(trigger),
        { top: 0, bottom: window.innerHeight },
        panel.offsetHeight
      )
    );
    // `buttonRef`/`menuRef` are stable refs from useMenu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open, placement]);

  const triggerLabel = label ?? t('common:more');
  const hasExplicitDivider = items.some(isDivider);
  const actions = items.filter((entry): entry is MoreMenuItem => !isDivider(entry));
  const normalItems = actions.filter((item) => !item.danger);
  const dangerItems = actions.filter((item) => item.danger);

  const select = (item: MoreMenuItem): void => {
    if (item.disabled) return;
    item.onSelect();
    menu.close(true);
  };

  const renderItem = (item: MoreMenuItem): ReactElement => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      aria-disabled={item.disabled || undefined}
      tabIndex={-1}
      onClick={() => select(item)}
      className={itemClasses(item)}
    >
      {item.icon ? <Icon name={item.icon} size="row" /> : null}
      {item.label}
    </button>
  );

  const renderEntry = (entry: MoreMenuEntry, index: number): ReactElement =>
    isDivider(entry) ? (
      <div
        key={entry.id ?? `divider-${index}`}
        role="separator"
        className="my-1 border-t border-line-2"
      />
    ) : (
      renderItem(entry)
    );

  const triggerProps: MoreMenuTriggerProps = {
    ref: menu.buttonRef,
    id: `${menuId}-trigger`,
    onClick: menu.toggle,
    onKeyDown: menu.onButtonKeyDown,
    'aria-haspopup': 'menu',
    'aria-expanded': menu.open,
    'aria-controls': menu.open ? menuId : undefined,
  };

  return (
    <div className={['relative', className].filter(Boolean).join(' ')}>
      {renderTrigger ? (
        renderTrigger(triggerProps)
      ) : (
        <button
          {...triggerProps}
          type="button"
          aria-label={triggerLabel}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-bg-2"
        >
          <Icon name="ellipsis-horizontal" size="row" />
        </button>
      )}

      {menu.open && (
        <div
          ref={menu.menuRef}
          id={menuId}
          role="menu"
          aria-label={t('common:moreActions')}
          onKeyDown={menu.onMenuKeyDown}
          // `max-height` is set ONLY when the panel cannot fit whole in the
          // chosen direction; it then scrolls internally rather than hanging
          // outside the clipping box. A panel that fits stays a plain box —
          // no scroll container, no change for the call sites that were fine.
          style={layout.maxHeight != null ? { maxHeight: `${layout.maxHeight}px` } : undefined}
          className={[
            'absolute z-30 min-w-[200px] rounded-lg border border-line-2 bg-cream p-1 shadow-lg',
            'animate-[modal-in_200ms_var(--ease-spring)] motion-reduce:animate-none',
            layout.maxHeight != null ? 'overflow-y-auto overscroll-contain' : '',
            layout.up ? 'bottom-full mb-1' : 'top-full mt-1',
            align === 'left' ? 'left-0' : 'right-0',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {hasExplicitDivider ? (
            items.map(renderEntry)
          ) : (
            <>
              {normalItems.map(renderItem)}
              {dangerItems.length > 0 && (
                <div
                  className={normalItems.length > 0 ? 'mt-1 border-t border-line-2 pt-1' : undefined}
                >
                  {dangerItems.map(renderItem)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
