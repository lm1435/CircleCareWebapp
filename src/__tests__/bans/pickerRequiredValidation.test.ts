import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `required` DATE/TIME FIELD IS NOT ENFORCED BY THE BROWSER ANY MORE, SO THE
 * FORM AROUND IT HAD BETTER NOT BE RELYING ON THAT.
 *
 * `DateField`/`TimeField` make their `<input>` `readOnly` on a coarse pointer,
 * which is the only thing that stops WebKit summoning its own picker from the
 * focused input (`PICKER_INDICATOR_HIDDEN` provably cannot — 97px -> 97px; see
 * `e2e/coarse-pointer.spec.ts`). HTML then BARS that input from constraint
 * validation: `willValidate` is false, `checkValidity()` on the form comes back
 * true however empty the field is, and a native submit goes straight through.
 *
 * That is safe TODAY for one reason and one reason only: validation in this app
 * is `useZodForm` — validate-on-submit against a schema, with `focusFirstError`
 * placing the caret — and the single form that marks a picker field `required`
 * (`AddEventModal`: `scheduled_date`, `scheduled_time`, `endTime`) carries
 * `noValidate`, so the browser was never the enforcer on either pointer class.
 * Nothing about that is structural. A form written next year with a `required`
 * `DateField` and no `noValidate` would look correct, behave correctly on the
 * author's laptop, and silently accept an empty required field on every phone —
 * the worst shape a regression can have.
 *
 * SO THE RULE IS: if a file marks a picker field `required`, every `<form>` in
 * it declares `noValidate`, i.e. it has already committed to validating in
 * JavaScript. That is deliberately narrow. It does NOT ask forms with an
 * optional date field to change (`CreateCircleModal` and `EditCirclePage` both
 * have one and both let the browser handle their other required TEXT inputs,
 * which `readOnly` does not touch) — inventing work there would be the kind of
 * blanket rule people delete.
 *
 * A source scan, like its neighbours here, because the fact is a fact about the
 * TEXT: no rendering can tell you that a form somewhere else would have relied
 * on a browser behaviour it never reached.
 */

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return path.endsWith('.tsx') && !path.includes('__tests__') ? [path] : [];
  });
}

/**
 * Every `<DateField …/>` / `<TimeField …/>` element in `source`, as text.
 *
 * Hand-scanned rather than matched with `/<DateField[^>]*\/>/`, which does not
 * work and would fail OPEN: half the props at these call sites are arrow
 * functions (`onChange={(e) => …}`), so a `[^>]*` run stops at the first `=>`
 * and the element's `required` — which sits further down — is never seen. A
 * guard that silently matches nothing is worse than no guard, so the depth
 * count below tracks `{}` and only accepts a `/>` outside every expression.
 */
function pickerElements(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/<(?:DateField|TimeField)\b/g)) {
    let depth = 0;
    for (let i = match.index!; i < source.length; i += 1) {
      const char = source[i];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (depth === 0 && char === '/' && source[i + 1] === '>') {
        found.push(source.slice(match.index!, i + 2));
        break;
      }
    }
  }
  return found;
}

/** `required`, `required={x}` — but not `required={false}`, which is not one. */
function marksRequired(element: string): boolean {
  return /\brequired\b(?!\s*=\s*\{\s*false\s*\})/.test(element);
}

describe('a required picker field lives only in a form that validates itself', () => {
  const offenders: string[] = [];
  const enforcing: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('<DateField') && !source.includes('<TimeField')) continue;
    if (!pickerElements(source).some(marksRequired)) continue;

    const short = file.slice(SRC.length + 1);
    enforcing.push(short);
    for (const form of source.matchAll(/<form\b[^>]*>/g)) {
      if (!/\bnoValidate\b/.test(form[0])) offenders.push(`${short}: ${form[0]}`);
    }
  }

  it('finds the call sites it is supposed to be checking', () => {
    // ANTI-VACUITY, and not a formality: every assertion below is "this list is
    // empty", which is also what a scanner that stopped matching reports. If
    // `pickerElements` breaks on a JSX shape it has not seen, or the fields are
    // renamed, this is the test that says so instead of the whole file passing
    // while checking nothing. `AddEventModal` is the only such call site today.
    expect(enforcing.length, 'files marking a DateField/TimeField required').toBeGreaterThan(0);
  });

  it('never lets one sit in a form that expects the browser to enforce it', () => {
    // `readonly` inputs are exempt from constraint validation, so on a coarse
    // pointer this form would submit empty and nothing would say so.
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
