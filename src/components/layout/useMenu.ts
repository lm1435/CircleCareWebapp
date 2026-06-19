import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Accessible menu-button behavior (WAI-ARIA menu pattern) shared by the
 * header's circle switcher and user menu:
 * - Enter / Space / ArrowDown opens and focuses the first item; ArrowUp the last
 * - ArrowDown / ArrowUp cycle items, Home / End jump to first / last
 * - Escape closes and returns focus to the trigger button
 * - Outside click and Tab close the menu
 *
 * The consumer renders a trigger `<button>` with `buttonRef`, `onButtonKeyDown`,
 * `aria-haspopup="menu"`, `aria-expanded={open}`, and (when `open`) a panel with
 * `menuRef`, `role="menu"`, `onMenuKeyDown`, containing `role="menuitem"` buttons.
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

export function useMenu(): MenuApi {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<'first' | 'last' | null>(null);

  const getItems = useCallback((): HTMLElement[] => {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
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
        case 'ArrowDown':
          event.preventDefault();
          openMenu('first');
          break;
        case 'ArrowUp':
          event.preventDefault();
          openMenu('last');
          break;
        case 'Escape':
          if (open) {
            event.preventDefault();
            close(true);
          }
          break;
        default:
          break;
      }
    },
    [open, openMenu, close]
  );

  const onMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const items = getItems();
      if (items.length === 0) return;
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          items[(activeIndex + 1) % items.length]?.focus();
          break;
        case 'ArrowUp':
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
    [getItems, close]
  );

  return { open, buttonRef, menuRef, toggle, close, onButtonKeyDown, onMenuKeyDown };
}
