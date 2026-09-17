import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * EVERY `useSubmitGuard` CLAIM MUST HAVE A RELEASE WIRED TO IT.
 *
 * `useSubmitGuard` is the manual half of the double-submit guard, for handlers
 * built on a React Query `mutate(...)` callback pair: those return immediately,
 * so there is no promise to hold the guard open. The call site claims on entry
 * and releases in `onSettled`.
 *
 * THE DRIFT THIS CATCHES. Forget the `onSettled: guard.release` half and
 * nothing fails — not a type check, not a lint rule. The component works
 * perfectly until the FIRST failed request, at which point the ref stays
 * claimed forever and that action is dead for the life of the component: the
 * user presses Save, or Delete, or Send, and absolutely nothing happens, with
 * no error and no spinner. On the note editors and the account-deletion
 * confirm this is silent and permanent until a reload.
 *
 * The hook's own release semantics are covered by
 * `src/hooks/__tests__/useGuardedSubmit.test.tsx`; the five emergency edit
 * modals have a runtime retry-after-failure test in
 * `src/components/emergency/__tests__/EditModals.test.tsx`. This file covers
 * the WIRING at every call site, including the ones with no runtime test.
 *
 * PARSED, NOT GREPPED. The regex version of this file matched the TEXT
 * `guard.release` after `onSettled:`, and four edits passed it — each is now a
 * fixture in "the scanner itself" below:
 *   - `onSettled: () => guard.release`   (a bare reference; never called)
 *   - `onSettled: guard.release()`       (called EAGERLY, at mutate time)
 *   - a release that exists only in a comment
 *   - two guards' releases swapped between their handlers
 * The uncalled arrow in `EditDoctorModal` passed the entire suite.
 *
 * THE RULE, per guard declared as `const g = useSubmitGuard()`:
 *   every `g.claim()` has, in the SAME handler function, exactly one release of
 *   `g` on the failure path, which is one of
 *     (a) `onSettled: g.release` — the function itself passed as the property;
 *     (b) `g.release()` called inside the function passed as `onSettled`;
 *     (c) `g.release()` called in BOTH the `onError` and `onSuccess` functions
 *         of one options object;
 *     (d) `g.release()` called in a `finally` block;
 *   and no other reference to `g.release` exists anywhere in the file.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// ── the scanner ─────────────────────────────────────────────────────────────

interface GuardReport {
  guard: string;
  claims: number;
  /** "line N (handler)" for each claim with no failure-path release beside it. */
  unreleasedClaims: string[];
  /** "line N: why" for each `guard.release` reference that is not a valid release. */
  strayReleases: string[];
}

function propertyName(node: ts.PropertyAssignment): string | undefined {
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
}

function nearestFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) return n;
  }
  return undefined;
}

/** The function this callback property belongs to, if `fn` is `{ name: fn }`. */
function callbackProperty(fn: ts.Node): ts.PropertyAssignment | undefined {
  const parent = fn.parent;
  return parent && ts.isPropertyAssignment(parent) && parent.initializer === fn ? parent : undefined;
}

function inFinallyBlock(node: ts.Node, boundary: ts.Node | undefined): boolean {
  for (let n = node.parent; n && n !== boundary; n = n.parent) {
    if (ts.isBlock(n) && ts.isTryStatement(n.parent) && n.parent.finallyBlock === n) return true;
  }
  return false;
}

