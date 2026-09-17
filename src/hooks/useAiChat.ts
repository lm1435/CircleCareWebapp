import { useRef } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  sendAiMessage,
  isRateLimitError,
  isServiceUnavailableError,
  type AIChatResponse,
} from '@/api/ai';
import {
  isAccessDeniedError,
  isFrozenCircleError,
  isInvalidMessageError,
  isSubscriptionRequiredError,
} from '@/lib/apiErrors';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { Analytics, type AiChatFailureReason } from '@/lib/analytics';

// Web port of the send half of mobile/src/components/ai/AIChatModal.tsx's
// handleSend. A mutation hook (mirrors useMedConfirmation's pattern) that POSTs
// one user message and threads the server's conversation_id back on the next
// turn. The conversation lives in-memory for the modal session only — mobile
// keeps it in component state too, and the backend is PHI-conservative (stores
// user messages only, no persistence client-side).

/** Discriminated outcome the modal renders as an assistant bubble or notice. */
export type AiChatErrorKind =
  | 'viewOnly' // 403 VIEW_ONLY / FORBIDDEN — a SEAT problem; no upgrade fixes it
  | 'circleReadOnly' // 403 READ_ONLY_MEMBER — the FROZEN circle; a seat does not fix it
  | 'subscriptionRequired' // 402 — premium-gated; web shows "open the app to upgrade"
  | 'rateLimited' // 429 — daily 50-question cap; "try again tomorrow"
  | 'unavailable' // 503 — AI service not configured on the server
  | 'invalidMessage' // 400 INVALID_MESSAGE — prompt-injection guard; rephrase, don't retry
  | 'sendFailed'; // anything else (network, 500, ...)

/**
 * Classify an apiClient rejection into one of the AI error kinds:
 *   - 403 READ_ONLY_MEMBER                         → circleReadOnly
 *   - 403 VIEW_ONLY / FORBIDDEN                    → viewOnly
 *   - 402 SUBSCRIPTION_REQUIRED / PAYMENT_REQUIRED → subscriptionRequired
 *   - 429 RATE_LIMIT_EXCEEDED                      → rateLimited
 *   - 503 SERVICE_UNAVAILABLE                      → unavailable
 *   - default                                      → sendFailed
 *
 * THE 403 BRANCH IS FIRST, DELIBERATELY. `backend/src/routes/ai.ts`
 * (`rejectIfViewOnlySeat`) refuses a view-only seat BEFORE it reads the circle
 * owner's tier, precisely so the client cannot mistake "you have a view-only
 * seat" for "this circle needs a subscription" — a view-only member's own
 * purchase would not grant them the assistant, only the owner handing them a
 * full seat would. AIChatModal fires `promptUpgrade()` on
 * `errors.subscriptionRequired`; without its own kind, a VIEW_ONLY 403 fell
 * through to `sendFailed`, and any future widening of that comparison would
 * have put a paywall in front of the one person it cannot help.
 *
 * `isAccessDeniedError` (not a VIEW_ONLY-only compare) because all three codes
 * in `ACCESS_ERROR_CODES` share the property that decides whether a PAYWALL may
 * be shown: the caller cannot buy their way past any of them. That is where
 * their similarity ends, and the COPY is worded in terms of the remedy — so
 * `READ_ONLY_MEMBER` is split back out first.
 *
 * WHY READ_ONLY_MEMBER GETS ITS OWN KIND. It is the FROZEN-circle refusal (a
 * free-tier owner's non-selected circle: `view_only` false, `can_edit` false),
 * and what unfreezes it is a subscription covering the circle — not a fuller
 * seat. The `viewOnly` copy tells the reader to ask the circle owner for full
 * access, which on this rejection sends them to a person who cannot grant what
 * they are asking for, to fix something a seat would not fix. This change set
 * kept `read_only` and `view_only` apart everywhere else (`resolveAiEntry`, the
 * two-cache flag refresh); this call site was re-merging them.
 *
 * It is currently unreachable from the AI route — `READ_ONLY_MEMBER` is
 * emitted only by `backend/src/routes/documents.ts` and `upload.ts` — which is
 * precisely why it needs to be right BEFORE it becomes reachable: a wrong
 * branch that never runs produces no evidence that it is wrong.
 *
 * FORBIDDEN stays on `viewOnly`. The backend uses it both for "not a member"
 * and for "conversation not found", and the code alone cannot tell them apart
 * — so a non-transactional, non-blaming message is the conservative landing
 * spot, and both are unreachable from a mounted modal in practice.
 */
