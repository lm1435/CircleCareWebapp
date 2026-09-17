import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';

/**
 * DRIFT GUARD — "view-only must be view-only on every surface."
 *
 * The circle's write-access flags live in TWO React Query caches:
 *
 *   `queryKeys.circles`      → `['circles']`      (GET /circles — the list)
 *   `queryKeys.circleDetail` → `['circle', id]`   (GET /circles/:id — detail)
 *
 * `['circles']` does NOT prefix-match `['circle', id]` (plural vs singular
 * root), and `useCircle().canEdit` — the gate behind every write affordance in
 * this app — reads the DETAIL. Every rejection handler used to refresh only
 * the list, so after a 403 the whole app kept offering Edit / Delete / Done /
 * Take to a member who could not perform any of them: each click 403'd again
 * and any optimistic row flipped back.
 *
 * `src/lib/circleAccessFlags.ts` owns that pair now. Four rules keep it owned:
 *
 *  1. No access-rejection branch may reference either circle query key itself.
 *     Refreshing one and not the other IS the bug.
 *  2. A rejection branch that refetches anything must refresh the access flags
 *     through the helper — you cannot repopulate the screen and leave the gate
 *     stale.
 *  3. In the circle-scoped hooks named below, EVERY rejection branch must
 *     CALL the helper, per branch.
 *  4. …and between them those calls must cover BOTH rejection families — the
 *     402 (subscription / frozen) family and the 403 (view-only / access)
 *     family. A hook that refreshes on a 402 alone leaves every view-only
 *     member with the stale gate.
 *
 * PARSED, NOT GREPPED. This file used to find branches with a regex and test
 * "calls the helper" with `body.includes(...)`. Three edits stayed green against
 * that, and each is now a fixture in the "the scanner itself" block below:
 *   - `const denied = isPermissionDeniedError(e); if (denied) { … }` with the
 *     call deleted — the alias's condition named no predicate, so the branch
 *     was invisible;
 *   - `// invalidateCircleAccessFlags(queryClient, circleId)` — a comment
 *     satisfied `includes`;
 *   - `useAiChat` narrowed to `if (isSubscriptionRequiredError(err))` — the
 *     predicate list did not even contain `isAccessDeniedError`, so the 403 half
 *     was never checked. The scanner below reads the TypeScript AST: comments
 *     are not nodes, a helper counts only as a real `CallExpression`, and local
 *     `const` / single-return-function aliases resolve back to the predicate.
 *
 * The runtime half is `src/hooks/__tests__/viewOnlyGateRefresh.test.tsx`. It
 * exercises ONE mutation per hook family (and 402 only for `useCompleteEvent`
 * and `useAiChat`), so these hooks are covered by this file alone: useUpdateEvent,
 * useDeleteEvent, useMedicationStatus, useUpdateVital, useDeleteVital,
 * useCreateCareNote, useDeleteCareNote, useCreateNote, useDeleteNote,
 * useLeaveCircle, useSetMedicationResponsible, useCancelInvite, useResendInvite
 * (each shares its onError helper with a runtime-tested sibling, but nothing at
 * runtime proves it is wired to it), plus useAcceptInvite and useCreateCircle,
 * which have no circle to refresh.
 *
 * NOT covered: a brand-new hook that classifies a 403 and refreshes nothing at
 * all. That is a design choice at the moment it is written, not drift from an
 * existing pattern — add it to `MUST_REFRESH_ACCESS_FLAGS` when it appears.
 */

const HOOKS_DIR = join(__dirname, '..', '..', 'hooks');
const SRC = join(__dirname, '..', '..');

const HELPER = 'invalidateCircleAccessFlags';
const CIRCLE_QUERY_KEYS = new Set(['circles', 'circleDetail']);

type Family = '402' | '403';
const BOTH: readonly Family[] = ['402', '403'];

/** `src/lib/apiErrors.ts` predicates, by the rejection family each tests for. */
const PREDICATE_FAMILIES: Record<string, readonly Family[]> = {
  isPermissionDeniedError: BOTH, // PERMISSION_ERROR_CODES = subscription ∪ access
  isSubscriptionRequiredError: ['402'],
  isAccessDeniedError: ['403'],
  isFrozenCircleError: ['403'], // READ_ONLY_MEMBER ⊂ ACCESS_ERROR_CODES
};

/**
 * Hooks that own a circle-scoped write and therefore MUST route their
 * access-rejection branch through the helper. Every one of these is reachable
 * from a surface a view-only member can see.
 */
