// Task 29 (notes-first-class plan): the create/update/delete note mutations
// must fire Analytics.eventNoteAdded/Updated/Deleted exactly once on success,
// never on error, and never with the note body/text.

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/eventNotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/eventNotes')>();
  return {
    ...actual,
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
  };
});

vi.mock('@/lib/analytics', () => ({
  Analytics: {
    eventNoteAdded: vi.fn(),
    eventNoteUpdated: vi.fn(),
    eventNoteDeleted: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));

import { createNote, deleteNote, updateNote, type EventNote } from '@/api/eventNotes';
import { Analytics } from '@/lib/analytics';
import { useCreateNote, useDeleteNote, useUpdateNote } from '@/hooks/useEventNotes';

const mockCreate = vi.mocked(createNote);
const mockUpdate = vi.mocked(updateNote);
const mockDelete = vi.mocked(deleteNote);

const CIRCLE_ID = 'circle-1';
const EVENT_ID = 'event-1';
const NOTE_ID = 'note-1';

const NOTE: EventNote = {
  id: NOTE_ID,
  event_id: EVENT_ID,
  circle_id: CIRCLE_ID,
  author_id: 'u1',
  body: 'Dr. Patel lowered the metoprolol to 25mg',
  created_at: '2026-09-27T00:00:00Z',
  updated_at: '2026-09-27T00:00:00Z',
  author: { id: 'u1', first_name: 'Sam', last_name: 'Doe' },
};

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateNote analytics', () => {
  it('fires Analytics.eventNoteAdded(circleId) exactly once on success', async () => {
    mockCreate.mockResolvedValue(NOTE);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateNote(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ circleId: CIRCLE_ID, eventId: EVENT_ID, body: 'x' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Analytics.eventNoteAdded).toHaveBeenCalledTimes(1);
    expect(Analytics.eventNoteAdded).toHaveBeenCalledWith(CIRCLE_ID);
  });

  it('does not fire Analytics.eventNoteAdded on error', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useCreateNote(), { wrapper: Wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ circleId: CIRCLE_ID, eventId: EVENT_ID, body: 'x' })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(Analytics.eventNoteAdded).not.toHaveBeenCalled();
  });
});

describe('useUpdateNote analytics', () => {
  it('fires Analytics.eventNoteUpdated(circleId) exactly once on success', async () => {
    mockUpdate.mockResolvedValue(NOTE);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateNote(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        circleId: CIRCLE_ID,
        eventId: EVENT_ID,
        noteId: NOTE_ID,
        body: 'edited',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Analytics.eventNoteUpdated).toHaveBeenCalledTimes(1);
    expect(Analytics.eventNoteUpdated).toHaveBeenCalledWith(CIRCLE_ID);
  });

  it('does not fire Analytics.eventNoteUpdated on error', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useUpdateNote(), { wrapper: Wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ circleId: CIRCLE_ID, eventId: EVENT_ID, noteId: NOTE_ID, body: 'edited' })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(Analytics.eventNoteUpdated).not.toHaveBeenCalled();
  });
});

describe('useDeleteNote analytics', () => {
  it('fires Analytics.eventNoteDeleted(circleId) exactly once on success', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteNote(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ circleId: CIRCLE_ID, eventId: EVENT_ID, noteId: NOTE_ID });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Analytics.eventNoteDeleted).toHaveBeenCalledTimes(1);
    expect(Analytics.eventNoteDeleted).toHaveBeenCalledWith(CIRCLE_ID);
  });

  it('does not fire Analytics.eventNoteDeleted on error', async () => {
    mockDelete.mockRejectedValue(new Error('boom'));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDeleteNote(), { wrapper: Wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ circleId: CIRCLE_ID, eventId: EVENT_ID, noteId: NOTE_ID })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(Analytics.eventNoteDeleted).not.toHaveBeenCalled();
  });
});
