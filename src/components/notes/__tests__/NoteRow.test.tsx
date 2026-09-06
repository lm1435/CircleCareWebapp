import { useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { NoteRow } from '../NoteRow';
import type { CareNote } from '@/api/careNotes';
import type { NoteDraft } from '../NoteComposer';

// WA2 — the entry timestamp must route through the VIEWER's resolved
// 12h/24h clock (resolveHourCycle), not the runtime's default locale. Pin
// useHourCycle so the test is deterministic instead of following
// navigator.language (same pattern as MedicationsPage.test.tsx / TodaysMeds).

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

function makeNote(overrides: Partial<CareNote> = {}): CareNote {
  return {
    id: 'note-1',
    circle_id: 'circle-1',
    author_id: 'user-1',
    note_date: '2026-08-10',
    body: 'Ate a good breakfast.',
    mood: null,
    categories: [],
    created_at: '2026-08-10T20:30:00.000Z', // 4:30 PM ET / 20:30 UTC
    updated_at: '2026-08-10T20:30:00.000Z',
    author: { id: 'user-1', first_name: 'Sam', last_name: 'Rivera' },
    ...overrides,
  };
}

const noop = () => {};

interface RenderRowOverrides {
  timezone?: string;
  canEditOwn?: boolean;
  canDelete?: boolean;
  editing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (draft: NoteDraft) => void;
  onDelete?: () => void;
  savePending?: boolean;
}

function renderRow(note: CareNote, overrides: RenderRowOverrides = {}) {
  return render(
    <NoteRow
      note={note}
      timezone={overrides.timezone ?? 'America/New_York'}
      canEditOwn={overrides.canEditOwn ?? false}
      canDelete={overrides.canDelete ?? false}
      editing={overrides.editing ?? false}
      onStartEdit={overrides.onStartEdit ?? noop}
      onCancelEdit={overrides.onCancelEdit ?? noop}
      onSaveEdit={overrides.onSaveEdit ?? noop}
      onDelete={overrides.onDelete ?? noop}
      savePending={overrides.savePending ?? false}
    />
  );
}

describe('NoteRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the entry time in 12h format when the viewer is on a 12h clock', () => {
    mockUseHourCycle.mockReturnValue('12h');
    renderRow(makeNote());

    // 20:30 UTC in America/New_York (EDT, UTC-4) is 16:30 → "4:30 PM".
    expect(screen.getByText(/4:30 PM/)).toBeInTheDocument();
    expect(screen.queryByText(/16:30/)).not.toBeInTheDocument();
  });

  it('renders the entry time in 24h format when the viewer is on a 24h clock (WA2 regression)', () => {
    // Before the fix, formatNoteTime used Intl.DateTimeFormat(undefined, ...)
    // which follows the runtime's default locale/hour-cycle and ignores
    // resolveHourCycle entirely — a 24h-clock viewer still saw AM/PM here.
    mockUseHourCycle.mockReturnValue('24h');
    renderRow(makeNote());

    expect(screen.getByText(/16:30/)).toBeInTheDocument();
    expect(screen.queryByText(/4:30 PM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PM/)).not.toBeInTheDocument();
  });

  it('renders the time in the CARE RECIPIENT timezone, not device-local', () => {
    mockUseHourCycle.mockReturnValue('24h');
    // 20:30 UTC in Europe/Madrid (CEST, UTC+2) is 22:30.
    renderRow(makeNote(), { timezone: 'Europe/Madrid' });

    expect(screen.getByText(/22:30/)).toBeInTheDocument();
  });

  it('renders the author name and note body', () => {
    mockUseHourCycle.mockReturnValue('12h');
    renderRow(makeNote());

    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('Ate a good breakfast.')).toBeInTheDocument();
  });

  // Wave 3, Task 16 review fix — actions live behind a MoreMenu now
  // (ellipsis trigger, named "Actions for note by <author>" — not the
  // generic "More", so multiple notes on a page each get a disambiguated
  // trigger name); assert it appears only for the affordances the caller
  // actually grants, and that it carries the right menu items.
  //
  // makeNote()'s default author is Sam Rivera, hence this fixed label.
  const MENU_TRIGGER_NAME = 'Actions for note by Sam Rivera';

  describe('actions — canEditOwn / canDelete gate the MoreMenu', () => {
    beforeEach(() => {
      mockUseHourCycle.mockReturnValue('12h');
    });

    it('renders no MoreMenu when neither canEditOwn nor canDelete', () => {
      renderRow(makeNote(), { canEditOwn: false, canDelete: false });
      expect(screen.queryByRole('button', { name: MENU_TRIGGER_NAME })).not.toBeInTheDocument();
    });

    it('offers only Edit when canEditOwn and not canDelete', async () => {
      const user = userEvent.setup();
      renderRow(makeNote(), { canEditOwn: true, canDelete: false });

      await user.click(screen.getByRole('button', { name: MENU_TRIGGER_NAME }));
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('offers only Delete when canDelete and not canEditOwn (circle-owner-on-others-note shape)', async () => {
      const user = userEvent.setup();
      renderRow(makeNote(), { canEditOwn: false, canDelete: true });

      await user.click(screen.getByRole('button', { name: MENU_TRIGGER_NAME }));
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('offers both Edit and Delete, and fires the right callback for each', async () => {
      const onStartEdit = vi.fn();
      const onDelete = vi.fn();
      const user = userEvent.setup();
      renderRow(makeNote(), { canEditOwn: true, canDelete: true, onStartEdit, onDelete });

      await user.click(screen.getByRole('button', { name: MENU_TRIGGER_NAME }));
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
      expect(onStartEdit).toHaveBeenCalledTimes(1);
      expect(onDelete).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: MENU_TRIGGER_NAME }));
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    // Regression guard for the review fix: the trigger must be named PER
    // NOTE (via the author), not the generic default "More" — otherwise two
    // notes on the same page render two identically-named controls.
    it('names the trigger per-note via the author, not the generic default', async () => {
      renderRow(makeNote(), { canEditOwn: true, canDelete: true });
      expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: MENU_TRIGGER_NAME })).toBeInTheDocument();
    });
  });

  // `editing=true` swaps the whole row for the NoteComposer (mirrors the
  // create composer, seeded from the note's own body/mood/categories).
  it('swaps to the NoteComposer when editing is true', () => {
    renderRow(
      makeNote({ body: 'Original text', mood: 'okay', categories: ['meal'] }),
      { editing: true }
    );

    // The composer's own field, id-prefixed for this note (`note-edit-<id>`).
    const field = screen.getByLabelText(/^Add a note/) as HTMLTextAreaElement;
    expect(field.value).toBe('Original text');
    expect(field.id).toBe('note-edit-note-1-body');

    // Save/Cancel — the edit-mode footer, not the create composer's Post.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post' })).not.toBeInTheDocument();

    // The static row's own content (author/body paragraph, MoreMenu) is gone —
    // this is the ONE editing surface, not an overlay on top of the row.
    expect(screen.queryByText('Ate a good breakfast.')).not.toBeInTheDocument();
  });

  // Mood/category display pills render as the shared `Badge` primitive in
  // its `dusk` variant — non-interactive, section-tinted.
  it('renders mood and category pills as dusk-variant Badges', () => {
    renderRow(makeNote({ mood: 'great', categories: ['meal', 'visit'] }));

    const mood = screen.getByText('Great day');
    const meal = screen.getByText('Meal');
    const visit = screen.getByText('Visit');
    for (const pill of [mood, meal, visit]) {
      expect(pill.className).toContain('bg-dusk-soft');
      expect(pill.className).toContain('text-dusk-deep');
    }
  });

  it('renders no pill row when there is no mood and no categories', () => {
    renderRow(makeNote({ mood: null, categories: [] }));
    expect(screen.queryByText('Great day')).not.toBeInTheDocument();
  });

  // WCAG 2.4.3 (focus order) — a STATEFUL harness, since NoteRow is
  // controlled: real Edit/Cancel navigation requires the parent (here, the
  // harness, standing in for NotesPage) to actually flip `editing`.
  function EditableHarness({ note }: { note: CareNote }): ReactElement {
    const [editing, setEditing] = useState(false);
    return (
      <NoteRow
        note={note}
        timezone="America/New_York"
        canEditOwn
        canDelete
        editing={editing}
        onStartEdit={() => setEditing(true)}
        onCancelEdit={() => setEditing(false)}
        onSaveEdit={() => setEditing(false)}
        onDelete={noop}
        savePending={false}
      />
    );
  }

  describe('focus order (WCAG 2.4.3)', () => {
    beforeEach(() => {
      mockUseHourCycle.mockReturnValue('12h');
    });

    it('moves focus into the textarea when Edit is chosen from the MoreMenu', async () => {
      const user = userEvent.setup();
      render(<EditableHarness note={makeNote()} />);

      await user.click(screen.getByRole('button', { name: MENU_TRIGGER_NAME }));
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

      const textarea = screen.getByLabelText(/^Add a note/);
      expect(document.activeElement).toBe(textarea);
    });

    it('returns focus to the row\'s MoreMenu trigger when Cancel exits edit mode', async () => {
      const user = userEvent.setup();
      render(<EditableHarness note={makeNote()} />);

      await user.click(screen.getByRole('button', { name: MENU_TRIGGER_NAME }));
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      // The static row (and its trigger) is a BRAND NEW DOM node — the whole
      // branch remounted — so this re-query is the point, not an oversight.
      const trigger = screen.getByRole('button', { name: MENU_TRIGGER_NAME });
      expect(document.activeElement).toBe(trigger);
    });
  });

  // "(edited)" only when the note was actually modified after creation.
  describe('the "(edited)" marker', () => {
    it('is absent when updated_at equals created_at', () => {
      renderRow(makeNote({ created_at: '2026-08-10T20:30:00.000Z', updated_at: '2026-08-10T20:30:00.000Z' }));
      expect(screen.queryByText('Edited')).not.toBeInTheDocument();
    });

    it('appears when updated_at differs from created_at', () => {
      renderRow(makeNote({ created_at: '2026-08-10T20:30:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' }));
      expect(screen.getByText('Edited')).toBeInTheDocument();
    });
  });
});
