import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/i18n';

vi.mock('@/api/medicationConfirmations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/medicationConfirmations')>();
  return { ...actual, confirmMedication: vi.fn(), getTodaysMedications: vi.fn() };
});
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui')>()),
  useToast: () => ({ showToast: vi.fn() }),
}));
const analytics = vi.hoisted(() => ({
  medicationConfirmed: vi.fn(),
  medicationConfirmRecovered: vi.fn(),
  medicationConfirmAlreadyRecorded: vi.fn(),
  errorOccurred: vi.fn(),
  writeRetryScheduled: vi.fn(),
  writeRetrySucceeded: vi.fn(),
  writeRetryGaveUp: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: analytics, default: analytics }));

import { confirmMedication, getTodaysMedications, type TodaysMedication } from '@/api/medicationConfirmations';
import { MEDICATION_UNDO_DELAY_MS, useMedicationUndo } from '@/components/meds/useMedicationUndo';
import {
  WRITE_RETRY_MAX_AGE_MS,
  __resetWriteRetryForTests,
  pendingCount,
} from '@/lib/writeRetryQueue';

// 1.4.3 audit item 5 (owner OK 2026-11-19): a dose Taken / Skipped whose answer never reached the
// server is queued for the quiet retry, re-reading the day before EVERY resend.

const mockConfirm = vi.mocked(confirmMedication);
const mockDay = vi.mocked(getTodaysMedications);
const network = () => ({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' });
const CIRCLE = 'circle-1';

const med = {
  id: 'med-1',
  scheduled_date: '2026-11-19',
  scheduled_time: '08:00:00',
  parent_event_id: null,
  confirmation: null,
} as unknown as TodaysMedication;
const rowWith = (status: string | null) =>
  [{ ...med, confirmation: status ? { status, confirmed_at: 'x', confirmed_by: 'u2' } : null }] as never;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

function setup() {
  const onConfirmed = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(
    () => useMedicationUndo({ circleId: CIRCLE, source: 'today' as never, onConfirmed, onError }),
    { wrapper }
  );
  return { ...hook, onConfirmed, onError };
}

async function takeAndFire(h: ReturnType<typeof setup>) {
  act(() => h.result.current.confirm(med, 'taken'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MEDICATION_UNDO_DELAY_MS + 50);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetWriteRetryForTests();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => {
  __resetWriteRetryForTests();
  vi.useRealTimers();
});

describe('dose Taken/Skipped quiet retry', () => {
  it('a network failure whose write did NOT land is queued (Saving stays), resent after 2 s, one success, no error', async () => {
    mockConfirm.mockRejectedValueOnce(network()).mockResolvedValue({} as never);
    mockDay.mockResolvedValue(rowWith(null)); // not recorded, before every attempt
    const h = setup();
    await takeAndFire(h);
    expect(pendingCount()).toBe(1);
    expect(h.result.current.pending).toEqual({ 'med-1': 'taken' }); // "Saving" badge kept
    expect(h.onError).not.toHaveBeenCalled();
    expect(analytics.errorOccurred).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(h.onConfirmed).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.result.current.pending).toEqual({});
  });

  it('NEGATIVE: the first attempt actually LANDED (re-read before the resend): nothing is sent twice', async () => {
    mockConfirm.mockRejectedValue(network());
    // In-mutation verify cannot reach the server; the queue's landed() read then finds it recorded.
    mockDay.mockRejectedValueOnce(network()).mockResolvedValue(rowWith('taken'));
    const h = setup();
    await takeAndFire(h);
    expect(pendingCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1); // never re-sent: no second confirmed_at, no second feed row
    expect(h.onConfirmed).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("NEGATIVE: another caregiver answered meanwhile: the resend's 409 goes to the existing dialog path and is never retried or overwritten", async () => {
    mockConfirm
      .mockRejectedValueOnce(network())
      .mockRejectedValue({ success: false, error: { code: 'DOSE_ALREADY_RECORDED', message: 'x' } });
    // Another caregiver recorded SKIPPED: not what we sent, so landed() is false and we try; the server refuses.
    mockDay.mockResolvedValue(rowWith('skipped'));
    const h = setup();
    await takeAndFire(h);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError.mock.calls[0][0]).toMatchObject({ error: { code: 'DOSE_ALREADY_RECORDED' } });
    expect(h.onConfirmed).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(2);
    expect(pendingCount()).toBe(0);
  });

  it('gives up after the max age: error_occurred ONCE, the row is released, no per-attempt noise', async () => {
    mockConfirm.mockRejectedValue(network());
    mockDay.mockResolvedValue(rowWith(null));
    const h = setup();
    await takeAndFire(h);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_MAX_AGE_MS + 60_000);
    });
    expect(analytics.errorOccurred).toHaveBeenCalledTimes(1);
    expect(analytics.errorOccurred.mock.calls[0][1]).toBe('medication_confirm_update_failed');
    expect(h.result.current.pending).toEqual({});
    expect(h.onConfirmed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a 5xx answer (the server replied) is NOT queued: the dialog path as before', async () => {
    mockConfirm.mockRejectedValue({ success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } });
    mockDay.mockResolvedValue(rowWith(null));
    const h = setup();
    await takeAndFire(h);
    expect(pendingCount()).toBe(0);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });
});
