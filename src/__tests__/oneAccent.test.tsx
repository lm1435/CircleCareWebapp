import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ChoiceTileButton } from '@/components/ui/ChoiceTileButton';
import { Checkbox } from '@/components/ui/Checkbox';
import { Toggle } from '@/components/ui/Toggle';
import { CHIP_SELECTED } from '@/components/ui/inputStyles';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { FloatingNavBar } from '@/components/layout/FloatingNavBar';

// ONE ACCENT (owner 2026-11-07, mock artifact 4xz6CSNgqu2nJZp4g2mw97): moss fills ONLY the primary
// action, in BOTH themes. Selection stays neutral (ink in light, warm white in dark); decoration
// (eyebrows, the AI nav mark) is neutral; colour is kept for meaning.

const SRC = join(__dirname, '..');
const CSS = readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8');

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

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

const LIGHT = tokens(blockOf('@theme {'));
const DARK = tokens(blockOf(":root[data-theme='dark'] {"));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('primary = moss in both themes (globals.css tokens)', () => {
  it('light: moss #5c6b4e under white text, >= 4.5:1', () => {
    expect(LIGHT['primary-fill']).toBe('#5c6b4e');
    expect(LIGHT['on-primary']).toBe('#ffffff');
    expect(contrast(LIGHT['on-primary'], LIGHT['primary-fill'])).toBeGreaterThanOrEqual(4.5);
  });

  it('dark: the dark moss token #8a9e78 under near-black text, >= 4.5:1 (never the cream selection fill)', () => {
    expect(DARK['primary-fill']).toBe(DARK['moss']);
    expect(DARK['primary-fill']).toBe('#8a9e78');
    expect(DARK['primary-fill']).not.toBe(DARK['ink']);
    expect(luminance(DARK['on-primary'])).toBeLessThan(0.02);
    expect(contrast(DARK['on-primary'], DARK['primary-fill'])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('%s: hover and active fills derive from moss and keep the label >= 4.5:1', (_name, P) => {
    for (const state of ['primary-fill-hover', 'primary-fill-active']) {
      expect(P[state], state).toBeDefined();
      expect(contrast(P['on-primary'], P[state])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('%s: the outline variant text is >= 4.5:1 on page and card', (_name, P) => {
    expect(contrast(P['primary-outline'], P['cream'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(P['primary-outline'], P['bg'])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('%s: the selection fill is neutral ink, distinct from the primary', (_name, P) => {
    expect(P['selected-fill']).toBe(P['ink']);
    expect(P['selected-fill']).not.toBe(P['primary-fill']);
    expect(contrast(P['on-selected'], P['selected-fill'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Button primary / outline variants', () => {
  it('primary: fill, hover, active and focus ring all read the primary tokens', () => {
    render(<Button variant="primary">Save</Button>);
    const cls = screen.getByRole('button', { name: 'Save' }).className;
    for (const c of [
      'bg-primary-fill',
      'text-on-primary',
      'hover:bg-primary-fill-hover',
      'active:bg-primary-fill-active',
      'focus-visible:outline-primary-fill',
    ]) {
      expect(cls.split(/\s+/)).toContain(c);
    }
  });

  it('outline: moss border + moss text on a transparent fill (never the primary fill)', () => {
    render(<Button variant="outline">Done</Button>);
    const parts = screen.getByRole('button', { name: 'Done' }).className.split(/\s+/);
    expect(parts).toContain('bg-transparent');
    expect(parts).toContain('border-primary-outline');
    expect(parts).toContain('text-primary-outline');
    expect(parts).not.toContain('bg-primary-fill');
  });
});

describe('selected states stay neutral (never the primary token)', () => {
  it('segmented control: the thumb and the active label use the selection fill', () => {
    render(
      <SegmentedControl
        label="Mode"
        options={[
          { value: 'schedule', label: 'Schedule' },
          { value: 'shifts', label: 'Shifts' },
        ]}
        value="shifts"
        onChange={() => {}}
      />
    );
    const thumb = screen.getByTestId('segmented-thumb');
    expect(thumb.className).toContain('bg-selected-fill');
    expect(thumb.className).not.toContain('primary');
    const active = screen.getByRole('tab', { name: 'Shifts' });
    expect(active.className).toContain('text-on-selected');
    expect(active.className).not.toContain('primary');
  });

  it('selected choice tile and chip: neutral ink, no primary token', () => {
    render(<ChoiceTileButton label="Once" selected onClick={() => {}} />);
    const tile = screen.getByRole('button', { name: 'Once' });
    expect(tile.className).toContain('bg-ink');
    expect(tile.className).not.toContain('primary');
    expect(CHIP_SELECTED).not.toContain('primary');
  });

  it('checked checkbox and switch: selection fill, not primary', () => {
    render(
      <>
        <Checkbox checked onChange={() => {}} label="Remind me" />
        <Toggle checked onChange={() => {}} label="Reminders" />
      </>
    );
    const box = screen.getByRole('checkbox', { name: 'Remind me' }).querySelector('span');
    const track = screen.getByRole('switch', { name: 'Reminders' }).querySelector('span');
    expect(box?.className).toContain('bg-selected-fill');
    expect(box?.className).not.toContain('primary');
    expect(track?.className).toContain('bg-selected-fill');
    expect(track?.className).not.toContain('primary');
  });

  it('no selection surface reads the primary token anywhere in src (Button / careCard actions only)', () => {
    const allowed = new Set([
      'components/ui/Button.tsx',
      'components/ui/careCard.ts',
    ]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('globals.css')) {
          const rel = relative(SRC, p);
          if (/(bg|border|text)-(primary-fill|on-primary)/.test(readFileSync(p, 'utf8')) && !allowed.has(rel)) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

describe('decoration goes neutral', () => {
  it('no Eyebrow is painted moss', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === '__tests__' || name === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.tsx')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/<Eyebrow\b[^>]*>/g)) {
            if (/color="moss"/.test(m[0])) offenders.push(`${relative(SRC, p)}: ${m[0]}`);
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it('the page masthead eyebrow is muted ink whatever the section tone', () => {
    render(
      <MemoryRouter>
        <PageMasthead section="Care" tone="dusk" title="Calendar" />
      </MemoryRouter>
    );
    const eyebrow = screen.getByText('Care');
    expect(eyebrow.className).not.toMatch(/text-(dusk|moss|clay|terracotta|coral)/);
    expect(eyebrow.className).toContain('text-ink-3');
    expect(eyebrow.querySelector('span[aria-hidden="true"]')).toBeNull(); // dot-less since the left-aligned masthead eyebrow
  });

  it('the AI nav mark is the inactive nav colour, not coral', () => {
    render(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <Routes>
          <Route
            path="/circles/:circleId/*"
            element={
              <FloatingNavBar
                circleId="c1"
                canCreate
                addOpen={false}
                onToggleAdd={vi.fn()}
                onOpenAssistant={vi.fn()}
                assistantAccess="allowed"
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );
    const ai = screen.getByRole('button', { name: /AI/ });
    expect(ai.innerHTML).not.toMatch(/coral/);
  });
});
