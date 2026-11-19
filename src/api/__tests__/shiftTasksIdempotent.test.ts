import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// 1.4.3 audit item 11: shift-task create is an idempotent save like mobile's (one key, 3 retries).
vi.unmock('@/lib/api');

import { apiClient } from '@/lib/api';
import { createShiftTask } from '@/api/shiftTasks';
import { __setIdempotencySupportedForTests } from '@/lib/idempotentWrite';

type Cfg = InternalAxiosRequestConfig;
const body = { scheduledDate: '2026-11-20', title: 'Walk', scheduled_time: '09:00' } as never;
const ok = (config: Cfg) => ({
  data: { success: true, data: { event: { id: 'e1' } } },
  status: 201,
  statusText: 'Created',
  headers: {},
  config,
});
const dropped = (config: Cfg): never => {
  throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
};
const refused = (config: Cfg): never => {
  throw new AxiosError('x', AxiosError.ERR_BAD_REQUEST, config, null, {
    data: { success: false, error: { code: 'SHIFT_ENDED', message: 'x' } },
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config,
  });
};
function script(steps: Array<(c: Cfg) => unknown>) {
  const seen: Cfg[] = [];
  apiClient.defaults.adapter = vi.fn(async (c: Cfg) => {
    seen.push(c);
    return steps[Math.min(seen.length - 1, steps.length - 1)](c) as never;
  });
  return seen;
}
afterEach(() => __setIdempotencySupportedForTests(false));

describe('createShiftTask idempotent save', () => {
  it('a lost answer is retried with the SAME Idempotency-Key and succeeds', async () => {
    __setIdempotencySupportedForTests(true);
    const seen = script([dropped, ok]);
    await expect(createShiftTask('c1', 'e1', body)).resolves.toMatchObject({ id: 'e1' });
    expect(seen).toHaveLength(2);
    const keys = seen.map((c) => c.headers.get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('NEGATIVE: a 409 refusal (SHIFT_ENDED) is not retried', async () => {
    __setIdempotencySupportedForTests(true);
    const seen = script([refused]);
    await expect(createShiftTask('c1', 'e1', body)).rejects.toMatchObject({ error: { code: 'SHIFT_ENDED' } });
    expect(seen).toHaveLength(1);
  });

  it('NEGATIVE: an old backend (no Idempotency-Supported) sends once, unkeyed', async () => {
    const seen = script([dropped]);
    await expect(createShiftTask('c1', 'e1', body)).rejects.toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.get('Idempotency-Key')).toBeFalsy();
  });
});
