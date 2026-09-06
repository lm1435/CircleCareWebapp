import { createElement, type ElementType, type HTMLAttributes, type ReactNode } from 'react';

export type TextVariant =
  | 'editorialTitle'
  | 'editorialTitleCompact'
  | 'display'
  | 'h1'
  | 'heroName'
  | 'authTitle'
  | 'h2'
  | 'sectionTitle'
  | 'h3'
  | 'h4'
  | 'body'
  | 'bodyMedium'
  | 'bodySemiBold'
  | 'bodyBold'
  | 'bodyDense'
  | 'caption'
  | 'label'
  | 'button'
  | 'mono'
  | 'eyebrow';

/** Spec §4.2. Values are mobile's Text.tsx StyleSheet, verbatim. */
export const TEXT_CLASS: Record<TextVariant, string> = {
  editorialTitle: 'text-[42px] font-semibold leading-[46px] tracking-[-1.2px] text-ink',
  // L3: `compact` (a title long enough to wrap to three lines at 42px) used to
  // render as `editorialTitle` PLUS an appended override className
  // (`text-xl leading-[35px]`). Both class lists land on the same element, and
  // Tailwind's compiled stylesheet orders utilities by declaration order in
  // the SOURCE FILES it scanned — `editorialTitle`'s `text-[42px]` here is
  // declared after `compact`'s override was ever authored elsewhere, so it
  // always won the cascade and `compact` was a silent no-op. A distinct
  // variant is a single class list, so there is no cascade to lose.
  editorialTitleCompact: 'text-[32px] font-semibold leading-[35px] tracking-[-1.2px] text-ink',
  display: 'text-2xl font-bold leading-tight tracking-tight text-ink',
  h1: 'text-xl font-bold leading-tight tracking-tight text-ink',
  heroName: 'text-xl font-semibold leading-[40px] tracking-[-0.6px] text-ink text-center',
  authTitle: 'text-[34px] font-semibold leading-[38px] tracking-tight text-ink',
  h2: 'text-lg font-semibold leading-tight text-ink',
  sectionTitle: 'text-lg font-semibold leading-[28px] text-ink',
  h3: 'text-base font-semibold leading-tight text-ink',
  h4: 'text-lg font-semibold leading-normal text-ink',
  body: 'text-base font-normal leading-relaxed text-ink',
  bodyMedium: 'text-base font-medium leading-relaxed text-ink',
  bodySemiBold: 'text-base font-semibold leading-relaxed text-ink',
  bodyBold: 'text-base font-bold leading-relaxed text-ink',
  bodyDense: 'text-md font-normal leading-normal text-ink',
  caption: 'text-sm font-normal leading-normal text-ink-2',
  label: 'text-sm font-semibold leading-normal text-ink-2',
  button: 'text-base font-semibold leading-normal',
  mono: 'text-xs font-normal leading-normal tracking-wider text-ink-3',
  eyebrow: 'text-xs font-normal leading-normal tracking-[1.2px] uppercase text-ink-3',
};

const DEFAULT_TAG: Record<TextVariant, ElementType> = {
  editorialTitle: 'h1',
  editorialTitleCompact: 'h1',
  display: 'h1',
  h1: 'h1',
  heroName: 'h1',
  authTitle: 'h1',
  h2: 'h2',
  sectionTitle: 'h2',
  h3: 'h3',
  h4: 'h4',
  body: 'p',
  bodyMedium: 'p',
  bodySemiBold: 'p',
  bodyBold: 'p',
  bodyDense: 'p',
  caption: 'p',
  label: 'span',
  button: 'span',
  mono: 'span',
  eyebrow: 'span',
};

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant: TextVariant;
  as?: ElementType;
  children: ReactNode;
}

/**
 * The single type primitive (spec §4.2). Every in-app heading, body run, label
 * and caption renders through a named variant so the scale stays the mobile
 * scale (12 · 14 · 18 · 24 · 32 · 42) with weight carrying the hierarchy.
 *
 * The default colors on `caption` (ink-2) and `mono`/`eyebrow` (ink-3) are a
 * web convention that consolidates the per-call-site color overrides mobile
 * applies at nearly every use; callers override with `className`.
 */
export function Text({ variant, as, className, children, ...rest }: TextProps) {
  const cls = className ? `${TEXT_CLASS[variant]} m-0 ${className}` : `${TEXT_CLASS[variant]} m-0`;
  return createElement(as ?? DEFAULT_TAG[variant], { className: cls, ...rest }, children);
}
