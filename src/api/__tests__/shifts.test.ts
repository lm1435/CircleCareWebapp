import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api';
import {
  assignShift,
  dropShift,
  getShifts,
  isShiftTakenError,
  shiftTakenBy,
  takeShift,
} from '../shifts';

vi.mock('@/lib/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);

beforeEach(() => vi.clearAllMocks());

describe('shifts API (SHIFTS_API_CONTRACT.md)', () => {
  it('reads shifts with includeShifts=true and keeps only shift rows', async () => {
    get.mockResolvedValue({
      success: true,
      data: {
        events: [
          { id: 'a', event_type: 'shift' },
          { id: 'b', event_type: 'task' },
        ],
      },
    });
    const rows = await getShifts('c1', '2026-10-19', '2026-10-25');
    expect(get).toHaveBeenCalledWith('/circles/c1/events', {
      params: { start_date: '2026-10-19', end_date: '2026-10-25', includeShifts: 'true' },
    });
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('take / drop / assign post { scope, scheduledDate, userId? } to the virtual id, URL-encoded as one segment', async () => {
    post.mockResolvedValue({ success: true, data: { event: { id: 'phys' }, rootId: 'newRoot' } });
    const take = await takeShift('c1', 'root_2026-10-20', { scope: 'future', scheduledDate: '2026-10-20' });
    expect(post).toHaveBeenLastCalledWith('/circles/c1/events/root_2026-10-20/shift/take', {
      scope: 'future',
      scheduledDate: '2026-10-20',
    });
    // The NEW root after a future split comes back to the caller.
    expect(take.rootId).toBe('newRoot');
    await dropShift('c1', 'x/../y', { scope: 'occurrence', scheduledDate: '2026-10-20' });
    expect(post).toHaveBeenLastCalledWith('/circles/c1/events/x%2F..%2Fy/shift/drop', expect.any(Object));
    await assignShift('c1', 'r', { scope: 'occurrence', scheduledDate: '2026-10-20', userId: 'u1' });
    expect(post).toHaveBeenLastCalledWith('/circles/c1/events/r/shift/assign', {
      scope: 'occurrence',
      scheduledDate: '2026-10-20',
      userId: 'u1',
    });
  });

  it('reads err.error.code and err.error.takenBy (the unwrapped envelope)', () => {
    const err = { success: false, error: { code: 'SHIFT_ALREADY_TAKEN', message: 'm', takenBy: ' Ana ' } };
    expect(isShiftTakenError(err)).toBe(true);
    expect(shiftTakenBy(err)).toBe('Ana');
    expect(isShiftTakenError({ error: { code: 'NOPE' } })).toBe(false);
    expect(shiftTakenBy({ error: { code: 'SHIFT_ALREADY_TAKEN' } })).toBeNull();
    // Never err.response.data.error.code.
    expect(isShiftTakenError({ response: { data: { error: { code: 'SHIFT_ALREADY_TAKEN' } } } })).toBe(false);
  });
});
