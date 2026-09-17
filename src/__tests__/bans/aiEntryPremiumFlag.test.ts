import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DRIFT GUARD — `view_only` IS READ BEFORE THE PREMIUM FLAG. ALWAYS.
 *
 * ─── WHAT THIS GUARD USED TO SAY, AND WHY THAT WAS WRONG ───────────────────
 *
 * It used to forbid `lib/aiAccess.ts` from NAMING a premium flag at all, on the
 * reasoning that "mobile tests the premium flag first and ships the bug". That
 * rationale is stale: mobile tests `view_only` FIRST
 * (`mobile/src/hooks/useAIEntryAccess.ts`), and banning the flag pushed web
 * onto `can_edit` instead — which is a DIFFERENT input, not a safer one. The
 * two agree for a view-only member and for a frozen circle, so both suites
 * stayed green; they disagree for a free-tier ACTIVE circle, where
 * `getCircleAccessLevel` answers `is_premium_circle: false` WITH
 * `can_edit: true` and `backend/src/routes/ai.ts` refuses on the OWNER's tier.
 * Web therefore offered the assistant to every member of the default
 * non-subscribing household, and a non-owner who asked a question got a 402 and
 * an upgrade prompt their own purchase could not lift.
 *
 * So the ban went; the thing it was standing in for stayed. What actually keeps
 * a view-only member off a paywall is not WHICH flag is read but the ORDER: the
 * backend short-circuits on `view_only` BEFORE consulting anybody's tier, so
 * `is_premium_circle` on that member's payload is hardcoded `false` and was
 * never computed from a subscription at all. Read it first and you sell a
 * subscription to the one person it cannot help.
 *
 * ─── WHAT THIS GUARD ACTUALLY CATCHES, AND WHAT IT CANNOT ──────────────────
 *
 * This is a TEXTUAL assertion over the source. It reads token order; it does
 * not follow data flow, and it cannot be made to. Mutation-tested against the
 * five most plausible edits to a three-line function:
 *
 *   1. swap the two branches (the bug that actually shipped)  → CAUGHT here
 *   2. an access-flag `if` inserted ABOVE the view-only check → CAUGHT here
 *   3. braces / an extra newline (behaviour identical)        → passes (benign)
 *   4. the condition extracted to a variable (identical)      → passes (benign)
 *   5. alias the flag, then read the ALIAS first              → SLIPS PAST HERE
 *
 * Case 5 is the shipped bug fully reinstated — `const premiumApplies =
 * isPremiumCircle;` followed by `if (!premiumApplies) return ...` above the
 * view-only check — and no regex over this file can tell that alias from any
 * other local. Do NOT try to make the pattern smarter: chasing an alias
 * textually is a road with no end, and each turn of the screw buys one more
 * false alarm on a benign refactor.
 *
 * THE REAL NET IS THE SHARED BEHAVIOUR TABLE.
 * `src/__tests__/fixtures/aiEntryCases.ts` — a verbatim port of mobile's
 * canonical copy — is expanded and run against the whole layout by
 * `src/components/layout/__tests__/AppLayout.aiGate.test.tsx`, and against the
 * rule directly by `src/lib/__tests__/aiAccess.test.ts`. Mobile runs the same
 * table in `mobile/src/__tests__/hooks/useAIEntryAccess.test.ts`. Mutations 1
 * and 5 each fail 3 scenarios there. That table, not this file, is what makes
 * the ordering safe to rely on; this guard is a cheap early signal that names
 * the rule at the point of edit, and a backstop for the one case the table
 * cannot reach.
 *
 * ─── WHY A SOURCE-ORDER ASSERTION AT ALL, THEN ─────────────────────────────
 *
 * The two orderings disagree BEHAVIOURALLY only for a view-only member whose
 * payload also says premium — a row the backend does not currently emit,
 * because the `view_only` short-circuit hardcodes the flag false. The table
 * covers the rows the server can produce; reading the ORDER off the source is
 * what still fails when someone reorders the branches in a way today's payloads
 * happen to mask. (This comment used to claim the source-order assertion was
 * why a behaviour test had been safe to delete. It was not — the shared table
 * was, and is.)
 *
 * Mobile carries the equivalent guard at
 * `mobile/src/__tests__/bans/aiEntryBranchOrder.test.ts` — the same assertion,
 * over its own file, so neither client can drift alone.
 */