export function analyzeGuards(fileName: string, source: string): GuardReport[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const guards: string[] = [];
  const walk = (n: ts.Node, visit: (n: ts.Node) => void): void => {
    visit(n);
    ts.forEachChild(n, (c) => walk(c, visit));
  };
  walk(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      ts.isIdentifier(n.initializer.expression) &&
      n.initializer.expression.text === 'useSubmitGuard'
    ) {
      guards.push(n.name.text);
    }
  });

  return guards.map((guard) => {
    const claimHandlers: ts.Node[] = [];
    const claimLines: number[] = [];
    const releaseRefs: ts.PropertyAccessExpression[] = [];

    walk(sf, (n) => {
      if (
        !ts.isPropertyAccessExpression(n) ||
        !ts.isIdentifier(n.expression) ||
        n.expression.text !== guard
      ) {
        return;
      }
      if (n.name.text === 'claim' && ts.isCallExpression(n.parent) && n.parent.expression === n) {
        claimHandlers.push(nearestFunction(n.parent) ?? sf);
        claimLines.push(line(n));
      } else if (n.name.text === 'release') {
        releaseRefs.push(n);
      }
    });

    /** Valid failure-path releases, keyed by the handler they sit in. */
    const releasesByHandler = new Map<ts.Node, number>();
    const credit = (handler: ts.Node | undefined): void => {
      const key = handler ?? sf;
      releasesByHandler.set(key, (releasesByHandler.get(key) ?? 0) + 1);
    };
    const strayReleases: string[] = [];
    /** `onError`/`onSuccess` releases, grouped by their options object. */
    const pairHalves = new Map<ts.Node, { onError: number[]; onSuccess: number[] }>();

    for (const ref of releaseRefs) {
      const parent = ref.parent;

      // (a) `onSettled: guard.release` — the function itself is the callback.
      if (ts.isPropertyAssignment(parent) && parent.initializer === ref) {
        const name = propertyName(parent);
        if (name === 'onSettled') {
          credit(nearestFunction(parent));
        } else if (name === 'onError' || name === 'onSuccess') {
          const halves = pairHalves.get(parent.parent) ?? { onError: [], onSuccess: [] };
          halves[name].push(line(ref));
          pairHalves.set(parent.parent, halves);
        } else {
          strayReleases.push(`line ${line(ref)}: passed as \`${name}\`, which does not run on failure`);
        }
        continue;
      }

      const called = ts.isCallExpression(parent) && parent.expression === ref;
      if (!called) {
        strayReleases.push(
          `line ${line(ref)}: \`${guard}.release\` is referenced but never called here ` +
            `(e.g. \`() => ${guard}.release\`) — the guard stays claimed`
        );
        continue;
      }

      const fn = nearestFunction(parent);
      const prop = fn ? callbackProperty(fn) : undefined;
      const propName = prop ? propertyName(prop) : undefined;

      // (b) `onSettled: () => guard.release()`.
      if (prop && propName === 'onSettled') {
        credit(nearestFunction(prop));
        continue;
      }
      // (c) half of an `onError` + `onSuccess` pair.
      if (prop && (propName === 'onError' || propName === 'onSuccess')) {
        const halves = pairHalves.get(prop.parent) ?? { onError: [], onSuccess: [] };
        halves[propName].push(line(ref));
        pairHalves.set(prop.parent, halves);
        continue;
      }
      // (d) `finally { guard.release() }`, with no function boundary between.
      if (inFinallyBlock(parent, fn)) {
        credit(fn);
        continue;
      }
      strayReleases.push(
        `line ${line(ref)}: \`${guard}.release()\` runs ${
          prop ? `in \`${propName}\`` : 'eagerly, at the call site (not in a callback)'
        } — not on the failure path`
      );
    }

    for (const [options, halves] of pairHalves) {
      if (halves.onError.length === 1 && halves.onSuccess.length === 1) {
        credit(nearestFunction(options));
      } else {
        for (const l of [...halves.onError, ...halves.onSuccess]) {
          strayReleases.push(
            `line ${l}: released in only one of onError/onSuccess — the other outcome jams the guard`
          );
        }
      }
    }

    const unreleasedClaims: string[] = [];
    claimHandlers.forEach((handler, i) => {
      const available = releasesByHandler.get(handler) ?? 0;
      if (available > 0) {
        releasesByHandler.set(handler, available - 1);
      } else {
        unreleasedClaims.push(`line ${claimLines[i]}: claimed with no failure-path release in the same handler`);
      }
    });
    // Releases left over belong to a handler that never claimed THIS guard —
    // the swapped-guards shape.
    for (const [handler, extra] of releasesByHandler) {
      for (let k = 0; k < extra; k += 1) {
        strayReleases.push(
          `line ${line(handler)}: releases \`${guard}\` in a handler that never claimed it`
        );
      }
    }

    return { guard, claims: claimHandlers.length, unreleasedClaims, strayReleases };
  });
}

// ── the scanner itself ──────────────────────────────────────────────────────

