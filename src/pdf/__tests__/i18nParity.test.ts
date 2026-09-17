/**
 * The shared templates speak MOBILE's key namespace (plan decision 4); the web
 * adapter maps `careSummary.*` → `emergency:careSummary.*` and
 * `medicationHistory.export.*` → `meds:export.*`. For that mapping to resolve
 * every key the templates use, the two web subtrees must carry EXACTLY the
 * keys mobile's do, in both languages. This asserts key-set parity (and, since
 * the strings were copied verbatim, value parity too) against the mobile
 * locale files, skipping with a note when the mobile checkout is absent.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_I18N = resolve(HERE, '..', '..', 'i18n');
const MOBILE_LOCALES = resolve(HERE, '..', '..', '..', '..', 'mobile', 'src', 'i18n', 'locales');

const mobilePresent = existsSync(MOBILE_LOCALES);
if (!mobilePresent) {
  console.info(`[i18nParity] skipped: ${MOBILE_LOCALES} is not on disk.`);
}
const describeIfMobile = mobilePresent ? describe : describe.skip;

type Json = Record<string, unknown>;

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

function subtree(obj: Json, path: string): Json {
  let node: unknown = obj;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) throw new Error(`${path} missing`);
    node = (node as Json)[part];
  }
  if (typeof node !== 'object' || node === null) throw new Error(`${path} is not an object`);
  return node as Json;
}

/** Every leaf path in dotted form, sorted. */
function leafPaths(obj: Json, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) out.push(...leafPaths(value as Json, path));
    else out.push(path);
  }
  return out.sort();
}

const CASES: ReadonlyArray<{ webFile: string; webPath: string; mobilePath: string }> = [
  { webFile: 'emergency.json', webPath: 'careSummary', mobilePath: 'careSummary' },
  { webFile: 'meds.json', webPath: 'export', mobilePath: 'medicationHistory.export' },
];

describeIfMobile('web PDF strings mirror mobile', () => {
  for (const lang of ['en', 'es'] as const) {
    const mobile = mobilePresent ? readJson(resolve(MOBILE_LOCALES, `${lang}.json`)) : {};
    for (const { webFile, webPath, mobilePath } of CASES) {
      const web = readJson(resolve(WEB_I18N, lang, webFile));

      it(`${lang}: ${webFile} ${webPath} has the same key set as mobile ${mobilePath}`, () => {
        expect(leafPaths(subtree(web, webPath))).toEqual(leafPaths(subtree(mobile, mobilePath)));
      });

      it(`${lang}: ${webFile} ${webPath} strings are verbatim copies of mobile`, () => {
        expect(subtree(web, webPath)).toEqual(subtree(mobile, mobilePath));
      });
    }
  }
});

describe('web-only masthead label', () => {
  it('emergency.exportPdf exists in both languages', () => {
    // The masthead action reuses the parity key (mobile's own label), no web-only key.
    expect(readJson(resolve(WEB_I18N, 'en', 'emergency.json')).exportPdf).toBeUndefined();
    expect(readJson(resolve(WEB_I18N, 'es', 'emergency.json')).exportPdf).toBeUndefined();
  });
});
