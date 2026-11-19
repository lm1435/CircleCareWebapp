import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// 1.4.3 owner rule: EVERY write retries a no-answer failure (1 / 3 / 7 s; zero delay under test)
// before the caller sees an error. REAL api client, axios adapter faked.
vi.unmock('@/lib/api');

import { apiClient, resetRefreshState } from '@/lib/api';
import { __setIdempotencySupportedForTests } from '@/lib/idempotentWrite';
import { tokenAccessor } from '@/lib/tokenAccessor';

type Cfg = InternalAxiosRequestConfig;
const reply = (config: Cfg, status: number, data: unknown = { success: true, data: {} }) => ({
  data,
  status,
  statusText: String(status),
  headers: {},
  config,
});
const dropped = (config: Cfg): never => {
  throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
};
const refused = (config: Cfg, status: number, code: string): never => {
  throw new AxiosError('x', AxiosError.ERR_BAD_REQUEST, config, null, {
    data: { success: false, error: { code, message: code } },
    status,
    statusText: String(status),
    headers: {},
    config,
  });
};

function script(steps: Array<(c: Cfg) => unknown>) {
  const seen: Cfg[] = [];
  apiClient.defaults.adapter = vi.fn(async (config: Cfg) => {
    seen.push(config);
    const step = steps[Math.min(seen.length - 1, steps.length - 1)];
    return step(config) as never;
  });
  return seen;
}

beforeEach(() => {
  resetRefreshState();
  tokenAccessor.clear();
  __setIdempotencySupportedForTests(true);
});
afterEach(() => __setIdempotencySupportedForTests(false));

