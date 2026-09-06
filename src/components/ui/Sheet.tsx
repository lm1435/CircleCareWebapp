import { createElement, type ElementType, type HTMLAttributes, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

export type SheetPadding = 'none' | 'sm' | 'md' | 'lg';

/** Spec §4.5: white, r20, 1px hairStrong border, `--shadow-sm`, padding 0. */
const SHEET = 'bg-cream border border-line shadow-sm';
// Caller radius wins (see Card.tsx OVERRIDES_RADIUS for why).
const OVERRIDES_RADIUS = /\brounded-(?!full\b)/;
const SHEET_RADIUS = 'rounded-xl';

const PADDING: Record<SheetPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export interface SheetProps extends HTMLAttributes<HTMLElement> {
  /** Default `none` — a Sheet groups rows that own their own inset. */
  padding?: SheetPadding;
  /** Semantic wrapper: `ul` for a row list, `nav`, `section`. */
  as?: ElementType;
}

/**
 * The grouped-row surface (spec §4.5): Quick Access, care team, settings rows,
 * the filter row. A Sheet is a Card's sibling, not a variant — it carries the
 * stronger hairline because its rows are separated by the weaker one.
 */
export function Sheet({
  padding = 'none',
  as,
  className,
  children,
  ...rest
}: SheetProps): ReactElement {
  const radius = className && OVERRIDES_RADIUS.test(className) ? '' : SHEET_RADIUS;
  const cls = [SHEET, radius, PADDING[padding], className].filter(Boolean).join(' ');
  return createElement(as ?? 'div', { className: cls, ...rest }, children);
}

/** Row metrics are shared by the static and pressable rows so they line up. */
const ROW =
  'flex items-center gap-2.5 px-4 py-3 min-h-[44px] border-t border-line-2 first:border-t-0';

const ROW_PRESSABLE =
  'w-full text-left hover:bg-bg-2 active:opacity-60 transition-colors duration-fast';

export interface SheetRowProps extends HTMLAttributes<HTMLElement> {
  /** `li` inside a `<Sheet as="ul">`; `div` otherwise. */
  as?: ElementType;
}

/** A non-interactive row inside a `Sheet`. */
export function SheetRow({ as, className, children, ...rest }: SheetRowProps): ReactElement {
  const cls = [ROW, className].filter(Boolean).join(' ');
  return createElement(as ?? 'div', { className: cls, ...rest }, children);
}

export interface SheetRowPressableProps extends HTMLAttributes<HTMLElement> {
  /** Route destination — renders a react-router `Link` unless `as` overrides. */
  to?: string;
  /** Override the element (e.g. `as={Link}` explicitly, or an `<a>`). */
  as?: ElementType;
  onClick?: HTMLAttributes<HTMLElement>['onClick'];
  disabled?: boolean;
}

/** An interactive row inside a `Sheet` — a real control, never a clickable div. */
export function SheetRowPressable({
  to,
  as,
  className,
  children,
  ...rest
}: SheetRowPressableProps): ReactElement {
  const tag: ElementType = as ?? (to ? Link : 'button');
  const cls = [ROW, ROW_PRESSABLE, className].filter(Boolean).join(' ');
  return createElement(
    tag,
    {
      className: cls,
      ...(tag === 'button' ? { type: 'button' } : { to }),
      ...rest,
    },
    children
  );
}