const MUST_REFRESH_ACCESS_FLAGS = [
  'useCalendarEvents.ts', // events: create / update / delete / complete / medication-status
  'useMedConfirmation.ts', // dose confirmations
  'useVitals.ts', // vitals create / update / delete
  'useDocuments.ts', // document upload / rename / delete
  'useCareNotes.ts', // daily care notes
  'useEventNotes.ts', // per-event notes
  'useEmergencyInfo.ts', // emergency info
  'useCircleMembers.ts', // remove member / leave / medication-responsible
  'useCircleAdmin.ts', // circle update / delete
  'useInvites.ts', // invite create / cancel / resend
  // THE AI ASSISTANT. Added after both hooks were found doing nothing with a
  // 403: `useAiChat` classified it for analytics and stopped, `useAiSuggestions`
  // classified it only to stop retrying. That is the "NOT covered" case named
  // above — a hook that refreshes NOTHING is invisible to rules 1 and 2, and the
  // only remedy is to name it here. It matters more than a write hook:
  // `AppLayout` gates the assistant's ENTRY POINTS AND ITS MOUNT on
  // `resolveAiEntry(...)`, read from these very caches, so a stale flag does not
  // just leave a button on screen — it keeps a whole premium surface open to
  // someone the server has already refused.
  'useAiChat.ts', // AI chat send
  'useAiSuggestions.ts', // AI suggestion chips (modal-open fetch)
];

/**
 * Exempt from rule 3, by hook — each one still has to justify itself.
 *
 * `useCreateCircle` (POST /circles): the circle does not exist yet, so it has no
 * access flags to go stale and no `circleId` to pass. Still true — the branch
 * sits in `useCreateCircle`'s own inline onError, not the shared
 * `useCircleAdminOnError` the update/delete writes use, which IS held to rule 3.
 */
const NO_CIRCLE_TO_REFRESH: Record<string, string> = {
  'useCircleAdmin.ts#useCreateCircle':
    'POST /circles — the circle does not exist yet, so it has no access flags to go stale',
};

// ── the scanner ─────────────────────────────────────────────────────────────

interface RejectionBranch {
  line: number;
  /** Nearest enclosing named function — every hook in scope is one. */
  fn: string;
  families: Set<Family>;
  /** A real `invalidateCircleAccessFlags(...)` call executes in this branch. */
  callsHelper: boolean;
  /** `queryKeys.circles` / `queryKeys.circleDetail` appears in the branch. */
  namesCircleKey: boolean;
  /** Some `*.invalidateQueries(...)` call appears in the branch. */
  refetches: boolean;
  /**
   * A pure classifier: the branch is only `return '<kind>'` (or a conditional
   * over string literals) — it decides what a rejection IS, and the hook's
   * handler does the refresh. `classifyAiError` is the one in scope.
   */
  classifier: boolean;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) {
    e = e.expression;
  }
  return e;
}

/** Visit `node`'s subtree without entering nested functions. */
function forEachInScope(node: ts.Node, visit: (n: ts.Node) => void): void {
  const walk = (n: ts.Node): void => {
    visit(n);
    if (n !== node && ts.isFunctionLike(n)) return;
    ts.forEachChild(n, walk);
  };
  walk(node);
}

/** Visit `node`'s whole subtree, nested functions included. */
function forEachDeep(node: ts.Node, visit: (n: ts.Node) => void): void {
  const walk = (n: ts.Node): void => {
    visit(n);
    ts.forEachChild(n, walk);
  };
  walk(node);
}

interface Aliases {
  /** `const denied = isPermissionDeniedError(e)` → denied. */
  values: Map<string, Set<Family>>;
  /** `function isTerminal(e) { return isA(e) || isB(e); }` → isTerminal. */
  functions: Map<string, Set<Family>>;
}

/** Every rejection family an expression tests for (predicates and aliases). */
function familiesIn(expr: ts.Node, aliases: Aliases): Set<Family> {
  const out = new Set<Family>();
  forEachInScope(expr, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      for (const f of PREDICATE_FAMILIES[name] ?? aliases.functions.get(name) ?? []) out.add(f);
    } else if (ts.isIdentifier(n) && aliases.values.has(n.text)) {
      // Only a READ of the alias, not its own declaration name.
      const parent = n.parent;
      if (!(ts.isVariableDeclaration(parent) && parent.name === n)) {
        for (const f of aliases.values.get(n.text)!) out.add(f);
      }
    }
  });
  return out;
}

