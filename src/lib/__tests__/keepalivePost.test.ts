// PK11: a POST the browser finishes after the page is gone. Pure contract
// tests: the token is the in-memory bearer, the request is keepalive, and
// every "cannot do it safely" case returns null so the caller keeps axios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepalivePost } from '../keepalivePost';
import { tokenAccessor } from '../tokenAccessor';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
  tokenAccessor.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  tokenAccessor.clear();
});

describe('keepalivePost', () => {
  it('sends one keepalive POST with the bearer token and a JSON body', async () => {
    tokenAccessor.setToken('tok-123', null);
    const req = keepalivePost('/circles/c1/medications/confirm', { event_id: 'e1', status: 'taken' });
    expect(req).not.toBeNull();
    await req;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/circles\/c1\/medications\/confirm$/);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ event_id: 'e1', status: 'taken' });
  });

  it('a body-less POST sends no body (task completion)', () => {
    tokenAccessor.setToken('tok-123', null);
    keepalivePost('/circles/c1/events/t1/complete');
    expect('body' in fetchMock.mock.calls[0][1]).toBe(false);
  });

  it('no token: null, nothing sent (the caller keeps axios, which can refresh)', () => {
    expect(keepalivePost('/x', {})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a token that expires within the margin: null (a keepalive request cannot refresh and retry)', () => {
    tokenAccessor.setToken('tok', Math.floor(Date.now() / 1000) + 3);
    expect(keepalivePost('/x', {})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a body over the 64 KB keepalive budget: null', () => {
    tokenAccessor.setToken('tok', null);
    expect(keepalivePost('/x', { blob: 'a'.repeat(70 * 1024) })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws: a fetch that throws synchronously is null', () => {
    tokenAccessor.setToken('tok', null);
    fetchMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(keepalivePost('/x', {})).toBeNull();
  });
});
