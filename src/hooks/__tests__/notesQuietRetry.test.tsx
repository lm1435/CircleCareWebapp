// 1.4.3 item 7 (web): the note creates send a client_request_id and retry a network
// failure quietly with the SAME id; a replay (200 replayed:true) is success; a
// definite refusal is not retried; the care note's optimistic row survives the
// retries and is rolled back only when every attempt fails.
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';

vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u', first_name: 'A', last_name: 'B' } }) },
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    errorOccurred: vi.fn(),
    eventNoteAdded: vi.fn(),
    writeRetryScheduled: vi.fn(),
    writeRetrySucceeded: vi.fn(),
    writeRetryGaveUp: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useCreateNote } from '../useEventNotes';
import { useCreateCareNote } from '../useCareNotes';
import { createNote } from '@/api/eventNotes';
import { createCareNote } from '@/api/careNotes';
import { __resetWriteRetryForTests, clearWriteRetryQueue } from '@/lib/writeRetryQueue';

const post = apiClient.post as unknown as Mock;
const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
const refusal = (code: string) => ({ success: false, error: { code, message: code } });
const NOTE = { id: 'n1', body: 'hi' };
const created = (replayed = false) => ({ success: true, data: { note: NOTE, replayed } });

const wrapper = (qc: QueryClient) =>
  function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  __resetWriteRetryForTests();
  post.mockReset();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('the note create API sends the idempotency key', () => {
  it('event note: client_request_id rides the body; an old caller sends none (N7-9)', async () => {
    post.mockResolvedValue(created());
    await createNote('c1', 'e1', { body: 'hi', client_request_id: 'req-1' });
    expect(post).toHaveBeenLastCalledWith('/circles/c1/events/e1/notes', {
      body: 'hi',
      client_request_id: 'req-1',
    });
    await createNote('c1', 'e1', { body: 'hi' });
    expect(post.mock.calls[1][1]).toEqual({ body: 'hi' });
  });

  it('care note: client_request_id rides the body; an old caller sends none (N7-9)', async () => {
    post.mockResolvedValue(created());
    await createCareNote('c1', { body: 'hi', client_request_id: 'req-2' });
    expect(post).toHaveBeenLastCalledWith('/circles/c1/care-notes', {
      body: 'hi',
      client_request_id: 'req-2',
    });
    await createCareNote('c1', { body: 'hi' });
    expect(post.mock.calls[1][1]).toEqual({ body: 'hi' });
  });

  it('a replayed:true answer returns the SAME note: success, not an error', async () => {
    post.mockResolvedValue(created(true));
    await expect(createNote('c1', 'e1', { body: 'hi', client_request_id: 'r' })).resolves.toEqual(NOTE);
    await expect(createCareNote('c1', { body: 'hi', client_request_id: 'r' })).resolves.toEqual(NOTE);
  });
});

describe('useCreateNote (event notes)', () => {
  it('P7-6 a network drop is retried with the SAME client_request_id and the note lands once', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(created(true));
    const qc = newQc();
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(qc) });
    let outcome: unknown;
    act(() => {
      void result.current
        .mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'hi' })
        .then((n) => (outcome = n));
    });
    await advance(2100);
    expect(outcome).toEqual(NOTE);
    expect(post).toHaveBeenCalledTimes(2);
    const ids = post.mock.calls.map((c) => c[1].client_request_id);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[0]).toBe(ids[1]);
    expect(Analytics.eventNoteAdded).toHaveBeenCalledTimes(1);
  });

  it('two separate submits get two DIFFERENT ids (never merged)', async () => {
    post.mockResolvedValue(created());
    const qc = newQc();
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'a' });
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'a' });
    });
    expect(post.mock.calls[0][1].client_request_id).not.toBe(post.mock.calls[1][1].client_request_id);
  });

  it('N7-3 a 409 OCCURRENCE_REMOVED is not retried: rejected at once, one request', async () => {
    post.mockRejectedValue(refusal('OCCURRENCE_REMOVED'));
    const qc = newQc();
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(qc) });
    let error: unknown;
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'hi' }).catch((e) => (error = e));
    });
    expect(error).toEqual(refusal('OCCURRENCE_REMOVED'));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('every attempt failing rejects (the composer keeps its text and shows its own error)', async () => {
    post.mockRejectedValue(network());
    const qc = newQc();
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(qc) });
    let error: unknown;
    act(() => {
      void result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'hi' }).catch((e) => (error = e));
    });
    await advance(60_000);
    expect(error).toEqual(network());
    expect(post).toHaveBeenCalledTimes(4);
    expect(Analytics.eventNoteAdded).not.toHaveBeenCalled();
  });
});

