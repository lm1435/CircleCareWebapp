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
    // An older backend (strings only): the same chips without ids; circle_empty unknown.
    expect(result).toEqual({ items: suggestions.map((text) => ({ text })), circleEmpty: null });
  });

  it('omits the query string entirely when no language is given', async () => {
    mockGet.mockResolvedValue({ success: true, data: { suggestions: [] } } as never);
    await getAiSuggestions(CIRCLE_ID);
    expect(mockGet).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/ai/suggestions`);
  });

  const NONE = { items: [], circleEmpty: null };

  it('returns no chips rather than throwing when `suggestions` is missing', async () => {
    mockGet.mockResolvedValue({ success: true, data: {} } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual(NONE);
  });

  it('returns no chips rather than throwing when the payload is malformed', async () => {
    mockGet.mockResolvedValue({ success: true, data: { suggestions: 'nope' } } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual(NONE);

    mockGet.mockResolvedValue({ success: true } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual(NONE);

    mockGet.mockResolvedValue({
      success: true,
      data: { suggestion_items: { id: 'x' }, circle_empty: 'yes' },
    } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual(NONE);
  });

  it('drops non-string and blank entries so no empty chip can render', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: { suggestions: ['Real question?', '', '   ', 42, null] },
    } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual({
      items: [{ text: 'Real question?' }],
      circleEmpty: null,
    });
  });

  it('P (1.4.2): prefers suggestion_items (with ids) and reports circle_empty', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: {
        suggestions: ['What can you help me with?'],
        suggestion_items: [{ id: 'capabilities', text: 'What can you help me with?' }],
        circle_empty: true,
      },
    } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual({
      items: [{ id: 'capabilities', text: 'What can you help me with?' }],
      circleEmpty: true,
    });
  });

  it('N (1.4.2): an unknown-shaped id never crashes; the chip stays, without the id', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: { suggestion_items: [{ id: 'Not An Id!', text: 'Tips?' }], circle_empty: false },
    } as never);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).resolves.toEqual({
      items: [{ text: 'Tips?' }],
      circleEmpty: false,
    });
  });

  it('propagates a 402 rejection so the caller can render nothing', async () => {
    const envelope = { success: false, error: { code: 'SUBSCRIPTION_REQUIRED' } };
    mockGet.mockRejectedValue(envelope);
    await expect(getAiSuggestions(CIRCLE_ID, 'en')).rejects.toEqual(envelope);
  });
});

describe('sendAiMessage with a chip id (1.4.2)', () => {
  const ok = {
    success: true,
    data: { message: 'ok', conversation_id: 'conv-1', remaining_requests: 1 },
  };

  it('P: sends suggestion_id with the chip text', async () => {
    mockPost.mockResolvedValue(ok as never);
    await sendAiMessage(CIRCLE_ID, {
      message: 'Did she take her medications today?',
      language: 'en',
      suggestion_id: 'doses_today',
    });
    expect(mockPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/ai/chat`, {
      message: 'Did she take her medications today?',
      conversation_id: undefined,
      language: 'en',
      suggestion_id: 'doses_today',
    });
  });

  it('N: a malformed id is never sent', async () => {
    mockPost.mockResolvedValue(ok as never);
    await sendAiMessage(CIRCLE_ID, { message: 'Tips?', suggestion_id: 'Robert"); DROP' });
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('suggestion_id');
  });

  it('N: an id the backend does not know (400 VALIDATION_ERROR) is retried ONCE as plain text', async () => {
    mockPost
      .mockRejectedValueOnce({ success: false, error: { code: 'VALIDATION_ERROR' } } as never)
      .mockResolvedValueOnce(ok as never);
    const result = await sendAiMessage(CIRCLE_ID, { message: 'Old chip?', suggestion_id: 'retired_chip' });
    expect(result).toEqual(ok.data);
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls[0][1]).toHaveProperty('suggestion_id', 'retired_chip');
    expect(mockPost.mock.calls[1][1]).not.toHaveProperty('suggestion_id');
  });

  it('N: any other refusal is not retried', async () => {
    const envelope = { success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } };
    mockPost.mockRejectedValue(envelope as never);
    await expect(
      sendAiMessage(CIRCLE_ID, { message: 'Tips?', suggestion_id: 'tips_first_weeks' })
    ).rejects.toEqual(envelope);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
