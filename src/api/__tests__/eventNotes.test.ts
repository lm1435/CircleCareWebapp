import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import {
  getEventNotes,
  createNote,
  updateNote,
  deleteNote,
  splitEventId,
  type EventNote,
} from '@/api/eventNotes';
import { useCreateNote, useUpdateNote, useDeleteNote } from '@/hooks/useEventNotes';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

const CIRCLE = 'circle-1';
const PARENT_UUID = '8f1c2d3e-4b5a-6789-abcd-ef0123456789'; // 36 chars
const COMPOSITE = `${PARENT_UUID}_2026-05-28`;
const NOTE_ID = 'note-1';

const NOTE: EventNote = {
  id: NOTE_ID,
  event_id: PARENT_UUID,
  circle_id: CIRCLE,
  author_id: 'u1',
  body: 'hello',
  created_at: '2026-05-28T00:00:00Z',
  updated_at: '2026-05-28T00:00:00Z',
  author: { id: 'u1', first_name: 'A', last_name: 'B' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('splitEventId', () => {
  it('splits a composite virtual-instance id into eventId + scheduledDate', () => {
    expect(splitEventId(COMPOSITE)).toEqual({
      eventId: PARENT_UUID,
      scheduledDate: '2026-05-28',
    });
  });

  it('leaves a bare UUID untouched (no scheduled date)', () => {
    expect(splitEventId(PARENT_UUID)).toEqual({
      eventId: PARENT_UUID,
      scheduledDate: undefined,
    });
  });

  it('lets an explicit scheduledDate win over the parsed one', () => {
    expect(splitEventId(COMPOSITE, '2026-06-01')).toEqual({
      eventId: PARENT_UUID,
      scheduledDate: '2026-06-01',
    });
  });

  it('applies an explicit scheduledDate to a bare UUID', () => {
    expect(splitEventId(PARENT_UUID, '2026-06-01')).toEqual({
      eventId: PARENT_UUID,
      scheduledDate: '2026-06-01',
    });
  });
});

describe('eventNotes api functions', () => {
  it('getEventNotes hits the real parent UUID + passes scheduled_date for a composite id', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { notes: [NOTE] } } as never);

    const notes = await getEventNotes(CIRCLE, COMPOSITE);

    expect(mockGet).toHaveBeenCalledWith(`/circles/${CIRCLE}/events/${PARENT_UUID}/notes`, {
      params: { scheduled_date: '2026-05-28' },
    });
    expect(notes).toEqual([NOTE]);
  });

  it('getEventNotes omits params for a bare UUID with no date', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { notes: [] } } as never);

    await getEventNotes(CIRCLE, PARENT_UUID);

    expect(mockGet).toHaveBeenCalledWith(`/circles/${CIRCLE}/events/${PARENT_UUID}/notes`, {
      params: undefined,
    });
  });

  it('createNote posts to the parent UUID with body + split scheduled_date', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { note: NOTE } } as never);

    const created = await createNote(CIRCLE, COMPOSITE, { body: 'hi' });

    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE}/events/${PARENT_UUID}/notes`, {
      body: 'hi',
      scheduled_date: '2026-05-28',
    });
    expect(created).toEqual(NOTE);
  });

  it('createNote omits scheduled_date for a bare UUID', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { note: NOTE } } as never);

    await createNote(CIRCLE, PARENT_UUID, { body: 'hi' });

    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE}/events/${PARENT_UUID}/notes`, {
      body: 'hi',
    });
  });

  it('updateNote patches the note under the parent UUID with { body }', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { note: NOTE } } as never);

    const updated = await updateNote(CIRCLE, COMPOSITE, NOTE_ID, { body: 'edited' });

    expect(mockPatch).toHaveBeenCalledWith(
      `/circles/${CIRCLE}/events/${PARENT_UUID}/notes/${NOTE_ID}`,
      { body: 'edited' }
    );
    expect(updated).toEqual(NOTE);
  });

  it('deleteNote deletes the note under the parent UUID', async () => {
    mockDelete.mockResolvedValueOnce({ success: true } as never);

    await deleteNote(CIRCLE, COMPOSITE, NOTE_ID);

    expect(mockDelete).toHaveBeenCalledWith(
      `/circles/${CIRCLE}/events/${PARENT_UUID}/notes/${NOTE_ID}`
    );
  });
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useEventNotes mutations — endpoints + invalidation', () => {
  it('useCreateNote fires the endpoint and invalidates the split eventNotes key', async () => {
    mockPost.mockResolvedValue({ success: true, data: { note: NOTE } } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateNote(), { wrapper: makeWrapper(client) });

    await result.current.mutateAsync({
      circleId: CIRCLE,
      eventId: COMPOSITE,
      body: 'new note',
    });

    // Endpoint + body went through the api layer (split applied).
    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE}/events/${PARENT_UUID}/notes`, {
      body: 'new note',
      scheduled_date: '2026-05-28',
    });

    // Invalidation targets the SAME split key the read query registers.
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({
        queryKey: queryKeys.eventNotes(CIRCLE, PARENT_UUID, '2026-05-28'),
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.calendarEvents(CIRCLE) });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.activityFeed(CIRCLE) });
  });

  it('useUpdateNote fires PATCH and invalidates the notes key', async () => {
    mockPatch.mockResolvedValue({ success: true, data: { note: NOTE } } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateNote(), { wrapper: makeWrapper(client) });

    await result.current.mutateAsync({
      circleId: CIRCLE,
      eventId: COMPOSITE,
      noteId: NOTE_ID,
      body: 'edited',
    });

    expect(mockPatch).toHaveBeenCalledWith(
      `/circles/${CIRCLE}/events/${PARENT_UUID}/notes/${NOTE_ID}`,
      { body: 'edited' }
    );
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({
        queryKey: queryKeys.eventNotes(CIRCLE, PARENT_UUID, '2026-05-28'),
      });
    });
  });

  it('useDeleteNote fires DELETE and invalidates the notes key', async () => {
    mockDelete.mockResolvedValue({ success: true } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteNote(), { wrapper: makeWrapper(client) });

    await result.current.mutateAsync({
      circleId: CIRCLE,
      eventId: COMPOSITE,
      noteId: NOTE_ID,
    });

    expect(mockDelete).toHaveBeenCalledWith(
      `/circles/${CIRCLE}/events/${PARENT_UUID}/notes/${NOTE_ID}`
    );
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({
        queryKey: queryKeys.eventNotes(CIRCLE, PARENT_UUID, '2026-05-28'),
      });
    });
  });

  it('useCreateNote refetches circle flags on a 403 permission rejection', async () => {
    mockPost.mockRejectedValue({ success: false, error: { code: 'VIEW_ONLY' } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateNote(), { wrapper: makeWrapper(client) });

    await expect(
      result.current.mutateAsync({ circleId: CIRCLE, eventId: PARENT_UUID, body: 'x' })
    ).rejects.toBeTruthy();

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.circles });
    });
  });
});
