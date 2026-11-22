/**
 * "The form remembers its save": a key follows the payload, never outlives it.
 * Real apiClient + real createEvent/updateEvent against a fake server that mirrors
 * backend/src/middleware/idempotency.ts (same key + same body = replay; same key + other body = 422).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';

vi.unmock('@/lib/api');

import { apiClient } from '@/lib/api';
import { createEvent, updateEvent } from '@/api/calendarEvents';
import { __setIdempotencySupportedForTests } from '@/lib/idempotentWrite';
import { createSaveIntentKeys } from '@/lib/saveIntentKeys';

type Mode = 'lose' | 'ok' | 'conflict';

function server() {
  const sent: Array<{ key: string | undefined; body: string }> = [];
  const rows: any[] = [];
  const stored = new Map<string, { body: string; answer: any }>();
  let mode: Mode = 'ok';
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const key = (config.headers?.get?.('Idempotency-Key') as string | undefined) || undefined;
    const body = String(config.data);
    sent.push({ key, body });
    const h = { 'idempotency-supported': '1' };
    const resp = (data: any, status: number) => ({ data, status, statusText: '', headers: h, config });
    const fail = (status: number, code: string) => {
      const err: any = new Error(`status ${status}`);
      err.isAxiosError = true;
      err.config = config;
      err.response = { status, data: { success: false, error: { code, message: 'x' } }, headers: h, config };
      throw err;
    };
    const lose = () => {
      const err: any = new Error('Network Error');
      err.code = 'ERR_NETWORK';
      err.isAxiosError = true;
      err.config = config;
      throw err;
    };
    const held = key ? stored.get(key) : undefined;
    if (held) {
      if (held.body !== body) return fail(422, 'IDEMPOTENCY_KEY_REUSED');
      return mode === 'lose' ? lose() : resp(held.answer, 200);
    }
    if (mode === 'conflict') return fail(422, 'IDEMPOTENCY_KEY_REUSED');
    const event = { id: `evt-${rows.length + 1}`, ...JSON.parse(body) };
    rows.push(event);
    const answer = { success: true, data: { event } };
    if (key) stored.set(key, { body, answer });
    if (mode === 'lose') return lose();
    return resp(answer, 201);
  });
  return { adapter, sent, rows, setMode: (m: Mode) => (mode = m) };
}

const original = apiClient.defaults.adapter;
beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  __setIdempotencySupportedForTests(true);
});
afterEach(() => {
  apiClient.defaults.adapter = original;
});

const med = (over: Record<string, unknown> = {}) =>
  ({ event_type: 'medication', title: 'Med', scheduled_date: '2026-11-02', scheduled_time: '20:00', ...over }) as any;

/** What a form does on a Save press: build a FRESH object, ask the intent for its stable twin, send. */
function press(intent: ReturnType<typeof createSaveIntentKeys>, slot: string, payload: any) {
  return createEvent('c1', intent.stable(slot, payload));
}

describe('saveIntentKeys', () => {
  it('P same payload pressed twice (all attempts lost the first time): same key, ONE row', async () => {
    const s = server();
    apiClient.defaults.adapter = s.adapter as any;
    const intent = createSaveIntentKeys();
    s.setMode('lose');
    await expect(press(intent, 'primary', med())).rejects.toBeTruthy();
    expect(s.sent).toHaveLength(4); // 1 + 3 automatic retries
    s.setMode('ok');
    await press(intent, 'primary', med());
    expect(new Set(s.sent.map((x) => x.key)).size).toBe(1);
    expect(s.rows).toHaveLength(1);
  });

  it('P after a confirmed success the next save of the same payload gets a NEW key', async () => {
    const s = server();
    apiClient.defaults.adapter = s.adapter as any;
    const intent = createSaveIntentKeys();
    await press(intent, 'primary', med());
    await press(intent, 'primary', med());
    expect(s.sent).toHaveLength(2);
    expect(s.sent[0].key).not.toBe(s.sent[1].key);
    expect(s.rows).toHaveLength(2);
  });

  it('N an edited payload never reuses the old key (a key with another body would be refused)', async () => {
    const s = server();
    apiClient.defaults.adapter = s.adapter as any;
    const intent = createSaveIntentKeys();
    s.setMode('lose');
    await expect(press(intent, 'primary', med())).rejects.toBeTruthy();
    s.setMode('ok');
    await press(intent, 'primary', med({ title: 'Med 2' }));
    const last = s.sent[s.sent.length - 1];
    expect(last.key).not.toBe(s.sent[0].key);
    expect(s.sent.some((x) => x.key === last.key && x.body !== last.body)).toBe(false);
  });

  it('N a conflict answer: no second write, the error surfaces, the next press mints a fresh key', async () => {
    const s = server();
    apiClient.defaults.adapter = s.adapter as any;
    const intent = createSaveIntentKeys();
    s.setMode('conflict');
    await expect(press(intent, 'primary', med())).rejects.toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(s.sent).toHaveLength(1); // not retried
    expect(s.rows).toHaveLength(0);
    s.setMode('ok');
    await press(intent, 'primary', med());
    expect(s.sent[1].key).not.toBe(s.sent[0].key);
    expect(s.rows).toHaveLength(1);
  });

  it('P multi-dose: each dose keeps its own key across presses, and keys differ between doses', async () => {
    const s = server();
    apiClient.defaults.adapter = s.adapter as any;
    const intent = createSaveIntentKeys();
    const doses = () => [med({ scheduled_time: '08:00' }), med({ scheduled_time: '20:00' })];
    s.setMode('lose');
    for (const d of doses()) await expect(press(intent, `dose:${d.scheduled_time}`, d)).rejects.toBeTruthy();
    s.setMode('ok');
    for (const d of doses()) await press(intent, `dose:${d.scheduled_time}`, d);
    const byBody = new Map<string, Set<string>>();
    for (const x of s.sent) byBody.set(x.body, (byBody.get(x.body) ?? new Set()).add(x.key as string));
    expect([...byBody.values()].every((k) => k.size === 1)).toBe(true);
    expect(new Set([...byBody.values()].map((k) => [...k][0])).size).toBe(2);
    expect(s.rows).toHaveLength(2);
  });

  it('P edit (PATCH): an unchanged edit pressed again reuses its key; N a different event id does not', async () => {
    const s = server();
    apiClient.defaults.adapter = s.adapter as any;
    const intent = createSaveIntentKeys();
    s.setMode('lose');
    await expect(updateEvent('c1', 'e1', intent.stable('edit:e1', { title: 'A' }))).rejects.toBeTruthy();
    s.setMode('ok');
    await updateEvent('c1', 'e1', intent.stable('edit:e1', { title: 'A' }));
    expect(new Set(s.sent.map((x) => x.key)).size).toBe(1);
    const data = { title: 'A' };
    s.setMode('lose');
    await expect(updateEvent('c1', 'e1', data)).rejects.toBeTruthy();
    const k = s.sent[s.sent.length - 1].key;
    s.setMode('ok');
    await updateEvent('c1', 'e2', data);
    expect(s.sent[s.sent.length - 1].key).not.toBe(k);
  });

  it('stable(): key order does not matter, a changed value does', () => {
    const intent = createSaveIntentKeys();
    const a = { x: 1, y: 2 };
    expect(intent.stable('s', { y: 2, x: 1 })).toBe(intent.stable('s', a) === a ? a : intent.stable('s', a));
    expect(intent.stable('s', { x: 1, y: 3 })).not.toBe(a);
  });
});