describe('useCreateCareNote', () => {
  const seed = (qc: QueryClient) =>
    qc.setQueryData(['careNotes', 'c1', {}], { notes: [], today: '2026-08-08', timezone: 'America/Denver' });
  const notesOf = (qc: QueryClient) =>
    (qc.getQueryData(['careNotes', 'c1', {}]) as { notes: { id: string }[] }).notes;

  it('the optimistic row stays while a network drop is retried, and the same id is sent', async () => {
    post.mockRejectedValueOnce(network()).mockResolvedValue(created());
    const qc = newQc();
    seed(qc);
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(qc) });
    act(() => {
      void result.current.mutateAsync({ circleId: 'c1', input: { body: 'hi' } });
    });
    await advance(100);
    expect(notesOf(qc).map((n) => n.id)[0]).toMatch(/^optimistic/);
    await advance(2100);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1].client_request_id).toBe(post.mock.calls[1][1].client_request_id);
  });

  it('every attempt failing rolls the optimistic row back', async () => {
    post.mockRejectedValue(network());
    const qc = newQc();
    seed(qc);
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(qc) });
    act(() => {
      void result.current.mutateAsync({ circleId: 'c1', input: { body: 'hi' } }).catch(() => {});
    });
    await advance(60_000);
    await advance(10);
    expect(result.current.isError).toBe(true);
    expect(notesOf(qc)).toEqual([]);
    expect(post).toHaveBeenCalledTimes(4);
  });

  it('N7-3 a 403 VIEW_ONLY is not retried', async () => {
    post.mockRejectedValue(refusal('VIEW_ONLY'));
    const qc = newQc();
    seed(qc);
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', input: { body: 'hi' } }).catch(() => {});
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

// Review W4: the id is held with the DRAFT, not minted per submit.
describe('the request id is held with the draft (W4)', () => {
  const server500 = () => refusal('INTERNAL_ERROR');

  it('P-W4a event note: a manual re-save of the same text reuses the id', async () => {
    post.mockRejectedValueOnce(server500()).mockResolvedValue(created(true));
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(newQc()) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'same' }).catch(() => {});
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'same' });
    });
    expect(post.mock.calls[0][1].client_request_id).toBe(post.mock.calls[1][1].client_request_id);
  });

  it('N-W4a event note: changed text gets a NEW id', async () => {
    post.mockRejectedValueOnce(server500()).mockResolvedValue(created());
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(newQc()) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'one' }).catch(() => {});
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'two' });
    });
    expect(post.mock.calls[0][1].client_request_id).not.toBe(post.mock.calls[1][1].client_request_id);
  });

  it('N-W4b event note: success clears it, the next identical note is a new note', async () => {
    post.mockResolvedValue(created());
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(newQc()) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'same' });
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'same' });
    });
    expect(post.mock.calls[0][1].client_request_id).not.toBe(post.mock.calls[1][1].client_request_id);
  });

  it('N-W4c event note: the same text on another event is a different note', async () => {
    post.mockRejectedValueOnce(server500()).mockResolvedValue(created());
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(newQc()) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'same' }).catch(() => {});
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e2', body: 'same' });
    });
    expect(post.mock.calls[0][1].client_request_id).not.toBe(post.mock.calls[1][1].client_request_id);
  });

  it('P-W4b care note: re-save reuses the id; changed text and success do not', async () => {
    post.mockRejectedValueOnce(server500()).mockResolvedValue(created());
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(newQc()) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', input: { body: 'a' } }).catch(() => {});
      await result.current.mutateAsync({ circleId: 'c1', input: { body: 'a' } }); // lands, clears
      await result.current.mutateAsync({ circleId: 'c1', input: { body: 'a' } }); // new note
    });
    const ids = post.mock.calls.map((c) => c[1].client_request_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  it('N-W4d care note: changed content gets a new id', async () => {
    post.mockRejectedValueOnce(server500()).mockResolvedValue(created());
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(newQc()) });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', input: { body: 'a' } }).catch(() => {});
      await result.current.mutateAsync({ circleId: 'c1', input: { body: 'b' } });
    });
    expect(post.mock.calls[0][1].client_request_id).not.toBe(post.mock.calls[1][1].client_request_id);
  });
});

