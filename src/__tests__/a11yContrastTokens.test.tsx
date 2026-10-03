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
