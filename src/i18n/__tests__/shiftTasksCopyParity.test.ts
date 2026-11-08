/**
 * PARITY: every shifts.tasks.* string says the same thing on mobile and web (en). The agreed wording is
 * __fixtures__/shiftTasksCopyParity.json (byte-identical copy in mobile/src/__tests__/fixtures).
 * Key sets must match both ways: a platform with an extra or missing key shows that text another way.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '__fixtures__', 'shiftTasksCopyParity.json'), 'utf8')
) as { tasks: Record<string, string> };

function flatten(obj: Record<string, any>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

const web = flatten(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'en', 'shifts.json'), 'utf8')).tasks
);

describe('shifts.tasks copy parity (en)', () => {
  it.each(Object.entries(fixture.tasks))('%s', (key, expected) => {
    expect(web[key]).toBe(expected);
  });

  it('web has no shifts.tasks key the fixture (mobile) lacks', () => {
    expect(Object.keys(web).filter((k) => !(k in fixture.tasks))).toEqual([]);
  });
});
