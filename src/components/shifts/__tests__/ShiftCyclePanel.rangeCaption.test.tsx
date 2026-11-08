import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { ShiftCyclePanel } from '../ShiftCyclePanel';
import { buildCyclePreview, previewRange } from '../shiftRotation';

// The rotation preview says WHEN it runs: a caption with the date range above the weekday header
// ("Nov 7 – Dec 18"; the year only when the range crosses one) and a month label on the FIRST cell
// ("Nov 7"), the same way the 1st of a month is labelled.

function panel(startDate: string) {
  return render(
    <ShiftCyclePanel
      daysOn="9"
      daysOff="8"
      onDaysOn={() => {}}
      onDaysOff={() => {}}
      startDate={startDate}
      language="en"
      dayHint={null}
    />
  );
}

describe('ShiftCyclePanel range caption and first-cell label', () => {
  it('captions the range inside one year without the year', () => {
    panel('2026-11-07');
    expect(screen.getByTestId('shift-cycle-range')).toHaveTextContent(/^Nov 7 – Dec 18$/);
  });

  it('adds the year to both ends when the range crosses New Year', () => {
    panel('2026-12-20');
    expect(screen.getByTestId('shift-cycle-range')).toHaveTextContent(/^Dec 20, 2026 – Jan 30, 2027$/);
  });

  it('the caption is outside the decorative grid, so a screen reader reads it', () => {
    panel('2026-11-07');
    const caption = screen.getByTestId('shift-cycle-range');
    expect(caption.closest('[aria-hidden="true"]')).toBeNull();
    // ...and the grid header still starts with the weekday initials.
    expect((screen.getByTestId('shift-cycle-preview').textContent ?? '').startsWith('SMTWTFS')).toBe(true);
  });

  it('labels the first cell with its month, like the 1st of a month', () => {
    panel('2026-11-07');
    const cells = screen.getAllByTestId('shift-cycle-cell');
    expect(cells[0]).toHaveTextContent(/^Nov 7$/);
    expect(cells[1]).toHaveTextContent(/^8$/);
    expect(cells[24]).toHaveTextContent(/^Dec 1$/);
  });

  it('a start on the 1st is labelled once, not twice', () => {
    const { cells } = buildCyclePreview('2026-12-01', 7, 7);
    expect(cells.filter((c) => c.labelled).map((c) => c.date)).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('range helper is pure wire-date math (no device zone)', () => {
    expect(previewRange('2027-02-10')).toEqual({ from: '2027-02-10', to: '2027-03-23', crossesYear: false });
    expect(previewRange('2026-12-20').crossesYear).toBe(true);
  });
});