describe('automatic write retry (api client)', () => {
  it('PATCH: the second attempt succeeds, the caller never sees the first failure', async () => {
    const seen = script([dropped, (c) => reply(c, 200)]);
    await expect(apiClient.patch('/users/me', { first_name: 'A' })).resolves.toBeTruthy();
    expect(seen).toHaveLength(2);
  });

  it('keyed create POST: the SAME Idempotency-Key on every attempt', async () => {
    const seen = script([dropped, dropped, (c) => reply(c, 200)]);
    await apiClient.post('/circles/c1/vitals', { type: 'weight' });
    expect(seen).toHaveLength(3);
    const keys = seen.map((c) => c.headers.get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(new Set(keys).size).toBe(1);
  });

  it('final failure after 3 retries reaches the caller once (4 attempts total)', async () => {
    const seen = script([dropped]);
    await expect(apiClient.put('/circles/c1/emergency-info', {})).rejects.toBeTruthy();
    expect(seen).toHaveLength(4);
  });

  it('NEGATIVE: a 4xx refusal is never retried', async () => {
    const seen = script([(c) => refused(c, 403, 'VIEW_ONLY')]);
    await expect(apiClient.patch('/circles/c1', {})).rejects.toMatchObject({ error: { code: 'VIEW_ONLY' } });
    expect(seen).toHaveLength(1);
  });

  it('NEGATIVE: a 5xx answer is not retried by this layer (it was answered)', async () => {
    const seen = script([(c) => refused(c, 500, 'SERVER_ERROR')]);
    await expect(apiClient.patch('/circles/c1', {})).rejects.toBeTruthy();
    expect(seen).toHaveLength(1);
  });

  it('NEGATIVE: an action POST (not a keyed route, e.g. leave circle: no backend key) is never auto-retried', async () => {
    const seen = script([dropped]);
    await expect(apiClient.post('/circles/c1/leave')).rejects.toBeTruthy();
    expect(seen).toHaveLength(1);
  });

  it('NEGATIVE: against an old backend (no Idempotency-Supported seen) a create POST is sent once, unkeyed', async () => {
    __setIdempotencySupportedForTests(false);
    const seen = script([dropped]);
    await expect(apiClient.post('/circles/c1/vitals', {})).rejects.toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.get('Idempotency-Key')).toBeFalsy();
  });

  it('NEGATIVE: a caller that carries its own Idempotency-Key retries itself (no double ladder)', async () => {
    const seen = script([dropped]);
    await expect(
      apiClient.patch('/circles/c1/events/e1', {}, { headers: { 'Idempotency-Key': 'caller-key-123456789' } })
    ).rejects.toBeTruthy();
    expect(seen).toHaveLength(1);
  });

  it('NEGATIVE: auth endpoints and account deletion are never auto-retried', async () => {
    const seen = script([dropped]);
    await expect(apiClient.post('/auth/login', {})).rejects.toBeTruthy();
    await expect(apiClient.delete('/users/me')).rejects.toBeTruthy();
    expect(seen).toHaveLength(2);
  });

  it('DELETE whose first attempt landed (response lost): the repeat 404 is success', async () => {
    const seen = script([dropped, (c) => refused(c, 404, 'NOT_FOUND')]);
    await expect(apiClient.delete('/circles/c1/vitals/v1')).resolves.toMatchObject({ success: true });
    expect(seen).toHaveLength(2);
  });

  it('NEGATIVE: a 404 on the FIRST attempt of a DELETE is still a failure', async () => {
    script([(c) => refused(c, 404, 'NOT_FOUND')]);
    await expect(apiClient.delete('/circles/c1/vitals/v1')).rejects.toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  // ── 1.4.3 retry review S5 / S7 / S4 / N3 / N4 ────────────────────────────────────────────────
  it.each([
    '/invites/i1/accept',
    '/invites/code/ABC12345/accept',
    '/invites/i1/resend',
    '/circles/c1/documents/upload',
    '/circles/c1/medications/m1/as-needed-doses/d1/remove',
    '/circles/c1/events/import',
    '/circles/c1/events/e1/shift/assign',
    '/feedback',
    '/circles/c1/dose-alerts/answer',
  ])('S7 positive: keyed POST %s retries with the SAME key', async (url) => {
    const seen = script([dropped, (c) => reply(c, 200)]);
    await apiClient.post(url, {});
    expect(seen).toHaveLength(2);
    expect(seen[0].headers.get('Idempotency-Key')).toBeTruthy();
    expect(seen[1].headers.get('Idempotency-Key')).toBe(seen[0].headers.get('Idempotency-Key'));
  });

  it('S7 positive: manual Create circle (caller key) auto-retries with its own stable key', async () => {
    const seen = script([dropped, (c) => reply(c, 200)]);
    await apiClient.post('/circles', {}, { headers: { 'Idempotency-Key': 'create-key-123456789' } });
    expect(seen).toHaveLength(2);
    expect(seen[1].headers.get('Idempotency-Key')).toBe('create-key-123456789');
  });

  it('S5 positive: 409 IDEMPOTENCY_IN_PROGRESS waits and resends with the same key', async () => {
    const seen = script([(c) => refused(c, 409, 'IDEMPOTENCY_IN_PROGRESS'), (c) => reply(c, 200)]);
    await expect(apiClient.post('/circles/c1/vitals', {})).resolves.toBeTruthy();
    expect(seen).toHaveLength(2);
    expect(seen[1].headers.get('Idempotency-Key')).toBe(seen[0].headers.get('Idempotency-Key'));
  });

  it('S5 negative: any other 409 is a refusal, sent once', async () => {
    const seen = script([(c) => refused(c, 409, 'DOSE_ALREADY_RECORDED')]);
    await expect(apiClient.post('/circles/c1/vitals', {})).rejects.toBeTruthy();
    expect(seen).toHaveLength(1);
  });

  it('S4 negative: a sleep that overshoots (tab asleep) stops with the original failure', async () => {
    const seen = script([dropped, (c) => reply(c, 200)]);
    const real = Date.now.bind(Date);
    let jump = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + jump);
    const realTimeout = globalThis.setTimeout;
    const tspy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
      realTimeout(() => {
        jump += 60_000; // the lid was closed for a minute
        fn();
      }, ms)) as never);
    await expect(apiClient.patch('/users/me', { first_name: 'A' })).rejects.toBeTruthy();
    tspy.mockRestore();
    spy.mockRestore();
    expect(seen).toHaveLength(1);
  });

  it('N3 negative: a sign-out during the wait means nothing is resent', async () => {
    const { clearWriteRetryQueue } = await import('@/lib/writeRetryQueue');
    const seen = script([
      (c) => {
        clearWriteRetryQueue();
        return dropped(c);
      },
      (c) => reply(c, 200),
    ]);
    await expect(apiClient.patch('/users/me', { first_name: 'A' })).rejects.toBeTruthy();
    expect(seen).toHaveLength(1);
  });
});
