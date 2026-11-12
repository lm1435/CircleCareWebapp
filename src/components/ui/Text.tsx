import { createElement, type ElementType, type HTMLAttributes, type ReactNode } from 'react';

export type TextVariant =
  | 'pageTitle'
  | 'sheetTitle'
  | 'pageSubtitle'
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
  | 'eyebrow'
  | 'sectionLabel';

/** Spec §4.2. Values are mobile's Text.tsx StyleSheet, verbatim. */
export const TEXT_CLASS: Record<TextVariant, string> = {
  // The ONE page title (owner 2026-11-11): 32/600/38, tracking -0.6. Every page's h1 renders it,
  // through PageMasthead. Wraps (text-balance + break-words), never truncates.
  pageTitle: 'text-xl font-semibold leading-[38px] tracking-[-0.6px] text-ink text-balance break-words',
  // The second level: 24/600/30. Sheet and modal titles, the web day heading, the Profile name.
  sheetTitle: 'text-lg font-semibold leading-[30px] tracking-[-0.3px] text-ink text-balance break-words',
  // The line under a page title: 16/500/22, secondary ink.
  pageSubtitle: 'text-md font-medium leading-[22px] text-ink-2',
  h2: 'text-lg font-semibold leading-tight text-ink text-balance',
  sectionTitle: 'text-lg font-semibold leading-[28px] text-ink text-balance',
  h3: 'text-base font-semibold leading-tight text-ink text-balance',
  h4: 'text-lg font-semibold leading-normal text-ink text-balance',
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
  // Profile section headings (mobile Eyebrow): 12/600, 0.15em, uppercase, muted ink-3 (>= 4.5:1 light and dark).
  sectionLabel: 'text-xs font-semibold leading-normal tracking-[0.15em] uppercase text-ink-3',
};

const DEFAULT_TAG: Record<TextVariant, ElementType> = {
  pageTitle: 'h1',
  sheetTitle: 'h2',
  pageSubtitle: 'p',
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
  sectionLabel: 'h2',
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
