import { apiClient } from '@/lib/api';
import {
  isSuggestionId,
  parseCircleEmpty,
  sanitizeSuggestionItems,
  suggestionItemsFromStrings,
  type AISuggestionItem,
} from '@/lib/aiChatSignals';

export type { AISuggestionItem } from '@/lib/aiChatSignals';

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
  /**
   * 1.4.2: the tapped chip's id (backend `CHIP_IDS`). The server resolves it to a fixed intent
   * WITHOUT classifying; the chip text still rides as `message`. A malformed id is never sent.
   */
  suggestion_id?: string;
}

/** Unwrapped `data` from the chat success envelope. */
export interface AIChatResponse {
  message: string;
  conversation_id: string;
  remaining_requests: number;
  /** Classifier label (e.g. GET_MEDICATION, UNKNOWN) for analytics only.
   *  Optional: older backends do not send it. Never carries intent params. */
  intent?: string;
  /**
   * FIND_NOTES only (backend 1.3.0+): buttons that open where the notes are.
   * Optional and additive: older backends never send it. Validate with
   * `sanitizeReplyActions` before rendering. Mirrors mobile/src/api/ai.ts.
   */
  actions?: unknown;
  /** FIND_NOTES only: enums/booleans for analytics. Never a name. */
  notes_path?: unknown;
  /**
   * 1.4.2 additive fields (backend §9), typed `unknown` and validated in lib/aiChatSignals.ts:
   *   outcome           answered | answered_empty | app_help | action_redirect | not_understood |
   *                     advice_refused | service_error | data_unavailable
   *   reason            only on not_understood
   *   history_len       earlier typed messages the classifier saw (0-10), bucketed for analytics
   *   suggestion_items  only on not_understood / advice_refused: chips to re-render under the reply
   * Mirrors mobile/src/api/ai.ts.
   */
  outcome?: unknown;
  reason?: unknown;
  history_len?: unknown;
  suggestion_items?: unknown;
}

/**
 * A tappable destination attached to an assistant reply (backend `AiReplyAction`). Destinations
 * only: no action ever carries a prefilled value. `event_type` picks which add form opens.
 */
export type AIReplyAction =
  | { type: 'open_provider'; provider_id: string; provider_name: string }
  | { type: 'open_notes' }
  | { type: 'open_doctors' }
  | { type: 'open_activity' }
  | { type: 'open_medications' }
  | { type: 'open_emergency_info' }
  | { type: 'open_vitals' }
  | { type: 'open_members' }
  | { type: 'open_add_medication' }
  | { type: 'open_add_event'; event_type: 'appointment' | 'task' }
  | { type: 'open_invite' }
  | { type: 'open_settings_notifications' }
  | { type: 'open_subscription' };

/** Which FIND_NOTES answer was given (backend `NotesPathInfo`). */
export interface AINotesPath {
  target: 'doctor' | 'doctor_list' | 'notes';
  doctor_named: boolean;
  doctor_matched: boolean;
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
  { message, conversation_id, language, suggestion_id }: SendAiMessageRequest
): Promise<AIChatResponse> {
  const body = { message, conversation_id, language };
  const url = `/circles/${circleId}/ai/chat`;
  if (!isSuggestionId(suggestion_id)) {
    const response = (await apiClient.post(url, body)) as { data: AIChatResponse };
    return response.data;
  }
  try {
    const response = (await apiClient.post(url, { ...body, suggestion_id })) as {
      data: AIChatResponse;
    };
    return response.data;
  } catch (err) {
    // An id this backend does not know is a 400 VALIDATION_ERROR (a chip list fetched before a
    // deploy that retired it). The chip's TEXT is still matched server-side without classifying,
    // so retry once as plain text rather than failing a tap that can succeed. Mobile does the same.
    if (aiErrorCode(err) !== 'VALIDATION_ERROR') throw err;
    const response = (await apiClient.post(url, body)) as { data: AIChatResponse };
    return response.data;
  }
}

/** Unwrapped `data` from the suggestions success envelope. */
export interface AISuggestionsResponse {
  /** Up to 6 server-authored questions. Optional so a malformed/older payload
   *  degrades to "no suggestions" instead of throwing. */
  suggestions?: string[];
  /** 1.4.2: the same chips with ids (send `suggestion_id` on tap). */
  suggestion_items?: unknown;
  /** 1.4.2: no current medications and nothing upcoming; omitted when the circle could not be read. */
  circle_empty?: unknown;
}

/** The starter chips for this circle, and whether the backend said the circle is empty. */
export interface AISuggestionSet {
  items: AISuggestionItem[];
  /** null = unknown (older backend, or the circle could not be read). */
  circleEmpty: boolean | null;
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
 * so this reads the inner `data` (1.4.2: `suggestion_items` with ids, else `suggestions`). Rejections (402
 * SUBSCRIPTION_REQUIRED when the circle owner is on the free tier, 403 FORBIDDEN
 * for a non-member, network, ...) propagate to the caller, which renders nothing.
 * A missing or malformed payload resolves to no chips rather than throwing.
 */
export async function getAiSuggestions(circleId: string, language?: string): Promise<AISuggestionSet> {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  const response = (await apiClient.get(`/circles/${circleId}/ai/suggestions${query}`)) as {
    data?: AISuggestionsResponse | null;
  } | null;

  // 1.4.2: prefer the chips WITH ids (the server picks the empty-circle or the data set). An older
  // backend sends only `suggestions: string[]`: the same chips without ids, sent as text.
  const data = response?.data ?? {};
  const withIds = sanitizeSuggestionItems(data.suggestion_items);
  return {
    items: withIds.length > 0 ? withIds : suggestionItemsFromStrings(data.suggestions),
    circleEmpty: parseCircleEmpty(data.circle_empty),
  };
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
