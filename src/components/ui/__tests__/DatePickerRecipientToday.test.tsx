import { useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { NoteComposer, EMPTY_NOTE_DRAFT, type NoteDraft } from '@/components/notes/NoteComposer';
import { addDaysToIsoDay } from '@/utils/recipientEventDate';
import { getDateInTimezone, getDeviceTimezone } from '@/utils/timezone';

/**
 * The date picker's "Today" must be the FIELD's today, not the viewer's.
 *
 * A note's date is a RECIPIENT-frame day (NoteComposer's `today` comes from the
 * server in the recipient's zone). The picker used to compute today from the
 * DEVICE zone, so a Denver viewer of a Sydney recipient at 2026-10-28T03:00Z
 * saw 10-27 ringed and "Today" saved noteDate 2026-10-27 (backdated); in the
 * reverse pairing "Today" was disabled because the viewer's today was past the
 * recipient's `max`.
 *
 * The device zone is the process zone (the TZ sweep varies it), so each case
 * builds the recipient's today RELATIVE to the device's today: one day ahead
 * and one day behind. Both are red from any device zone without the fix.
 */

const NOW = new Date('2026-10-28T03:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

function Harness({
  today,
  initial,
  onDraft,
}: {
  today: string;
  initial: NoteDraft;
  onDraft: (d: NoteDraft) => void;
}): ReactElement {
  const [draft, setDraft] = useState<NoteDraft>(initial);
  return (
    <NoteComposer
      idPrefix="note"
      draft={draft}
      onChange={(d) => {
        setDraft(d);
        onDraft(d);
      }}
      onSubmit={() => {}}
      submitLabel="Post"
      today={today}
    />
  );
}

async function openPicker(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Choose a date' }));
  await screen.findByRole('dialog', { name: 'Date picker' });
}

const deviceToday = () => getDateInTimezone(getDeviceTimezone(), NOW);

describe.each([
  ['recipient a day AHEAD of the viewer (Denver viewer, Sydney recipient)', 1],
  ['recipient a day BEHIND the viewer (Sydney viewer, Denver recipient)', -1],
])('note date picker: %s', (_label, offset) => {
  it('rings the recipient today, and Today saves the recipient today (noteDate null)', async () => {
    const recipientToday = addDaysToIsoDay(deviceToday(), offset);
    const pastDay = addDaysToIsoDay(recipientToday, -3);
    const onDraft = vi.fn();
    const user = userEvent.setup({ advanceTimers: () => undefined });
    render(
      <Harness
        today={recipientToday}
        initial={{ ...EMPTY_NOTE_DRAFT, body: 'x', noteDate: pastDay }}
        onDraft={onDraft}
      />
    );
    await openPicker(user);

    const ringed = document.querySelector<HTMLElement>('[aria-current="date"]');
    expect(ringed?.getAttribute('data-day')).toBe(recipientToday);

    const todayButton = screen.getByRole('button', { name: 'Today' });
    expect(todayButton).toBeEnabled();
    await user.click(todayButton);

    // `null` is "today" in the draft contract; a string here is a backdated note.
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ noteDate: null }));
  });
});
