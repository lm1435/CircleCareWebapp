import { apiClient } from '@/lib/api';

// Web port of mobile/src/api/ai.ts (the `sendAIMessage` half — web has no voice
// input and does not surface the suggestions endpoint, so only the chat call is
// mirrored). Backend: POST /circles/:circleId/ai/chat (backend/src/routes/ai.ts).
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
