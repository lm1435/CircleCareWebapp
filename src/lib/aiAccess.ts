// Who gets the AI Care Assistant entry point, and what tapping it does.
//
// The backend gate is already live (backend/src/routes/ai.ts —
// `rejectIfViewOnlySeat` + the owner-tier check below it). This module is the
// client half: without it the entry is offered to people the server has
// already decided to refuse, so the only feedback they get is an error bubble
// after they have typed a question.
//
// Every input is ALREADY on the client from `useCircle(circleId)` — this adds
// no request.

/** What the AI entry point should do for the current viewer. */
export type AiEntryState =
  /** Render the entry; tapping opens the assistant. */
  | 'available'
  /** Render the entry; tapping raises the upgrade prompt (the viewer is the
   *  owner, and premium benefits do not apply here — the one person whose
   *  purchase would actually lift it). */
  | 'upgrade'
  /** Render nothing. No prompt, no sale. */
  | 'hidden';

export interface AiEntryInput {
  /** `useCircle().viewOnly` — the requester's membership-level view-only seat. */
  viewOnly: boolean;
  /**
   * `useCircle().isPremiumCircle` — read it as "premium benefits apply to ME
   * here", never as "this circle is premium". THE SAME INPUT MOBILE READS
   * (`mobile/src/hooks/useAIEntryAccess.ts`); see the note below on why
   * `can_edit` is the wrong one.
   */
  isPremiumCircle: boolean;
  /** `circle.owner_id === current user id`. */
  isOwner: boolean;
}

/**
 * THE ONE PLACE THE AI-ENTRY RULE LIVES ON WEB — and it must give the same
 * answer as `mobile/src/hooks/useAIEntryAccess.ts` for every input. The nine-row
 * table in `src/__tests__/fixtures/aiEntryCases.ts` (a verbatim port of mobile's
 * canonical copy) is run by both suites so a divergence fails in whichever
 * client drifts.
 *
 *   view_only member                  → hidden
 *   premium benefits don't apply here:
 *       viewer is the owner           → upgrade
 *       anyone else                   → hidden
 *   otherwise                         → available
 *
 * WHY A VIEW-ONLY MEMBER GETS NOTHING RATHER THAN A PAYWALL. They cannot
 * change their own role — only the circle owner can hand them a full seat — so
 * an upgrade offer is an offer they cannot act on, for a purchase that would
 * not grant them the feature even if they made it.
 *
 * WHY `viewOnly` IS TESTED FIRST, AND WHY THAT ORDER IS LOAD-BEARING.
 * `rejectIfViewOnlySeat` returns 403 VIEW_ONLY *before* the route reads the
 * owner's subscription tier, and `getCircleAccessLevel` short-circuits on the
 * same flag, so `is_premium_circle` on a view-only member's payload is
 * hardcoded `false` without anyone's tier ever being consulted. Read the flag
 * first and you show a paywall to a view-only member of a genuinely PREMIUM
 * circle. Do not reorder these branches — pinned as a source-order assertion by
 * `src/__tests__/bans/aiEntryPremiumFlag.test.ts`.
 *
 * WHY NOT `can_edit`, WHICH THIS FUNCTION USED TO READ. The two flags agree for
 * a view-only member and for a frozen circle, so every test passed. They
 * disagree for a FREE-TIER ACTIVE circle — the default state of most
 * non-subscribing households: `backend/src/services/circleAccess.ts` returns
 * `is_premium_circle: false` with `can_edit: true` for it, while
 * `backend/src/routes/ai.ts` refuses on the OWNER's tier. So `can_edit` offered
 * the assistant to every member of such a circle; a NON-OWNER typed a question,
 * got a 402, and `AIChatModal` raised an upgrade prompt whose purchase could
 * not unlock it, because the tier read is `getUserTier(circle.owner_id)`. That
 * is the dead-paywall pattern this module exists to remove. `can_edit` is not
 * an input here at all any more.
 *
 * Fails closed everywhere: the caller's inputs come from `useCircle`, whose
 * flags are all `?? false`, so an unloaded circle resolves to `hidden` (nobody
 * is the owner of a circle that has not arrived) rather than flashing an entry
 * the viewer may not have.
 */
export function resolveAiEntry({ viewOnly, isPremiumCircle, isOwner }: AiEntryInput): AiEntryState {
  if (viewOnly) return 'hidden';
  if (!isPremiumCircle) return isOwner ? 'upgrade' : 'hidden';
  return 'available';
}
