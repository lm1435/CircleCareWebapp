import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * SOURCE-TEXT BANS, READ OFF THE TYPESCRIPT PARSER — not a test file, a helper
 * the structural tests share (`DatePicker.test.tsx`, `SegmentedControl.test.tsx`).
 *
 * THIS USED TO BE A HAND-ROLLED LEXER, and every one of its blind spots was a
 * way to put banned code in front of a ban and have it pass:
 *
 *   - it dropped a template's static text, so ``iso.split(`T`)`` reached the
 *     split ban as ``.split(``)``;
 *   - it did not know a `/` after `return` or `typeof` starts a regex, so the
 *     `\/\/` inside `/https?:\/\//` read as a line comment and hid everything
 *     after it on that line — `new Date(u).getDate()` included;
 *   - it did not model JSX text at all: `https://` in a paragraph hid the rest
 *     of the line, `/*` hid everything up to the next `*\/`, and a pair of
 *     backticks hid the `{…}` between them;
 *   - and it THREW on ordinary code — `<p>Don't</p>`, `return /'/.test(s)` —
 *     so the only way to keep a ban green on a file like that was to not ban it.
 *
 * Strings, templates, regexes, JSX and comments are the parser's problem, and
 * the parser that compiles this code is the only one guaranteed to agree with
 * it. So this parses with `typescript` (a devDependency, already used the same
 * way by `src/__tests__/bans/pickerRowHeight.test.ts`) and exposes the few AST
 * questions the bans actually ask. Comments are trivia in that tree — they are
 * never visited, so prose ABOUT a banned form is never on trial — and every
 * expression is, wherever it sits: a `${…}`, a JSX `{…}`, beside a regex.
 *
 * WHAT IT CANNOT SEE, stated so no ban overclaims: it is SYNTAX, not types or
 * data flow. It reads one file and follows no import, and a name built at run
 * time (`d[key]()`) is unreadable to it — which is why
 * {@link findDynamicMemberCalls} exists, so a ban can refuse that shape
 * outright instead of guessing.
 *
 * A file the parser reports syntax errors for THROWS rather than returning a
 * partial tree: the TS parser recovers from errors silently, and a ban run over
 * a recovered tree is a vacuous pass with a plausible face.
 */

export function readSource(relativePath: string): string {
  // `process.cwd()` rather than `import.meta.url`: vitest rewrites the latter to
  // a non-file URL, which `fileURLToPath` refuses.
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  // A `.ts` file parsed as TSX misreads `<T>value` casts as JSX; everything
  // else here (components, and the inline probes) is TSX.
  return fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
}

/** Parse a source file, or throw with the parser's own complaint. */
export function parseSource(text: string, fileName = 'probe.tsx'): ts.SourceFile {
  const { diagnostics = [] } = ts.transpileModule(text, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve },
  });
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(
      `${fileName} does not parse (${errors.length} error(s)); first: ` +
        ts.flattenDiagnosticMessageText(first.messageText, '\n')
    );
  }
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
}

function walk(root: ts.Node, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, step);
  };
  step(root);
}

/** `file:line  source text` for a node — what a failing ban prints. */
export function locate(node: ts.Node): string {
  const sf = node.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return `${sf.fileName}:${line + 1}  ${node.getText(sf)}`;
}

/** The text of a string or substitution-free template literal; otherwise null. */
export function staticText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * Every piece of static text the file spells out: each quoted string (JSX
 * attribute values included), each static run of a template, and each run of
 * JSX text. This is what a class-name scanner like Tailwind's can see; an
 * interpolated class is split across two of these and appears whole in neither.
 */
export function staticTexts(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      out.push(node.text);
    }
  });
  return out;
}

/** Peel `( … )`, `x!`, `x as T` and `x satisfies T` off an expression. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) current = current.expression;
    else if (ts.isNonNullExpression(current)) current = current.expression;
    else if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else return current;
  }
}

/**
 * The member name a node reads, however it is spelled: `a.name`, `a?.name`,
 * `a['name']`, `` a[`name`] ``. Null for anything else, including a computed
 * key the parser cannot resolve (`a[key]`).
 */
export function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return staticText(node.argumentExpression);
  return null;
}

function nameSet(names: string | readonly string[]): ReadonlySet<string> {
  return new Set(typeof names === 'string' ? [names] : names);
}

/**
 * Every READ of a member with one of these names, called or not: property
 * access, element access with a literal key, and object destructuring
 * (`const { getDate } = d`, `const { 'getDate': g } = d`). Taking a method off
 * an object without calling it on the spot is still taking it.
 */
export function findMemberReferences(
  sf: ts.SourceFile,
  names: string | readonly string[]
): ts.Node[] {
  const wanted = nameSet(names);
  const out: ts.Node[] = [];
  walk(sf, (node) => {
    const name = memberName(node);
    if (name !== null && wanted.has(name)) {
      out.push(node);
      return;
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      const keyText =
        ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)
          ? key.text
          : null;
      if (keyText !== null && wanted.has(keyText)) out.push(node);
    }
  });
  return out;
}

/**
 * Calls to a function or method of one of these names: `name()`, `a.name()`,
 * `a?.name()`, `a['name']()`, `(a.name)()`.
 */
export function findCalls(
  sf: ts.SourceFile,
  names: string | readonly string[]
): ts.CallExpression[] {
  const wanted = nameSet(names);
  const out: ts.CallExpression[] = [];
  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = unwrap(node.expression);
    const name = ts.isIdentifier(callee) ? callee.text : memberName(callee);
    if (name !== null && wanted.has(name)) out.push(node);
  });
  return out;
}

/** Calls through a computed key no parser can read: `a[key]()`, ``a[`get${x}`]()``. */
export function findDynamicMemberCalls(sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = unwrap(node.expression);
    if (ts.isElementAccessExpression(callee) && memberName(callee) === null) out.push(node);
  });
  return out;
}

/** `new Name(…)` where the constructor is spelled as that bare identifier. */
export function findNewExpressions(sf: ts.SourceFile, identifier: string): ts.NewExpression[] {
  const out: ts.NewExpression[] = [];
  walk(sf, (node) => {
    if (!ts.isNewExpression(node)) return;
    const callee = unwrap(node.expression);
    if (ts.isIdentifier(callee) && callee.text === identifier) out.push(node);
  });
  return out;
}

/** True when an identifier sits in a type, where it names a type and runs nothing. */
function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isExpressionWithTypeArguments(current)) {
      // `class X extends Date` is a VALUE reference; `implements` and interface
      // `extends` are types.
      const clause = current.parent;
      return !(
        ts.isHeritageClause(clause) &&
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        ts.isClassLike(clause.parent)
      );
    }
    if (ts.isTypeNode(current)) return true;
    if (ts.isExpression(current) || ts.isStatement(current)) return false;
  }
  return false;
}

/**
 * Every place this identifier is used as a VALUE — the reference an alias
 * (`const D = Date`) or a constructor call hangs off. Excludes type positions
 * (`): Date`), member names (`x.Date`), object keys, and declarations.
 */
export function findValueReferences(sf: ts.SourceFile, identifier: string): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  walk(sf, (node) => {
    if (!ts.isIdentifier(node) || node.text !== identifier) return;
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return;
    if (ts.isQualifiedName(parent) && parent.right === node) return;
    if (
      (ts.isPropertyAssignment(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isClassDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isJsxAttribute(parent)) &&
      parent.name === node
    ) {
      return;
    }
    if (ts.isBindingElement(parent) && (parent.propertyName === node || parent.name === node)) {
      return;
    }
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return;
    if (inTypePosition(node)) return;
    out.push(node);
  });
  return out;
}
