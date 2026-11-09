/**
 * GUARD — every function the API layer exports has at least one caller in the
 * APP (tests do not count).
 *
 * Why (sweep 2026-11-08): an API function nobody calls is a feature whose
 * client half silently never shipped (a backend route wired on one platform
 * only), or dead code that keeps a stale contract "tested" while nothing uses
 * it. Both look fine in review because the function and its unit test exist.
 *
 * What counts as an export: `export (async) function f`, `export const f = (..) =>`,
 * and each method of an exported object literal (`export const authApi = { signIn() {} }`).
 * A caller is any non-test file under src/ (or App.tsx / index.ts) that names it
 * — for a method, `.name` / `{ name }`; for a function, the identifier — other
 * than its own declaration.
 *
 * ALLOWED lists the known exceptions, each with a reason, and is pinned
 * EXACTLY: an entry that gains a caller must be removed (so the list cannot
 * become a stale licence).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const API_DIR = path.join(ROOT, 'src', 'api');

const ALLOWED: Record<string, string> = {
  'src/api/medicationAsNeeded.ts::isAsNeededFutureError':
    'unused predicate: the log dialog bounds the Given time up front (mobile has no twin either); a skewed-clock 400 falls to the generic save error. PROPOSED: wire or delete',
  'src/api/medicationAsNeeded.ts::isAsNeededTooOldError':
    'unused predicate, same as isAsNeededFutureError (48h window enforced in the picker). PROPOSED: wire or delete',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['__tests__', '__mocks__', 'node_modules'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface ApiExport {
  file: string;
  name: string;
  /** For object methods: the method name searched for. */
  member?: string;
}

function collectExports(file: string): ApiExport[] {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rel = path.relative(ROOT, file);
  const out: ApiExport[] = [];
  const isExported = (n: ts.Node) =>
    !!(ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export);
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && isExported(stmt)) {
      out.push({ file: rel, name: stmt.name.text });
    } else if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        let init: ts.Expression = decl.initializer;
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) {
          init = init.expression;
        }
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          out.push({ file: rel, name: decl.name.text });
        } else if (ts.isObjectLiteralExpression(init)) {
          for (const prop of init.properties) {
            const isFn =
              ts.isMethodDeclaration(prop) ||
              (ts.isPropertyAssignment(prop) &&
                (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)));
            if (isFn && prop.name && ts.isIdentifier(prop.name)) {
              out.push({ file: rel, name: `${decl.name.text}.${prop.name.text}`, member: prop.name.text });
            }
          }
        }
      }
    }
  }
  return out;
}

const apiFiles = fs
  .readdirSync(API_DIR)
  .filter((f) => /\.ts$/.test(f) && !f.endsWith('.d.ts'))
  .map((f) => path.join(API_DIR, f));
const appFiles = [
  ...walk(path.join(ROOT, 'src')),
  ...['index.html'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
];
const appTexts = appFiles.map((f) => ({ file: path.relative(ROOT, f), text: fs.readFileSync(f, 'utf8') }));

function hasCaller(e: ApiExport): boolean {
  const ident = e.member ?? e.name;
  const re = e.member
    ? new RegExp(`(\\.${ident}\\b|[{,]\\s*${ident}\\s*[,}:])`, 'g')
    : new RegExp(`\\b${ident}\\b`, 'g');
  for (const { file, text } of appTexts) {
    const hits = text.match(re)?.length ?? 0;
    // Its own file holds the declaration once (`function f` / `f:` / `f(`);
    // anything beyond that is a use.
    if (file === e.file) {
      if (e.member) {
        const uses = text.match(new RegExp(`\\.${ident}\\b`, 'g'))?.length ?? 0;
        if (uses > 0) return true;
      } else if (hits > 1) {
        return true;
      }
    } else if (hits > 0) {
      return true;
    }
  }
  return false;
}

describe('API exports have callers', () => {
  const exportsFound = apiFiles.flatMap(collectExports);
  const uncalled = exportsFound.filter((e) => !hasCaller(e)).map((e) => `${e.file}::${e.name}`).sort();

  it('finds the API layer (not vacuous)', () => {
    expect(exportsFound.length).toBeGreaterThan(100);
  });

  it('every exported API function has a non-test caller, or an ALLOWED reason', () => {
    expect(uncalled).toEqual(Object.keys(ALLOWED).sort());
  });

  it('every ALLOWED entry carries a reason', () => {
    for (const [k, why] of Object.entries(ALLOWED)) expect(`${k} ${why}`.length).toBeGreaterThan(k.length + 15);
  });
});
