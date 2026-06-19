import '@testing-library/jest-dom/vitest';

// Global mocks for modules that would otherwise hit the network.
// Individual tests can override with their own vi.mock factories or by
// importing the mocked module and using vi.mocked(...).

// API client — never make real HTTP calls in tests.
vi.mock('@/lib/api', () => {
  const apiClient = Object.assign(vi.fn(), {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  });
  return {
    apiClient,
    setOnAuthFailure: vi.fn(),
    resetRefreshState: vi.fn(),
  };
});

// Supabase OAuth broker — never open a real OAuth handshake in tests.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: vi.fn(),
      signInWithIdToken: vi.fn(),
      setSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));
