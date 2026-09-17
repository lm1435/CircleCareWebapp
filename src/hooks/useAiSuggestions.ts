import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAiSuggestions } from '@/api/ai';
import { isAccessDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
import { queryKeys } from '@/lib/queryKeys';

// Web port of the suggestions half of mobile/src/components/ai/AIChatModal.tsx
// (mobile's `loadSuggestions`), reshaped as a React Query read hook per the web
// convention for server state.
//
// The strings are SERVER-OWNED. The backend's BASE_SUGGESTIONS list also seeds
// the intent classifier's few-shot examples, so a client-invented question
// classifies as UNKNOWN and the assistant answers its own chip with "I didn't
// quite understand that". This hook therefore has NO fallback list: on any
// failure it resolves to no suggestions and the modal renders nothing.

/**
 * Terminal failures that must never be retried:
 *   - 402 SUBSCRIPTION_REQUIRED / PAYMENT_REQUIRED — the circle owner is on the
 *     free tier; the AI assistant is premium-gated and retrying cannot help.
 *   - 403 FORBIDDEN — the caller is not a member of this circle.
 * Both are stable for the session, so retrying only burns requests.
 */
function isTerminalSuggestionsError(err: unknown): boolean {
  return isSubscriptionRequiredError(err) || isAccessDeniedError(err);
}

/**
 * Normalize the i18n tag to the base language the backend understands. The
 * suggestions route coerces anything that is not exactly 'es' to 'en', so a
 * region-qualified tag like 'es-MX' would silently return English copy.
 */
function baseLanguage(tag: string | undefined): 'en' | 'es' {
  return tag?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * Suggested questions for the AI Care Assistant's empty state.
 *
 * @param circleId - circle whose data personalizes the suggestions
 * @param enabled  - fetch only while the chat modal is open
 *
 * The query key carries the resolved language so switching to Spanish refetches
 * rather than reusing the English chips. `staleTime` is generous — the list is
 * built from lightweight DB reads and barely moves within a session.
 */
export function useAiSuggestions(circleId: string, enabled: boolean): UseQueryResult<string[]> {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const language = baseLanguage(i18n.language);

  const query = useQuery({
    queryKey: queryKeys.aiSuggestions(circleId, language),
    queryFn: () => getAiSuggestions(circleId, language),
    enabled: enabled && !!circleId,
    staleTime: 1000 * 60 * 30, // 30 min — chips barely change within a session
    retry: (failureCount, error) => (isTerminalSuggestionsError(error) ? false : failureCount < 1),
  });

  // A TERMINAL 403/402 HERE MEANS THE GATING FLAGS ARE STALE — REFRESH THEM.
  //
  // `isTerminalSuggestionsError` above already recognises this rejection; it
  // used that only to stop retrying, which treats "you may not have this" as
  // nothing more than a wasted request. It is more than that: `AppLayout` gates
  // both AI entry points and the chat modal's MOUNT on `resolveAiEntry(...)`,
  // read from the two circle caches, so this request is often the FIRST signal
  // that the seat was downgraded or the circle froze since those caches were
  // filled — it fires the moment the modal opens. Without this the assistant
  // stays offered and usable until `staleTime` expires or the window regains
  // focus.
  //
  // In an effect, not in `retry`: `retry` is a pure decision the client may
  // call more than once, and a cache invalidation is not something to do from
  // inside one. The dependency is the settled error object, so this fires once
  // per failure and cannot loop — refreshing the circle caches does not re-run
  // this query.
  const { error, isError } = query;
  useEffect(() => {
    if (!isError) return;
    if (isAccessDeniedError(error) || isSubscriptionRequiredError(error)) {
      invalidateCircleAccessFlags(queryClient, circleId);
    }
  }, [isError, error, queryClient, circleId]);

  return query;
}
