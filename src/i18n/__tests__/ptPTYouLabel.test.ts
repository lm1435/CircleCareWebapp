/**
 * pt-PT "(you)" label (1.4.3, mobile twin: mobile/src/__tests__/i18n/ptPTYouLabel.test.ts).
 * pt-PT is a SPARSE override of pt, so a key it does not define falls back to Brazilian
 * Portuguese ("você"). Resolves each key the way i18next does (pt-PT -> pt -> en).
 */
// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [k: string]: string | Tree };
const DIR = join(process.cwd(), 'src', 'i18n');
const load = (code: string): Record<string, Tree> =>
  Object.fromEntries(
    readdirSync(join(DIR, 'en'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const p = join(DIR, code, f);
        return [f.replace(/\.json$/, ''), existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}];
      })
  );
const en = load('en');
const pt = load('pt');
const ptPT = load('pt-PT');
const get = (tree: Tree, key: string): string | undefined => {
  const v = key.split('.').reduce<string | Tree | undefined>(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    tree
  );
  return typeof v === 'string' ? v : undefined;
};
const resolvePtPT = (ns: string, key: string) =>
  get(ptPT[ns], key) ?? get(pt[ns], key) ?? get(en[ns], key);
const flatten = (tree: Tree, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flatten(v, `${prefix}${k}.`)
  );
const VOCE = /(^|[^\p{L}])vocês?(?=[^\p{L}]|$)/iu;

describe('pt-PT self label', () => {
  it('the member list suffix is "(eu)" in pt-PT', () => {
    expect(resolvePtPT('members', 'list.you')).toBe('(eu)');
  });

  it('matches the other pt-PT self labels ("Eu")', () => {
    expect(resolvePtPT('shifts', 'you')).toBe('Eu');
    expect(resolvePtPT('auth', 'preview.demo.members.you')).toBe('Eu');
  });

  it('pt-BR is unchanged: "(você)"', () => {
    expect(get(pt.members, 'list.you')).toBe('(você)');
  });

  it('no pt-PT self label (en "You", "(you)", "Me") resolves to "você"', () => {
    const selfLabels = Object.entries(en).flatMap(([ns, tree]) =>
      flatten(tree)
        .filter(([, v]) => /^\(?(you|me)\)?$/i.test(v))
        .map(([k]) => [ns, k] as const)
    );
    expect(selfLabels.length).toBeGreaterThanOrEqual(3);
    const leaks = selfLabels.filter(([ns, k]) => VOCE.test(resolvePtPT(ns, k) ?? ''));
    expect(leaks).toEqual([]);
  });
});
