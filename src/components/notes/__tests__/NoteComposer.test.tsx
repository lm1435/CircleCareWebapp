import { useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { NoteComposer, EMPTY_NOTE_DRAFT, type NoteDraft } from '../NoteComposer';

// One selection language — the category chips share ChipSelect's ink
// selected treatment, interactive state (decision 2026-09-04), never
// coral-deep.

/** Stateful harness so a click toggling a category actually re-renders. */
function Harness(): ReactElement {
  const [draft, setDraft] = useState<NoteDraft>(EMPTY_NOTE_DRAFT);
  return (
    <NoteComposer
      idPrefix="note"
      draft={draft}
      onChange={setDraft}
      onSubmit={() => {}}
      submitLabel="Post"
    />
  );
}

describe('NoteComposer', () => {
  it('renders the mood and categories field labels', () => {
    render(<Harness />);
    expect(screen.getByText('Mood')).toBeInTheDocument();
    expect(screen.getByText('Categories')).toBeInTheDocument();
  });

  it('gives a toggled category chip the ink selection treatment, not bg-coral-deep', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const mealChip = screen.getByRole('button', { name: 'Meal' });
    expect(mealChip).toHaveAttribute('aria-pressed', 'false');
    expect(mealChip.className).not.toContain('bg-ink');

    await user.click(mealChip);

    expect(mealChip).toHaveAttribute('aria-pressed', 'true');
    expect(mealChip.className).toContain('bg-ink');
    expect(mealChip.className).not.toContain('bg-coral-deep');
  });
});
