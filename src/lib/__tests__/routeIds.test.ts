import axios, { type InternalAxiosRequestConfig } from 'axios';

// Real api client: the global setup mock is removed for this file.
vi.unmock('@/lib/api');

import { apiClient } from '@/lib/api';
import { hasTraversalSegment, isSafeRouteId } from '@/lib/routeIds';
import { tokenAccessor } from '@/lib/tokenAccessor';

// SECURITY (web audit 2026-10-01): a decoded `..%2F` route param must never
// become a request path. React Router hands `/circles/..%2F..%2Fx/notes` to the
// app as circleId `../../x`; the API modules build `/circles/${circleId}/...`.

describe('isSafeRouteId', () => {
  it.each(['3f1c2a9e-7b6d-4c1e-9a2b-0d4e5f6a7b8c', 'c1', 'circle-1', 'A_b-9'])('accepts %s', (id) => {
    expect(isSafeRouteId(id)).toBe(true);
  });

  it.each([
    '../users/me',
    '../../x',
    '..',
    '.',
    'x?y',
    'x#y',
    'a/b',
    'a\\b',
    '%2e%2e',
    '',
    'x'.repeat(65),
    undefined,
    null,
  ])('refuses %s', (id) => {
    expect(isSafeRouteId(id)).toBe(false);
  });
});

describe('hasTraversalSegment', () => {
  it.each([
    '/circles/../users/me',
    '/circles/../../x/notes',
    '/circles/./x',
    '/circles/%2e%2e/users/me',
    '/circles/.%2E/users',
    '/circles/x\\..\\y',
  ])('flags %s', (url) => {
    expect(hasTraversalSegment(url)).toBe(true);
  });

  it.each([
    '/circles/c1/care-notes',
    '/circles/c1/events?start=2026-01-01&end=..',
    '/users/me',
    '/circles/c1/documents/report.v2',
    '/circles/c1/x..y',
    undefined,
  ])('passes %s', (url) => {
    expect(hasTraversalSegment(url)).toBe(false);
  });
});

describe('apiClient refuses a traversal path before attaching the token', () => {
  const sent: InternalAxiosRequestConfig[] = [];
  beforeEach(() => {
    sent.length = 0;
    tokenAccessor.setToken('secret-access-token', Math.floor(Date.now() / 1000) + 3600);
    apiClient.defaults.adapter = async (config) => {
      sent.push(config);
      return { data: { success: true, data: {} }, status: 200, statusText: 'OK', headers: {}, config };
    };
  });
  afterEach(() => {
    tokenAccessor.clear();
  });

  it('a decoded `..%2F` circle id never reaches the network', async () => {
    const circleId = '../users/me?';
    await expect(apiClient.get(`/circles/${circleId}/care-notes`)).rejects.toMatchObject({
      error: { code: 'INVALID_REQUEST_PATH' },
    });
    expect(sent).toHaveLength(0);
  });

  it('a normal path still goes out with the bearer token', async () => {
    await apiClient.get('/circles/c1/care-notes');
    expect(sent).toHaveLength(1);
    expect(String(sent[0].headers.Authorization)).toBe('Bearer secret-access-token');
    expect(axios.isAxiosError(sent[0])).toBe(false);
  });
});