// N-W3: a session that ended during the quiet retry must not run the optimistic rollback.
describe('session ended mid-retry (N-W3)', () => {
  const key = ['careNotes', 'c1', {}];
  const seed = (qc: QueryClient) =>
    qc.setQueryData(key, { notes: [{ id: 'old-row' }], today: '2026-08-08', timezone: 'America/Denver' });

  it('POSITIVE: care note: the cleared cache is NOT repopulated by a rollback, and no error event is counted', async () => {
    post.mockRejectedValue(network());
    const qc = newQc();
    seed(qc);
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(qc) });
    act(() => {
      void result.current.mutateAsync({ circleId: 'c1', input: { body: 'hi' } }).catch(() => {});
    });
    await advance(100);
    clearWriteRetryQueue(); // sign-out ...
    qc.clear(); // ... clears the caches too
    await advance(10_000);
    expect(qc.getQueryData(key)).toBeUndefined();
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1); // nothing resent under another session
  });

  it('POSITIVE: event note: a session-ended failure reports no error_occurred', async () => {
    post.mockRejectedValue(network());
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(newQc()) });
    act(() => {
      void result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'hi' }).catch(() => {});
    });
    await advance(100);
    clearWriteRetryQueue();
    await advance(10_000);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a normal give-up (same session) still rolls the optimistic row back and reports', async () => {
    post.mockRejectedValue(network());
    const qc = newQc();
    seed(qc);
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(qc) });
    act(() => {
      void result.current.mutateAsync({ circleId: 'c1', input: { body: 'hi' } }).catch(() => {});
    });
    await advance(60_000);
    expect((qc.getQueryData(key) as { notes: { id: string }[] }).notes.map((n) => n.id)).toEqual(['old-row']);
    expect(Analytics.errorOccurred).toHaveBeenCalled();
  });
});

// N-W1: clearing the held id only clears the id that landed.
describe('a slow earlier save never wipes a newer draft id (N-W1)', () => {
  it('POSITIVE: save A lands after save B (same scope) failed: B re-save still reuses its id', async () => {
    let releaseA!: (v: unknown) => void;
    post
      .mockImplementationOnce(() => new Promise((r) => (releaseA = r))) // A, slow
      .mockRejectedValueOnce(refusal('INTERNAL_ERROR')) // B fails
      .mockResolvedValue(created());
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapper(newQc()) });
    let aDone: Promise<unknown> = Promise.resolve();
    act(() => {
      aDone = result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'A' });
    });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'B' }).catch(() => {});
    });
    await act(async () => {
      releaseA(created());
      await aDone;
    });
    await act(async () => {
      await result.current.mutateAsync({ circleId: 'c1', eventId: 'e1', body: 'B' });
    });
    const ids = post.mock.calls.map((c) => c[1].client_request_id);
    expect(ids[2]).toBe(ids[1]);
  });
});
