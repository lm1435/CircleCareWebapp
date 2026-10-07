// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LOCALE_DOCS,
  checkLocaleTable,
  // @ts-expect-error plain .mjs module without type declarations
} from '../localeHtml.mjs';
import { LOCALE_REGISTRY } from '../../src/i18n/locales';

/**
 * Per-locale document copy lives one file per locale in scripts/localeDocs/<code>.mjs
 * (lane-owned); scripts/localeDocs/index.mjs is the flip-stage wiring. A lane's file is
 * validated here BEFORE the flip: every `<code>.mjs` present must be complete and its og
 * assets must exist; every wired entry must have its file.
 */
const dir = fileURLToPath(new URL('../localeDocs/', import.meta.url));
const pub = fileURLToPath(new URL('../../public/', import.meta.url));
const codes = readdirSync(dir)
  .filter((f) => /^[a-z]{2,3}(-[A-Z]{2})?\.mjs$/.test(f))
  .map((f) => f.replace(/\.mjs$/, ''));

describe('scripts/localeDocs per-locale files', () => {
  it.each(codes)('%s is a complete document entry with existing og assets', async (code) => {
    const { doc } = await import(/* @vite-ignore */ `${dir}${code}.mjs`);
    expect(() => checkLocaleTable(['en', code], { [code]: doc }, (f: string) => existsSync(`${pub}${f}`))).not.toThrow();
    expect(doc.htmlLang.toLowerCase().startsWith(code.split('-')[0])).toBe(true);
  });

  it('every wired LOCALE_DOCS entry has a file, and every registered non-EN locale is wired', () => {
    for (const k of Object.keys(LOCALE_DOCS)) expect(codes).toContain(k);
    for (const { code } of LOCALE_REGISTRY) if (code !== 'en') expect(LOCALE_DOCS[code]).toBeDefined();
  });
});
