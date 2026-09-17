// Daily Care Notes — NotesPage page slice (docs/plans/daily-care-notes.md,
// Web Task 19). The careNotes hooks, useCircle, the auth store, and Analytics
// are mocked so the test asserts page wiring; i18n + ToastProvider are real.
//
// Covered per the plan: composer gate (body-or-mood), mood single-select
// toggle + category multi-toggle (aria-pressed in labeled groups), day
// grouping with recipient-TZ labels, calm empty state, view-only gating, and
// own-note edit/delete affordances (owner may delete any). Anchored-regex
// getByLabelText per the RequiredMarker convention.
//
// Timezone-independent: `today` comes off the mocked notes response (never the
// machine clock), and non-relative day labels are computed with the same
// UTC-noon Intl call the page uses.

import { act, render, screen, within } from '@testing-library/react';
import { submitFormTwice } from '@/test/doubleSubmit';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';
import NotesPage from '../NotesPage';
import type { CareNote } from '@/api/careNotes';

// ── Hook mocks ───────────────────────────────────────────────────────────────

const mockUseCareNotes = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/hooks/useCareNotes', () => ({
  useCareNotes: (circleId: string, params: unknown) => mockUseCareNotes(circleId, params),
  useCreateCareNote: () => ({ mutate: mockCreate, isPending: false }),
  useUpdateCareNote: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteCareNote: () => ({ mutate: mockDelete, isPending: false }),
}));

let circleState: { circle: { owner_id: string } | undefined; canEdit: boolean } = {
  circle: { owner_id: 'owner-1' },
  canEdit: true,
};

vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => circleState,
}));

let currentUserId: string | undefined = 'user-1';

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: currentUserId ? { id: currentUserId } : null }),
}));

const mockCareNotesViewed = vi.fn();
const mockCareNoteAdded = vi.fn();
const mockCareNoteUpdated = vi.fn();
const mockCareNoteDeleted = vi.fn();

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    careNotesViewed: (...args: unknown[]) => mockCareNotesViewed(...args),
    careNoteAdded: (...args: unknown[]) => mockCareNoteAdded(...args),
    careNoteUpdated: (...args: unknown[]) => mockCareNoteUpdated(...args),
    careNoteDeleted: (...args: unknown[]) => mockCareNoteDeleted(...args),
    errorOccurred: vi.fn(),
  },
}));

// NoteRow reads the viewer's 12h/24h clock via the shared currentUser React
// Query (WA2, landed concurrently in this same in-flight batch). Pin it here
// exactly like TasksPage.test.tsx does, so this page test needs no
// QueryClientProvider and note-time labels never depend on the runner's
// navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CIRCLE_ID = 'circle-1';
const TZ = 'America/Chicago';
const TODAY = '2026-03-15';

function makeNote(overrides: Partial<CareNote> = {}): CareNote {
  return {
    id: 'note-1',
    circle_id: CIRCLE_ID,
    author_id: 'user-1',
    note_date: TODAY,
    body: 'Quiet morning, good appetite.',
    mood: null,
    categories: [],
    created_at: '2026-03-15T14:00:00Z',
    updated_at: '2026-03-15T14:00:00Z',
    author: { id: 'user-1', first_name: 'Ana', last_name: 'Lopez' },
    ...overrides,
  };
}

