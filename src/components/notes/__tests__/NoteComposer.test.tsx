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
  // The submit row is a sticky footer: Post stays on screen while the form is
  // taller than the viewport. jsdom has no layout, so this pins the structure;
  // e2e/flows/sticky-save-footer.spec.ts measures the real geometry.
  it('keeps Post in a sticky footer row, disabled until there is something to post', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const post = screen.getByRole('button', { name: 'Post' });
    const footer = screen.getByTestId('note-composer-footer');
    expect(footer).toContainElement(post);
    expect(footer.className.split(/\s+/)).toContain('sticky');
    expect(footer.className).toMatch(/bg-cream/);
    expect(post).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'Slept well');
    expect(post).toBeEnabled();
  });

  // A failed post's alert must be on screen whenever Post is. At phone widths
  // the form is taller than the viewport, so an alert in the form's normal
  // flow (above the sticky row) ended up under the row + nav pill or below
  // the fold. It lives INSIDE the sticky footer, above Post, and Post points
  // at it so a screen reader on Post hears why the last attempt failed.
  it('renders a failed-post alert inside the sticky footer, above Post, linked via aria-describedby', () => {
    render(
      <NoteComposer
        idPrefix="note"
        draft={{ ...EMPTY_NOTE_DRAFT, body: 'Slept well' }}
        onChange={() => {}}
        onSubmit={() => {}}
        submitLabel="Post"
        error="Couldn't post your note."
      />
    );
    const footer = screen.getByTestId('note-composer-footer');
    const alert = screen.getByRole('alert');
    const post = screen.getByRole('button', { name: 'Post' });
    expect(alert).toHaveTextContent("Couldn't post your note.");
    expect(footer).toContainElement(alert);
    // Above Post in the footer (DOM order = visual order in the column).
    expect(alert.compareDocumentPosition(post) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert.id).toBe('note-error');
    expect(post).toHaveAttribute('aria-describedby', 'note-error');
    expect(post).toHaveAccessibleDescription("Couldn't post your note.");
  });

  it('leaves Post undescribed when there is no error', () => {
    render(<Harness />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Post' })).not.toHaveAttribute('aria-describedby');
  });

  // Post's bottom edge must sit exactly at the root scroll-padding-bottom band
  // (nav + inset + 16px): offset 12px + the row's 4px bottom padding. Less,
  // and every focus on Post scrolls the page (globals.css scroll-padding).
  it('rests the footer 12px above the nav pill (16px with its padding: the scroll-padding band)', () => {
    render(<Harness />);
    const classes = screen.getByTestId('note-composer-footer').className.split(/\s+/);
    expect(classes).toContain('bottom-[calc(var(--nav-h,64px)+var(--nav-inset,0px)+12px)]');
    expect(classes).toContain('pb-1');
    expect(classes).toContain('xl:bottom-3');
  });

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
