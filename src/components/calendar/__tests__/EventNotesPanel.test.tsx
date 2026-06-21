// Task 1.10 — EventNotesPanel: create (fires useCreateNote with the right args,
// incl. scheduled_date for a virtual-instance id), edit-own, delete-with-confirm,
// and the gating rules mirrored from mobile EventNotesScreen:
//   - composer hidden when !canEdit
//   - edit offered only on the user's OWN notes
//   - delete offered on own notes OR (for the circle owner) any note
//
// The eventNotes hooks, useCircle, and the auth store are mocked so the test
// asserts wiring without a network/React Query roundtrip. i18n + ToastProvider
// are real (the panel calls useToast).

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { ToastProvider } from '@/components/ui';
import type { EventNote } from '@/api/eventNotes';
import { EventNotesPanel } from '../EventNotesPanel';

// ── Hook mocks ───────────────────────────────────────────────────────────────

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
let notesData: EventNote[] = [];
let queryState: { isPending: boolean; isError: boolean } = { isPending: false, isError: false };

vi.mock('@/hooks/useEventNotes', () => ({
  useEventNotes: () => ({ data: notesData, ...queryState, refetch: vi.fn() }),
  useCreateNote: () => ({ mutate: mockCreate, isPending: false }),
  useUpdateNote: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteNote: () => ({ mutate: mockDelete, isPending: false }),
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CIRCLE_ID = 'circle-1';
const EVENT_ID = 'event-1';
// Composite virtual-instance id: parentUUID (36 chars) + "_" + date.
const VIRTUAL_EVENT_ID = '11111111-2222-3333-4444-555555555555_2026-06-20';

function makeNote(overrides: Partial<EventNote> = {}): EventNote {
  return {
    id: 'note-1',
    event_id: EVENT_ID,
    circle_id: CIRCLE_ID,
    author_id: 'user-1',
    body: 'Took it with breakfast.',
    created_at: '2026-06-19T12:00:00Z',
    updated_at: '2026-06-19T12:00:00Z',
    author: { id: 'user-1', first_name: 'Ana', last_name: 'Lopez' },
    ...overrides,
  };
}

function renderPanel(eventId = EVENT_ID, scheduledDate?: string) {
  return render(
    <ToastProvider>
      <EventNotesPanel circleId={CIRCLE_ID} eventId={eventId} scheduledDate={scheduledDate} />
    </ToastProvider>
  );
}

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  notesData = [];
  queryState = { isPending: false, isError: false };
  circleState = { circle: { owner_id: 'owner-1' }, canEdit: true };
  currentUserId = 'user-1';
});

describe('EventNotesPanel', () => {
  it('shows the empty state and a composer when canEdit', () => {
    renderPanel();
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a note')).toBeInTheDocument();
  });

  it('creates a note via useCreateNote with the trimmed body', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Add a note'), '  Refill on Monday  ');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toEqual({
      circleId: CIRCLE_ID,
      eventId: EVENT_ID,
      body: 'Refill on Monday',
      scheduledDate: undefined,
    });
  });

  it('passes scheduled_date through for a virtual-instance id', async () => {
    const user = userEvent.setup();
    renderPanel(VIRTUAL_EVENT_ID, '2026-06-20');

    await user.type(screen.getByLabelText('Add a note'), 'Note on instance');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      eventId: VIRTUAL_EVENT_ID,
      scheduledDate: '2026-06-20',
      body: 'Note on instance',
    });
  });

  it('hides the composer when !canEdit', () => {
    circleState = { circle: { owner_id: 'owner-1' }, canEdit: false };
    notesData = [makeNote()];
    renderPanel();

    expect(screen.queryByLabelText('Add a note')).not.toBeInTheDocument();
    // No edit/delete affordances when the user can't edit the circle.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('offers edit + delete on the user’s OWN note and saves an edit', async () => {
    const user = userEvent.setup();
    notesData = [makeNote({ author_id: 'user-1' })];
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editBox = screen.getByLabelText('Edit note');
    await user.clear(editBox);
    await user.type(editBox, 'Updated body');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toEqual({
      circleId: CIRCLE_ID,
      eventId: EVENT_ID,
      noteId: 'note-1',
      body: 'Updated body',
    });
  });

  it('does NOT offer edit on another member’s note, but the circle owner CAN delete it', () => {
    // Current user is the owner; the note is someone else's.
    currentUserId = 'owner-1';
    notesData = [makeNote({ author_id: 'someone-else' })];
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('does NOT offer edit OR delete on another member’s note for a non-owner', () => {
    currentUserId = 'user-1'; // a plain member, not the owner
    notesData = [makeNote({ author_id: 'someone-else' })];
    renderPanel();

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('deletes a note only after confirming in the dialog', async () => {
    const user = userEvent.setup();
    notesData = [makeNote({ author_id: 'user-1' })];
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // Confirm dialog appears; deletion fires only on confirm.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText("Delete this note? This can't be undone.")).toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete.mock.calls[0][0]).toEqual({
      circleId: CIRCLE_ID,
      eventId: EVENT_ID,
      noteId: 'note-1',
    });
  });
});
