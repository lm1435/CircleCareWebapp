import { apiClient } from '@/lib/api';

// Web port of mobile/src/api/ai.ts (the `sendAIMessage` + `getAISuggestions`
// halves — web has no voice input, so that is the one mobile affordance not
// mirrored). Backend: POST /circles/:circleId/ai/chat and
// GET /circles/:circleId/ai/suggestions (backend/src/routes/ai.ts).
//
// PHI-conservative: the server stores ONLY user messages (no PHI, no assistant
// responses). The conversation is identified by `conversation_id`, which the
// caller threads back on each turn so the server can supply prior user-message
// context to the intent classifier. We never persist anything client-side.

/** A single chat turn rendered in the modal. Mirrors mobile's AIChatMessage. */
export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Request body for POST /circles/:circleId/ai/chat. */
export interface SendAiMessageRequest {
  /** 1–2000 chars (enforced server-side by the chat zod schema). */
  message: string;
  /** Continue an existing in-memory conversation; omit to start a new one. */
  conversation_id?: string;
  /** Current UI language ('en' | 'es') so the assistant replies in-language. */
  language?: string;
}

/** Unwrapped `data` from the chat success envelope. */
export interface AIChatResponse {
  message: string;
  conversation_id: string;
  remaining_requests: number;
  /** Classifier label (e.g. GET_MEDICATION, UNKNOWN) for analytics only.
   *  Optional: older backends do not send it. Never carries intent params. */
  intent?: string;
}

/**
 * Send a message to the AI Care Assistant (premium feature).
 *
 * The apiClient response interceptor unwraps the `{ success, data }` envelope,
 * so this returns the inner `data`. On 402/429/503 the interceptor rejects with
 * the backend error envelope (`{ success:false, error:{ code, message } }`),
 * which `useAiChat` classifies — see src/lib/apiErrors.ts + the status/code
 * helpers below.
 */
export async function sendAiMessage(
  circleId: string,
  { message, conversation_id, language }: SendAiMessageRequest
): Promise<AIChatResponse> {
  const response = (await apiClient.post(`/circles/${circleId}/ai/chat`, {
    message,
    conversation_id,
    language,
  })) as { data: AIChatResponse };

  return response.data;
}

/** Unwrapped `data` from the suggestions success envelope. */
export interface AISuggestionsResponse {
  /** Up to 6 server-authored questions. Optional so a malformed/older payload
   *  degrades to "no suggestions" instead of throwing. */
  suggestions?: string[];
}

/**
 * Fetch the server's suggested questions for this circle (premium feature).
 *
 * CRITICAL — these strings must NEVER be hardcoded client-side. The backend's
 * `BASE_SUGGESTIONS` list is the single source of truth AND is injected into the
 * intent-classifier prompt as few-shot examples; a suggestion the classifier has
 * never seen classifies as UNKNOWN, so a client-invented chip answers itself
 * with "I didn't quite understand that". Mobile's catch-block fallback has
 * exactly that bug — do not port it. When this call fails, show nothing.
 *
 * The apiClient response interceptor unwraps the `{ success, data }` envelope,
 * so this returns the inner `data.suggestions`. Rejections (402
 * SUBSCRIPTION_REQUIRED when the circle owner is on the free tier, 403 FORBIDDEN
 * for a non-member, network, ...) propagate to the caller, which renders nothing.
 * A missing or malformed `suggestions` field resolves to `[]` rather than throwing.
 */
export async function getAiSuggestions(circleId: string, language?: string): Promise<string[]> {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  const response = (await apiClient.get(`/circles/${circleId}/ai/suggestions${query}`)) as {
    data?: AISuggestionsResponse | null;
  } | null;

  const suggestions = response?.data?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter(
    (suggestion): suggestion is string =>
      typeof suggestion === 'string' && suggestion.trim().length > 0
  );
}

/**
 * True for a 429 `RATE_LIMIT_EXCEEDED` rejection — the user hit the 50/day cap.
 * Distinct from 402 (subscription) and 503 (unconfigured): the daily limit
 * resets, so the copy says "try again tomorrow", not "upgrade".
 *
 * Mirrors mobile's `isRateLimitError`. (402 `SUBSCRIPTION_REQUIRED` is handled
 * by `isSubscriptionRequiredError` in src/lib/apiErrors.ts.)
 */
export function isRateLimitError(err: unknown): boolean {
  return aiErrorCode(err) === 'RATE_LIMIT_EXCEEDED';
}

/**
 * True for a 503 `SERVICE_UNAVAILABLE` rejection — the AI service is not
 * configured on the server (no OpenAI key). Nothing the user can do; the modal
 * shows an "unavailable" notice rather than "upgrade"/"try tomorrow".
 */
export function isServiceUnavailableError(err: unknown): boolean {
  return aiErrorCode(err) === 'SERVICE_UNAVAILABLE';
}

interface ApiErrorEnvelope {
  error?: { code?: string };
}

function aiErrorCode(err: unknown): string | undefined {
  const code = (err as ApiErrorEnvelope | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}