function resolveAliases(sf: ts.SourceFile): Aliases {
  const aliases: Aliases = { values: new Map(), functions: new Map() };
  // Fixpoint, so an alias of an alias resolves regardless of source order.
  for (let changed = true; changed; ) {
    changed = false;
    const record = (map: Map<string, Set<Family>>, name: string, fams: Set<Family>): void => {
      const prev = map.get(name);
      if (fams.size === 0 || (prev && [...fams].every((f) => prev.has(f)))) return;
      map.set(name, new Set([...(prev ?? []), ...fams]));
      changed = true;
    };
    forEachDeep(sf, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const init = unwrap(n.initializer);
        if (ts.isArrowFunction(init) && !ts.isBlock(init.body)) {
          record(aliases.functions, n.name.text, familiesIn(init.body, aliases));
        } else if (!ts.isFunctionLike(init)) {
          record(aliases.values, n.name.text, familiesIn(init, aliases));
        }
      } else if (ts.isFunctionDeclaration(n) && n.name && n.body) {
        const [only] = n.body.statements;
        if (n.body.statements.length === 1 && ts.isReturnStatement(only) && only.expression) {
          record(aliases.functions, n.name.text, familiesIn(only.expression, aliases));
        }
      }
    });
  }
  return aliases;
}

function isExit(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  if (ts.isBlock(stmt)) {
    const last = stmt.statements[stmt.statements.length - 1];
    return last !== undefined && isExit(last);
  }
  return false;
}

function isStringKind(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true;
  return ts.isConditionalExpression(e) && isStringKind(e.whenTrue) && isStringKind(e.whenFalse);
}

function isClassifierReturn(stmts: readonly ts.Statement[]): boolean {
  const inner = stmts.length === 1 && ts.isBlock(stmts[0]!) ? stmts[0]!.statements : stmts;
  const [only] = inner;
  return (
    inner.length === 1 &&
    ts.isReturnStatement(only!) &&
    only.expression !== undefined &&
    isStringKind(only.expression)
  );
}

function enclosingFunctionName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      ts.isVariableDeclaration(n.parent) &&
      ts.isIdentifier(n.parent.name)
    ) {
      return n.parent.name.text;
    }
  }
  return '<module>';
}

/**
 * Every `if` / `else if` whose condition tests for an access rejection —
 * directly or through a local alias — with the statements that run ON the
 * rejection: the `then` branch; for `if (!isX(e))`, the `else` branch, or the
 * rest of the block after an early exit.
 */
export function rejectionBranches(fileName: string, source: string): RejectionBranch[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const aliases = resolveAliases(sf);
  const out: RejectionBranch[] = [];

  forEachDeep(sf, (node) => {
    if (!ts.isIfStatement(node)) return;
    const families = familiesIn(node.expression, aliases);
    if (families.size === 0) return;

    const cond = unwrap(node.expression);
    const negated = ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken;
    let onRejection: readonly ts.Statement[];
    if (!negated) {
      onRejection = [node.thenStatement];
    } else if (node.elseStatement) {
      onRejection = [node.elseStatement];
    } else if (isExit(node.thenStatement) && ts.isBlock(node.parent)) {
      const siblings = node.parent.statements;
      onRejection = siblings.slice(siblings.indexOf(node) + 1);
    } else {
      return;
    }

    let callsHelper = false;
    let namesCircleKey = false;
    let refetches = false;
    for (const stmt of onRejection) {
      // The helper has to EXECUTE in the branch: a call deferred into a nested
      // callback is not the branch refreshing anything.
      forEachInScope(stmt, (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === HELPER) {
          callsHelper = true;
        }
      });
      forEachDeep(stmt, (n) => {
        if (
          ts.isPropertyAccessExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === 'queryKeys' &&
          CIRCLE_QUERY_KEYS.has(n.name.text)
        ) {
          namesCircleKey = true;
        }
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'invalidateQueries'
        ) {
          refetches = true;
        }
      });
    }

    out.push({
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      fn: enclosingFunctionName(node),
      families,
      callsHelper,
      namesCircleKey,
      refetches,
      classifier: isClassifierReturn(onRejection),
    });
  });
  return out;
}

interface HookVerdict {
  /** Rule-3 branches (classifiers and exemptions removed). */
  checked: number;
  missing: string[];
  /** Families with at least one branch that reaches the helper. */
  covered: Family[];
}

