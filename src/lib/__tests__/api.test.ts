import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

// Task 45b — test the REAL api client (the global setup mock is removed here).
// Network traffic is intercepted at the axios adapter level for apiClient and
// via a spy on bare `axios.post` for the cookie-mode refresh call.
vi.unmock('@/lib/api');

import { apiClient, resetRefreshState, setOnAuthFailure } from '@/lib/api';
import { tokenAccessor } from '@/lib/tokenAccessor';

type Adapter = (config: InternalAxiosRequestConfig) => Promise<{
  data: unknown;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: InternalAxiosRequestConfig;
}>;

function ok(data: unknown): Adapter {
  return async (config) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
}

function unauthorized(config: InternalAxiosRequestConfig): never {
  throw new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, null, {
    data: { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  });
}

function refreshEnvelope(token: string) {
  return {
    data: {
      success: true,
      data: {
        session: { access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600 },
      },
    },
  };
}

describe('api client', () => {
  beforeEach(() => {
    resetRefreshState();
    tokenAccessor.clear();
  });

  afterEach(() => {
    setOnAuthFailure(null);
    vi.restoreAllMocks();
  });

  describe('cookie-mode auth endpoints', () => {
    it('sends X-Session-Mode: cookie + withCredentials on /auth/* calls', async () => {
      let captured: InternalAxiosRequestConfig | undefined;
      apiClient.defaults.adapter = async (config) => {
        captured = config;
        return ok({ success: true })(config);
      };

      await apiClient.post('/auth/login', { email: 'a@b.com', password: 'pw' });

      expect(captured).toBeDefined();
      expect(captured!.withCredentials).toBe(true);
      expect(AxiosHeaders.from(captured!.headers).get('X-Session-Mode')).toBe('cookie');
    });

    it('never sends ambient cookie credentials on data endpoints', async () => {
      let captured: InternalAxiosRequestConfig | undefined;
      apiClient.defaults.adapter = async (config) => {
        captured = config;
        return ok({ success: true, data: {} })(config);
      };
      tokenAccessor.setToken('data-token', null);

      await apiClient.get('/circles');

      expect(captured!.withCredentials).toBe(false);
      expect(AxiosHeaders.from(captured!.headers).get('X-Session-Mode')).toBeNull();
      expect(AxiosHeaders.from(captured!.headers).get('Authorization')).toBe('Bearer data-token');
    });
  });

  describe('401 refresh deduplication', () => {
    it('three concurrent 401s trigger exactly ONE refresh and all originals are retried', async () => {
      tokenAccessor.setToken('stale-token', null);

      const refreshSpy = vi
        .spyOn(axios, 'post')
        .mockResolvedValue(refreshEnvelope('fresh-token'));

      const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        const auth = AxiosHeaders.from(config.headers).get('Authorization');
        if (auth === 'Bearer fresh-token') {
          return ok({ success: true, data: { url: config.url } })(config);
        }
        return unauthorized(config);
      });
      apiClient.defaults.adapter = adapter;

      const results = (await Promise.all([
        apiClient.get('/circles'),
        apiClient.get('/users/me'),
        apiClient.get('/circles/abc/activity'),
      ])) as unknown as Array<{ success: boolean }>;

      // Exactly one deduplicated cookie-mode refresh
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(refreshSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/refresh'),
        {},
        expect.objectContaining({
          withCredentials: true,
          headers: expect.objectContaining({ 'X-Session-Mode': 'cookie' }),
        })
      );

      // All three originals retried successfully with the new token
      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.success).toBe(true);
      }
      // 3 initial 401s + 3 retries
      expect(adapter).toHaveBeenCalledTimes(6);
      expect(tokenAccessor.getAuthToken()).toBe('fresh-token');
    });

    it('fires onAuthFailure exactly once and clears the token when refresh fails', async () => {
      tokenAccessor.setToken('stale-token', null);

      vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh failed'));
      const onAuthFailure = vi.fn();
      setOnAuthFailure(onAuthFailure);

      apiClient.defaults.adapter = async (config) => unauthorized(config);

      const settled = await Promise.allSettled([
        apiClient.get('/circles'),
        apiClient.get('/users/me'),
        apiClient.get('/circles/abc/activity'),
      ]);

      expect(settled.every((entry) => entry.status === 'rejected')).toBe(true);
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
      expect(tokenAccessor.getAuthToken()).toBeNull();
    });

    it('does not attempt a refresh for 401s on auth endpoints (no deadlock)', async () => {
      const refreshSpy = vi.spyOn(axios, 'post');
      apiClient.defaults.adapter = async (config) => unauthorized(config);

      await expect(apiClient.post('/auth/login', { email: 'a@b.com', password: 'x' })).rejects.toMatchObject(
        { success: false }
      );

      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  describe('envelope unwrap', () => {
    it('rejects with the response envelope so callers read error.code directly', async () => {
      apiClient.defaults.adapter = async (config) => {
        throw new AxiosError('Forbidden', AxiosError.ERR_BAD_REQUEST, config, null, {
          data: { success: false, error: { code: 'EMAIL_NOT_VERIFIED', email: 'a@b.com' } },
          status: 403,
          statusText: 'Forbidden',
          headers: {},
          config,
        });
      };

      await expect(apiClient.post('/auth/login', {})).rejects.toMatchObject({
        success: false,
        error: { code: 'EMAIL_NOT_VERIFIED', email: 'a@b.com' },
      });
    });
  });
});