describe('the scanner itself (fixtures that beat the old regex)', () => {
  const component = (handlers: string) => `
    export function Thing() {
      const saveGuard = useSubmitGuard();
      const deleteGuard = useSubmitGuard();
      ${handlers}
      return null;
    }`;
  const clean = (r: GuardReport[]) =>
    r.map(({ guard, unreleasedClaims, strayReleases }) => ({ guard, unreleasedClaims, strayReleases }));
  const OK = (guard: string) => ({ guard, unreleasedClaims: [], strayReleases: [] });

  it('accepts the four valid shapes', () => {
    const shapes = [
      `const onSave = () => { if (!saveGuard.claim()) return; save.mutate(x, { onSettled: saveGuard.release }); };`,
      `const onSave = () => { if (!saveGuard.claim()) return; save.mutate(x, { onSettled: () => saveGuard.release() }); };`,
      `const onSave = () => { if (!saveGuard.claim()) return; save.mutate(x, { onError: () => { saveGuard.release(); }, onSuccess: () => saveGuard.release() }); };`,
      `const onSave = async () => { if (!saveGuard.claim()) return; try { await save(); } finally { saveGuard.release(); } };`,
    ];
    for (const shape of shapes) {
      expect(clean(analyzeGuards('f.tsx', component(shape)))).toEqual([OK('saveGuard'), OK('deleteGuard')]);
    }
  });

  it('rejects `onSettled: () => guard.release` — referenced, never called', () => {
    const [save] = analyzeGuards(
      'f.tsx',
      component(`const onSave = () => { if (!saveGuard.claim()) return; save.mutate(x, { onSettled: () => saveGuard.release }); };`)
    );
    expect(save?.unreleasedClaims).toHaveLength(1);
    expect(save?.strayReleases).toHaveLength(1);
  });

  it('rejects `onSettled: guard.release()` — released eagerly at mutate time', () => {
    const [save] = analyzeGuards(
      'f.tsx',
      component(`const onSave = () => { if (!saveGuard.claim()) return; save.mutate(x, { onSettled: saveGuard.release() }); };`)
    );
    expect(save?.unreleasedClaims).toHaveLength(1);
    expect(save?.strayReleases).toHaveLength(1);
  });

  it('rejects a release that exists only in a comment', () => {
    const [save] = analyzeGuards(
      'f.tsx',
      component(`const onSave = () => {
        if (!saveGuard.claim()) return;
        save.mutate(x, {
          // onSettled: saveGuard.release,
          onSuccess: close,
        });
      };`)
    );
    expect(save?.unreleasedClaims).toHaveLength(1);
  });

  it('rejects two guards whose releases are swapped between handlers', () => {
    const [save, del] = analyzeGuards(
      'f.tsx',
      component(`
        const onSave = () => { if (!saveGuard.claim()) return; save.mutate(x, { onSettled: deleteGuard.release }); };
        const onDelete = () => { if (!deleteGuard.claim()) return; del.mutate(x, { onSettled: saveGuard.release }); };`)
    );
    expect(save?.unreleasedClaims).toHaveLength(1);
    expect(del?.unreleasedClaims).toHaveLength(1);
  });

  it('rejects a release in onSuccess only, and in onError only', () => {
    for (const prop of ['onSuccess', 'onError']) {
      const [save] = analyzeGuards(
        'f.tsx',
        component(`const onSave = () => { if (!saveGuard.claim()) return; save.mutate(x, { ${prop}: () => saveGuard.release() }); };`)
      );
      expect(save?.unreleasedClaims).toHaveLength(1);
    }
  });

  it('rejects a finally release deferred into a nested callback', () => {
    const [save] = analyzeGuards(
      'f.tsx',
      component(`const onSave = async () => { if (!saveGuard.claim()) return; try { await save(); } finally { setTimeout(() => saveGuard.release(), 300); } };`)
    );
    expect(save?.unreleasedClaims).toHaveLength(1);
  });
});

// ── the real call sites ─────────────────────────────────────────────────────

describe('useSubmitGuard: every claim is paired with a release', () => {
  const files = sourceFiles(SRC)
    .filter((file) => !file.endsWith(join('hooks', 'useGuardedSubmit.ts')))
    .map((file) => [file.slice(SRC.length + 1), file, analyzeGuards(file, readFileSync(file, 'utf8'))] as const)
    .filter(([, , reports]) => reports.length > 0);

  it('finds the call sites at all (so a rename cannot silently empty this suite)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    // …and the claims in them: a scanner that stopped seeing `.claim()` would
    // pass every per-file check below with zero claims.
    const claims = files.reduce((n, [, , reports]) => n + reports.reduce((m, r) => m + r.claims, 0), 0);
    expect(claims).toBeGreaterThanOrEqual(files.length);
  });

  it.each(files)('%s', (_label, _file, reports) => {
    for (const report of reports) {
      // A guard declared and never claimed is dead code rather than a hazard,
      // so it may have no release — but any release it has must be valid.
      expect(report).toEqual({
        guard: report.guard,
        claims: report.claims,
        unreleasedClaims: [],
        strayReleases: [],
      });
    }
  });
});
