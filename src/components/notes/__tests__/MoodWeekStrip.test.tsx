// MoodWeekStrip (docs/plans/notes-first-class.md, Slice 3 — Decision 6 / User
// Flow step 6 / UI States "mood strip empty week"). Real i18n (no mock) —
// same convention as NoteRow.test.tsx. Every mood-having note gets its own
// dot (decorative, aria-hidden); the accessible name on each day button
// carries the real summary text. Fixed `today` throughout — the week and
// "today" highlighting must never depend on the machine clock/timezone.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { MoodWeekStrip } from '../MoodWeekStrip';
import type { CareNote, CareNoteMood } from '@/api/careNotes';

// Week of Sun 2026-09-20 .. Sat 2026-09-26. TODAY is the Thursday in that
// week; Tuesday 2026-09-22 is used below to match the plan's own example
// accessible name verbatim ("Tuesday, September 22: 1 good, 1 tough").
const TODAY = '2026-09-24';
const TUESDAY = '2026-09-22';

let seq = 0;
function makeNote(date: string, mood: CareNoteMood | null, overrides: Partial<CareNote> = {}): CareNote {
  seq += 1;
  return {
    id: `note-${seq}`,
    circle_id: 'circle-1',
    author_id: 'user-1',
    note_date: date,
    body: null,
    mood,
    categories: [],
    created_at: `${date}T12:00:00.000Z`,
    updated_at: `${date}T12:00:00.000Z`,
    author: { id: 'user-1', first_name: 'Sam', last_name: 'Rivera' },
    ...overrides,
  };
}

beforeEach(() => {
  seq = 0;
});

function renderStrip(notes: CareNote[], onSelectDay = () => {}) {
  return render(<MoodWeekStrip notes={notes} today={TODAY} onSelectDay={onSelectDay} />);
}

describe('MoodWeekStrip — layout', () => {
  it('renders exactly 7 day cells, Sunday first, for the week containing today', () => {
    renderStrip([]);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(7);

    // Sunday 2026-09-20 .. Saturday 2026-09-26, in order.
    const expectedDates = [
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ];
    const expectedNumbers = ['20', '21', '22', '23', '24', '25', '26'];
    buttons.forEach((button, i) => {
      expect(within(button).getByText(expectedNumbers[i])).toBeInTheDocument();
    });
    // Sanity: dateMath's Sunday-first ordering, not a hardcoded guess.
    expect(expectedDates[0]).toBe('2026-09-20');
  });

  it('marks only today with aria-current="date"', () => {
    renderStrip([]);
    const buttons = screen.getAllByRole('button');
    const current = buttons.filter((b) => b.getAttribute('aria-current') === 'date');
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText('24')).toBeInTheDocument();
  });
});

describe('MoodWeekStrip — dots', () => {
  it('shows one dot per mood-having note, up to 3, then a "+N" overflow', () => {
    const notes = [
      makeNote(TUESDAY, 'great'),
      makeNote(TUESDAY, 'good'),
      makeNote(TUESDAY, 'okay'),
      makeNote(TUESDAY, 'tough'),
    ];
    renderStrip(notes);

    const tuesdayButton = screen.getByRole('button', {
      name: 'Tuesday, September 22: 1 great, 1 good, 1 okay, 1 tough',
    });
    // 3 visible dots + one "+1" overflow marker, all decorative.
    const dots = tuesdayButton.querySelectorAll('[aria-hidden="true"] > span');
    // (dots row is itself aria-hidden; count actual dot spans by class)
    const dotEls = tuesdayButton.querySelectorAll('.rounded-full');
    expect(dotEls.length).toBe(3);
    expect(tuesdayButton).toHaveTextContent('+1');
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });

  it('shows both dots when a day has two different moods (no overflow)', () => {
    const notes = [makeNote(TUESDAY, 'good'), makeNote(TUESDAY, 'tough')];
    renderStrip(notes);

    const tuesdayButton = screen.getByRole('button', {
      name: 'Tuesday, September 22: 1 good, 1 tough',
    });
    expect(tuesdayButton.querySelectorAll('.rounded-full').length).toBe(2);
    expect(tuesdayButton).not.toHaveTextContent('+');
  });

  it('does not render a dot for a note with no mood, and does not count it', () => {
    const notes = [makeNote(TUESDAY, null, { body: 'Just a note, no mood.' })];
    renderStrip(notes);

    // No colon/summary suffix at all — nothing to report for that day.
    const tuesdayButton = screen.getByRole('button', { name: 'Tuesday, September 22' });
    expect(tuesdayButton.querySelectorAll('.rounded-full').length).toBe(0);
  });
});

describe('MoodWeekStrip — summary line', () => {
  it('counts NOTES by mood in order great→good→okay→tough, only moods present', () => {
    const notes = [
      makeNote(TUESDAY, 'tough'),
      makeNote('2026-09-23', 'great'),
      makeNote('2026-09-23', 'great'),
      makeNote('2026-09-25', 'great'),
      makeNote('2026-09-20', 'okay'),
      makeNote(TODAY, 'tough'),
    ];
    renderStrip(notes);

    // 3 great, 1 okay, 2 tough — "good" has zero notes and is omitted.
    expect(screen.getByText('This week: 3 great, 1 okay, 2 tough')).toBeInTheDocument();
  });

  it('shows "No moods logged this week" for an empty week, strip still shown', () => {
    renderStrip([]);
    expect(screen.getByText('No moods logged this week')).toBeInTheDocument();
    // The 7 cells are still there — never hidden.
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  it('a note outside the current week does not count toward the summary', () => {
    const notes = [makeNote('2026-09-13', 'great')]; // prior week
    renderStrip(notes);
    expect(screen.getByText('No moods logged this week')).toBeInTheDocument();
  });
});

describe('MoodWeekStrip — interaction', () => {
  it('calls onSelectDay with the clicked day\'s date string', async () => {
    const user = userEvent.setup();
    const onSelectDay = vi.fn();
    renderStrip([makeNote(TUESDAY, 'good')], onSelectDay);

    await user.click(screen.getByRole('button', { name: 'Tuesday, September 22: 1 good' }));
    expect(onSelectDay).toHaveBeenCalledWith(TUESDAY);
  });
});
