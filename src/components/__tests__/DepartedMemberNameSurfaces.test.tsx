// A member removed from a circle comes back from the API as a NAME-ONLY user
// object ({ id, first_name, last_name } - no email), and an event-note author
// can even be null when the departed user has no name at all. Every surface
// that renders such a user must show the name (or degrade) without throwing.

import { render, screen } from '@testing-library/react';
import '@/i18n';
import { ToastProvider } from '@/components/ui';
import type { EventNote } from '@/api/eventNotes';
import type { CareNote } from '@/api/careNotes';
import type { CircleDocument } from '@/api/documents';
import type { HistoryConfirmation } from '@/components/meds/historyQuery';
import { EventNotesPanel } from '../calendar/EventNotesPanel';
import { DocumentRow } from '../documents/DocumentRow';
import { NoteRow } from '../notes/NoteRow';
import { HistoryList } from '../meds/HistoryList';

const DEPARTED = {
  id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Lisa',
  last_name: 'Departed',
};

let notesData: EventNote[] = [];
vi.mock('@/hooks/useEventNotes', () => ({
  useEventNotes: () => ({ data: notesData, isPending: false, isError: false, refetch: vi.fn() }),
  useCreateNote: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({ circle: { owner_id: 'owner-1' }, canEdit: true }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: 'user-1' } }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const mockUseMedicationConfirmations = vi.fn();
vi.mock('@/hooks/useMedConfirmation', () => ({
  useMedicationConfirmations: (circleId: string, params: unknown) =>
    mockUseMedicationConfirmations(circleId, params),
}));

function eventNote(author: unknown): EventNote {
  return {
    id: 'note-1',
    event_id: 'event-1',
    circle_id: 'circle-1',
    author_id: DEPARTED.id,
    body: 'Left a message for the nurse.',
    created_at: '2026-06-19T12:00:00Z',
    updated_at: '2026-06-19T12:00:00Z',
    author,
  } as EventNote;
}

describe('departed member name surfaces', () => {
  it('a. EventNotesPanel renders a name-only departed author', () => {
    notesData = [eventNote(DEPARTED)];
    render(
      <ToastProvider>
        <EventNotesPanel circleId="circle-1" eventId="event-1" />
      </ToastProvider>
    );
    expect(screen.getByText('Lisa Departed')).toBeInTheDocument();
  });

  it('b. EventNotesPanel renders a note with author: null without throwing', () => {
    notesData = [eventNote(null)];
    render(
      <ToastProvider>
        <EventNotesPanel circleId="circle-1" eventId="event-1" />
      </ToastProvider>
    );
    expect(screen.getByText('Left a message for the nurse.')).toBeInTheDocument();
  });

  it('c. DocumentRow shows the departed uploader first name', () => {
    const doc = {
      id: 'doc-1',
      circle_id: 'circle-1',
      uploaded_by: DEPARTED.id,
      label: 'Insurance Card',
      category: 'insurance',
      note: null,
      file_path: 'circle-documents/circle-1/1.jpg',
      file_type: 'image/jpeg',
      file_size: 524288,
      created_at: '2026-05-02T12:00:00.000Z',
      updated_at: '2026-05-02T12:00:00.000Z',
      uploaded_by_user: DEPARTED,
    } as unknown as CircleDocument;
    render(
      <ul>
        <DocumentRow doc={doc} circleId="circle-1" onPreview={vi.fn()} />
      </ul>
    );
    expect(screen.getByText('512 KB').parentElement).toHaveTextContent('Lisa');
  });

  it('d. care-notes NoteRow shows the departed author full name', () => {
    const note = {
      id: 'note-1',
      circle_id: 'circle-1',
      author_id: DEPARTED.id,
      note_date: '2026-08-10',
      body: 'Ate a good breakfast.',
      mood: null,
      categories: [],
      created_at: '2026-08-10T20:30:00.000Z',
      updated_at: '2026-08-10T20:30:00.000Z',
      author: DEPARTED,
    } as CareNote;
    render(
      <NoteRow
        note={note}
        timezone="America/New_York"
        canEditOwn={false}
        canDelete={false}
        editing={false}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSaveEdit={() => {}}
        onDelete={() => {}}
        savePending={false}
      />
    );
    expect(screen.getByText('Lisa Departed')).toBeInTheDocument();
  });

  it('e. med HistoryList shows the departed confirmer full name', () => {
    const conf = {
      id: 'conf-1',
      event_id: 'evt-1',
      circle_id: 'circle-1',
      confirmed_by: DEPARTED.id,
      confirmed_at: '2026-09-05T14:12:00Z',
      status: 'taken',
      scheduled_time: '08:00:00',
      confirmed_by_user: DEPARTED,
      event: {
        id: 'evt-1',
        title: 'Metformin',
        medication_name: 'Metformin',
        medication_dosage: '500 mg',
        scheduled_date: '2026-09-05',
      },
    } as unknown as HistoryConfirmation;
    mockUseMedicationConfirmations.mockReturnValue({
      data: { confirmations: [conf], hasMore: false },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });
    render(<HistoryList circleId="circle-1" timezone="America/Denver" medicationName={null} />);
    expect(screen.getByText(/Lisa Departed/)).toBeInTheDocument();
  });
});
