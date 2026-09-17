/**
 * THE AI-ENTRY CASE TABLE — CANONICAL SOURCE.
 *
 * `mobile/src/__tests__/fixtures/aiEntryCases.ts` is canonical.
 * `webapp/src/__tests__/fixtures/aiEntryCases.ts` is a VERBATIM PORT of this
 * file. Keep the two copies identical — if you change a row here, change it
 * there in the same commit.
 *
 * That is ENFORCED, not merely asked for. `mobile/src/__tests__/bans/
 * aiEntryCasesParity.test.ts` and `webapp/src/__tests__/fixtures/
 * aiEntryCasesParity.test.ts` byte-compare the two copies, each guarded on the
 * sibling tree existing so a single-repo clone stays green. Both are modelled on
 * `mobile/src/__tests__/utils/timezoneParity.test.ts`, which was written after
 * two timezone defects shipped in BOTH apps because "shared" was a story and
 * not a check.
 *
 * This header used to cite `backend/src/utils/hourCycle.ts` as the precedent
 * for the convention. That citation was circular: hourCycle makes the same
 * unenforced promise about its own two client ports, and still has the same
 * exposure this file no longer has.
 *
 * Nothing in this file may import anything, so both runtimes can read it
 * unchanged — but it is NOT inert data. It exports `expandAiEntryCases`, a
 * nested loop whose iteration ORDER and label format both suites depend on, so
 * a structural comparison of `AI_ENTRY_CASES` alone would pass while the
 * expansion drifted underneath it. That is why the parity check is byte
 * equality and not a row-by-row compare.
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * One product rule, written twice, by two authors, from two different inputs:
 *
 *   mobile/src/hooks/useAIEntryAccess.ts   read `is_premium_circle`
 *   webapp/src/lib/aiAccess.ts             read `can_edit`
 *
 * They agree for a view-only member and for a frozen circle, so every test on
 * both sides passed. They disagree for a FREE-TIER ACTIVE circle — the default
 * state of most non-subscribing households — because
 * `backend/src/services/circleAccess.ts` returns `is_premium_circle: false`
 * together with `can_edit: true` for it, while `backend/src/routes/ai.ts`
 * refuses on the OWNER'S TIER. Web therefore offered the assistant to every
 * member of such a circle; a non-owner typed a question, got a 402, and was
 * shown a paywall whose purchase could not unlock it (the tier read is the
 * OWNER's). That is the dead-paywall pattern the whole change existed to
 * remove.
 *
 * A table that only either client ran could not catch that. This one is run by
 * BOTH suites, so a future divergence fails in whichever repo drifts.
 *
 * ─── HOW TO READ A ROW ─────────────────────────────────────────────────────
 *
 * `is_premium_circle` does NOT mean "this circle is premium". Read it as
 * "premium benefits apply TO ME here": the server computes it per MEMBERSHIP
 * and hardcodes it `false` for a view-only seat WITHOUT reading the owner's
 * tier, which is why `view_only` must be tested BEFORE it.
 *
 * `can_edit` is a column here even though neither client's rule reads it. That
 * is the point: rows 4-7 vary it while the answer does not, which is what makes
 * "web reads can_edit" a failing table rather than an invisible difference.
 */

/** The three things an AI entry point can do, in the vocabulary BOTH clients
 *  share. Each client maps its own state names onto these:
 *
 *    mobile 'open'    -> 'show'     web 'available' -> 'show'
 *    mobile 'upgrade' -> 'upgrade'  web 'upgrade'   -> 'upgrade'
 *    mobile 'hidden'  -> 'hidden'   web 'hidden'    -> 'hidden'
 *    mobile 'pending' -> 'hidden'   (both mean: nothing is rendered)
 */
export type AiEntryExpectation = 'show' | 'upgrade' | 'hidden';

/**
 * One cell of the table.
 *
 *   boolean        that exact value.
 *   'any'          the answer must not depend on it — the runner tries BOTH.
 *   'unresolved'   the client has no value for it. For a flag that means the
 *                  field is absent from the payload (the access lookup failed,
 *                  or an older response shape); for `isOwner` it means there is
 *                  no resolved circle at all, so owner-ness is unknowable.
 */
export type AiEntryCell = boolean | 'any' | 'unresolved';

export interface AiEntryCase {
  /** 1-9, matching the table in the spec. */
  row: number;
  name: string;
  viewOnly: AiEntryCell;
  isPremiumCircle: AiEntryCell;
  canEdit: AiEntryCell;
  isOwner: AiEntryCell;
  /** One answer, or one per owner-ness when the row's answer depends on it. */
  expected: AiEntryExpectation | { owner: AiEntryExpectation; nonOwner: AiEntryExpectation };
}

/**
 * | view_only | is_premium_circle | can_edit | viewer is owner | expected |
 * |-----------|-------------------|----------|-----------------|----------|
 * | true      | any               | any      | any             | hidden   |
 * | false     | true              | true     | yes             | show     |
 * | false     | true              | true     | no              | show     |
 * | false     | FALSE             | TRUE     | yes             | UPGRADE  |
 * | false     | FALSE             | TRUE     | no              | HIDDEN   |
 * | false     | false             | false    | yes             | upgrade  |
 * | false     | false             | false    | no              | hidden   |
 * | loading / unresolved          | —        | —               | nothing  |
 * | access lookup failed          | —        | —               | owner: upgrade, else hidden |
 */
