import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// W4 (docs/plans/app-polish-uniformity.md): every hover colour change eases over --dur-fast.
// The mechanism is ONE base-layer rule in globals.css (not per-class `transition-colors`), so a new
// element cannot forget it. This test locks the rule; it does not scan class strings.
const CSS = readFileSync(join(__dirname, '..', '..', 'styles', 'globals.css'), 'utf8');

/** The `@layer base { ... }` bodies (brace-matched) of a stylesheet. */
function baseLayerBodies(css: string): string[] {
  const out: string[] = [];
  const re = /@layer\s+base\s*\{/g;
  while (re.exec(css)) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

/** The declaration block of the hover-transition rule inside the base layer, or null. */
export function hoverTransitionRule(css: string): { selector: string; body: string } | null {
  for (const base of baseLayerBodies(css)) {
    const re = /:is\(([^{}]*?\[role=['"]?radio['"]?\][^{}]*?)\)\s*\{([^{}]*)\}/;
    const m = re.exec(base);
    if (m) return { selector: m[1], body: m[2] };
  }
  return null;
}

describe('hover colour transition (base rule)', () => {
  const rule = hoverTransitionRule(CSS);

  it('exists in the base layer', () => {
    expect(rule).not.toBeNull();
  });

  it('covers links, buttons, tabs and menu items, and does not use a [class*=] attribute match', () => {
    for (const s of ['a', 'button', "[role='tab']", "[role='menuitem']"]) {
      expect(rule!.selector).toContain(s);
    }
    expect(rule!.selector).not.toContain('class*=');
  });

  it('transitions colour properties over the --dur-fast token', () => {
    expect(rule!.body).toMatch(/transition-property:\s*color,\s*background-color,\s*border-color,\s*opacity\s*;/);
    expect(rule!.body).toMatch(/transition-duration:\s*var\(--dur-fast\)\s*;/);
  });

  it('never transitions outline or box-shadow: a keyboard focus ring appears instantly', () => {
    const prop = /transition-property:\s*([^;]*);/.exec(rule!.body)![1];
    expect(prop).not.toMatch(/outline|box-shadow|all|transform/);
  });

  it('is not in the utilities layer, so utilities such as transition-none / duration-slow still win', () => {
    // Base layer only: found above. The same rule must not also appear unlayered or in utilities.
    const outsideBase = CSS.replace(/@layer\s+base\s*\{/g, '@layer base-removed {');
    expect(hoverTransitionRule(outsideBase)).toBeNull();
  });

  it('the reduced-motion block still zeroes every transition duration with !important', () => {
    expect(CSS).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it('negative: a rule with a different duration, outline, or in a non-base layer is rejected', () => {
    const wrap = (body: string, layer = 'base') =>
      `@layer ${layer} { :is(a, button, [role='radio']) { ${body} } }`;
    const good = 'transition-property: color, background-color, border-color, opacity; transition-duration: var(--dur-fast);';
    expect(hoverTransitionRule(wrap(good))).not.toBeNull();
    expect(hoverTransitionRule(wrap(good, 'utilities'))).toBeNull();
    expect(hoverTransitionRule(wrap('transition-property: all;'))!.body).not.toMatch(
      /transition-property:\s*color,\s*background-color,\s*border-color,\s*opacity\s*;/
    );
    const withOutline = hoverTransitionRule(wrap('transition-property: color, outline-color, box-shadow;'))!;
    expect(/transition-property:\s*([^;]*);/.exec(withOutline.body)![1]).toMatch(/outline|box-shadow/);
    expect(hoverTransitionRule('')).toBeNull();
  });
});
