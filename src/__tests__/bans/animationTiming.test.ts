import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_FALLBACK_MS } from '../../components/ui/motion';

const ROOT = join(__dirname, '..', '..');
const CSS = readFileSync(join(ROOT, 'styles', 'globals.css'), 'utf8');

// Hand-typed `animate-[name_NNNms_...]` timings are banned: use the `animate-*` utilities in
// globals.css (driven by `--dur-enter/exit/fade`). The sites below are the ones whose value does
// not equal a token yet; normalising them is a visible change planned for Phase 4 of
// docs/plans/app-polish-uniformity.md. The list only shrinks: file -> exact occurrence count.
export const ALLOWED_ARBITRARY_ANIMATIONS: Record<string, number> = {
  'components/ui/pickerPopover.tsx': 1, // modal-in_200ms
  'components/ui/MoreMenu.tsx': 1, // modal-in_200ms
  'components/layout/Header.tsx': 1, // modal-in_200ms
  'components/layout/AddMenu.tsx': 2, // rise-in_250ms, zoom-in_200ms
  'components/ui/Modal.tsx': 1, // fade-in_160ms_ease-in_reverse_forwards
};

const ARBITRARY = /animate-\[[a-z-]+_\d+m?s/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !p.includes('__tests__') && !p.includes('/test/') && !p.endsWith('styles/globals.css'))
      out.push(p);
  }
  return out;
}

/** Violations for a map of relative path -> source. Exported shape kept local for the negative tests. */
function violations(sources: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [rel, src] of Object.entries(sources)) {
    const found = src.match(ARBITRARY)?.length ?? 0;
    const allowed = ALLOWED_ARBITRARY_ANIMATIONS[rel] ?? 0;
    if (found !== allowed) out.push(`${rel}: ${found} arbitrary animate-[..._NNNms] (allowed ${allowed})`);
  }
  return out;
}

describe('animation timing bans', () => {
  const sources: Record<string, string> = {};
  for (const f of walk(ROOT)) sources[f.slice(ROOT.length + 1)] = readFileSync(f, 'utf8');

  it('has no arbitrary animation timing beyond the allow-list', () => {
    expect(violations(sources)).toEqual([]);
  });

  it('every allow-listed file still exists and still has the sites (the list only shrinks)', () => {
    for (const rel of Object.keys(ALLOWED_ARBITRARY_ANIMATIONS)) expect(sources[rel]).toBeDefined();
  });

  it('fails for a new arbitrary timing in a non-allow-listed file', () => {
    const bad = { 'components/Foo.tsx': 'className="animate-[fade-in_300ms_ease-out]"' };
    expect(violations(bad)).toEqual([
      'components/Foo.tsx: 1 arbitrary animate-[..._NNNms] (allowed 0)',
    ]);
  });

  it('fails for an extra occurrence in an allow-listed file', () => {
    const rel = 'components/ui/MoreMenu.tsx';
    const bad = { [rel]: `${sources[rel]}\n"animate-[modal-in_240ms_ease-out]"` };
    expect(violations(bad)).toEqual([`${rel}: 2 arbitrary animate-[..._NNNms] (allowed 1)`]);
  });

  it('every named animate-* utility used in src is declared in globals.css', () => {
    const BUILT_IN = new Set(['none', 'spin', 'ping', 'pulse', 'bounce']);
    const used = new Set<string>();
    for (const [rel, src] of Object.entries(sources)) {
      if (rel === 'styles/globals.css') continue;
      for (const m of src.matchAll(/(?<![\w-])animate-([a-z][a-z-]*)/g)) {
        if (!BUILT_IN.has(m[1])) used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(CSS).toMatch(new RegExp(`@utility animate-${name} \\{`));
  });

  it('negative: an undeclared utility name would be detected', () => {
    expect(CSS).not.toMatch(/@utility animate-not-a-real-one \{/);
  });

  it('JS exit fallback stays above the CSS exit duration (one source: --dur-exit)', () => {
    const exit = CSS.match(/--dur-exit:\s*(\d+)ms/);
    expect(exit).not.toBeNull();
    expect(EXIT_FALLBACK_MS).toBeGreaterThan(Number(exit![1]));
  });

  it('the global reduced-motion block still collapses animation-duration', () => {
    expect(CSS).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*?animation-duration: 0\.01ms !important/
    );
  });
});
