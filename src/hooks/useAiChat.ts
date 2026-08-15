import { useRef } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  sendAiMessage,
  isRateLimitError,
  isServiceUnavailableError,
  type AIChatResponse,
} from '@/api/ai';
import { isSubscriptionRequiredError } from '@/lib/apiErrors';
import { Analytics } from '@/lib/analytics';

// Web port of the send half of mobile/src/components/ai/AIChatModal.tsx's
// handleSend. A mutation hook (mirrors useMedConfirmation's pattern) that POSTs
// one user message and threads the server's conversation_id back on the next
// turn. The conversation lives in-memory for the modal session only — mobile
// keeps it in component state too, and the backend is PHI-conservative (stores
// user messages only, no persistence client-side).

/** Discriminated outcome the modal renders as an assistant bubble or notice. */
export type AiChatErrorKind =
  | 'subscriptionRequired' // 402 — premium-gated; web shows "open the app to upgrade"
  | 'rateLimited' // 429 — daily 50-question cap; "try again tomorrow"
  | 'unavailable' // 503 — AI service not configured on the server
  | 'sendFailed'; // anything else (network, 500, ...)

/**
 * Classify an apiClient rejection into one of the AI error kinds. Order matters
 * only in that each predicate inspects a distinct backend code, so they are
 * mutually exclusive:
 *   - 402 SUBSCRIPTION_REQUIRED / PAYMENT_REQUIRED → subscriptionRequired
 *   - 429 RATE_LIMIT_EXCEEDED                      → rateLimited
 *   - 503 SERVICE_UNAVAILABLE                      → unavailable
 *   - default                                      → sendFailed
 */
export function classifyAiError(err: unknown): AiChatErrorKind {
  if (isSubscriptionRequiredError(err)) return 'subscriptionRequired';
  if (isRateLimitError(err)) return 'rateLimited';
  if (isServiceUnavailableError(err)) return 'unavailable';
  return 'sendFailed';
}

/** Variables for one send. An object (not a bare string) so the suggestion-chip
 *  origin rides along to analytics without a second, order-dependent argument. */
export interface AiChatSendVariables {
  /** Trimmed message text (1–2000 chars, enforced server-side). */
  message: string;
  /** True when the text came from a server-suggested question chip rather than
   *  the composer. Mirrors mobile's `usedSuggestion: !!messageText`. */
  usedSuggestion?: boolean;
}

export interface UseAiChatResult {
  /** RQ mutation: send the trimmed message text. Resolves to the AI response. */
  mutation: UseMutationResult<AIChatResponse, unknown, AiChatSendVariables>;
  /** Map a caught error to an i18n key under the `ai` namespace. */
  errorKey: (err: unknown) => string;
  /** Reset the threaded conversation (and the mutation) for a new chat. */
  resetConversation: () => void;
}

/**
 * Mutation hook for the AI Care Assistant chat.
 *
 * Tracks `conversation_id` in a ref so each send continues the same server-side
 * conversation; `resetConversation()` clears it (the modal's "new chat"). The
 * current i18n language is sent on every request so the assistant replies in
 * the user's language. Errors are NOT toasted here — the modal renders them
 * inline (assistant bubble / notice), mirroring mobile — so the caller uses
 * `errorKey(error)` / `classifyAiError(error)` in its onError handling.
 */
export function useAiChat(circleId: string): UseAiChatResult {
  const { i18n } = useTranslation();
  const conversationIdRef = useRef<string | undefined>(undefined);
  /** Questions asked in this conversation, for turn-index analytics. */
  const turnIndexRef = useRef(0);
  const startedAtRef = useRef(0);

  const mutation = useMutation<AIChatResponse, unknown, AiChatSendVariables>({
    mutationFn: ({ message, usedSuggestion }: AiChatSendVariables) => {
      // PHI-safe: circle_id and a LENGTH — never the message text.
      const turnIndex = turnIndexRef.current;
      turnIndexRef.current += 1;
      startedAtRef.current = Date.now();
      Analytics.aiChatMessageSent(circleId, {
        turnIndex,
        messageLength: message.length,
        usedSuggestion: usedSuggestion ?? false,
      });
      // The backend chatSchema accepts only 'en' | 'es'. `i18n.language` can be a
      // region-qualified tag (e.g. 'en-US', 'es-MX'), so normalize to the base
      // language — otherwise the request 400s and the modal shows "sendFailed".
      const language = i18n.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
      return sendAiMessage(circleId, {
        message,
        conversation_id: conversationIdRef.current,
        language,
      });
    },
    onSuccess: (data) => {
      conversationIdRef.current = data.conversation_id;
      Analytics.aiChatResponseReceived(circleId, {
        intent: data.intent ?? 'unreported',
        latencyMs: Date.now() - startedAtRef.current,
        turnIndex: Math.max(0, turnIndexRef.current - 1),
      });
    },
    onError: (err) => {
      Analytics.aiChatFailed(circleId, {
        reason: classifyAiError(err),
        latencyMs: Date.now() - startedAtRef.current,
        turnIndex: Math.max(0, turnIndexRef.current - 1),
      });
    },
  });

  return {
    mutation,
    errorKey: (err: unknown) => `errors.${classifyAiError(err)}`,
    resetConversation: () => {
      conversationIdRef.current = undefined;
      turnIndexRef.current = 0;
      mutation.reset();
    },
  };
}
