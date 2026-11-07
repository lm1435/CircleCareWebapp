import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { TimeChips, type TimeChipsOther } from '../TimeChips';
import { CHOICE_TILE_BOX } from '@/components/ui/inputStyles';
import { ChipSelect } from '@/components/ui/ChipSelect';

// The "When?" row (owner 1.4.0, mobile StackedChoice parity): four time chips + "Other time" drawn as the
// same tile, in ONE content-sized wrapping row, whatever is selected. jsdom has no layout (memory: jsdom
// geometry blind), so this pins the STRUCTURE and the shared classes; e2e/flows/simple-add-flows.spec.ts
// measures the real row at phone width.

function renderChips(other?: Partial<TimeChipsOther>, value = '') {
  const onClick = vi.fn();
  const onChange = vi.fn();
  const el = (o?: Partial<TimeChipsOther>, v = value) => (
    <TimeChips
      id="time-chips"
      value={v}
      hourCycle="12h"
      onChange={onChange}
      other={{ label: 'Other time', expanded: false, selected: false, onClick, ...o }}
    />
  );
  const r = render(el(other));
  return { onClick, onChange, rerender: (o?: Partial<TimeChipsOther>, v?: string) => r.rerender(el(o, v)) };
}

/** The arrangement: every class and inline style on the row, the group and each tile's box. */
function arrangement() {
  const row = screen.getByTestId('time-chip-row');
  const tiles = [...within(row).getAllByRole('radio'), screen.getByTestId('time-chip-other')];
  return {
    row: [row.className, row.getAttribute('style')],
    group: [screen.getByRole('radiogroup').className, screen.getByRole('radiogroup').getAttribute('style')],
    tiles: tiles.map((t) => [t.className.replace(/bg-ink text-cream border-ink|border-line-strong text-ink hover:bg-bg-2/, ''), t.getAttribute('style')]),
  };
}

describe('TimeChips row', () => {
  it('one wrapping flex row: the radiogroup is display:contents so its radios and Other time share it; no grid', () => {
    renderChips();
    const row = screen.getByTestId('time-chip-row');
    expect(row).toHaveClass('flex', 'flex-wrap', 'gap-2');
    expect(row).not.toHaveClass('grid');
    expect(row).not.toHaveAttribute('data-columns');
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveClass('contents');
    const other = screen.getByRole('button', { name: 'Other time' });
    // Outside the radiogroup in the DOM: a radiogroup owns radios only.
    expect(within(group).queryByRole('button', { name: 'Other time' })).toBeNull();
    expect(row).toContainElement(other);
  });

  it('content-sized tiles that can never be wider than the row (no equal columns, no one-line clipping)', () => {
    renderChips({ time: '7:15 AM', selected: true });
    for (const tile of [screen.getByRole('radio', { name: /Morning/ }), screen.getByTestId('time-chip-other')]) {
      expect(tile).toHaveClass('max-w-full');
      expect(tile).not.toHaveClass('overflow-hidden');
      expect(tile.style.gridRow).toBe('');
      tile.querySelectorAll('span').forEach((span) => expect(span).not.toHaveClass('whitespace-nowrap'));
    }
  });

  it('Other time is the SAME tile as the time chips (radius, min height, border, padding, centring)', () => {
    renderChips();
    const other = screen.getByRole('button', { name: 'Other time' });
    const chip = screen.getByRole('radio', { name: /Morning/ });
    for (const cls of CHOICE_TILE_BOX.split(' ')) {
      expect(other).toHaveClass(cls);
      expect(chip).toHaveClass(cls);
    }
    expect(other).toHaveClass('rounded-2xl', 'min-h-[56px]', 'border', 'px-3.5', 'py-2', 'justify-center');
    expect(other).not.toHaveClass('rounded-full');
  });

  it('Other time with no time: its label alone; with one: label over time (line styles of a chip), named "Other time, 7:15 AM"', () => {
    const { rerender } = renderChips();
    expect(screen.queryByTestId('time-chip-other-time')).toBeNull();
    // An invisible, unnamed second line keeps it as tall as the two-line chips.
    const spacer = screen.getByTestId('time-chip-other-spacer');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).toHaveClass('invisible');
    expect(screen.getByRole('button', { name: 'Other time' })).toBeInTheDocument();
    rerender({ time: '7:15 AM', selected: true });
    const other = screen.getByRole('button', { name: 'Other time, 7:15 AM' });
    const [label, time] = Array.from(other.querySelectorAll('span'));
    expect([label.textContent, time.textContent]).toEqual(['Other time', '7:15 AM']);
    const chipSpans = Array.from(screen.getByRole('radio', { name: /Morning/ }).querySelectorAll('span'));
    expect(label.className).toBe(chipSpans[0].className);
    expect(other.textContent).not.toContain('·');
  });

  it('DETERMINISTIC: opened on a custom time == after a chip is picked == after another custom time', () => {
    const { rerender } = renderChips({ time: '3:15 AM', selected: true });
    const first = arrangement();
    rerender({}, '21:00');
    expect(screen.getByRole('radio', { name: /Bedtime/ })).toBeChecked();
    expect(arrangement()).toEqual(first);
    rerender({ time: '10:45 PM', selected: true }, '22:45');
    expect(arrangement()).toEqual(first);
  });

  it('keeps the button role and aria-expanded; a tap calls onClick, not onChange', async () => {
    const { onClick, onChange } = renderChips({ expanded: true });
    const other = screen.getByRole('button', { name: 'Other time' });
    expect(other).toHaveAttribute('aria-expanded', 'true');
    await userEvent.setup().click(other);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selected (a custom time) is lit like a chosen chip; unselected is not', () => {
    renderChips({ selected: true }, '08:00');
    const other = screen.getByRole('button', { name: 'Other time' });
    const lit = screen.getByRole('radio', { name: /Morning/ });
    expect(lit).toBeChecked();
    expect(other).toHaveClass('bg-ink');
    expect(lit).toHaveClass('bg-ink');
    expect(screen.getByRole('radio', { name: /Midday/ })).not.toHaveClass('bg-ink');
  });

  it('the four radios keep their names and roving tab stop', () => {
    renderChips();
    const radios = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('large text (24px root): still the same wrapping row, never a one-column list', () => {
    document.documentElement.style.fontSize = '24px';
    try {
      renderChips();
      expect(screen.getByTestId('time-chip-row')).toHaveClass('flex', 'flex-wrap');
      expect(screen.getByRole('button', { name: 'Other time' })).not.toHaveClass('w-full');
    } finally {
      document.documentElement.style.fontSize = '';
    }
  });
});

describe('"How often?" uses the same tile (ChipSelect variant="tile")', () => {
  it('same box as the time chips, label in the tile font; the pill stays the default', () => {
    const { rerender } = render(
      <ChipSelect label="How often?" variant="tile" options={['Every day', 'Some days']} value="Every day" onChange={vi.fn()} />
    );
    const tile = screen.getByRole('radio', { name: 'Every day' });
    for (const cls of CHOICE_TILE_BOX.split(' ')) expect(tile).toHaveClass(cls);
    expect(tile).not.toHaveClass('rounded-full');
    expect(tile.querySelector('span')).toHaveClass('text-base', 'font-medium');
    rerender(<ChipSelect label="How often?" options={['Every day', 'Some days']} value="Every day" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Every day' })).toHaveClass('rounded-full');
  });
});
