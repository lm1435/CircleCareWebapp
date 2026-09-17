import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api read so we can assert the exact args and drive failures.
vi.mock('@/api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ai')>();
  return { ...actual, getAiSuggestions: vi.fn() };
});

// Mutable so tests can exercise region-qualified tags (e.g. 'es-MX').
let mockLanguage = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

import { getAiSuggestions } from '@/api/ai';
import { queryKeys } from '@/lib/queryKeys';
import { useAiSuggestions } from '@/hooks/useAiSuggestions';

const CIRCLE_ID = 'circle-1';
const mockGet = vi.mocked(getAiSuggestions);
// Server-authored strings — never a hardcoded product list on the client.
const SUGGESTIONS = ['What medications are due today?', 'How is adherence this week?'];

function setup() {
  const queryClient = new QueryClient({
    // Leave retry at the hook's own setting so the retry predicate is exercised.
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLanguage = 'en';
});

describe('useAiSuggestions', () => {
  it('fetches the circle suggestions in the current language', async () => {
    mockGet.mockResolvedValue(SUGGESTIONS);
    const { wrapper } = setup();

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(CIRCLE_ID, 'en');
    expect(result.current.data).toEqual(SUGGESTIONS);
  });

  it('normalizes a region-qualified tag (es-MX) to es — the route only knows en|es', async () => {
    mockLanguage = 'es-MX';
    mockGet.mockResolvedValue(SUGGESTIONS);
    const { wrapper } = setup();

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(CIRCLE_ID, 'es');
  });

  it('keys by circle AND language so switching to Spanish refetches', async () => {
    mockGet.mockResolvedValue(SUGGESTIONS);
    const { wrapper, queryClient } = setup();

    const { rerender, result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(queryKeys.aiSuggestions(CIRCLE_ID, 'en'))).toEqual(SUGGESTIONS);

    const spanish = ['¿Qué medicamentos tocan hoy?'];
    mockGet.mockResolvedValue(spanish);
    mockLanguage = 'es';
    rerender();

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.aiSuggestions(CIRCLE_ID, 'es'))).toEqual(spanish)
    );
    expect(mockGet).toHaveBeenLastCalledWith(CIRCLE_ID, 'es');
  });

  it('does not fetch while the modal is closed', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, false), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('does not fetch without a circleId', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAiSuggestions('', true), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('does not retry a 402 SUBSCRIPTION_REQUIRED — the gate is terminal', async () => {
    mockGet.mockRejectedValue({ success: false, error: { code: 'SUBSCRIPTION_REQUIRED' } });
    const { wrapper } = setup();

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(1);
    // No data at all — the modal renders no suggestion block and no fallback.
    expect(result.current.data).toBeUndefined();
  });

  it('does not retry a 403 FORBIDDEN — non-member is terminal too', async () => {
    mockGet.mockRejectedValue({ success: false, error: { code: 'FORBIDDEN' } });
    const { wrapper } = setup();

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeUndefined();
  });

  // The AI routes' view-only refusal (backend/src/routes/ai.ts
  // `rejectIfViewOnlySeat`) is 403 VIEW_ONLY, and the suggestions fetch fires
  // the instant the modal opens. It is as terminal as FORBIDDEN — the seat
  // cannot change for the length of the session — so it must never be retried.
  it('does not retry a 403 VIEW_ONLY — the seat cannot change mid-session', async () => {
    mockGet.mockRejectedValue({ success: false, error: { code: 'VIEW_ONLY' } });
    const { wrapper } = setup();

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeUndefined();
  });

  it('retries a transient failure once, then gives up with no data', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    const { wrapper } = setup();

    const { result } = renderHook(() => useAiSuggestions(CIRCLE_ID, true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBeUndefined();
  });
});
