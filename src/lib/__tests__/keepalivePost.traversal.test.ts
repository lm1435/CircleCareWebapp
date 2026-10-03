// SECURITY (web audit 2026-10-01): the keepalive flush bypasses axios, so it
// needs the interceptor's dot-segment guard itself — a circle/event id carrying
// `../` must never send the Bearer token to another backend path.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { keepalivePost } from '../keepalivePost';
import { tokenAccessor } from '../tokenAccessor';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  tokenAccessor.setToken('tok-123', null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  tokenAccessor.clear();
});

it.each([
  '/circles/../users/me/events/e1/complete',
  '/circles/c1/events/../../../users/me/complete',
  '/circles/%2e%2e/users/me/complete',
])('refuses %s without calling fetch', (path) => {
  expect(keepalivePost(path)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('still sends a normal path', () => {
  expect(keepalivePost('/circles/c1/events/e1/complete')).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