export const AI_ENTRY_CASES: readonly AiEntryCase[] = [
  {
    row: 1,
    name: 'view-only member — hidden, whatever else the payload says',
    viewOnly: true,
    isPremiumCircle: 'any',
    canEdit: 'any',
    isOwner: 'any',
    expected: 'hidden',
  },
  {
    row: 2,
    name: 'premium circle, viewer is the owner — show',
    viewOnly: false,
    isPremiumCircle: true,
    canEdit: true,
    isOwner: true,
    expected: 'show',
  },
  {
    row: 3,
    name: 'premium circle, viewer is not the owner — show',
    viewOnly: false,
    isPremiumCircle: true,
    canEdit: true,
    isOwner: false,
    expected: 'show',
  },
  {
    row: 4,
    // THE DIVERGENCE, owner half. A free-tier ACTIVE circle: not premium, yet
    // fully editable. Reading `can_edit` answers 'show' and drops the owner
    // into a chat window the server will refuse.
    name: 'FREE-TIER ACTIVE circle (not premium, editable), viewer is the owner — upgrade',
    viewOnly: false,
    isPremiumCircle: false,
    canEdit: true,
    isOwner: true,
    expected: 'upgrade',
  },
  {
    row: 5,
    // THE DIVERGENCE, non-owner half — the row that was live on web. Reading
    // `can_edit` answers 'show'; the member types a question, gets a 402, and
    // is offered a subscription that CANNOT unlock it, because the route reads
    // the OWNER's tier (`getUserTier(circle.owner_id)`).
    name: 'FREE-TIER ACTIVE circle (not premium, editable), viewer is NOT the owner — hidden',
    viewOnly: false,
    isPremiumCircle: false,
    canEdit: true,
    isOwner: false,
    expected: 'hidden',
  },
  {
    row: 6,
    name: 'frozen circle (not premium, not editable), viewer is the owner — upgrade',
    viewOnly: false,
    isPremiumCircle: false,
    canEdit: false,
    isOwner: true,
    expected: 'upgrade',
  },
  {
    row: 7,
    name: 'frozen circle (not premium, not editable), viewer is NOT the owner — hidden',
    viewOnly: false,
    isPremiumCircle: false,
    canEdit: false,
    isOwner: false,
    expected: 'hidden',
  },
  {
    row: 8,
    // No circle at all yet. Gate on RESOLVED, not on falsy: an entry that
    // appears and is then taken away is the failure this change removes, and
    // an unresolved tier read as "frozen" flashes a paywall on every cold
    // start. Owner-ness is unknowable here, hence 'unresolved'.
    name: 'circle still loading / unresolved — nothing rendered',
    viewOnly: 'unresolved',
    isPremiumCircle: 'unresolved',
    canEdit: 'unresolved',
    isOwner: 'unresolved',
    expected: 'hidden',
  },
  {
    row: 9,
    // The circle resolved — so we know who owns it — but its access fields did
    // not come back. Fail CLOSED onto the frozen branch: the owner is the one
    // person who can act on a prompt, everybody else gets nothing.
    name: 'access lookup failed (circle known, flags absent) — owner: upgrade, else hidden',
    viewOnly: 'unresolved',
    isPremiumCircle: 'unresolved',
    canEdit: 'unresolved',
    isOwner: 'any',
    expected: { owner: 'upgrade', nonOwner: 'hidden' },
  },
];

/** One fully-resolved run of a row. `undefined` means "the client has no value
 *  for this"; for `isOwner` it additionally means "there is no circle". */
export interface AiEntryScenario {
  row: number;
  label: string;
  viewOnly: boolean | undefined;
  isPremiumCircle: boolean | undefined;
  canEdit: boolean | undefined;
  isOwner: boolean | undefined;
  expected: AiEntryExpectation;
}

function values(cell: AiEntryCell): (boolean | undefined)[] {
  if (cell === 'any') return [true, false];
  if (cell === 'unresolved') return [undefined];
  return [cell];
}

function show(value: boolean | undefined): string {
  return value === undefined ? '—' : String(value);
}

/**
 * Expand the nine rows into every concrete combination they stand for, so both
 * suites iterate exactly the same list in exactly the same order.
 */
export function expandAiEntryCases(
  cases: readonly AiEntryCase[] = AI_ENTRY_CASES
): AiEntryScenario[] {
  const scenarios: AiEntryScenario[] = [];
  for (const testCase of cases) {
    for (const viewOnly of values(testCase.viewOnly)) {
      for (const isPremiumCircle of values(testCase.isPremiumCircle)) {
        for (const canEdit of values(testCase.canEdit)) {
          for (const isOwner of values(testCase.isOwner)) {
            const expected =
              typeof testCase.expected === 'string'
                ? testCase.expected
                : isOwner === true
                  ? testCase.expected.owner
                  : testCase.expected.nonOwner;
            scenarios.push({
              row: testCase.row,
              label:
                `row ${testCase.row}: ${testCase.name} ` +
                `[view_only=${show(viewOnly)} is_premium_circle=${show(isPremiumCircle)} ` +
                `can_edit=${show(canEdit)} owner=${show(isOwner)}] -> ${expected}`,
              viewOnly,
              isPremiumCircle,
              canEdit,
              isOwner,
              expected,
            });
          }
        }
      }
    }
  }
  return scenarios;
}
