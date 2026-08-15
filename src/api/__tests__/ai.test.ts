import { apiClient } from '@/lib/api';
import {
  sendAiMessage,
  getAiSuggestions,
  isRateLimitError,
  isServiceUnavailableError,
} from '@/api/ai';

// `@/lib/api` is mocked globally in src/test/setup.ts — apiClient.post is a
// vi.fn(). The response interceptor (envelope unwrap) is bypassed in tests, so
// we resolve the mock with the already-unwrapped `{ success, data }` shape.
const mockPost = vi.mocked(apiClient.post);
const mockGet = vi.mocked(apiClient.get);

const CIRCLE_ID = 'circle-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendAiMessage', () => {
  it('POSTs the chat endpoint with message + conversation_id + language and returns data', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { message: 'Hi there', conversation_id: 'conv-1', remaining_requests: 49 },
    } as never);

    const result = await sendAiMessage(CIRCLE_ID, {
      message: 'How is adherence?',
      conversation_id: 'conv-1',
      language: 'es',
    });

    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/ai/chat`, {
      message: 'How is adherence?',
      conversation_id: 'conv-1',
      language: 'es',
    });
    expect(result).toEqual({
      message: 'Hi there',
      conversation_id: 'conv-1',
      remaining_requests: 49,
    });
  });

  it('omits conversation_id (undefined) on a first turn', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { message: 'ok', conversation_id: 'conv-new', remaining_requests: 50 },
    } as never);

    await sendAiMessage(CIRCLE_ID, { message: 'hello', language: 'en' });

    const [, body] = mockPost.mock.calls[0];
    expect((body as Record<string, unknown>).conversation_id).toBeUndefined();
    expect((body as Record<string, unknown>).language).toBe('en');
  });
});

describe('error classifiers (402 vs 429 vs 503)', () => {
  const rateLimit = { success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } };
  const unavailable = { success: false, error: { code: 'SERVICE_UNAVAILABLE' } };
  const subscription = { success: false, error: { code: 'SUBSCRIPTION_REQUIRED' } };

  it('isRateLimitError is true only for RATE_LIMIT_EXCEEDED', () => {
    expect(isRateLimitError(rateLimit)).toBe(true);
    expect(isRateLimitError(unavailable)).toBe(false);
    expect(isRateLimitError(subscription)).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });

  it('isServiceUnavailableError is true only for SERVICE_UNAVAILABLE', () => {
    expect(isServiceUnavailableError(unavailable)).toBe(true);
    expect(isServiceUnavailableError(rateLimit)).toBe(false);
    expect(isServiceUnavailableError(subscription)).toBe(false);
    expect(isServiceUnavailableError(undefined)).toBe(false);
  });
});

describe('getAiSuggestions', () => {
  it('GETs the suggestions endpoint with the language and returns the list', async () => {
    const suggestions = ['What medications are due today?', 'How is adherence this week?'];
    mockGet.mockResolvedValue({ success: true, data: { suggestions } } as never);

    const result = await getAiSuggestions(CIRCLE_ID, 'es');

    expect(mockGet).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/ai/suggestions?language=es`);
    expect(result).toEqual(suggestions);
  });

  it('omits the query string entirely when no language is given', async () => {
    mockGet.mockResolvedValue({ success: true, data: { suggestions: [] } } as never);
    await getAiSuggestions(CIRCLE_ID);
    expect(mockGet).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/ai/suggestions`);
  });

  it('returns [] rather than throwing when `suggestions` is missing', async () => {
    mockGet.mockResolvedValue({ success: true, data: {} } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual([]);
  });

  it('returns [] rather than throwing when the payload is malformed', async () => {
    mockGet.mockResolvedValue({ success: true, data: { suggestions: 'nope' } } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual([]);

    mockGet.mockResolvedValue({ success: true } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual([]);
  });

  it('drops non-string and blank entries so no empty chip can render', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: { suggestions: ['Real question?', '', '   ', 42, null] },
    } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual(['Real question?']);
  });

  it('propagates a 402 rejection so the caller can render nothing', async () => {
    const envelope = { success: false, error: { code: 'SUBSCRIPTION_REQUIRED' } };
    mockGet.mockRejectedValue(envelope);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).rejects.toEqual(envelope);
  });
});
