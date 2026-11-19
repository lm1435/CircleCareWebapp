// 1.4.3 write-failure audit item 1 (web): an event note whose send fails AFTER the panel closed
// must not vanish. mutateAsync settles on the promise: the draft is parked (memory only, same
// user, same circle + event occurrence) and the failure toast comes from the root ToastProvider.

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import '@/i18n';
import { ToastProvider } from '@/components/ui';
import { EventNotesPanel } from '../EventNotesPanel';
import { SessionEndedError } from '@/lib/writeRetryQueue';
import {
  clearParkedNoteDrafts,
  parkEventNoteDraft,
  takeParkedEventNoteDraft,
} from '@/lib/parkedNoteDraft';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/hooks/useEventNotes', () => ({
  useEventNotes: () => ({
    data: [
      {
        id: 'note-1',
        event_id: 'event-1',
        circle_id: 'circle-1',
        author_id: 'user-1',
        body: 'Old body',
        created_at: '2026-06-19T12:00:00Z',
        updated_at: '2026-06-19T12:00:00Z',
        author: { id: 'user-1', first_name: 'Ana', last_name: 'Lopez' },
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateNote: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateNote: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeleteNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({ circle: { owner_id: 'owner-1' }, canEdit: true }),
}));
let currentUserId: string | undefined = 'user-1';
vi.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: { id: string } | null }) => unknown) =>
      selector({ user: currentUserId ? { id: currentUserId } : null }),
    { getState: () => ({ user: currentUserId ? { id: currentUserId } : null }) }
  ),
}));

const GENERIC = "Couldn't save your note. Please try again.";
let closePanel: () => void = () => {};

function Host({ eventId = 'event-1', circleId = 'circle-1' }: { eventId?: string; circleId?: string }) {
  const [open, setOpen] = useState(true);
  closePanel = () => setOpen(false);
  return (
    <ToastProvider>
      {open ? <EventNotesPanel circleId={circleId} eventId={eventId} scheduledDate="2026-06-20" /> : null}
    </ToastProvider>
  );
}

/** A request held until the test settles it. */
function deferred() {
  let reject: (e: unknown) => void = () => {};
  let resolve: (v: unknown) => void = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  clearParkedNoteDrafts();
  currentUserId = 'user-1';
});

async function typeAndSend(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Add a note'), text);
  await user.click(screen.getByRole('button', { name: 'Add note' }));
}

describe('EventNotesPanel create survives the panel closing', () => {
  it('POSITIVE: closed mid-send and every attempt fails: draft parked for THIS event, failure toast shown', async () => {
    const d = deferred();
    mockCreate.mockReturnValue(d.promise);
    render(<Host />);
    await typeAndSend('Refill on Monday');
    act(() => closePanel());
    await act(async () => d.reject({ success: false, error: { code: 'SERVER_ERROR', message: 'x' } }));
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1')).toBe('Refill on Monday');
  });

  it('POSITIVE: reopening the panel for the same event restores the parked text exactly once', async () => {
    parkEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1', 'Parked text');
    const first = render(<Host />);
    expect((screen.getByLabelText('Add a note') as HTMLTextAreaElement).value).toBe('Parked text');
    first.unmount();
    render(<Host />);
    expect((screen.getByLabelText('Add a note') as HTMLTextAreaElement).value).toBe('');
  });

  it('NEGATIVE: panel still open on failure: text stays in the composer, nothing parked', async () => {
    mockCreate.mockRejectedValue({ success: false, error: { code: 'SERVER_ERROR', message: 'x' } });
    render(<Host />);
    await typeAndSend('Still here');
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
    expect((screen.getByLabelText('Add a note') as HTMLTextAreaElement).value).toBe('Still here');
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1')).toBeNull();
  });

  it('NEGATIVE: success after close parks nothing and shows no error', async () => {
    const d = deferred();
    mockCreate.mockReturnValue(d.promise);
    render(<Host />);
    await typeAndSend('Landed');
    act(() => closePanel());
    await act(async () => d.resolve({}));
    expect(screen.queryByText(GENERIC)).toBeNull();
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1')).toBeNull();
  });

  it("NEGATIVE: another event, circle or user never gets someone else's parked draft", () => {
    parkEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1', 'Private');
    expect(takeParkedEventNoteDraft('circle-1', 'event-2', '2026-06-20', 'user-1')).toBeNull();
    expect(takeParkedEventNoteDraft('circle-2', 'event-1', '2026-06-20', 'user-1')).toBeNull();
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-21', 'user-1')).toBeNull();
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-2')).toBeNull();
    // Read-and-delete: even the wrong user's attempt leaves nothing behind for a later reader.
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1')).toBeNull();
  });

  it('NEGATIVE: the session ended mid-send (signed out): nothing is parked and no toast', async () => {
    const d = deferred();
    mockCreate.mockReturnValue(d.promise);
    render(<Host />);
    await typeAndSend('Secret');
    act(() => closePanel());
    currentUserId = undefined;
    await act(async () => d.reject(new SessionEndedError()));
    expect(screen.queryByText(GENERIC)).toBeNull();
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1')).toBeNull();
  });

  it('NEGATIVE: signed in as someone else by the time it fails: nothing parked', async () => {
    const d = deferred();
    mockCreate.mockReturnValue(d.promise);
    render(<Host />);
    await typeAndSend('Mine');
    act(() => closePanel());
    currentUserId = 'user-2';
    await act(async () => d.reject({ success: false, error: { code: 'SERVER_ERROR', message: 'x' } }));
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-2')).toBeNull();
    expect(takeParkedEventNoteDraft('circle-1', 'event-1', '2026-06-20', 'user-1')).toBeNull();
  });

  it('edit: a failure after the panel closed still reports (toast is not tied to the panel)', async () => {
    const d = deferred();
    mockUpdate.mockReturnValue(d.promise);
    render(<Host />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Edit, / }));
    await user.type(screen.getByLabelText('Edit note'), ' more');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    act(() => closePanel());
    await act(async () => d.reject({ success: false, error: { code: 'SERVER_ERROR', message: 'x' } }));
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
  });
});
