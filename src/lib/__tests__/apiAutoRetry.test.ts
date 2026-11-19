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

  it('NEGATIVE: an action POST (not a create route) is never auto-retried', async () => {
    const seen = script([dropped]);
    await expect(apiClient.post('/invites/i1/accept')).rejects.toBeTruthy();
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
});
