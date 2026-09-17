import { resolveAiEntry } from '@/lib/aiAccess';

/**
 * The product rule, stated once:
 *
 *   view_only member                → HIDE   (they cannot change their own role,
 *                                             so an upgrade offer is useless and
 *                                             insulting)
 *   premium benefits don't apply:
 *     viewer IS the owner           → SHOW, tapping raises the upgrade prompt
 *     anyone else                   → HIDE
 *   otherwise                       → SHOW
 *
 * The nine-row table that both clients share lives in
 * `src/__tests__/fixtures/aiEntryCases.ts` and is run against the whole layout
 * in `components/layout/__tests__/AppLayout.aiGate.test.tsx`. This file is the
 * unit-level pin on the rule itself.
 */
describe('resolveAiEntry', () => {
  describe('A — view-only member', () => {
    it('hides the entry for a view-only member', () => {
      expect(resolveAiEntry({ viewOnly: true, isPremiumCircle: false, isOwner: false })).toBe(
        'hidden'
      );
    });

    // THE ORDERING BUG THIS EXISTS TO PREVENT. The backend returns early for a
    // view-only seat BEFORE reading the owner's tier — both in
    // `rejectIfViewOnlySeat` and in `getCircleAccessLevel` — so the premium
    // flag it reports for that member is hardcoded false. Testing the premium
    // flag FIRST therefore shows a paywall to a view-only member of a genuinely
    // premium circle, selling a subscription that changes nothing about their
    // seat. `view_only` must be read first, always.
    //
    // WHY A MATRIX AND NOT ONE ROW. A single `{ isPremiumCircle: true, isOwner:
    // false }` row cannot see the reorder: premium-first skips its own branch
    // when the flag is true, and when it is false (what the backend actually
    // sends this member) a non-owner lands on 'hidden' down that branch too.
    // The reordered code only answers differently — 'upgrade', the paywall —
    // once the owner flag is also set. So the claim "view_only wins, whatever
    // else the payload says" is asserted over every premium/owner pairing.
    it('hides the entry for a view-only member of a genuinely PREMIUM circle', () => {
      for (const isPremiumCircle of [true, false]) {
        for (const isOwner of [false, true]) {
          expect({
            isPremiumCircle,
            isOwner,
            entry: resolveAiEntry({ viewOnly: true, isPremiumCircle, isOwner }),
          }).toEqual({ isPremiumCircle, isOwner, entry: 'hidden' });
        }
      }
    });

    // NOT merely defensive, despite how it reads. This exact pairing —
    // `view_only` true alongside a premium/owner flag — is row 1 of the shared
    // case table (`src/__tests__/fixtures/aiEntryCases.ts`) in BOTH repos, so it
    // is exercised behaviourally on every run of both suites, not just here.
    //
    // Keep it. The source-order ban (`src/__tests__/bans/aiEntryPremiumFlag.
    // test.ts`) is a cheap tripwire on the obvious edit and NOT a substitute:
    // aliasing the flag to a `const` and branching on the alias first reinstates
    // the shipped bug and passes that ban 3/3 (mutation-proven, both repos). The
    // owner + view-only scenarios are what actually catch it. Mobile deleted its
    // copy of this test on the argument that the ban covered it, and has since
    // restored it — see `mobile/src/__tests__/hooks/useAIEntryAccess.test.ts`.
    it('hides the entry for a view-only viewer who is somehow also the owner', () => {
      expect(resolveAiEntry({ viewOnly: true, isPremiumCircle: false, isOwner: true })).toBe(
        'hidden'
      );
    });
  });

  describe('B — premium does not apply here, viewer IS the owner', () => {
    it('shows the entry and marks it as an upgrade prompt', () => {
      expect(resolveAiEntry({ viewOnly: false, isPremiumCircle: false, isOwner: true })).toBe(
        'upgrade'
      );
    });
  });

  describe('C — premium does not apply here, viewer is NOT the owner', () => {
    // The row that was LIVE ON WEB while this function read `can_edit`: a
    // free-tier ACTIVE circle answers `is_premium_circle: false` WITH
    // `can_edit: true`, so every member saw the assistant, and a non-owner who
    // typed a question got a 402 and an upgrade prompt their own purchase could
    // not lift — the AI route reads `getUserTier(circle.owner_id)`.
    it('hides the entry', () => {
      expect(resolveAiEntry({ viewOnly: false, isPremiumCircle: false, isOwner: false })).toBe(
        'hidden'
      );
    });
  });

  describe('otherwise', () => {
    it('shows the entry when premium benefits apply to this viewer', () => {
      expect(resolveAiEntry({ viewOnly: false, isPremiumCircle: true, isOwner: false })).toBe(
        'available'
      );
      expect(resolveAiEntry({ viewOnly: false, isPremiumCircle: true, isOwner: true })).toBe(
        'available'
      );
    });
  });
});
