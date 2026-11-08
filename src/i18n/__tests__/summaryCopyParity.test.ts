/**
 * PARITY: the live page-summary lines say the same thing on mobile and web. The agreed en wording is in
 * __fixtures__/summaryCopyParity.json (byte-identical copy in mobile/src/__tests__/fixtures).
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'summaryCopyParity.json'), 'utf8')
) as { lines: Array<{ id: string; webFile: string; webKey: string; en: string }> };

function get(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

describe('summary copy parity (en)', () => {
  it.each(fixture.lines.map((l) => [l.id, l.webFile, l.webKey, l.en]))('%s', (_id, file, key, expected) => {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'en', file as string), 'utf8'));
    expect(get(json, key as string)).toBe(expected);
  });
});
