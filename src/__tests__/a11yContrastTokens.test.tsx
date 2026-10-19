import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import { Checkbox } from '@/components/ui/Checkbox';
import { Toggle } from '@/components/ui/Toggle';
import { fieldShell, INPUT_SHELL } from '@/components/ui/inputStyles';
import { OtpInput } from '@/components/auth/OtpInput';
import { AVATAR_GRADIENTS } from '@/components/ui/Avatar';

// a11y audit 2026-09-29 — the colour contracts behind WCAG 1.4.3 (placeholder
// text) and 1.4.11 (non-text contrast: the visible boundary of a control).
// Computed from the real tokens in globals.css, so re-tuning a token below the
// threshold fails here, not in a lawsuit.

const CSS = readFileSync(join(__dirname, '..', 'styles', 'globals.css'), 'utf8');

function token(name: string): string {
  const match = CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`--color-${name} is not a #rrggbb token in globals.css`);
  return match[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast tokens (WCAG 1.4.3 / 1.4.11)', () => {
  it('placeholder text is >= 4.5:1 on the field ground (cream)', () => {
    expect(contrast(token('placeholder'), token('cream'))).toBeGreaterThanOrEqual(4.5);
  });

  // Every ground a control sits on. (bg-3 is skeleton-only; see globals.css.)
  it.each(['cream', 'bg', 'bg-2'])('line-strong is >= 3:1 on %s', (ground) => {
    expect(contrast(token('line-strong'), token(ground))).toBeGreaterThanOrEqual(3);
  });

  it('matches mobile\'s fieldBorder (parity)', () => {
    expect(token('line-strong').toLowerCase()).toBe('#8a8783');
  });

  it('the focus edge (moss) is >= 3:1 on cream', () => {
    expect(contrast(token('moss'), token('cream'))).toBeGreaterThanOrEqual(3);
  });
});

describe('control boundaries use line-strong (WCAG 1.4.11)', () => {
  it('text-field shell: line-strong at rest, a 2px moss edge on focus', () => {
    for (const shell of [INPUT_SHELL, fieldShell(), fieldShell({ multiline: true })]) {
      expect(shell).toContain('border-line-strong');
      expect(shell).toContain('focus-within:border-moss');
      expect(shell).toContain('focus-within:shadow-[0_0_0_1px_var(--color-moss)]');
      expect(shell).not.toContain('border-line-2');
    }
  });

  it('an errored field still shows focus (terracotta edge)', () => {
    expect(fieldShell({ error: true })).toContain(
      'focus-within:shadow-[0_0_0_1px_var(--color-terracotta)]'
    );
  });

  it('unchecked checkbox box', () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Remind me" />);
    const box = screen.getByRole('checkbox', { name: 'Remind me' }).querySelector('span');
    expect(box?.className).toContain('border-line-strong');
  });

  it('switch off track', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Reminders" />);
    const track = screen.getByRole('switch', { name: 'Reminders' }).querySelector('span');
    expect(track?.className).toMatch(/(^|\s)bg-line-strong(\s|$)/);
  });

  it('empty OTP cell', () => {
    render(<OtpInput value="" onChange={() => {}} label="Code" />);
    const cells = screen.getAllByRole('textbox');
    expect(cells[0].className).toContain('border-line-strong');
    expect(cells[0].className).toContain('focus:border-moss');
  });
});

// WCAG 2.4.11 Focus Not Obscured: a Tab into content beyond the viewport must
// scroll it clear of the sticky 60px header and (below xl) the floating nav
// pill. The browser honours the scroll container's scroll-padding when it
// scrolls a focused element into view; the real geometry is proved in
// e2e/a11y-wcag22.spec.ts.
describe('focus-not-obscured scroll padding (globals.css)', () => {
  const html = CSS.match(/html\s*\{[^}]*scroll-behavior:\s*smooth;[^}]*\}/)?.[0] ?? '';

  it('keeps focused controls below the sticky header', () => {
    const top = html.match(/scroll-padding-top:\s*(\d+)px/);
    expect(Number(top?.[1])).toBeGreaterThanOrEqual(60 + 8);
  });

  it('keeps focused controls above the floating nav pill', () => {
    expect(html).toMatch(/scroll-padding-bottom:\s*calc\(var\(--nav-h, 0px\) \+ var\(--nav-inset\)/);
  });
});

