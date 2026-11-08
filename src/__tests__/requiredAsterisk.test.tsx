import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import '@/i18n';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { INPUT_ERROR } from '@/components/ui/inputStyles';

// Owner 2026-11-07 (mobile parity): every field the user MUST fill shows a red asterisk after its
// label, in the field-error colour, aria-hidden (the control carries aria-required).

const CSS = readFileSync(join(__dirname, '..', 'styles', 'globals.css'), 'utf8');

function hexIn(open: string, name: string): string {
  const start = CSS.indexOf(open);
  const block = CSS.slice(start, CSS.indexOf('\n}', start));
  const m = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`${name} not found in ${open}`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The colour utility the field error line uses (`text-terracotta`). */
const ERROR_TEXT = INPUT_ERROR.split(/\s+/).find((c) => /^text-(?!sm|xs|base|md|lg)/.test(c))!;

describe('FieldLabel required asterisk', () => {
  it('renders the label then an aria-hidden "*" in the field-error colour (the name stays the label)', () => {
    render(
      <FieldLabel htmlFor="x" required>
        Shift name
      </FieldLabel>
    );
    const label = screen.getByText('Shift name').closest('label')!;
    expect(label).toHaveAttribute('for', 'x');
    const star = Array.from(label.querySelectorAll('[aria-hidden="true"]')).find((n) =>
      n.textContent?.includes('*')
    );
    expect(star).toBeDefined();
    expect(star!.className.split(/\s+/)).toContain(ERROR_TEXT);
    // The control's aria-required announces it; no duplicate sr-only "(required)" in the name.
    expect(label).not.toHaveTextContent('(required)');
  });

  it('no asterisk without `required`', () => {
    render(<FieldLabel htmlFor="y">Notes</FieldLabel>);
    expect(screen.getByText('Notes').closest('label')).not.toHaveTextContent('*');
  });

  it.each([
    ['light', '@theme {'],
    ['dark', ":root[data-theme='dark'] {"],
  ])('%s: the error colour is >= 4.5:1 on page and card', (_n, open) => {
    const token = ERROR_TEXT.replace(/^text-/, '');
    for (const ground of ['bg', 'cream']) {
      expect(contrast(hexIn(open, token), hexIn(open, ground))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