function verdictFor(name: string, source: string): HookVerdict {
  const branches = rejectionBranches(name, source)
    .filter((b) => !b.classifier)
    .filter((b) => !(`${name}#${b.fn}` in NO_CIRCLE_TO_REFRESH));
  const covered = new Set<Family>();
  for (const b of branches) if (b.callsHelper) for (const f of b.families) covered.add(f);
  return {
    checked: branches.length,
    missing: branches
      .filter((b) => !b.callsHelper)
      .map(
        (b) =>
          `hooks/${name}:${b.line} (${b.fn}) — this access-rejection branch never calls ` +
          `${HELPER}, so the gate it proves stale stays stale.`
      ),
    covered: BOTH.filter((f) => covered.has(f)),
  };
}

function hookFiles(): string[] {
  return readdirSync(HOOKS_DIR)
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    .map((name) => join(HOOKS_DIR, name))
    .filter((p) => statSync(p).isFile());
}

// ── the scanner itself ──────────────────────────────────────────────────────
// Each fixture is an edit that PASSED the regex version of this file.

describe('the scanner itself (fixtures that beat the old regex)', () => {
  const HANDLER = (body: string) => `
    import { invalidateCircleAccessFlags } from '@/lib/circleAccessFlags';
    import { isPermissionDeniedError, isSubscriptionRequiredError, isAccessDeniedError } from '@/lib/apiErrors';
    export function useThing(circleId: string) {
      const queryClient = useQueryClient();
      return (error: unknown) => {
        ${body}
      };
    }`;

  it('the real shape passes', () => {
    const v = verdictFor(
      'fixture.ts',
      HANDLER(`
        if (isSubscriptionRequiredError(error)) {
          invalidateCircleAccessFlags(queryClient, circleId);
        } else if (isPermissionDeniedError(error)) {
          invalidateCircleAccessFlags(queryClient, circleId);
        }`)
    );
    expect(v).toEqual({ checked: 2, missing: [], covered: ['402', '403'] });
  });

  it('resolves a const alias of the predicate — and fails when its call is gone', () => {
    const v = verdictFor(
      'fixture.ts',
      HANDLER(`
        const denied = isPermissionDeniedError(error);
        if (denied) {
          showToast('no');
        }`)
    );
    expect(v.checked).toBe(1);
    expect(v.missing).toHaveLength(1);
  });

  it('resolves an alias of an alias, and a single-return helper function', () => {
    const src = `
      import { isAccessDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
      function isTerminal(e: unknown) { return isAccessDeniedError(e) || isSubscriptionRequiredError(e); }
      export function useThing() {
        return (error: unknown) => {
          const refused = isTerminal(error);
          const alsoRefused = refused;
          if (alsoRefused) { doNothing(); }
        };
      }`;
    const [branch] = rejectionBranches('fixture.ts', src);
    expect(branch && [...branch.families].sort()).toEqual(['402', '403']);
    expect(branch?.callsHelper).toBe(false);
  });

  it('a helper call that exists only in a comment does not count', () => {
    const v = verdictFor(
      'fixture.ts',
      HANDLER(`
        if (isPermissionDeniedError(error)) {
          // invalidateCircleAccessFlags(queryClient, circleId);
          /* invalidateCircleAccessFlags(queryClient, circleId); */
          showToast('no');
        }`)
    );
    expect(v.missing).toHaveLength(1);
  });

  it('a string mentioning the helper does not count either', () => {
    const v = verdictFor(
      'fixture.ts',
      HANDLER(`
        if (isPermissionDeniedError(error)) {
          log('invalidateCircleAccessFlags(queryClient, circleId)');
        }`)
    );
    expect(v.missing).toHaveLength(1);
  });

  it('narrowing an access refresh to the 402 alone leaves the 403 family uncovered', () => {
    const v = verdictFor(
      'fixture.ts',
      `
      import { isAccessDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';
      export function classify(err: unknown) {
        if (isAccessDeniedError(err)) return isFrozen(err) ? 'circleReadOnly' : 'viewOnly';
        if (isSubscriptionRequiredError(err)) return 'subscriptionRequired';
        return 'sendFailed';
      }
      export function useChat(circleId: string) {
        return (err: unknown) => {
          if (isSubscriptionRequiredError(err)) {
            invalidateCircleAccessFlags(queryClient, circleId);
          }
        };
      }`
    );
    // The classifier branches are exempt, so they cannot cover the 403 family.
    expect(v.missing).toEqual([]);
    expect(v.covered).toEqual(['402']);
  });

  it('a negated predicate refreshes on the else branch, or after the early return', () => {
    const elseShape = rejectionBranches(
      'fixture.ts',
      HANDLER(`
        if (!isPermissionDeniedError(error)) { showToast('x'); } else { invalidateCircleAccessFlags(queryClient, circleId); }`)
    );
    const earlyReturn = rejectionBranches(
      'fixture.ts',
      HANDLER(`
        if (!isPermissionDeniedError(error)) return;
        invalidateCircleAccessFlags(queryClient, circleId);`)
    );
    expect(elseShape.map((b) => b.callsHelper)).toEqual([true]);
    expect(earlyReturn.map((b) => b.callsHelper)).toEqual([true]);
  });

  it('a call deferred into a nested callback is not the branch refreshing', () => {
    const v = verdictFor(
      'fixture.ts',
      HANDLER(`
        if (isPermissionDeniedError(error)) {
          const later = () => invalidateCircleAccessFlags(queryClient, circleId);
        }`)
    );
    expect(v.missing).toHaveLength(1);
  });

  it('flags a branch that names a circle key directly', () => {
    const [branch] = rejectionBranches(
      'fixture.ts',
      HANDLER(`
        if (isPermissionDeniedError(error)) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
        }`)
    );
    expect(branch).toMatchObject({ namesCircleKey: true, refetches: true, callsHelper: false });
  });
});