// Avatar initials are white on a name-hashed gradient (mobile parity, same
// fix as mobile 2026-09-29): the old coral and clay-light stops were 4.12:1
// and 2.87:1. Every stop of every gradient must carry white text at 4.5:1.
describe('avatar gradients carry white initials (WCAG 1.4.3)', () => {
  const stops = AVATAR_GRADIENTS.flat().map((v) => v.match(/--color-([a-z0-9-]+)/)?.[1] ?? v);
  it.each(stops)('%s is >= 4.5:1 against cream', (name) => {
    expect(contrast(token(name), token('cream'))).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------
// DARK PALETTE (docs/plans/dark-mode-palette.md). The dark tokens live in the
// `:root[data-theme='dark']` block of globals.css and many are `rgba()` washes,
// so they are parsed here (token() above only reads #rrggbb from the first
// match, i.e. the light @theme). The full 109-pairing + role-token proof is
// scripts/contrast.mjs (exit code 0 = pass); this asserts its load-bearing
// pairings inside the unit suite so a re-tuned dark token fails here.
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number];

function blockOf(open: string): string {
  const start = CSS.indexOf(open);
  if (start < 0) throw new Error(`block not found: ${open}`);
  let depth = 0;
  for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(start, i + 1);
  }
  throw new Error(`unterminated block: ${open}`);
}

function parseColor(value: string): Rgba {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const p = fn[1].split(',').map((x) => Number(x.trim()));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`not a #rrggbb / rgba() colour: ${value}`);
}

function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    const value = m[2].replace(/\/\*.*$/, '').trim();
    if (/^(#[0-9a-f]{6}|rgba?\([^)]*\))$/i.test(value)) out[m[1]] = value;
  }
  return out;
}

const LIGHT = tokensIn(blockOf('@theme {'));
const DARK_BLOCK = blockOf(":root[data-theme='dark'] {");
const DARK = tokensIn(DARK_BLOCK);

function over(fg: Rgba, bg: Rgba): Rgba {
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as Rgba;
}
function lum([r, g, b]: Rgba): number {
  const lin = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG ratio of `fg` on `bg`, compositing translucent colours over `base` (an opaque ground). */
function ratioIn(P: Record<string, string>, fg: string, bg: string, on = 'bg'): number {
  const base = parseColor(P[on]);
  const ground = (() => {
    const c = parseColor(P[bg]);
    return c[3] < 1 ? over(c, base) : c;
  })();
  const f = (() => {
    const c = parseColor(P[fg]);
    return c[3] < 1 ? over(c, ground) : c;
  })();
  const [hi, lo] = [lum(f), lum(ground)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe('dark palette (parsed from the :root[data-theme=dark] block)', () => {
  it('lives in the real stylesheet, screen-only, and the spike file is gone', () => {
    expect(CSS).toMatch(/@media screen\s*\{\s*:root\[data-theme='dark'\]/);
    expect(DARK_BLOCK).toContain('color-scheme: dark');
    expect(() => readFileSync(join(__dirname, '..', 'styles', 'dark-spike.css'))).toThrow();
  });

  it('every light colour token has a dark counterpart (a missing one would paint the light value)', () => {
    const missing = Object.keys(LIGHT).filter((k) => !(k in DARK));
    expect(missing).toEqual([]);
  });

  it('includes shadows and the shimmer highlight', () => {
    for (const name of ['--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-xl', '--shadow-btn']) {
      expect(DARK_BLOCK).toContain(`${name}:`);
    }
    expect(DARK_BLOCK).toContain('--shimmer-highlight:');
    expect(DARK_BLOCK).toContain('--photo-filter:');
  });

  it.each(['bg', 'cream', 'bg-2'])('ink / ink-2 / ink-3 are >= 4.5:1 on %s', (ground) => {
    for (const fg of ['ink', 'ink-2', 'ink-3']) {
      expect(ratioIn(DARK, fg, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('placeholder (translucent) is >= 4.5:1 composited over the field ground', () => {
    expect(ratioIn(DARK, 'placeholder', 'cream', 'cream')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['cream', 'bg', 'bg-2'])('line-strong (control edge) is >= 3:1 on %s', (ground) => {
    expect(ratioIn(DARK, 'line-strong', ground)).toBeGreaterThanOrEqual(3);
  });

  it.each(['moss', 'terracotta', 'ink'])('focus / error edge %s is >= 3:1 on cream', (fg) => {
    expect(ratioIn(DARK, fg, 'cream')).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ['moss', 'moss-soft'],
    ['moss-deep', 'moss-soft'],
    ['terracotta-deep', 'terracotta-soft'],
    ['coral-deep', 'coral-soft'],
    ['clay-deep', 'clay-soft'],
    ['dusk-deep', 'dusk-soft'],
    ['amber-deep', 'amber-soft'],
  ])('%s text on its %s wash is >= 4.5:1 over both page and card', (fg, wash) => {
    for (const ground of ['bg', 'cream']) {
      expect(ratioIn(DARK, fg, wash, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['on-primary', 'primary-fill'],
    ['on-primary', 'primary-fill-hover'],
    ['on-fill', 'task-fill'],
    ['on-fill', 'medication-fill'],
    ['on-fill', 'appointment-fill'],
    ['on-raised', 'surface-raised'],
    ['ink', 'surface-toast'],
    ['menu-icon', 'menu-clay'],
    ['menu-icon', 'menu-dusk'],
    ['menu-icon', 'menu-moss'],
    ['menu-label', 'menu-pill'],
    ['on-apple', 'apple-fill'],
    ['on-badge', 'badge'],
  ])('role pairing %s on %s is >= 4.5:1', (fg, bg) => {
    expect(ratioIn(DARK, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['menu-clay', 'menu-dusk', 'menu-moss'])('%s disc reads against the add-menu pill (>= 3:1)', (disc) => {
    expect(ratioIn(DARK, disc, 'menu-pill')).toBeGreaterThanOrEqual(3);
  });

  it('toasts are raised charcoal in dark (owner decision), above the card surface', () => {
    expect(DARK['surface-toast']).toBe(DARK['surface-raised']);
    expect(DARK['surface-toast']).not.toBe(DARK['cream']);
    expect(ratioIn(DARK, 'moss', 'surface-toast')).toBeGreaterThanOrEqual(3);
    expect(ratioIn(DARK, 'terracotta-deep', 'surface-toast')).toBeGreaterThanOrEqual(3);
    expect(ratioIn(DARK, 'ink-3', 'surface-toast')).toBeGreaterThanOrEqual(3);
  });

  it('the primary fill is distinguishable from page and card (>= 3:1, non-text)', () => {
    expect(ratioIn(DARK, 'primary-fill', 'bg')).toBeGreaterThanOrEqual(3);
    expect(ratioIn(DARK, 'primary-fill', 'cream')).toBeGreaterThanOrEqual(3);
  });

  it.each(
    Object.keys(DARK)
      .filter((k) => k.startsWith('avatar-'))
      .map((k) => [k])
  )('avatar stop %s carries the (dark) cream initials at >= 4.5:1', (stop) => {
    expect(ratioIn(DARK, 'cream', stop)).toBeGreaterThanOrEqual(4.5);
  });

  it('light role tokens equal the hues they replaced, so light is unchanged', () => {
    expect(LIGHT['primary-fill']).toBe(LIGHT['moss']);
    expect(LIGHT['primary-fill-hover']).toBe(LIGHT['moss-mid']);
    expect(LIGHT['on-primary']).toBe(LIGHT['cream']);
    expect(LIGHT['task-fill']).toBe(LIGHT['moss']);
    expect(LIGHT['medication-fill']).toBe(LIGHT['clay']);
    expect(LIGHT['appointment-fill']).toBe(LIGHT['dusk']);
    expect(LIGHT['on-fill']).toBe(LIGHT['cream']);
    expect(LIGHT['surface-raised']).toBe(LIGHT['ink']);
    expect(LIGHT['on-raised']).toBe(LIGHT['cream']);
    expect(LIGHT['surface-toast']).toBe(LIGHT['cream']);
    expect(LIGHT['menu-pill']).toBe(LIGHT['ink']);
    expect(LIGHT['badge']).toBe(LIGHT['ink']);
    expect(LIGHT['apple-fill']).toBe(LIGHT['ink']);
    expect(LIGHT['photo-scrim']).toBe(LIGHT['ink']);
    expect(LIGHT['on-photo']).toBe(LIGHT['cream']);
    expect(LIGHT['avatar-moss']).toBe(LIGHT['moss']);
    expect(LIGHT['avatar-moss-deep']).toBe(LIGHT['moss-deep']);
    expect(LIGHT['avatar-clay-deep']).toBe(LIGHT['clay-ramp-deep']);
  });
});
