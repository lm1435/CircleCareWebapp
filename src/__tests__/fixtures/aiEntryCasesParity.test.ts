import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CROSS-TREE DRIFT GUARD for the AI-entry case table.
 *
 * `mobile/src/__tests__/fixtures/aiEntryCases.ts` is canonical;
 * `src/__tests__/fixtures/aiEntryCases.ts` is a verbatim port of it. Until this
 * file existed, NOTHING enforced that — the two copies' own headers promised
 * they would be edited in the same commit, and a promise in a comment is not a
 * check. The header cites `backend/src/utils/hourCycle.ts` as precedent, but
 * that file makes the identical unenforced promise about its own two ports, so
 * the citation is circular: it is one unchecked convention pointing at another.
 *
 * ─── WHY BYTE EQUALITY, AND NOT "THE ROWS AGREE" ───────────────────────────
 *
 * The fixture is NOT inert data, despite its own header's claim that "it is
 * data, so both runtimes can read it unchanged". It also exports
 * `expandAiEntryCases`, a nested loop over four flag columns, and BOTH suites
 * iterate its output — `AppLayout.aiGate.test.tsx` here and
 * `mobile/src/__tests__/hooks/useAIEntryAccess.test.ts` there — in the order
 * that loop happens to produce. A row-by-row comparison would let the two
 * copies' expansion logic drift while the tables still "matched", which is the
 * half that actually decides what each suite runs. Comparing bytes covers the
 * rows, the loop, and the doc comment in one assertion, and it is the same
 * assertion the two ports' headers already claim to guarantee.
 *
 * ─── PRECEDENT ─────────────────────────────────────────────────────────────
 *
 * `mobile/src/__tests__/utils/timezoneParity.test.ts` ("the fixture is
 * genuinely shared, not merely duplicated") is this exact check, written after
 * two timezone defects shipped in both apps because "shared" was a story
 * rather than a check. For the cross-tree path, `apiErrors.test.ts` in this
 * repo already reaches into `../mobile/` the same way (and mobile's
 * `JoinCircleScreen.inviterFallback.test.tsx` reaches into `webapp/`).
 *
 * A sibling test in `mobile/` asserts the same equality from that side, so a
 * one-sided edit fails in whichever tree is edited alone. Both are needed:
 * either one alone leaves the OTHER repo free to drift when its suite is the
 * only one that runs.
 *
 * ─── IF THIS FAILS ─────────────────────────────────────────────────────────
 *
 * Do not "fix" it by editing one copy to match. Decide which change is
 * correct, then apply it to BOTH files in the same commit — mobile's copy is
 * canonical, so a deliberate change starts there.
 */

// Resolved from the webapp repo root (vitest's process.cwd()), matching the
// existing cross-tree guard in `src/lib/__tests__/apiErrors.test.ts`. Not
// derived from import.meta.url: under the vite/vitest SSR module loader a test
// file's import.meta.url is not reliably a plain file:// URL.
const MINE = resolve(process.cwd(), 'src/__tests__/fixtures/aiEntryCases.ts');
const CANONICAL = resolve(process.cwd(), '../mobile/src/__tests__/fixtures/aiEntryCases.ts');

const mobileAvailable = existsSync(CANONICAL);

describe('the AI-entry case table is genuinely shared, not merely duplicated', () => {
  it('reads the file it claims to — a guard pointed at a missing path passes forever', () => {
    // Skipping on a missing SIBLING is a deliberate concession to a single-repo
    // clone. Skipping on a missing copy of OUR OWN is not: that is this guard
    // silently switching itself off.
    expect(existsSync(MINE)).toBe(true);
    expect(readFileSync(MINE, 'utf8')).toContain('export function expandAiEntryCases');
  });

  it.skipIf(!mobileAvailable)('matches the canonical mobile copy byte for byte', () => {
    // utf8, not a Buffer compare, so a mismatch prints a readable character
    // diff instead of two byte dumps.
    expect(readFileSync(MINE, 'utf8')).toBe(readFileSync(CANONICAL, 'utf8'));
  });
});

if (!mobileAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[aiEntryCasesParity.test.ts] mobile checkout not found at ${CANONICAL} — ` +
      'the AI-entry fixture parity check was skipped.'
  );
}
