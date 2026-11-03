/**
 * Web parity of mobile/src/__tests__/api/idempotentEventWrite.test.ts.
 *
 * REPRODUCES (HEAD before the fix): the real apiClient + real createEvent /
 * updateEvent against a fake server that WRITES the event and then loses the
 * response (network drop / timeout). HEAD rejects -> the form says the save
 * failed for a medication that exists, and Save again creates a second one.
 *
 * AFTER: the save carries an Idempotency-Key and is retried with the SAME key
 * once the tab is visible again; the server (dedupes by key, as the backend
 * middleware does — proven live in backend requestIdempotency.integration.test.ts)
 * replays the first answer: one row, a success, `api_write_retried` recovered.
 * An old backend (no `Idempotency-Supported`) keeps today's behaviour exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';

// The REAL api client (the global setup mock is removed here), as in api.test.ts.
vi.unmock('@/lib/api');

const apiWriteRetried = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return { ...actual, Analytics: { ...actual.Analytics, apiWriteRetried: (...a: unknown[]) => apiWriteRetried(...a) } };
});

import { apiClient } from '@/lib/api';
import { createEvent, getEvents, updateEvent } from '@/api/calendarEvents';
import { __setIdempotencySupportedForTests } from '@/lib/idempotentWrite';

type Sent = { method: string; key: string | undefined };

function fakeServer(opts: { supportsIdempotency: boolean; loseFirstResponse: boolean; refuseFirst?: boolean }) {
  const sent: Sent[] = [];
  const rows: any[] = [];
  const byKey = new Map<string, any>();
  let writes = 0;
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const key = (config.headers?.get?.('Idempotency-Key') as string | undefined) ?? undefined;
    sent.push({ method: config.method ?? 'get', key: key || undefined });
    const respHeaders: Record<string, string> = opts.supportsIdempotency ? { 'idempotency-supported': '1' } : {};
    const ok = (data: any, status = 200, extra: Record<string, string> = {}) => ({
      data,
      status,
      statusText: 'OK',
      headers: { ...respHeaders, ...extra },
      config,
    });
    if (config.method === 'get') return ok({ success: true, data: { events: rows } });
    if (opts.supportsIdempotency && key && byKey.has(key)) {
      return ok(byKey.get(key), 200, { 'idempotent-replayed': 'true' });
    }
    writes += 1;
    if (writes === 1 && opts.refuseFirst) {
      const err: any = new Error('Request failed with status code 400');
      err.isAxiosError = true;
      err.config = config;
      err.response = {
        status: 400,
        data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'x' } },
        headers: respHeaders,
        config,
      };
      throw err;
    }
    const body = JSON.parse(String(config.data));
    const event =
      config.method === 'post' ? { id: `evt-${rows.length + 1}`, ...body } : { ...(rows[0] ?? { id: 'evt-1' }), ...body };
    if (config.method === 'post') rows.push(event);
    else rows[0] = event;
    const answer = { success: true, data: { event } };
    if (opts.supportsIdempotency && key) byKey.set(key, answer);
    if (writes === 1 && opts.loseFirstResponse) {
      const err: any = new Error('Network Error');
      err.code = 'ERR_NETWORK';
      err.isAxiosError = true;
      err.config = config;
      throw err;
    }
    return ok(answer, config.method === 'post' ? 201 : 200);
  });
  return { adapter, sent, rows };
}

let visibility: DocumentVisibilityState = 'visible';
const originalAdapter = apiClient.defaults.adapter;

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
  apiWriteRetried.mockClear();
  __setIdempotencySupportedForTests(false);
});
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
});

const MED = {
  event_type: 'medication',
  title: 'Med',
  medication_name: 'Med',
  scheduled_date: '2026-11-02',
  scheduled_time: '20:00',
  recurrence_rule: 'daily',
} as any;

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('create: response lost after the server wrote', () => {
  it('tab hidden mid-save: waits until visible, retries with the SAME key, ONE row, no failure', async () => {
    const server = fakeServer({ supportsIdempotency: true, loseFirstResponse: true });
    apiClient.defaults.adapter = server.adapter as any;
    await getEvents('c1', { start_date: '2026-11-02', end_date: '2026-11-02' } as any);

    visibility = 'hidden';
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let result: any;
    const save = createEvent('c1', MED).then(
      (r) => {
        settled = 'resolved';
        result = r;
      },
      () => {
        settled = 'rejected';
      }
    );
    await flush();
    expect(settled).toBe('pending');
    expect(server.sent.filter((s) => s.method === 'post')).toHaveLength(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await save;

    expect(settled).toBe('resolved');
    expect(result.id).toBe('evt-1');
    expect(server.rows).toHaveLength(1);
    const posts = server.sent.filter((s) => s.method === 'post');
    expect(posts).toHaveLength(2);
    expect(posts[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[1].key).toBe(posts[0].key);
    expect(apiWriteRetried).toHaveBeenCalledWith({
      operation: 'event_create',
      cause: 'network_error',
      attempts: 2,
      outcome: 'recovered',
      replayed: true,
      backgrounded: true,
    });
  });

  it('two separate saves use two different keys', async () => {
    const server = fakeServer({ supportsIdempotency: true, loseFirstResponse: false });
    apiClient.defaults.adapter = server.adapter as any;
    await getEvents('c1', { start_date: '2026-11-02', end_date: '2026-11-02' } as any);
    await createEvent('c1', MED);
    await createEvent('c1', { ...MED, scheduled_time: '08:00' });
    const keys = server.sent.filter((s) => s.method === 'post').map((s) => s.key);
    expect(keys[0]).toBeDefined();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("OLD backend (no Idempotency-Supported): no header, no retry — today's behaviour", async () => {
    const server = fakeServer({ supportsIdempotency: false, loseFirstResponse: true });
    apiClient.defaults.adapter = server.adapter as any;
    await getEvents('c1', { start_date: '2026-11-02', end_date: '2026-11-02' } as any);
    await expect(createEvent('c1', MED)).rejects.toMatchObject({ code: 'ERR_NETWORK' });
    const posts = server.sent.filter((s) => s.method === 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0].key).toBeUndefined();
    expect(apiWriteRetried).not.toHaveBeenCalled();
  });

  it('a definitive refusal (400 VALIDATION_ERROR) is never retried', async () => {
    const server = fakeServer({ supportsIdempotency: true, loseFirstResponse: false, refuseFirst: true });
    apiClient.defaults.adapter = server.adapter as any;
    await getEvents('c1', { start_date: '2026-11-02', end_date: '2026-11-02' } as any);
    await expect(createEvent('c1', MED)).rejects.toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(server.sent.filter((s) => s.method === 'post')).toHaveLength(1);
  });
});

describe('edit: response lost after the server wrote', () => {
  it('PATCH retries with the same key and resolves with the saved event', async () => {
    const server = fakeServer({ supportsIdempotency: true, loseFirstResponse: true });
    apiClient.defaults.adapter = server.adapter as any;
    await getEvents('c1', { start_date: '2026-11-02', end_date: '2026-11-02' } as any);
    const saved = await updateEvent('c1', 'evt-1', { medication_dosage: '20 mg' } as any);
    expect(saved).toMatchObject({ medication_dosage: '20 mg' });
    const patches = server.sent.filter((s) => s.method === 'patch');
    expect(patches).toHaveLength(2);
    expect(patches[1].key).toBe(patches[0].key);
  });
});