// ── the real hooks ──────────────────────────────────────────────────────────

describe('circle access-flag refresh (view-only drift guard)', () => {
  const files = hookFiles();

  it('actually scans the hooks it claims to', () => {
    // A guard that silently matches nothing is worse than no guard.
    const withBranches = files.filter(
      (f) => rejectionBranches(f, readFileSync(f, 'utf8')).length > 0
    );
    expect(withBranches.length).toBeGreaterThanOrEqual(MUST_REFRESH_ACCESS_FLAGS.length);
  });

  it.each(files)('%s: no rejection branch names a circle query key directly', (file) => {
    const offenders = rejectionBranches(file, readFileSync(file, 'utf8'))
      .filter((b) => b.namesCircleKey)
      .map(
        ({ line }) =>
          `${relative(SRC, file)}:${line} — an access-rejection branch names a circle query key ` +
          `directly. Call ${HELPER}(queryClient, circleId): refreshing ['circles'] without ` +
          `['circle', circleId] leaves useCircle().canEdit stale, so the UI keeps offering ` +
          `writes the server has already refused.`
      );
    expect(offenders).toEqual([]);
  });

  it.each(files)('%s: a rejection branch that refetches also refreshes the gate', (file) => {
    const offenders = rejectionBranches(file, readFileSync(file, 'utf8'))
      .filter((b) => b.refetches && !b.callsHelper)
      .map(
        ({ line }) =>
          `${relative(SRC, file)}:${line} — this rejection branch refetches data but never calls ` +
          `${HELPER}, so the screen repopulates with the stale edit gate still in place.`
      );
    expect(offenders).toEqual([]);
  });

  // PER BRANCH, NOT PER FILE, AND PER FAMILY. A per-file presence check let a
  // hook with a 402 branch and a 403 branch stay green with the call deleted
  // from either one; a per-branch check without families let `useAiChat` narrow
  // its refresh to the 402 alone.
  it.each(MUST_REFRESH_ACCESS_FLAGS)(
    'hooks/%s routes every access-rejection branch through the shared helper, for 402 AND 403',
    (name) => {
      const file = join(HOOKS_DIR, name);
      expect(existsSync(file)).toBe(true);
      const verdict = verdictFor(name, readFileSync(file, 'utf8'));

      // Anti-vacuity: a hook named in MUST_REFRESH_ACCESS_FLAGS with no
      // rejection branch left to check is a guard that has stopped guarding.
      expect(verdict.checked, `hooks/${name}: no access-rejection branch found`).toBeGreaterThan(0);
      expect(verdict.missing).toEqual([]);
      expect(
        verdict.covered,
        `hooks/${name}: every circle-scoped write can be refused as a 402 (frozen / free tier) ` +
          `AND as a 403 (view-only seat) — both must reach ${HELPER}`
      ).toEqual(BOTH);
    }
  );

  it('every exemption still names a branch that exists', () => {
    for (const key of Object.keys(NO_CIRCLE_TO_REFRESH)) {
      const [name, fn] = key.split('#') as [string, string];
      const branches = rejectionBranches(name, readFileSync(join(HOOKS_DIR, name), 'utf8'));
      expect(branches.some((b) => b.fn === fn), `${key} exempts nothing`).toBe(true);
    }
  });
});
