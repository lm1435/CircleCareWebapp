// The History tab's filter row, plus the option-list derivation that feeds it.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { MedicationFilter } from '../MedicationFilter';
import { medicationOptions, historyParams, type HistoryConfirmation } from '../historyQuery';

const OPTIONS = [
  { id: 'Metformin', name: 'Metformin' },
  { id: 'Warfarin', name: 'Warfarin' },
];

function renderFilter(value: string | null, onChange = vi.fn()) {
  render(<MedicationFilter options={OPTIONS} value={value} onChange={onChange} />);
  return onChange;
}

describe('MedicationFilter', () => {
  it('reads "All medications" until one is chosen', () => {
    renderFilter(null);
    expect(screen.getByRole('button', { name: 'Filter by: All medications' })).toBeInTheDocument();
  });

  it('names the chosen medication on the trigger', () => {
    renderFilter('Warfarin');
    expect(screen.getByRole('button', { name: 'Filter by: Warfarin' })).toBeInTheDocument();
  });

  it('offers every option plus All, and reports the choice', async () => {
    const user = userEvent.setup();
    const onChange = renderFilter(null);

    await user.click(screen.getByRole('button', { name: 'Filter by: All medications' }));

    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'All medications',
      'Metformin',
      'Warfarin',
    ]);

    await user.click(screen.getByRole('menuitem', { name: 'Warfarin' }));
    expect(onChange).toHaveBeenCalledWith('Warfarin');
  });

  it('clears the filter back to null', async () => {
    const user = userEvent.setup();
    const onChange = renderFilter('Warfarin');

    await user.click(screen.getByRole('button', { name: 'Filter by: Warfarin' }));
    await user.click(screen.getByRole('menuitem', { name: 'All medications' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps the trigger at the 44px minimum target', () => {
    renderFilter(null);
    expect(
      screen.getByRole('button', { name: 'Filter by: All medications' }).className
    ).toContain('min-h-[44px]');
  });
});

// ---------------------------------------------------------------------------
// The options come from the history page itself, keyed by medication NAME.
//
// Not by event id, and the reason is not cosmetic: the confirmations endpoint
// filters with `.eq('event_id', …)`, and a recurring medication's
// confirmations are written against the MATERIALIZED CHILD of each occurrence,
// never the series root the roster hands out. Filtering a daily medication by
// its root id returns an empty history for the medication the caregiver just
// asked to see. Mobile filters by name for the same reason.
// ---------------------------------------------------------------------------

function conf(name: string | null, id: string): HistoryConfirmation {
  return {
    id,
    event_id: id,
    circle_id: 'circle-1',
    confirmed_by: 'u1',
    confirmed_at: '2026-09-05T14:00:00Z',
    status: 'taken',
    scheduled_time: '08:00:00',
    event: { id, medication_name: name, title: 'Untitled', scheduled_date: '2026-09-05' },
  };
}

describe('medicationOptions', () => {
  it('lists each medication once, in first-seen order', () => {
    expect(
      medicationOptions([
        conf('Warfarin', 'a'),
        conf('Metformin', 'b'),
        conf('Warfarin', 'c'),
      ])
    ).toEqual([
      { id: 'Warfarin', name: 'Warfarin' },
      { id: 'Metformin', name: 'Metformin' },
    ]);
  });

  it('falls back to the event title and skips a row with neither', () => {
    expect(medicationOptions([conf(null, 'a')])).toEqual([
      { id: 'Untitled', name: 'Untitled' },
    ]);
    expect(medicationOptions([{ ...conf(null, 'a'), event: null }])).toEqual([]);
  });
});

describe('historyParams', () => {
  it('spans 30 local days ending today, in the circle timezone', () => {
    // 2026-09-05T04:00:00Z is still 2026-09-04 in Denver — the case where a
    // device-local read would name the wrong end date.
    const params = historyParams('America/Denver', new Date('2026-09-05T04:00:00Z'));
    expect(params).toEqual({
      start_date: '2026-08-06',
      end_date: '2026-09-04',
    });
  });

  // The WINDOW is the query key. A `limit`/`offset` in here would fork the page
  // size out of the hook's control and give the page's copy of the query a
  // different cache entry from the list's.
  it('carries no paging parameters', () => {
    const params = historyParams('America/Denver', new Date('2026-09-05T04:00:00Z'));
    expect(params).not.toHaveProperty('limit');
    expect(params).not.toHaveProperty('offset');
  });
});
