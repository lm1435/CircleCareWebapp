import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_NAMES } from '../../components/ui/iconNames';

const ROOT = join(__dirname, '..', '..');
const WEBAPP_ROOT = join(ROOT, '..');
const MOBILE_SRC = join(WEBAPP_ROOT, '..', 'mobile', 'src');

/**
 * Icons with NO mobile precedent — a genuine web-only affordance. Every entry
 * needs a one-line reason; this is the ONLY escape hatch from the
 * mobile-precedent check below (the module doc comment on iconNames.ts:
 * "adding a name here requires a mobile precedent").
 */
const WEB_ONLY_ICONS: Partial<Record<(typeof ICON_NAMES)[number], string>> = {
  // Empty since the Emergency Info "Print" action became "Share"
  // (docs/plans/pdf-export-parity.md, B3) — `share-outline` has mobile
  // precedent, so no web-only glyph remains.
};

function walkMobileSrc(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      walkMobileSrc(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

// Files allowed to still contain hand-drawn <svg markup (spec §4.4 — later
// tasks replace these; the Icon component itself legitimately builds <svg>).
const SVG_ALLOWLIST = [
  'components/ui/Icon.tsx',
  'components/layout/StoreBadges.tsx',
  'components/auth/OAuthButtons.tsx',
  'components/meds/AdherenceRing.tsx',
  'components/vitals/VitalsChart.tsx',
  'components/overview/AdherenceCard.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || p.includes('/test/')) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !p.includes('__tests__') && !p.includes('/test/')) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(ROOT);

describe('icon names (spec §4.4)', () => {
  it('every <Icon name="..."/> uses a name in ICON_NAMES', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(ROOT.length + 1);
      const re = /<Icon\b[^>]*\bname[=:]\s*["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const name = m[1];
        if (!(ICON_NAMES as readonly string[]).includes(name)) {
          offenders.push(`${rel}: "${name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no hand-drawn <svg remains outside the allowlist', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const rel = file.slice(ROOT.length + 1);
      if (SVG_ALLOWLIST.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (src.includes('<svg')) {
        offenders.push(rel);
      }
    }
    // Expected to fail until later tasks replace the ~37 hand-drawn SVGs.
    expect(offenders).toEqual([]);
  });

  // Skipped (with this name as the reason) when the mobile repo isn't checked
  // out as a sibling of webapp/ — the precedent check has nothing to read.
  it.skipIf(!existsSync(MOBILE_SRC))(
    'every ICON_NAMES entry has mobile precedent, or is listed in WEB_ONLY_ICONS with a reason (mobile repo not found at ../mobile/src)',
    () => {
      const mobileFiles = walkMobileSrc(MOBILE_SRC);
      const combined = mobileFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
      const unprecedented: string[] = [];
      for (const name of ICON_NAMES) {
        if (name in WEB_ONLY_ICONS) continue;
        const hasPrecedent = combined.includes(`"${name}"`) || combined.includes(`'${name}'`);
        if (!hasPrecedent) unprecedented.push(name);
      }
      expect(unprecedented).toEqual([]);
    }
  );

  it('WEB_ONLY_ICONS only allowlists real ICON_NAMES entries', () => {
    const invalid = Object.keys(WEB_ONLY_ICONS).filter(
      (name) => !(ICON_NAMES as readonly string[]).includes(name)
    );
    expect(invalid).toEqual([]);
  });
});
