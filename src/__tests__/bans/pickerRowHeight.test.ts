import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * THE PICKER ROW HEIGHT IS WRITTEN DOWN IN EIGHT PLACES. THEY MUST AGREE.
 *
 * `TimePickerPanel.tsx` declares `const ROW_HEIGHT = 36` and, a hundred lines
 * below, hands Tailwind the literal `min-h-[36px]` — because Tailwind's scanner
 * reads class STRINGS out of source text and can never see an interpolated
 * `min-h-[${ROW_HEIGHT}px]`. The file's own comment says "change one and change
 * the other"; until this test existed, nothing made that true.
 *
 * THERE ARE NOW TWO ROW HEIGHTS, AND SO TWO OF EVERY COPY. The popover stopped
 * being a fine-pointer-only control (see `pickerPopover`'s header for the three
 * defects that had to be answered first), so a row is 36 under a mouse and
 * `TOUCH_ROW_HEIGHT = 44` under a finger — the house standard, and WCAG 2.5.5
 * AAA. Each size carries its own hand-copied class in `ROW_MIN_H` and its own
 * seven-row ceiling (`MAX_PANEL_HEIGHT` / `SHEET_MAX_PANEL_HEIGHT`), so the
 * drift this file was written for is now available in two flavours plus a new
 * one: the two pairs getting CROSSED, i.e. the touch constant paired with the
 * fine class. The checks below are per-pair and exhaustive over the set of
 * classes in the file, which is what makes a crossed pair a failure rather than
 * two numbers that both still appear somewhere.
 *
 * WHY NOTHING ELSE CATCHES IT. The two halves feed completely disjoint
 * machinery, which is exactly why the drift is silent:
 *
 *   - The CONSTANT's only consumer is `MIN_USABLE_PANEL` — the floor the
 *     popover refuses to squeeze a panel below. Lower `ROW_HEIGHT` to 20 and
 *     that floor quietly drops 72 → 56, i.e. the panel will now agree to clamp
 *     itself to a height that cannot show one whole row. No unit test sees it:
 *     `pickerPopover.test.tsx` passes `minHeight` explicitly in every placement
 *     case and never reads the panel's own default.
 *   - The CLASS is the only thing that produces rendered pixels. So the one
 *     spec that measures real geometry — `e2e/picker-geometry.spec.ts`, whose
 *     WCAG 2.5.8 case pins the rendered row at 36 — is blind to the constant
 *     in the other direction: edit `min-h-[36px]` alone and it fails, edit
 *     `ROW_HEIGHT` alone and it passes.
 *
 * So the whole vitest suite AND the whole Playwright suite stay green while the
 * squeeze floor and the row it is supposed to reserve room for disagree. That
 * is the regression this file exists to make loud, and it is a source scan for
 * the same reason `disabledOpacity` and `cardShells` are: the fact being
 * asserted is a fact about the TEXT, and no amount of rendering can recover it.
 *
 * The other three copies are restatements in test files — `pickerPopover.test`
 * builds every stubbed measurement out of its own `ROW`, and the e2e spec pins
 * `DESIGNED_ROW_PX`. A restatement that drifts does not break; it just starts
 * asserting the old design against the new one, which is worse than not
 * asserting at all. `MAX_PANEL_HEIGHT` is the fifth: a bare `288` that is
 * seven rows plus the panel chrome and stops being seven rows the moment a row
 * changes size.
 */

const SRC = join(__dirname, '..', '..');
const WEBAPP = join(SRC, '..');

const PANEL = join(SRC, 'components', 'ui', 'TimePickerPanel.tsx');
const POPOVER = join(SRC, 'components', 'ui', 'pickerPopover.tsx');
const POPOVER_TEST = join(SRC, 'components', 'ui', '__tests__', 'pickerPopover.test.tsx');
const GEOMETRY_SPEC = join(WEBAPP, 'e2e', 'picker-geometry.spec.ts');

/**
 * The one number `pattern` captures out of `file` — however many times it says
 * it. Every occurrence must agree, which is load-bearing rather than tidy:
 * `min-h-[36px]` appears TWICE in `TimePickerPanel.tsx`, once as the class the
 * browser reads and once inside the very comment that tells the next reader to
 * keep it in step with `ROW_HEIGHT`. A comment that still says 36 over a class
 * that says 20 is the instruction actively lying, so it is checked, not
 * skipped.
 *
 * ANTI-VACUITY, and the whole reason this is a function rather than five inline
 * `.match()` calls. A regex that stops matching — someone reformats the
 * declaration across two lines, renames the constant, swaps the `px` unit —
 * hands back `undefined`, and every comparison below would then read
 * `undefined === undefined` and PASS while describing nothing at all. Requiring
 * at least one match turns that into a named, loud failure here, instead of a
 * guard that has quietly stopped guarding.
 */
