import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * NO `|| undefined` ON A FIELD AN EDIT MUST BE ABLE TO CLEAR.
 *
 * THE BUG CLASS (sweep 2026-11-08, "can't clear on edit"). An update is a
 * PARTIAL patch: an absent key means "leave the stored value alone", only `null`
 * clears. `value.trim() || undefined` turns "the user emptied the field" into
 * "no key", so the server kept the old notes / place / dose / end / time / last
 * name / date of birth and the app said "Saved". Every payload builder below was
 * moved onto `utils/editPatch` (or sends the trimmed value); this file keeps the
 * shape from coming back.
 *
 * Same rule on mobile: `mobile/src/__tests__/screens/noOrUndefinedInEditPayloads.test.ts`.
 *
 * PARSED, NOT GREPPED (see the other files in this folder): a comment that
 * mentions `|| undefined` must not trip it, and an aliased or re-wrapped
 * expression must. THE RULE, per file:
 *   (a) no `<anything>.trim() || undefined` anywhere;
 *   (b) no object-literal property named one of CLEARABLE whose value is
 *       `<anything> || undefined`;
 *   (c) no assignment `<anything>.<CLEARABLE> = <anything> || undefined`.
 */

const CLEARABLE = new Set([
  'description',
  'location',
  'medication_dosage',
  'duration_minutes',
  'scheduled_time',
  'recurrence_rule',
  'recurrence_end_date',
  'recipient_dob',
  'first_name',
  'last_name',
]);

const PAYLOAD_BUILDERS = [
  'src/components/calendar/AddEventModal.tsx',
  'src/pages/ProfilePage.tsx',
  'src/pages/EditCirclePage.tsx',
  'src/utils/recipientEventDate.ts',
];

function isOrUndefined(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
    ts.isIdentifier(unwrap(node.right)) &&
    (unwrap(node.right) as ts.Identifier).text === 'undefined'
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) {
    n = n.expression;
  }
  return n;
}

function isTrimCall(node: ts.Expression): boolean {
  const n = unwrap(node);
  return (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === 'trim'
  );
}

function propName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/** Every violation in `source`, as `line: text`. */
export function violations(source: string, fileName = 'x.tsx'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const report = (node: ts.Node, why: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    out.push(`${line}: ${why}: ${node.getText(sf)}`);
  };
  const visit = (node: ts.Node) => {
    if (isOrUndefined(node) && isTrimCall(node.left)) {
      report(node, '.trim() || undefined');
    }
    if (ts.isPropertyAssignment(node)) {
      const key = propName(node.name);
      if (key && CLEARABLE.has(key) && isOrUndefined(unwrap(node.initializer))) {
        report(node, `${key}: … || undefined`);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
    ) {
      const key = ts.isPropertyAccessExpression(node.left)
        ? node.left.name.text
        : ts.isStringLiteral(node.left.argumentExpression)
          ? node.left.argumentExpression.text
          : null;
      if (key && CLEARABLE.has(key) && isOrUndefined(unwrap(node.right))) {
        report(node, `.${key} = … || undefined`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // Each `.trim() || undefined` inside a flagged property is reported twice; keep one line each.
  return [...new Set(out)];
}

describe('the scanner itself', () => {
  it.each([
    ['a trimmed field in a payload', `const d = { description: description.trim() || undefined };`],
    ['a trimmed value anywhere', `send(name.trim() || undefined);`],
    ['parenthesized', `const d = { location: (location.trim()) || undefined };`],
    ['a non-trim clearable field', `const d = { recipient_dob: data.recipient_dob || undefined };`],
    ['a quoted key', `const d = { 'last_name': last || undefined };`],
    ['an assignment', `data.medication_dosage = dosage.trim() || undefined;`],
    ['an element assignment', `data['scheduled_time'] = time || undefined;`],
    ['inside JSX', `const el = <Form onSave={() => save({ last_name: v.trim() || undefined })} />;`],
  ])('catches %s', (_name, src) => {
    expect(violations(src)).not.toEqual([]);
  });

  it.each([
    ['a comment', `// description: description.trim() || undefined\nconst d = { description: x };`],
    ['a block comment', `/* data.location = loc.trim() || undefined */ const a = 1;`],
    ['a string', `const s = "description: description.trim() || undefined";`],
    ['a field outside the list', `const d = { pickerToday: today || undefined };`],
    ['a nullish fallback', `const d = { description: editPatch(a, b, o) ?? undefined };`],
    ['an || with another fallback', `const d = { location: loc.trim() || null };`],
  ])('ignores %s', (_name, src) => {
    expect(violations(src)).toEqual([]);
  });
});

describe('the edit payload builders', () => {
  it.each(PAYLOAD_BUILDERS)('%s never drops an emptied field with `|| undefined`', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(violations(source, file)).toEqual([]);
  });
});
