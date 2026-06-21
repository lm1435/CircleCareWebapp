import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's send function (keep classifiers intact for apiErrors).
vi.mock('@/api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ai')>();
  return { ...actual, sendAiMessage: vi.fn() };
});

// Mutable so individual tests can exercise region-qualified tags (e.g. 'en-US').
let mockLanguage = 'es';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

import { sendAiMessage, type AIChatResponse } from '@/api/ai';
import { useAiChat, classifyAiError } from '@/hooks/useAiChat';

const CIRCLE_ID = 'circle-1';
const mockSend = vi.mocked(sendAiMessage);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

function makeResponse(overrides: Partial<AIChatResponse> = {}): AIChatResponse {
  return { message: 'reply', conversation_id: 'conv-1', remaining_requests: 49, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLanguage = 'es';
});

describe('useAiChat — request body', () => {
  it('sends message + current language, no conversation_id on the first turn', async () => {
    const { wrapper } = setup();
    mockSend.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });
    act(() => result.current.mutation.mutate('first question'));

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(mockSend).toHaveBeenCalledWith(CIRCLE_ID, {
      message: 'first question',
      conversation_id: undefined,
      language: 'es',
    });
  });

  // Regression: the backend chatSchema accepts only 'en' | 'es'. A region-
  // qualified i18n tag like 'en-US' was sent verbatim and 400'd, surfacing as
  // the modal's generic "sendFailed" error. The hook must normalize to base.
  it('normalizes a region-qualified language tag to the base language', async () => {
    mockLanguage = 'en-US';
    const { wrapper } = setup();
    mockSend.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });
    act(() => result.current.mutation.mutate('q'));

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(mockSend.mock.calls[0][1].language).toBe('en');
  });

  it('normalizes a region-qualified Spanish tag (es-MX) to es', async () => {
    mockLanguage = 'es-MX';
    const { wrapper } = setup();
    mockSend.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });
    act(() => result.current.mutation.mutate('q'));

    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(mockSend.mock.calls[0][1].language).toBe('es');
  });

  it('threads the server conversation_id into the next request', async () => {
    const { wrapper } = setup();
    mockSend.mockResolvedValue(makeResponse({ conversation_id: 'conv-42' }));

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });

    act(() => result.current.mutation.mutate('q1'));
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));

    mockSend.mockResolvedValue(makeResponse({ conversation_id: 'conv-42' }));
    act(() => result.current.mutation.mutate('q2'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));

    expect(mockSend.mock.calls[1][1].conversation_id).toBe('conv-42');
  });

  it('resetConversation drops the threaded id for a fresh chat', async () => {
    const { wrapper } = setup();
    mockSend.mockResolvedValue(makeResponse({ conversation_id: 'conv-9' }));

    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });

    act(() => result.current.mutation.mutate('q1'));
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));

    act(() => result.current.resetConversation());

    mockSend.mockResolvedValue(makeResponse());
    act(() => result.current.mutation.mutate('q2'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));

    expect(mockSend.mock.calls[1][1].conversation_id).toBeUndefined();
  });
});

describe('classifyAiError + errorKey — 402 vs 429 vs 503', () => {
  const cases = [
    ['SUBSCRIPTION_REQUIRED', 'subscriptionRequired'],
    ['PAYMENT_REQUIRED', 'subscriptionRequired'],
    ['RATE_LIMIT_EXCEEDED', 'rateLimited'],
    ['SERVICE_UNAVAILABLE', 'unavailable'],
    ['SOMETHING_ELSE', 'sendFailed'],
  ] as const;

  it.each(cases)('classifies %s as %s', (code, kind) => {
    expect(classifyAiError({ success: false, error: { code } })).toBe(kind);
  });

  it('falls back to sendFailed for a non-envelope error', () => {
    expect(classifyAiError(new Error('network'))).toBe('sendFailed');
  });

  it('errorKey prefixes the kind with errors.', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAiChat(CIRCLE_ID), { wrapper });
    expect(result.current.errorKey({ error: { code: 'RATE_LIMIT_EXCEEDED' } })).toBe(
      'errors.rateLimited'
    );
    expect(result.current.errorKey({ error: { code: 'SUBSCRIPTION_REQUIRED' } })).toBe(
      'errors.subscriptionRequired'
    );
    expect(result.current.errorKey({ error: { code: 'SERVICE_UNAVAILABLE' } })).toBe(
      'errors.unavailable'
    );
  });
});
