import { apiClient } from '@/lib/api';
import { authApi } from '@/api/auth';

// `@/lib/api` is mocked globally in src/test/setup.ts — the response interceptor
// (envelope-unwrapping) is bypassed, so we resolve each mock with the already
// "unwrapped" `{ success, data }` envelope the api fns return.
const mockPost = vi.mocked(apiClient.post);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sessionEstablished', () => {
  it('POSTs /auth/session-established with the language and returns the envelope', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { skipped: false, language: 'es', welcomeSent: true },
    } as never);

    const result = await authApi.sessionEstablished('es');

    expect(mockPost).toHaveBeenCalledWith('/auth/session-established', { language: 'es' });
    expect(result).toEqual({
      success: true,
      data: { skipped: false, language: 'es', welcomeSent: true },
    });
  });

  it('returns the short-circuit envelope every later sign-in produces', async () => {
    mockPost.mockResolvedValue({ success: true, data: { skipped: true } } as never);

    const result = await authApi.sessionEstablished('en');

    expect(mockPost).toHaveBeenCalledWith('/auth/session-established', { language: 'en' });
    expect(result.data.skipped).toBe(true);
  });

  it('rejects to the caller when the endpoint fails (callers must swallow it)', async () => {
    mockPost.mockRejectedValue({ success: false, error: { code: 'SERVER_ERROR' } });

    await expect(authApi.sessionEstablished('en')).rejects.toMatchObject({
      error: { code: 'SERVER_ERROR' },
    });
  });
});

describe('signup attribution payload', () => {
  beforeEach(() => sessionStorage.clear());

  it('signup sends signup_source + detail alongside the form data', async () => {
    mockPost.mockResolvedValue({ success: true, data: {} } as never);
    sessionStorage.setItem(
      'cc_signup_attribution',
      JSON.stringify({ utm_source: 'fb', src: 'welcome' })
    );
    await authApi.signup({
      email: 'a@b.co',
      password: 'pw',
      first_name: 'A',
      last_name: 'B',
      termsAccepted: true,
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/signup',
      expect.objectContaining({
        email: 'a@b.co',
        signup_source: 'email',
        signup_source_detail: { utm_source: 'fb', src: 'welcome' },
      })
    );
  });

  it('oauthSession defaults to web with empty detail and keeps tokens', async () => {
    mockPost.mockResolvedValue({ success: true, data: {} } as never);
    await authApi.oauthSession({ access_token: 'a', refresh_token: 'r' });
    expect(mockPost).toHaveBeenCalledWith('/auth/oauth-session', {
      access_token: 'a',
      refresh_token: 'r',
      signup_source: 'web',
      signup_source_detail: {},
    });
  });
});