function notesResult(notes: CareNote[], overrides: Record<string, unknown> = {}) {
  return {
    data: { notes, today: TODAY, timezone: TZ },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/circles/${CIRCLE_ID}/notes`]}>
        <Routes>
          <Route path="/circles/:circleId/notes" element={<NotesPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

/** The <li> entry card containing the given note body text. */
function rowContaining(text: string): HTMLElement {
  const el = screen.getByText(text).closest('li');
  if (!el) throw new Error(`No <li> row contains "${text}"`);
  return el;
}

beforeEach(() => {
  mockUseCareNotes.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockCareNotesViewed.mockReset();
  mockCareNoteAdded.mockReset();
  mockCareNoteUpdated.mockReset();
  mockCareNoteDeleted.mockReset();
  mockUseHourCycle.mockReturnValue('12h');
  circleState = { circle: { owner_id: 'owner-1' }, canEdit: true };
  currentUserId = 'user-1';
  mockUseCareNotes.mockReturnValue(notesResult([makeNote()]));
});

describe('NotesPage — composer gate', () => {
  it('disables Post until body or mood is set, re-disables when cleared', async () => {
    const user = userEvent.setup();
    renderPage();

    const post = screen.getByRole('button', { name: 'Post' });
    expect(post).toBeDisabled();

    // Body alone enables.
    const field = screen.getByLabelText(/^Add a note/);
    await user.type(field, 'Walked in the garden');
    expect(post).toBeEnabled();

    await user.clear(field);
    expect(post).toBeDisabled();

    // Mood alone enables.
    const moodGroup = screen.getByRole('radiogroup', { name: 'Mood' });
    await user.click(within(moodGroup).getByRole('radio', { name: 'Great day' }));
    expect(post).toBeEnabled();

    // Toggling the mood off disables again.
    await user.click(within(moodGroup).getByRole('radio', { name: 'Great day' }));
    expect(post).toBeDisabled();
  });

  it('a category alone does NOT enable Post (body-or-mood rule)', async () => {
    const user = userEvent.setup();
    renderPage();

    const categoryGroup = screen.getByRole('group', { name: 'Categories' });
    await user.click(within(categoryGroup).getByRole('button', { name: 'Meal' }));

    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  });
});

describe('NotesPage — mood and category chips', () => {
  it('mood is single-select with toggle-to-clear (radiogroup/radio)', async () => {
    const user = userEvent.setup();
    renderPage();

    const moodGroup = screen.getByRole('radiogroup', { name: 'Mood' });
    const great = within(moodGroup).getByRole('radio', { name: 'Great day' });
    const tough = within(moodGroup).getByRole('radio', { name: 'Tough day' });

    expect(great).not.toBeChecked();

    await user.click(great);
    expect(great).toBeChecked();

    // Picking another mood moves the selection (single-select).
    await user.click(tough);
    expect(tough).toBeChecked();
    expect(great).not.toBeChecked();

    // Tapping the selected chip clears it (universal toggle rule — a
    // deliberate escape from strict radio semantics; see ChipSelect).
    await user.click(tough);
    expect(tough).not.toBeChecked();
  });

  it('categories multi-toggle independently (aria-pressed in a labeled group)', async () => {
    const user = userEvent.setup();
    renderPage();

    const categoryGroup = screen.getByRole('group', { name: 'Categories' });
    const meal = within(categoryGroup).getByRole('button', { name: 'Meal' });
    const visit = within(categoryGroup).getByRole('button', { name: 'Visit' });

    await user.click(meal);
    await user.click(visit);
    expect(meal).toHaveAttribute('aria-pressed', 'true');
    expect(visit).toHaveAttribute('aria-pressed', 'true');

    // Untap one — the other stays selected.
    await user.click(meal);
    expect(meal).toHaveAttribute('aria-pressed', 'false');
    expect(visit).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('NotesPage — posting', () => {
  it('posts the trimmed body + mood + categories, clears the composer, and fires careNoteAdded on success', async () => {
    mockCreate.mockImplementation((_variables, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Add a note/), '  Ate all of lunch  ');
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Mood' })).getByRole('radio', {
        name: 'Good day',
      })
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Categories' })).getByRole('button', {
        name: 'Meal',
      })
    );
    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toEqual({
      circleId: CIRCLE_ID,
      input: { body: 'Ate all of lunch', mood: 'good', categories: ['meal'] },
    });

    // WB8 REGRESSION — category count only. `mood` (user-authored health
    // content) must NOT reach analytics, even though the create request
    // above legitimately sends it to the API. Old code: this call included
    // `mood: 'good'` in the captured payload.
    expect(mockCareNoteAdded).toHaveBeenCalledWith(CIRCLE_ID, {
      categoryCount: 1,
    });
    expect(mockCareNoteAdded.mock.calls[0][1]).not.toHaveProperty('mood');

    // Composer cleared optimistically.
    expect(screen.getByLabelText(/^Add a note/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  });

  it('preserves the composer input and shows the failure INLINE in the composer (announced, no toast)', async () => {
    mockCreate.mockImplementation((_variables, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(new Error('boom'));
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Add a note/), 'Rough evening');
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Mood' })).getByRole('radio', {
        name: 'Tough day',
      })
    );
    await user.click(screen.getByRole('button', { name: 'Post' }));

    // Input restored — nothing lost.
    expect(screen.getByLabelText(/^Add a note/)).toHaveValue('Rough evening');
    expect(
      within(screen.getByRole('radiogroup', { name: 'Mood' })).getByRole('radio', {
        name: 'Tough day',
      })
    ).toBeChecked();

    // Inside the composer's own form, as role="alert" — and NOT a toast, which
    // at 360x640 covers the textarea the user retries from.
    const form = screen.getByLabelText(/^Add a note/).closest('form') as HTMLFormElement;
    expect(within(form).getByRole('alert')).toHaveTextContent(
      "Couldn't post your note. Your note is still here — try again."
    );
    expect(document.querySelector('[data-toast-region] [data-toast]')).toBeNull();
    // Announced, not focused: focus stays where the user left it.
    expect(document.activeElement?.getAttribute('role')).not.toBe('alert');

    expect(mockCareNoteAdded).not.toHaveBeenCalled();
  });

  it('fires careNotesViewed once on mount', () => {
    renderPage();
    expect(mockCareNotesViewed).toHaveBeenCalledWith(CIRCLE_ID);
  });
});

describe('NotesPage — day grouping', () => {
  it('groups notes by note_date with Today / Yesterday / formatted headings', () => {
    mockUseCareNotes.mockReturnValue(
      notesResult([
        makeNote({ id: 'n-today', note_date: TODAY, body: 'Today note' }),
        makeNote({ id: 'n-yday', note_date: '2026-03-14', body: 'Yesterday note' }),
        makeNote({ id: 'n-old', note_date: '2026-03-10', body: 'Older note' }),
      ])
    );
    renderPage();

    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeInTheDocument();

    // Non-relative label — computed the same way the page computes it (UTC-noon
    // anchored) so the assertion never depends on the machine timezone.
    const oldLabel = new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date('2026-03-10T12:00:00Z'));
    expect(screen.getByRole('heading', { level: 2, name: oldLabel })).toBeInTheDocument();

    // Entries sit under their day sections.
    const todaySection = screen.getByRole('region', { name: 'Today' });
    expect(within(todaySection).getByText('Today note')).toBeInTheDocument();
    const ydaySection = screen.getByRole('region', { name: 'Yesterday' });
    expect(within(ydaySection).getByText('Yesterday note')).toBeInTheDocument();
  });

  it('renders mood and category display pills on entries', () => {
    mockUseCareNotes.mockReturnValue(
      notesResult([
        makeNote({ mood: 'great', categories: ['meal', 'visit'], body: 'Full day' }),
      ])
    );
    renderPage();

    const row = rowContaining('Full day');
    expect(within(row).getByText('Great day')).toBeInTheDocument();
    expect(within(row).getByText('Meal')).toBeInTheDocument();
    expect(within(row).getByText('Visit')).toBeInTheDocument();
  });
});

describe('NotesPage — empty state', () => {
  it('shows the calm empty state with the composer still visible and no starter chips', () => {
    mockUseCareNotes.mockReturnValue(notesResult([]));
    renderPage();

    expect(screen.getByText('No notes yet')).toBeInTheDocument();
    expect(
      screen.getByText('Jot down how the day went — everyone in the circle can see it.')
    ).toBeInTheDocument();

    // Composer remains the call to action.
    expect(screen.getByLabelText(/^Add a note/)).toBeInTheDocument();

    // Calm: only the composer's two labeled chip rows exist — no starter
    // chips or extra CTA groups in the empty state. Mood is a `radiogroup`
    // (ChipSelect, single-select); Categories stays a plain `group` of
    // `aria-pressed` multi-toggle buttons.
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });
});

describe('NotesPage — view-only', () => {
  it('hides the composer, shows the banner, and keeps the thread readable', () => {
    circleState = { circle: { owner_id: 'owner-1' }, canEdit: false };
    renderPage();

    expect(screen.queryByLabelText(/^Add a note/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'View-only — you can see everything, but changes are off.'
    );

    // Thread still visible, but with no write affordances.
    expect(screen.getByText('Quiet morning, good appetite.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('NotesPage — own-note affordances', () => {
  // Edit/Delete now live behind a MoreMenu (ellipsis trigger, named
  // "Actions for note by <author>" — per-note, not the generic "More") —
  // open it before looking for the item. MoreMenu's own items are
  // `role="menuitem"`, not `role="button"`.
  const MENU_TRIGGER_NAME = /^Actions for note by /;

  async function openRowMenu(row: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(row).getByRole('button', { name: MENU_TRIGGER_NAME }));
  }

  it('offers Edit + Delete on own notes only (non-owner sees neither on others)', async () => {
    const user = userEvent.setup();
    mockUseCareNotes.mockReturnValue(
      notesResult([
        makeNote({ id: 'mine', body: 'My note', author_id: 'user-1' }),
        makeNote({
          id: 'theirs',
          body: 'Their note',
          author_id: 'user-2',
          author: { id: 'user-2', first_name: 'Ben', last_name: 'Reyes' },
        }),
      ])
    );
    renderPage();

    const mine = rowContaining('My note');
    await openRowMenu(mine, user);
    expect(within(mine).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(mine).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

    // Own note has no delete affordance shown twice, and the OTHER row (not
    // own, not owner) gets no menu trigger at all — nothing to open.
    const theirs = rowContaining('Their note');
    expect(within(theirs).queryByRole('button', { name: MENU_TRIGGER_NAME })).not.toBeInTheDocument();
  });

  it('lets the circle owner delete (but not edit) any note', async () => {
    currentUserId = 'owner-1';
    const user = userEvent.setup();
    mockUseCareNotes.mockReturnValue(
      notesResult([
        makeNote({
          id: 'theirs',
          body: 'Their note',
          author_id: 'user-2',
          author: { id: 'user-2', first_name: 'Ben', last_name: 'Reyes' },
        }),
      ])
    );
    renderPage();

    const theirs = rowContaining('Their note');
    await openRowMenu(theirs, user);
    expect(within(theirs).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(theirs).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('edits an own note inline and saves via useUpdateCareNote (explicit values, null clears)', async () => {
    mockUpdate.mockImplementation((_variables, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    mockUseCareNotes.mockReturnValue(
      notesResult([makeNote({ id: 'mine', body: 'Original text', mood: 'okay' })])
    );
    const user = userEvent.setup();
    renderPage();

    await openRowMenu(rowContaining('Original text'), user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    // One editing surface at a time: the create composer hides during the edit,
    // so the only note field on the page is the inline editor.
    const fields = screen.getAllByLabelText(/^Add a note/);
    expect(fields).toHaveLength(1);
    const editField = fields[0] as HTMLTextAreaElement;
    expect(editField.value).toBe('Original text');

    await user.clear(editField);
    await user.type(editField, 'Corrected text');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      circleId: CIRCLE_ID,
      noteId: 'mine',
      input: { body: 'Corrected text', mood: 'okay', categories: [] },
    });
    // Mirrors careNoteAdded: category COUNT only, never mood/body.
    expect(mockCareNoteUpdated).toHaveBeenCalledWith(CIRCLE_ID, { categoryCount: 0 });
  });

  it('deletes an own note through the confirm dialog', async () => {
    mockDelete.mockImplementation((_variables, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    const user = userEvent.setup();
    renderPage();

    await openRowMenu(rowContaining('Quiet morning, good appetite.'), user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('This note will be removed for everyone in the circle.')
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0][0]).toEqual({ circleId: CIRCLE_ID, noteId: 'note-1' });
    expect(mockCareNoteDeleted).toHaveBeenCalledWith(CIRCLE_ID);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DOUBLE SUBMIT — a duplicated care note. The composer's own guard
// (`if (!canSubmit || submitting) return`) is `createMutation.isPending`
// arriving as a prop: React Query state, committed a render AFTER the submit
// that started the request. Two submits in the SAME tick both read the same
// pre-clear `draft` (the optimistic `setDraft(EMPTY_NOTE_DRAFT)` has not
// committed either), so the page posts the same note twice.
//
// `submitFormTwice` dispatches both inside one `act()` with no render in
// between; two awaited `userEvent.click`s would let React commit and would pass
// against a state-flag "fix".
// ────────────────────────────────────────────────────────────────────────────
describe('NotesPage — double submit', () => {
  function composerForm(): HTMLFormElement {
    const form = screen.getByLabelText(/^Add a note/).closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('composer form not found');
    return form;
  }

  it('posts ONE note when the composer is submitted twice in one tick', async () => {
    const user = userEvent.setup();
    // No callbacks fired: the request is still in flight when the second
    // submit arrives, which is the only state in which the guard is under test.
    mockCreate.mockImplementation(() => {});
    renderPage();

    await user.type(screen.getByLabelText(/^Add a note/), 'Ate all of lunch');
    await submitFormTwice(composerForm());

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCareNoteAdded).not.toHaveBeenCalled();
  });

  it('still posts on a genuine RESUBMIT after the first attempt failed', async () => {
    const user = userEvent.setup();
    let pending: { onError?: (e: unknown) => void; onSettled?: () => void } | undefined;
    mockCreate.mockImplementation((_variables, opts) => {
      pending = opts;
    });
    renderPage();

    await user.type(screen.getByLabelText(/^Add a note/), 'Ate all of lunch');
    await submitFormTwice(composerForm());
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // The request comes back a failure: the page restores the draft, so the
    // composer is valid again and the retry must be allowed through.
    await act(async () => {
      pending?.onError?.(new Error('500'));
      pending?.onSettled?.();
    });

    expect(within(composerForm()).getByRole('alert')).toBeInTheDocument();

    await submitFormTwice(composerForm());
    expect(mockCreate).toHaveBeenCalledTimes(2);
    // The retry clears the previous failure (a new one mounts if it fails too).
    expect(within(composerForm()).queryByRole('alert')).toBeNull();
  });
});
