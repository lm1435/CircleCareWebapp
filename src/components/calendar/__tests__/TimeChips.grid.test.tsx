import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { nextFitColumns } from '@/lib/largeText';
import {
  TIME_CHIP_BOX,
  TIME_CHIP_MAX_COLUMNS,
  TimeChips,
  gridCellPlacement,
  type TimeChipsOther,
} from '../TimeChips';

// The "When?" grid (owner 1.4.0, mobile parity): four time chips + "Other time" drawn as the same chip,
// in equal columns. jsdom has no layout (memory: jsdom geometry blind), so this pins the STRUCTURE,
// the shared classes and the column arithmetic; e2e/flows/simple-add-flows.spec.ts measures the real
// rows at 375px and desktop.

function renderChips(other?: Partial<TimeChipsOther>, value = '') {
  const onClick = vi.fn();
  const onChange = vi.fn();
  render(
    <TimeChips
      id="time-chips"
      value={value}
      hourCycle="12h"
      onChange={onChange}
      other={{ label: 'Other time', expanded: false, selected: false, onClick, ...other }}
    />
  );
  return { onClick, onChange };
}

function stubSubgrid(supported: boolean) {
  vi.stubGlobal('CSS', { supports: (prop: string, val: string) => supported && val === 'subgrid' && !!prop });
}

afterEach(() => vi.unstubAllGlobals());

describe('gridCellPlacement / nextFitColumns (pure)', () => {
  it('3 columns: Morning/Midday/Evening, then Bedtime + Other time at row 2, column 2', () => {
    expect(TIME_CHIP_MAX_COLUMNS).toBe(3);
    expect(gridCellPlacement(0, 3)).toEqual({ row: 1, column: 1 });
    expect(gridCellPlacement(3, 3)).toEqual({ row: 2, column: 1 });
    expect(gridCellPlacement(4, 3)).toEqual({ row: 2, column: 2 });
  });
  it('2 columns puts Other time at row 3; 1 column at row 5', () => {
    expect(gridCellPlacement(4, 2)).toEqual({ row: 3, column: 1 });
    expect(gridCellPlacement(4, 1)).toEqual({ row: 5, column: 1 });
    expect(gridCellPlacement(4, 0)).toEqual({ row: 5, column: 1 });
  });
  it('a measured overflow drops one column, never below one', () => {
    expect(nextFitColumns(3, true)).toBe(2);
    expect(nextFitColumns(2, true)).toBe(1);
    expect(nextFitColumns(1, true)).toBe(1);
    expect(nextFitColumns(3, false)).toBe(3);
  });
});

describe('TimeChips grid', () => {
  it('starts at 3 equal columns, the radiogroup spans the chip rows as a subgrid, Other time is placed at row 2 / column 2', () => {
    stubSubgrid(true);
    renderChips();
    const grid = screen.getByTestId('time-chip-grid');
    expect(grid).toHaveAttribute('data-columns', '3');
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('data-columns', '3');
    expect(group.style.gridRow).toBe('1 / span 2');
    const other = screen.getByRole('button', { name: 'Other time' });
    expect(other.style.gridRow).toBe('2');
    expect(other.style.gridColumn).toBe('2');
    // Outside the radiogroup in the DOM: a radiogroup owns radios only.
    expect(within(group).queryByRole('button', { name: 'Other time' })).toBeNull();
    expect(grid).toContainElement(other);
  });

  it('Other time is the SAME chip box as the time chips (radius, min height, border, padding)', () => {
    renderChips();
    const other = screen.getByRole('button', { name: 'Other time' });
    const chip = screen.getByRole('radio', { name: /Morning/ });
    for (const cls of TIME_CHIP_BOX.split(' ')) {
      expect(other).toHaveClass(cls);
      expect(chip).toHaveClass(cls);
    }
    expect(other).toHaveClass('rounded-2xl', 'min-h-[56px]', 'border', 'px-3.5', 'py-2', 'justify-center');
    expect(other).not.toHaveClass('rounded-full');
    expect(other).not.toHaveClass('underline-offset-2');
  });

  it('FALSIFIER: labels and times stay on one line while there is more than one column (so an overflow drops a column)', () => {
    renderChips();
    const other = screen.getByRole('button', { name: 'Other time' });
    expect(other.querySelector('span')).toHaveClass('whitespace-nowrap');
    const chip = screen.getByRole('radio', { name: /Morning/ });
    chip.querySelectorAll('span').forEach((span) => expect(span).toHaveClass('whitespace-nowrap'));
    for (const cell of [other, chip]) expect(cell).toHaveAttribute('data-fit-cell');
  });

  it('keeps the button role, its name and aria-expanded; a tap calls onClick, not onChange', async () => {
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

  it('no subgrid (older browsers): Other time takes its own row in the same 3 columns', () => {
    stubSubgrid(false);
    renderChips();
    const other = screen.getByRole('button', { name: 'Other time' });
    expect(other.style.gridRow).toBe('');
    expect((other.parentElement as HTMLElement).style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(screen.getByRole('radiogroup').style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('large text (24px root) is ONE column', () => {
    document.documentElement.style.fontSize = '24px';
    try {
      renderChips();
      expect(screen.getByTestId('time-chip-grid')).toHaveAttribute('data-columns', '1');
      // One column: text may wrap.
      expect(screen.getByRole('button', { name: 'Other time' }).querySelector('span')).not.toHaveClass('whitespace-nowrap');
    } finally {
      document.documentElement.style.fontSize = '';
    }
  });
});
