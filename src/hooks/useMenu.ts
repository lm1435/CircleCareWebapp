import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Accessible menu-button behavior (WAI-ARIA menu pattern) shared by the
 * header's circle switcher and user menu, `AddMenu` (the global Create menu),
 * and footer overflow menus (`MoreMenu`):
 * - Enter / Space / ArrowDown opens and focuses the first item; ArrowUp the last
 * - ArrowDown / ArrowUp cycle items, Home / End jump to first / last
 * - Escape closes and returns focus to the trigger button
 * - Outside click and Tab close the menu
 *
 * Escape also stops propagation once the menu is open, so a menu nested in a
 * dialog (e.g. `MoreMenu` inside a `Modal` footer) closes only itself on the
 * first Escape rather than also dismissing the ancestor dialog.
 *
 * The consumer renders a trigger `<button>` with `buttonRef`, `onButtonKeyDown`,
 * `aria-haspopup="menu"`, `aria-expanded={open}`, and (when `open`) a panel with
 * `menuRef`, `role="menu"`, `onMenuKeyDown`, containing `role="menuitem"` buttons.
 *
 * `orientation: 'horizontal'` (default `'vertical'`) swaps which arrow keys
 * cycle items — `AddMenu`'s pill lays its options out in a row, so ArrowLeft /
 * ArrowRight (rather than ArrowUp / ArrowDown) move between them; Home, End,
 * Escape and Tab behave identically either way.
 */
export interface MenuApi {
  open: boolean;
  buttonRef: React.RefObject<HTMLButtonElement>;
  menuRef: React.RefObject<HTMLDivElement>;
  toggle: () => void;
  close: (focusButton?: boolean) => void;
  onButtonKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export interface UseMenuOptions {
  /** @default 'vertical' */
  orientation?: 'vertical' | 'horizontal';
  /**
   * Notified whenever this hook's internal open state changes (open OR
   * close), including transitions the hook triggers itself (Escape, Tab,
   * outside click). `AddMenu`'s visibility is a boolean owned by its parent
   * rather than by this hook, so it uses this to mirror a self-triggered
   * close back into that external state.
   */
  onOpenChange?: (open: boolean) => void;
}

/**
 * `[role="menuitem"]` rows that are only in the DOM for a wider breakpoint
 * (e.g. the circle switcher's `xl:hidden` Vitals/Members/Settings rows) sit
 * off-screen via `display:none` at narrower widths, but `querySelectorAll`
 * still returns them — so ArrowDown/End from the last VISIBLE row focused a
 * hidden node (a no-op) and the menu never wrapped back to the top.
 *
 * `checkVisibility()` is the correct primitive here, but jsdom (the test DOM)
 * doesn't implement it — every element reports a null `offsetParent`, which
 * would make this filter reject everything under test. So it only filters
 * when the browser actually supports the check; jsdom falls back to "include
 * everything", matching the pre-fix behavior for the environment tests run in.
 */
function isVisibleMenuItem(el: HTMLElement): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

export function useMenu({ orientation = 'vertical', onOpenChange }: UseMenuOptions = {}): MenuApi {
  const [open, setOpenRaw] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<'first' | 'last' | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const setOpen = useCallback((next: boolean): void => {
    setOpenRaw(next);
    onOpenChangeRef.current?.(next);
  }, []);

  const NEXT_KEY = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const PREV_KEY = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';

  const getItems = useCallback((): HTMLElement[] => {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    ).filter(isVisibleMenuItem);
  }, []);

  const close = useCallback((focusButton = false): void => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  const openMenu = useCallback((focus: 'first' | 'last'): void => {
    pendingFocus.current = focus;
    setOpen(true);
  }, []);

  const toggle = useCallback((): void => {
    if (open) {
      close();
    } else {
      openMenu('first');
    }
  }, [open, close, openMenu]);

  // After the menu renders, move focus to the requested item.
  useEffect(() => {
    if (!open) return;
    const items = getItems();
    const target = pendingFocus.current === 'last' ? items[items.length - 1] : items[0];
    target?.focus();
    pendingFocus.current = null;
  }, [open, getItems]);

  // Close on outside click (mousedown so it wins over focus changes).
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const onButtonKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      switch (event.key) {
        case 'Enter':
        case ' ':
        case NEXT_KEY:
          event.preventDefault();
          openMenu('first');
          break;
        case PREV_KEY:
          event.preventDefault();
          openMenu('last');
          break;
        case 'Escape':
          if (open) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
          break;
        default:
          break;
      }
    },
    [open, openMenu, close, NEXT_KEY, PREV_KEY]
  );

  const onMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const items = getItems();
      if (items.length === 0) return;
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);

      switch (event.key) {
        case NEXT_KEY:
          event.preventDefault();
          items[(activeIndex + 1) % items.length]?.focus();
          break;
        case PREV_KEY:
          event.preventDefault();
          items[(activeIndex - 1 + items.length) % items.length]?.focus();
          break;
        case 'Home':
          event.preventDefault();
          items[0]?.focus();
          break;
        case 'End':
          event.preventDefault();
          items[items.length - 1]?.focus();
          break;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          close(true);
          break;
        case 'Tab':
          // Let focus move naturally, but close the menu.
          setOpen(false);
          break;
        default:
          break;
      }
    },
    [getItems, close, NEXT_KEY, PREV_KEY]
  );

  return { open, buttonRef, menuRef, toggle, close, onButtonKeyDown, onMenuKeyDown };
}
