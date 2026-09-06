// The medication-history query and the confirm mutation.
//
// Both guards here are about a boundary that is invisible in a screenshot: the
// history list PAGES (it used to fetch one page and throw `hasMore` away), and
// the confirm mutation must not settle until the dose list has actually
// refetched (the undo flow clears its pending badge on settle).

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/medicationConfirmations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/medicationConfirmations')>();
  return {
    ...actual,
    getMedicationConfirmations: vi.fn(),
    confirmMedication: vi.fn(),
  };
});

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

vi.mock('@/lib/analytics', () => ({
  Analytics: { medicationConfirmed: vi.fn(), errorOccurred: vi.fn() },
}));

import {
  confirmMedication,
  getMedicationConfirmations,
  type MedicationConfirmation,
  type MedicationConfirmationsPage,
} from '@/api/medicationConfirmations';
import { medicationOptions } from '@/components/meds/historyQuery';
import { queryKeys } from '@/lib/queryKeys';
import {
  MEDICATION_CONFIRMATIONS_PAGE_SIZE,
  useConfirmMedication,
  useMedicationConfirmations,
} from '@/hooks/useMedConfirmation';
import { Analytics } from '@/lib/analytics';

const CIRCLE_ID = 'circle-1';
const WINDOW = { start_date: '2026-08-07', end_date: '2026-09-05' };

const mockGet = vi.mocked(getMedicationConfirmations);
const mockConfirm = vi.mocked(confirmMedication);

function row(id: string, medication: string): MedicationConfirmation {
  return {
    id,
    event_id: id,
    circle_id: CIRCLE_ID,
    confirmed_by: 'u1',
    confirmed_at: '2026-09-05T14:00:00Z',
    status: 'taken',
    scheduled_time: '08:00:00',
    event: {
      id,
      title: medication,
      medication_name: medication,
      scheduled_date: '2026-09-05',
    },
  } as MedicationConfirmation;
}

