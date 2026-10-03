import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/**
 * Never navigate a tab or window to a signed Storage URL (memory
 * feedback_no_system_browser_for_files). The old document preview's "Open in
 * new tab" was `<Button as="a" href={signedUrl} target="_blank">`, which put
 * the Supabase host and the signing token in the address bar and history. It
 * now opens a `blob:` URL on the app's origin (documents/openInNewTab.ts).
 *
 * Rules, over every non-test source file:
 *  1. A `target="_blank"` element may only point at a known public URL
 *     (legal pages, store listings).
 *  2. No `href` expression may name a signed/storage/file URL — rendering the
 *     token as a visible, copyable link is the same leak.
 *  3. `window.open`, `location.assign/replace` and `location.href =` must not
 *     be handed a signed/storage/file URL; in documents/ the only window.open
 *     allowed is the synchronous `about:blank` placeholder.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Identifiers/literals that carry a signed Storage URL in this codebase. */
const SENSITIVE = /signed|file_?url|fileUrl|photo_?url|photoUrl|storage|supabase/i;

/** Public destinations a new tab may open. */
const ALLOWED_BLANK_HREF = /^(legalUrl\(|APP_STORE_URL$|PLAY_STORE_URL$)/;

const FILES = walk(ROOT).map((file) => ({
  rel: file.slice(ROOT.length + 1),
  src: readFileSync(file, 'utf8'),
}));

describe('no navigation to signed Storage URLs', () => {
  it('scans the source tree', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => f.rel === 'components/documents/DocumentPreviewModal.tsx')).toBe(true);
  });

  it('every target="_blank" element points at an allowed public URL', () => {
    const offenders: string[] = [];
    for (const { rel, src } of FILES) {
      const blank = /target=(?:"_blank"|'_blank'|\{['"]_blank['"]\})/g;
      let m: RegExpExecArray | null;
      while ((m = blank.exec(src))) {
        // The href lives in the same opening tag: look back to the tag start.
        const tagStart = Math.max(src.lastIndexOf('<a', m.index), src.lastIndexOf('<Button', m.index));
        const tagEnd = src.indexOf('>', m.index);
        const tag = src.slice(tagStart, tagEnd === -1 ? undefined : tagEnd + 1);
        const href = /href=\{([^}]*)\}/.exec(tag)?.[1]?.trim() ?? /href="([^"]*)"/.exec(tag)?.[1] ?? '';
        if (!ALLOWED_BLANK_HREF.test(href)) offenders.push(`${rel}: target=_blank href={${href}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no href renders a signed/storage/file URL', () => {
    const offenders: string[] = [];
    for (const { rel, src } of FILES) {
      for (const m of src.matchAll(/\bhref=\{([^}]*)\}/g)) {
        if (SENSITIVE.test(m[1])) offenders.push(`${rel}: href={${m[1]}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('window.open / location navigation is never handed a signed/storage/file URL', () => {
    const offenders: string[] = [];
    const NAV = /(window\.open|location\.assign|location\.replace)\(\s*([^,)]*)|location\.href\s*=\s*([^;\n]*)/g;
    for (const { rel, src } of FILES) {
      for (const m of src.matchAll(NAV)) {
        const arg = (m[2] ?? m[3] ?? '').trim();
        if (SENSITIVE.test(arg)) offenders.push(`${rel}: ${m[0].trim()}`);
        if (rel.startsWith('components/documents/') && m[1] === 'window.open' && arg !== "'about:blank'") {
          offenders.push(`${rel}: ${m[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