const AI_ACCESS = join(__dirname, '..', '..', 'lib', 'aiAccess.ts');

/** The access/tier flags the rule may branch on AFTER `viewOnly`, never before.
 *  `can_edit` is in here too: it is not an input any more, and if it ever comes
 *  back it must not come back ahead of the view-only check either. */
const ACCESS_FLAG = /isPremiumCircle|is_premium_circle|canEdit|can_edit|planTier|plan_tier/;

/** Strip block + line comments — the rule is about CODE, and the file's own
 *  doc comment necessarily discusses every flag it names. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Blank the CONTENTS of string/template literals, keeping the quotes so
 *  offsets and line counts are untouched. A flag name inside a string is prose,
 *  not a branch — without this a `throw new Error('isPremiumCircle ...')` above
 *  the view-only check would be reported as an offender. Applied only to the
 *  flag scan: the shape assertion below needs `'hidden'` intact. */
function blankStringLiterals(src: string): string {
  return src.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m, quote: string) =>
    quote + ' '.repeat(Math.max(0, m.length - 2)) + quote
  );
}

/** Split into lines, carrying each line's REAL offset in `body`. Computed by
 *  accumulation, never by `body.indexOf(line)`: `indexOf` resolves a duplicated
 *  line (two identical `return 'hidden';`s, say) to the FIRST occurrence, which
 *  reports the wrong position for the second — and position is the entire
 *  assertion here. */
function linesWithOffsets(body: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let at = 0;
  for (const text of body.split('\n')) {
    out.push({ text, at });
    at += text.length + 1; // +1 for the '\n' consumed by split
  }
  return out;
}

describe('AI entry gate reads view_only before any access flag', () => {
  const source = readFileSync(AI_ACCESS, 'utf8');
  const code = stripComments(source);
  // Everything from the function signature onwards — the destructured
  // parameter list is deliberately included, because a rule that never names
  // `viewOnly` in its body at all must fail here rather than pass vacuously.
  const body = code.slice(code.indexOf('function resolveAiEntry'));
  // Flag scan reads this one; the shape assertion reads `body`.
  const scannable = blankStringLiterals(body);

  it('reads the file it claims to', () => {
    // A guard pointed at the wrong path passes forever.
    expect(source).toContain('export function resolveAiEntry');
    expect(body).not.toBe('');
  });

  it('branches on viewOnly before it branches on any access/premium flag', () => {
    const viewOnlyAt = scannable.indexOf('if (viewOnly');
    expect(viewOnlyAt).toBeGreaterThan(-1);

    // The rule must still READ an access flag somewhere in its body — a
    // version that names none at all is not a stricter rule, it is a different
    // one. Deliberately "somewhere in the body", not "on an `if` line": a
    // behaviour-preserving `const premiumApplies = isPremiumCircle;` extraction
    // moves the only mention off the `if` line, and failing that refactor buys
    // nothing (it does not close the aliasing hole either — see the header).
    expect(ACCESS_FLAG.test(scannable)).toBe(true);

    const offenders = linesWithOffsets(scannable)
      .filter(({ text, at }) => at < viewOnlyAt && text.trim().startsWith('if '))
      .filter(({ text }) => ACCESS_FLAG.test(text))
      .map(
        ({ text }) =>
          `lib/aiAccess.ts — "${text.trim()}" branches before the view_only check.\n` +
          `A view-only member's payload has the premium flag hardcoded false: the AI route and ` +
          `getCircleAccessLevel both return before reading the owner's tier. Test view_only ` +
          `FIRST, or a view-only member of a PREMIUM circle is shown a paywall for a purchase ` +
          `that would not give them the assistant.`
      );
    expect(offenders).toEqual([]);
  });

  it('gates the whole rule on viewOnly — the check is a return, not a fallthrough', () => {
    // An ordering that reads view_only first but does not LEAVE on it is the
    // same bug with extra steps. Braces and line breaks are allowed: they are
    // the single most likely benign edit to this function, and rejecting
    // `if (viewOnly) {\n  return 'hidden';\n}` taught nobody anything.
    // Scoped to the function body, not the whole file — a matching line
    // anywhere else in the module used to satisfy this.
    expect(body).toMatch(/if \(viewOnly\)\s*(?:\{\s*)?return\s+'hidden';/);
  });
});