function numberIn(text: string, pattern: RegExp, where: string): number {
  const found = [...text.matchAll(pattern)].map((m) => m[1]!);
  expect(found, `${where}: pattern matched nothing, so this guard is asserting nothing`)
    .not.toHaveLength(0);
  expect([...new Set(found)], `${where}: occurrences disagree`).toHaveLength(1);
  return Number(found[0]);
}

function statedNumber(file: string, pattern: RegExp, what: string): number {
  return numberIn(readFileSync(file, 'utf8'), pattern, `${what} — ${file.slice(WEBAPP.length + 1)}`);
}

/**
 * ONE of `pickerPopover`'s two `box` class strings — the whole reason the
 * padding below is read from a SCOPED slice of the file rather than from the
 * file at large.
 *
 * `p-` is not a rare string in a module that documents `Modal`'s `p-6` and its
 * own history with `p-1` in four comments, and a whole-file scan for it reports
 * "occurrences disagree" against prose. Worse, the two boxes are now MEANT to
 * disagree — that is the change this guard is tracking — so a scan that could
 * not tell them apart could not state either arithmetic.
 *
 * Anti-vacuity is `toHaveLength(1)` and not `not.toHaveLength(0)`: two matches
 * would mean the marker stopped identifying one box, and silently reading the
 * WRONG box's padding is precisely the failure mode this whole file exists for.
 * `bg-cream` is the surface both boxes paint and nothing else in the module
 * does; the markers are what separates them.
 */
function boxClasses(marker: string, what: string): string {
  const lines = readFileSync(POPOVER, 'utf8')
    .split('\n')
    .filter((line) => line.includes('bg-cream') && line.includes(marker));
  expect(lines, `${what}: expected exactly one box class string containing "${marker}"`)
    .toHaveLength(1);
  return lines[0]!;
}

/** Tailwind's spacing scale: `p-1` is 0.25rem is 4px, at the 16px root. */
const SPACING_PX = 4;
const REM_PX = 16;

/**
 * `const ROW_HEIGHT = 36;` — the constant `minUsablePanel` is built from.
 *
 * The negative lookbehind is load-bearing now that `TOUCH_ROW_HEIGHT` exists:
 * without it this pattern matches BOTH declarations, `statedNumber` reports
 * "occurrences disagree", and the failure names the wrong thing entirely.
 */
const ROW_HEIGHT_DECL = /(?<!TOUCH_)\bROW_HEIGHT\s*=\s*(\d+)\s*;/g;
/** `const TOUCH_ROW_HEIGHT = 44;` — its twin, for the sheet presentation. */
const TOUCH_ROW_HEIGHT_DECL = /\bTOUCH_ROW_HEIGHT\s*=\s*(\d+)\s*;/g;
/** `min-h-[36px]` / `min-h-[44px]` — the classes, the only half that paints. */
const MIN_H_CLASS = /\bmin-h-\[(\d+)px\]/g;

/** Every distinct number `pattern` captures out of `text`, as strings. */
function numberSet(text: string, pattern: RegExp): Set<string> {
  return new Set([...text.matchAll(pattern)].map((m) => m[1]!));
}

/** Every distinct number `pattern` captures out of `file`, comments included. */
function statedSet(file: string, pattern: RegExp): Set<string> {
  return numberSet(readFileSync(file, 'utf8'), pattern);
}

/**
 * Only the text the file hands to the RUNTIME — string literals, template
 * chunks and JSX text — with every comment dropped.
 *
 * A raw-text scan could not tell the class that paints from the comment that
 * describes it: `TimePickerPanel.tsx` spells `min-h-[36px]` / `min-h-[44px]`
 * out in a comment beside `ROW_MIN_H`, so setting `ROW_MIN_H.touch` to
 * `min-h-[36px]` left the file's class set at {36, 44} and this guard green
 * while every sheet row rendered at 36. Parsed with the TypeScript compiler
 * rather than a comment-stripping regex, which would trip on `//` inside a
 * string.
 */
function runtimeStrings(file: string): string {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
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
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out.join('\n');
}

