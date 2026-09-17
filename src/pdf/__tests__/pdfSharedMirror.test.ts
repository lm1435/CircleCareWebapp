/**
 * `src/pdf/shared/` is a BYTE-IDENTICAL mirror of `mobile/src/pdf/shared/`
 * (plan decision 1), produced by `mobile/scripts/sync-pdf-shared.sh`. The
 * three repos share no package, so this test is the only thing that stops the
 * two copies drifting: it fails when any file differs, is missing on one side,
 * or exists on only one side.
 *
 * When the mobile checkout is not next to this one (a web-only clone, CI for
 * the web app alone) there is nothing to compare against, so the cases skip
 * with a console note rather than fail.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SHARED = resolve(HERE, '..', 'shared');
const MOBILE_SHARED = resolve(HERE, '..', '..', '..', '..', 'mobile', 'src', 'pdf', 'shared');

const mobilePresent = existsSync(MOBILE_SHARED);
if (!mobilePresent) {
  console.info(
    `[pdfSharedMirror] skipped: ${MOBILE_SHARED} is not on disk, nothing to compare against.`
  );
}

const describeIfMobile = mobilePresent ? describe : describe.skip;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

describeIfMobile('src/pdf/shared mirrors mobile/src/pdf/shared byte-for-byte', () => {
  const mobileFiles = mobilePresent ? listFiles(MOBILE_SHARED) : [];
  const webFiles = listFiles(WEB_SHARED);

  it('has the same set of files on both sides (no extras, nothing missing)', () => {
    expect(webFiles).toEqual(mobileFiles);
  });

  it('is non-empty (the sync script has been run at least once)', () => {
    expect(mobileFiles.length).toBeGreaterThan(0);
  });

  for (const file of mobileFiles) {
    it(`${file} is byte-identical`, () => {
      const webPath = join(WEB_SHARED, file);
      expect(existsSync(webPath), `${file} missing on the web side — run sync-pdf-shared.sh`).toBe(
        true
      );
      const mobileBytes = readFileSync(join(MOBILE_SHARED, file));
      const webBytes = readFileSync(webPath);
      expect(
        webBytes.equals(mobileBytes),
        `${file} differs from mobile — edit mobile/src/pdf/shared and run sync-pdf-shared.sh`
      ).toBe(true);
    });
  }
});

describe('the web shared folder is platform-pure', () => {
  it('imports nothing outside the folder except types', () => {
    for (const file of listFiles(WEB_SHARED)) {
      const source = readFileSync(join(WEB_SHARED, file), 'utf8');
      const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gm)];
      for (const [, typeOnly, specifier] of imports) {
        if (typeOnly) continue;
        expect(specifier, `${file} imports ${specifier} at runtime`).toMatch(/^\.\//);
      }
    }
  });
});