function page(rows: MedicationConfirmation[], hasMore: boolean): MedicationConfirmationsPage {
  return { confirmations: rows, hasMore };
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMedicationConfirmations', () => {
  it('asks for one page of 30 at offset 0, inside the given window', async () => {
    mockGet.mockResolvedValue(page([row('c1', 'Metformin')], false));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useMedicationConfirmations(CIRCLE_ID, WINDOW), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(MEDICATION_CONFIRMATIONS_PAGE_SIZE).toBe(30);
    expect(mockGet).toHaveBeenCalledWith(CIRCLE_ID, {
      ...WINDOW,
      limit: 30,
      offset: 0,
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  // THE REGRESSION. One page of 100 with `hasMore` discarded meant a circle on
  // five daily medications (~150 doses a month) lost a fortnight of its "last
  // 30 days" with nothing on screen saying so.
  it('pages: a second fetch appends to the first, and both are readable at once', async () => {
    mockGet
      .mockResolvedValueOnce(page([row('c1', 'Metformin'), row('c2', 'Warfarin')], true))
      .mockResolvedValueOnce(page([row('c3', 'Atorvastatin')], false));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useMedicationConfirmations(CIRCLE_ID, WINDOW), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    expect(result.current.data?.confirmations).toHaveLength(2);
    expect(result.current.data?.hasMore).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    // The next OFFSET is the count of rows already loaded — not
    // `pages.length * PAGE_SIZE`, so a short page cannot make the next request
    // skip rows.
    expect(mockGet).toHaveBeenLastCalledWith(CIRCLE_ID, { ...WINDOW, limit: 30, offset: 2 });

    await waitFor(() => expect(result.current.data?.confirmations).toHaveLength(3));
    expect(result.current.data?.confirmations.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    // `hasMore` is the LAST page's answer, not the first's.
    expect(result.current.data?.hasMore).toBe(false);
    expect(result.current.hasNextPage).toBe(false);
  });

  // The filter menu reads the same flattened list, so a medication that only
  // appears on page two joins the options once that page is loaded.
  it('feeds medicationOptions from every loaded page', async () => {
    mockGet
      .mockResolvedValueOnce(page([row('c1', 'Metformin')], true))
      .mockResolvedValueOnce(page([row('c2', 'Warfarin')], false));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useMedicationConfirmations(CIRCLE_ID, WINDOW), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(medicationOptions(result.current.data?.confirmations ?? [])).toEqual([
      { id: 'Metformin', name: 'Metformin' },
    ]);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.confirmations).toHaveLength(2));

    expect(medicationOptions(result.current.data?.confirmations ?? [])).toEqual([
      { id: 'Metformin', name: 'Metformin' },
      { id: 'Warfarin', name: 'Warfarin' },
    ]);
  });

  // Paging belongs to the hook. A caller-supplied limit/offset would fork the
  // page size out of the query key's control — and the key is the whole reason
  // the page's copy of this query and the list's share one cache entry.
  it('ignores caller-supplied limit/offset and keys only on the window', async () => {
    mockGet.mockResolvedValue(page([], false));
    const { Wrapper, queryClient } = wrapper();

    const { result } = renderHook(
      () => useMedicationConfirmations(CIRCLE_ID, { ...WINDOW, limit: 500, offset: 90 }),
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(CIRCLE_ID, { ...WINDOW, limit: 30, offset: 0 });
    expect(
      queryClient.getQueryData(queryKeys.medicationConfirmations(CIRCLE_ID, WINDOW))
    ).toBeDefined();
  });

  it('stays idle while disabled', () => {
    mockGet.mockResolvedValue(page([], false));
    const { Wrapper } = wrapper();

    renderHook(() => useMedicationConfirmations(CIRCLE_ID, WINDOW, { enabled: false }), {
      wrapper: Wrapper,
    });

    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useConfirmMedication', () => {
  // THE DUPLICATE-DOSE WINDOW.
  //
  // The undo flow clears a dose's pending badge when the mutation settles. With
  // a bare `void invalidateQueries(...)` that happened while the today's-meds
  // refetch was still in flight, so the row fell back to the STALE cached dose
  // for a frame or two — Take/Skip reappeared under the cursor on a dose that
  // had just been answered, and a second click wrote a duplicate confirmation,
  // a duplicate activity-feed row and a duplicate push to the whole circle.
  //
  // Returning the promise from `onSuccess` makes TanStack await it, so
  // `mutateAsync` resolves only after the list is fresh.
  it('does not settle until the today’s-meds refetch has finished', async () => {
    mockConfirm.mockResolvedValue({ id: 'conf-1' } as MedicationConfirmation);
    const { Wrapper, queryClient } = wrapper();

    let releaseRefetch!: () => void;
    const refetched = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation((filters?: { queryKey?: readonly unknown[] }) =>
        filters?.queryKey?.[0] === 'todaysMeds' ? refetched : Promise.resolve()
      );

    const { result } = renderHook(() => useConfirmMedication(CIRCLE_ID, 'care_profile'), {
      wrapper: Wrapper,
    });

    let settled = false;
    await act(async () => {
      void result.current
        .mutateAsync({ event_id: 'e1', status: 'taken', scheduled_time: '08:00:00' })
        .then(() => {
          settled = true;
        });
      // Enough turns for the POST itself to resolve; only the refetch is open.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['todaysMeds', CIRCLE_ID] });
    expect(settled).toBe(false);

    await act(async () => {
      releaseRefetch();
      await refetched;
      await Promise.resolve();
    });

    await waitFor(() => expect(settled).toBe(true));
  });

  // Only the dose list is awaited. Adherence, activity and the weekly figure
  // are background freshness for screens nobody is looking at; awaiting them
  // would hold Take/Skip hostage to a report fetch.
  it('does not wait on the background invalidations', async () => {
    mockConfirm.mockResolvedValue({ id: 'conf-2' } as MedicationConfirmation);
    const { Wrapper, queryClient } = wrapper();

    const never = new Promise<void>(() => {});
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      (filters?: { queryKey?: readonly unknown[] }) =>
        filters?.queryKey?.[0] === 'todaysMeds' ? Promise.resolve() : never
    );

    const { result } = renderHook(() => useConfirmMedication(CIRCLE_ID, 'care_profile'), {
      wrapper: Wrapper,
    });

    let confirmation: MedicationConfirmation | undefined;
    await act(async () => {
      confirmation = await result.current.mutateAsync({
        event_id: 'e1',
        status: 'taken',
        scheduled_time: '08:00:00',
      });
    });

    // It RESOLVED — with three background invalidations still hanging open
    // forever. Awaiting those would have deadlocked this assertion.
    expect(confirmation).toEqual({ id: 'conf-2' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

// Error visibility (mobile parity with `medicationConfirmFailed`): a failed
// confirm is counted as `error_occurred` / `medication_confirm_error` on BOTH
// onError branches, and `code` is the closed-set `classifyFailureCode` value —
// never the toast copy or the rejection's message.
describe('useConfirmMedication — error_occurred on failure', () => {
  const errorOccurred = vi.mocked(Analytics.errorOccurred);

  it.each([
    ['permission-denied branch', { success: false, error: { code: 'VIEW_ONLY' } }, 'VIEW_ONLY'],
    [
      'other branch (409)',
      { success: false, error: { code: 'MEDICATION_DISCONTINUED', message: 'pat@example.com' } },
      'MEDICATION_DISCONTINUED',
    ],
    ['other branch (message only)', { message: 'confirm for pat@example.com failed' }, 'unknown_error'],
  ])('%s → screen/error/circle_id/status/source/code, no message text', async (_l, rej, code) => {
    mockConfirm.mockRejectedValue(rej);
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useConfirmMedication(CIRCLE_ID, 'care_profile'), {
      wrapper: Wrapper,
    });
    result.current.mutate({ event_id: 'e1', status: 'skipped', scheduled_time: '08:00:00' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(errorOccurred).toHaveBeenCalledTimes(1);
    expect(errorOccurred).toHaveBeenCalledWith('medication_confirm', 'medication_confirm_error', {
      circle_id: CIRCLE_ID,
      status: 'skipped',
      source: 'care_profile',
      code,
    });
    expect(JSON.stringify(errorOccurred.mock.calls[0])).not.toContain('@');
  });
});