describe('picker row height: the constant and its hand-copied twins agree', () => {
  it('TimePickerPanel states both row heights as constants and as Tailwind classes', () => {
    const fine = statedNumber(PANEL, ROW_HEIGHT_DECL, 'ROW_HEIGHT declaration');
    const touch = statedNumber(PANEL, TOUCH_ROW_HEIGHT_DECL, 'TOUCH_ROW_HEIGHT declaration');
    // CODE ONLY. See `runtimeStrings`: a comment is not a class.
    const rendered = numberSet(runtimeStrings(PANEL), MIN_H_CLASS);

    // EXHAUSTIVE, not "contains": `{36, 44}` is what the file's runtime
    // strings must contain — no third size without a constant behind it, and
    // neither of the two surviving only in a comment.
    //
    // The failure this names: `minUsablePanel` reserves room for a row of
    // `fine`/`touch` px while the browser draws one of some other size. Lower a
    // constant and the popover will clamp to a panel too short for its own row;
    // raise it and the panel refuses heights it could have used.
    expect(rendered).toEqual(new Set([String(fine), String(touch)]));
    // THE PAIRING. Set equality alone cannot see the CROSSED pair — `fine`
    // holding the 44 class and `touch` the 36 still paints {36, 44} — so each
    // key of `ROW_MIN_H` is read against its own constant.
    const rowMinH = readFileSync(PANEL, 'utf8').match(
      /\bROW_MIN_H\s*=\s*\{\s*fine:\s*'min-h-\[(\d+)px\]',\s*touch:\s*'min-h-\[(\d+)px\]'\s*,?\s*\}/
    );
    expect(rowMinH, 'ROW_MIN_H declaration not found, so the pairing is unchecked').not.toBeNull();
    expect({ fine: Number(rowMinH![1]), touch: Number(rowMinH![2]) }).toEqual({ fine, touch });
    // And the prose may not lie: a class named in a comment has to be one the
    // code actually paints.
    expect(statedSet(PANEL, MIN_H_CLASS)).toEqual(rendered);
    // …and the two really are two. A refactor that set both constants to the
    // same number would satisfy the set check with one element and quietly
    // delete the touch target this pair exists to guarantee.
    expect(touch).toBeGreaterThan(fine);
    // WCAG 2.5.5 Target Size (Enhanced), AAA — the reason the touch number is
    // 44 and not "a bit more than 36".
    expect(touch).toBeGreaterThanOrEqual(44);
  });

  it('every test-side restatement of the row height still matches the panel', () => {
    const constant = statedNumber(PANEL, ROW_HEIGHT_DECL, 'ROW_HEIGHT declaration');
    // Both of these are stated as "`TimePickerPanel`'s `ROW_HEIGHT`, restated"
    // in their own files. A restatement that drifts keeps passing — it simply
    // measures the widget against a design that is no longer shipped, which is
    // how a stub ends up returning the answer the code was supposed to compute.
    const restated = {
      // `pickerPopover.test.tsx` stubs jsdom's missing layout out of this.
      'pickerPopover.test.tsx ROW': statedNumber(
        POPOVER_TEST,
        /\bconst ROW = (\d+)\s*;/g,
        'const ROW'
      ),
      // The e2e spec pins it so the WCAG floor alone cannot carry the check:
      // `text-md` at 1.5 leading is ~23.7px, so a row with its `min-h` deleted
      // outright still clears 24 by a rounding margin.
      'picker-geometry.spec.ts DESIGNED_ROW_PX': statedNumber(
        GEOMETRY_SPEC,
        /(?<!TOUCH_)\bDESIGNED_ROW_PX = (\d+)\s*;/g,
        'DESIGNED_ROW_PX'
      ),
    };
    expect(Object.values(restated).every((n) => n === constant), JSON.stringify(restated)).toBe(
      true
    );
  });

  it('the touch row height is restated correctly in the sheet geometry spec', () => {
    const constant = statedNumber(PANEL, TOUCH_ROW_HEIGHT_DECL, 'TOUCH_ROW_HEIGHT declaration');
    // Same argument as its 36px sibling, and STRONGER: 44 clears the 24px WCAG
    // floor by nearly double, so a sheet row that silently reverted to the
    // desktop size would still satisfy `MIN_TARGET_PX` and hand touch users
    // back the target this whole change exists to enlarge. Only a restatement
    // of the DESIGNED number can fail on that.
    const restated = statedNumber(
      GEOMETRY_SPEC,
      /\bDESIGNED_TOUCH_ROW_PX = (\d+)\s*;/g,
      'DESIGNED_TOUCH_ROW_PX'
    );
    expect(restated).toBe(constant);
  });

  it('both ceilings are still exactly seven rows plus their OWN panel chrome', () => {
    const rowHeight = statedNumber(PANEL, ROW_HEIGHT_DECL, 'ROW_HEIGHT declaration');
    const touchRowHeight = statedNumber(
      PANEL,
      TOUCH_ROW_HEIGHT_DECL,
      'TOUCH_ROW_HEIGHT declaration'
    );
    const maxPanelHeight = statedNumber(
      POPOVER,
      /(?<!SHEET_)\bMAX_PANEL_HEIGHT = (\d+)\s*;/g,
      'MAX_PANEL_HEIGHT'
    );
    const sheetMaxPanelHeight = statedNumber(
      POPOVER,
      /\bSHEET_MAX_PANEL_HEIGHT = (\d+)\s*;/g,
      'SHEET_MAX_PANEL_HEIGHT'
    );

    // `pickerPopover.tsx` spells both derivations out: seven rows plus the
    // panel chrome. SEVEN is the design decision (an odd count, so the selected
    // row sits on the centre line with three above and three below); the two
    // ceilings are only its arithmetic at the two row sizes. Change a row
    // height alone and a ceiling silently becomes 8 rows, or 6 and a sliver —
    // the panel still opens, still scrolls, and no other test can tell.
    const VISIBLE_ROWS = 7;
    // 12px `text-xs` at the 1.5 leading `globals.css` sets, over `pt-1 pb-1` —
    // `TimePickerPanel`'s column header, the one term of the chrome that is the
    // same in both boxes.
    const COLUMN_HEADER = 26;

    // THE PADDING IS READ OUT OF THE CLASS STRINGS, not restated here, and that
    // is the half of this test that is new. The ceilings are a sum over the
    // panel's chrome, and the padding IS chrome — so a padding change that left
    // a ceiling alone would quietly buy the sheet 24px of room out of the seven
    // rows it is supposed to reserve. Restating the numbers locally would have
    // made this guard agree with itself and with nothing else.
    const anchoredPad = numberIn(
      boxClasses('z-[60]', 'anchored box'),
      /\bp-(\d+)\b/g,
      'anchored padding'
    );
    // THE TALL BRANCH, and only it. The sheet's vertical padding is gated on a
    // viewport with the height to spend on it (see the box's own comment: at
    // 390x360 the whole vertical budget is ten pixels), so `pt-` and `pb-`
    // each appear TWICE in that string. The ceiling is built from the tall
    // pair because a ceiling is an appetite cap and only ever binds where the
    // panel had room to reach it — a viewport short enough to select the 4px
    // branch is capped by `SHEET_VIEWPORT_FRACTION` long before.
    //
    // Matching the variant prefix rather than `\bpt-(\d+)\b` is what keeps
    // that honest: the bare pattern found `['1','3']` and reported "occurrences
    // disagree", which is the right failure but the wrong question. The short
    // branch has a guard of its own and it cannot be a source scan — it is
    // `usableRows >= 4` at 390x360 in `e2e/picker-geometry.spec.ts`, measured,
    // because what it protects is a rendered week row.
    const TALL = String.raw`\[@media\(min-height:500px\)\]:`;
    const sheetTopPad = numberIn(
      boxClasses('inset-x-0', 'sheet box'),
      new RegExp(`${TALL}pt-(\\d+)\\b`, 'g'),
      'sheet pt (tall branch)'
    );
    // The FLOOR of the `max()`, not the inset: `env(safe-area-inset-bottom)` is
    // 0 on Android, on desktop emulation and on every iPhone with a home
    // button, so the floor is the number the arithmetic can actually know. A
    // device that reports a real inset spends it on the home indicator and
    // shows a little under seven rows, which is the correct trade and the same
    // one the 0.25rem floor made — only now the devices reporting NOTHING are
    // not the ones paying for it.
    const sheetBottomFloor =
      numberIn(
        boxClasses('inset-x-0', 'sheet box'),
        new RegExp(`${TALL}pb-\\[max\\(([\\d.]+)rem,env\\(safe-area-inset-bottom\\)\\)\\]`, 'g'),
        'sheet pb floor (tall branch)'
      ) * REM_PX;

    // ANCHORED: `p-1` top and bottom, plus the panel's 1px border on all four
    // sides — so two of them stack vertically.
    const anchoredChrome = COLUMN_HEADER + 2 * anchoredPad * SPACING_PX + 2;
    // SHEET: its own top padding and its own bottom floor, plus ONE border.
    // The sheet is `border-t` only — there is no bottom edge to draw when the
    // box is flush with the viewport floor — and counting two here is how the
    // ceiling ends up a pixel richer than the box it is capping.
    const sheetChrome = COLUMN_HEADER + sheetTopPad * SPACING_PX + sheetBottomFloor + 1;
    // Not equal, and the test says so out loud: the two boxes were forked from
    // one another and shared `p-1` until the sheet's edges turned out to be the
    // screen's. A refactor that re-merged them would satisfy both sums below
    // with one number and hand touch users the 4px ring back.
    expect(sheetChrome).toBeGreaterThan(anchoredChrome);

    expect(maxPanelHeight).toBe(VISIBLE_ROWS * rowHeight + anchoredChrome);
    expect(sheetMaxPanelHeight).toBe(VISIBLE_ROWS * touchRowHeight + sheetChrome);
  });
});
