// Backdating in the data layer: the optimistic row is filed under its own day in
// the windows that cover it (and only those), and useOlderCareNotes pages
// contiguous 92-day ranges.
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/careNotes', () => ({
  getCareNotes: vi.fn(),
  createCareNote: vi.fn(),
  updateCareNote: vi.fn(),
  deleteCareNote: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u', first_name: 'A', last_name: 'B' } }) },
}));
vi.mock('@/lib/analytics', () => ({ Analytics: { errorOccurred: vi.fn() } }));

import { createCareNote, getCareNotes } from '@/api/careNotes';
import { useCreateCareNote, useOlderCareNotes } from '../useCareNotes';

const TODAY = '2026-08-08';
const note = (id: string, d: string) => ({ id, note_date: d }) as never;
const wrapper = (qc: QueryClient) =>
  function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };

describe('useCreateCareNote — optimistic row lands under its own day', () => {
  it('goes into covering windows only, sorted note_date DESC', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData(['careNotes', 'c1', {}], {
      notes: [note('t', TODAY), note('y', '2026-08-07')],
      today: TODAY,
      timezone: 'America/Denver',
    });
    qc.setQueryData(['careNotes', 'c1', { from: '2026-02-05', to: '2026-05-07' }], {
      notes: [note('o', '2026-05-01')],
      today: TODAY,
      timezone: 'America/Denver',
    });
    (createCareNote as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCreateCareNote(), { wrapper: wrapper(qc) });

    act(() => {
      result.current.mutate({ circleId: 'c1', input: { body: 'x', note_date: '2026-08-07' } });
    });
    await waitFor(() => {
      const d = qc.getQueryData(['careNotes', 'c1', {}]) as { notes: { id: string }[] };
      expect(d.notes.map((n) => (n.id.startsWith('optimistic') ? 'NEW' : n.id))).toEqual([
        't',
        'NEW',
        'y',
      ]);
    });
    const older = qc.getQueryData(['careNotes', 'c1', { from: '2026-02-05', to: '2026-05-07' }]) as {
      notes: unknown[];
    };
    expect(older.notes).toHaveLength(1);

    act(() => {
      result.current.mutate({ circleId: 'c1', input: { body: 'y', note_date: '2026-05-05' } });
    });
    await waitFor(() => {
      const d = qc.getQueryData(['careNotes', 'c1', { from: '2026-02-05', to: '2026-05-07' }]) as {
        notes: { note_date: string }[];
      };
      expect(d.notes).toHaveLength(2);
      expect(d.notes[0].note_date).toBe('2026-05-05');
    });
  });
});

describe('useOlderCareNotes', () => {
  it('requests contiguous 92-day pages before the base window and reports the end', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (getCareNotes as ReturnType<typeof vi.fn>).mockImplementation(
      async (_c: string, r: { from: string; to: string }) => ({
        notes: r.to === '2026-05-08' ? [note('a', '2026-05-01')] : [],
        today: TODAY,
        timezone: 'America/Denver',
      })
    );
    const { result, rerender } = renderHook(
      ({ pages }: { pages: number }) => useOlderCareNotes('c1', TODAY, pages),
      { wrapper: wrapper(qc), initialProps: { pages: 1 } }
    );
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(getCareNotes).toHaveBeenCalledWith('c1', { from: '2026-02-06', to: '2026-05-08' });
    expect(result.current.reachedEnd).toBe(false);

    rerender({ pages: 2 });
    await waitFor(() => expect(result.current.reachedEnd).toBe(true));
    expect(getCareNotes).toHaveBeenCalledWith('c1', { from: '2025-11-06', to: '2026-02-05' });
  });
});