export function classifyAiError(err: unknown): AiChatErrorKind {
  if (isAccessDeniedError(err)) return isFrozenCircleError(err) ? 'circleReadOnly' : 'viewOnly';
  if (isSubscriptionRequiredError(err)) return 'subscriptionRequired';
  if (isRateLimitError(err)) return 'rateLimited';
  if (isServiceUnavailableError(err)) return 'unavailable';
  // 400 INVALID_MESSAGE — `detectPromptInjection` in backend/src/routes/ai.ts
  // refused this exact text. TERMINAL for it: sending the same words again
  // produces the same 400, so the generic "Sorry, I encountered an error.
  // Please try again." was retry copy on a request that cannot succeed. The
  // assistant asks for a rephrase instead. Ranked after the access/quota codes,
  // which are about the CALLER rather than the text.
  if (isInvalidMessageError(err)) return 'invalidMessage';
  return 'sendFailed';
}

/**
 * Narrow a kind to the CLOSED `AiChatFailureReason` vocabulary that
 * `lib/analytics.ts` accepts for `ai_chat_failed`. TOTAL — every kind maps to
 * something, because every send that fails must produce a terminal event.
 *
 * `viewOnly` is not a member of that set. A grouping dimension has to be a
 * closed set agreed with the schema that owns it, and widening one from a
 * caller is how a series quietly splits in two — so it is reported as the
 * GENERIC bucket, `sendFailed`, which is mobile's behaviour (its own set is
 * `'rate_limited' | 'error'`, and everything that is not a rate limit is
 * 'error').
 *
 * WHY NOT `undefined` / report nothing, which this used to do.
 * `Analytics.aiChatMessageSent` fires in `mutationFn`, BEFORE the request. So
 * returning early emitted a sent event with no terminal event: a funnel step
 * that starts and never ends, indistinguishable in PostHog from a message that
 * vanished. Silence is not the conservative option once the opening event has
 * already gone out. The value is rare — AppLayout gates the modal's mount on
 * the same rule, so a 403 here means the CLIENT's cached flags were stale —
 * which is exactly why it must not be the one shape that breaks the funnel.
 *
 * FOLLOW-UP for whoever owns `lib/analytics.ts`: adding `'viewOnly'` to
 * `AiChatFailureReason` makes that stale-flag race visible on its own; change
 * the one line below when it lands. A new kind added without touching this
 * switch fails to compile.
 */
function analyticsReason(kind: AiChatErrorKind): AiChatFailureReason {
  switch (kind) {
    case 'subscriptionRequired':
    case 'rateLimited':
    case 'unavailable':
    case 'sendFailed':
      return kind;
    case 'viewOnly':
    // `circleReadOnly` and `invalidMessage` are not in the closed
    // `AiChatFailureReason` vocabulary either, for the same reason `viewOnly`
    // is not: widening a grouping dimension from a caller splits one PostHog
    // series in two. Reported as the generic bucket until whoever owns
    // lib/analytics.ts adds them.
    case 'circleReadOnly':
    case 'invalidMessage':
      return 'sendFailed';
  }
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
  const queryClient = useQueryClient();
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
      // Unconditional: `aiChatMessageSent` has already fired for this turn.
      Analytics.aiChatFailed(circleId, {
        reason: analyticsReason(classifyAiError(err)),
        latencyMs: Date.now() - startedAtRef.current,
        turnIndex: Math.max(0, turnIndexRef.current - 1),
      });
      // THE FLAGS THIS MODAL'S OWN MOUNT IS GATED ON ARE NOW KNOWN TO BE STALE.
      //
      // `AppLayout` gates both AI entry points AND the modal's mount on
      // `resolveAiEntry({ viewOnly, isPremiumCircle, isOwner })`, read from the
      // two circle caches. A 403/402 here is the server saying that decision
      // was made on stale data — the seat was downgraded to view-only, or the
      // circle froze, since this modal opened. Classifying it for analytics and
      // stopping (which is all this handler used to do) leaves the caller
      // holding an assistant they may not have, still sending, until
      // `staleTime` expires or the window is refocused.
      //
      // Both codes, and the helper rather than either key: `['circles']` does
      // not prefix-match `['circle', id]`, and `resolveAiEntry` reads flags that
      // live on BOTH responses (see `lib/circleAccessFlags.ts`). Anything else
      // is not an access decision and must not fan out invalidations.
      if (isAccessDeniedError(err) || isSubscriptionRequiredError(err)) {
        invalidateCircleAccessFlags(queryClient, circleId);
      }
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
