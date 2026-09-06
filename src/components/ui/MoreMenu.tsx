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
   * against the nearest `[role="dialog"]` ancestor's bottom edge when there is
   * one — see the flip-up note below — falling back to the viewport
   * otherwise. `'up'`/`'down'` skip measurement and pin the panel, for a
   * caller whose layout the measurement can't see (e.g. a custom scroll
   * container that isn't a dialog).
   */
  placement?: 'auto' | 'up' | 'down';
  className?: string;
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
 * BELOW it and flips above only when there is no room underneath (measured
 * once per open, spec §4.5), against the nearest `[role="dialog"]` ancestor
 * when the trigger lives inside one (a Modal footer, say) and the viewport
 * otherwise — see `placement` to skip measurement entirely.
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
  const [flipUp, setFlipUp] = useState(false);

  // Measure after the panel is in the DOM but before paint, so the flipped
  // panel never renders in the wrong place for a frame.
  useLayoutEffect(() => {
    if (!menu.open) return;
    if (placement === 'up') {
      setFlipUp(true);
      return;
    }
    if (placement === 'down') {
      setFlipUp(false);
      return;
    }
    const trigger = menu.buttonRef.current;
    const panel = menu.menuRef.current;
    if (!trigger || !panel) {
      setFlipUp(false);
      return;
    }
    // The viewport is the wrong boundary inside a Modal: the panel is
    // `overflow-hidden` (D-health.md §9.2's fix for a different clip), so a
    // footer menu that has plenty of room below it in the WINDOW can still be
    // clipped by the dialog's own bottom edge. Measure against the nearest
    // dialog ancestor when there is one, and only fall back to the viewport
    // for menus that aren't inside a Modal at all.
    const boundary =
      trigger.closest('[role="dialog"]')?.getBoundingClientRect().bottom ?? window.innerHeight;
    setFlipUp(trigger.getBoundingClientRect().bottom + panel.offsetHeight > boundary);
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
          className={[
            'absolute z-30 min-w-[200px] rounded-lg border border-line-2 bg-cream p-1 shadow-lg',
            'animate-[modal-in_200ms_var(--ease-spring)] motion-reduce:animate-none',
            flipUp ? 'bottom-full mb-1' : 'top-full mt-1',
            align === 'left' ? 'left-0' : 'right-0',
          ].join(' ')}
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
