/**
 * Copy rule (owner, 1.4.0): never assume the people in a circle are relatives. Role and member
 * DESCRIPTIONS say "family, a friend or a paid caregiver" (or a neutral "everyone in the
 * circle"), never "sibling or spouse" / "family members" as the only option. Role NAMES
 * ("Family caregiver") are out of scope. Mobile pins the same copy in
 * mobile/src/__tests__/i18n/inclusiveMemberCopy.test.ts.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const I18N_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT'];
type Json = Record<string, any>;
const load = (code: string, ns: string): Json | null => {
  const f = join(I18N_DIR, code, `${ns}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Json) : null;
};
const get = (j: Json | null, path: string): string | undefined =>
  path.split('.').reduce<any>((n, p) => (n == null ? undefined : n[p]), j ?? undefined);

/** Every string value in a locale's namespaces, with its "ns:path". */
function allStrings(code: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const f of readdirSync(join(I18N_DIR, code)).filter((n) => n.endsWith('.json'))) {
    const ns = f.slice(0, -5);
    const walk = (o: any, p: string) => {
      if (typeof o === 'string') out.push([`${ns}:${p}`, o]);
      else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p ? `${p}.${k}` : k);
    };
    walk(load(code, ns), '');
  }
  return out;
}

/** Relative-only phrasings the 1.4.0 sweep removed (per locale). */
const BANNED: Record<string, RegExp[]> = {
  en: [/from everyone in the family/, /Siblings, spouses/, /Caregivers are family members/, /join your family's care circle/, /Join your family in/, /Family members are notified/, /the whole family sees/, /Unlimited family members/],
  es: [/Hermanos, parejas/, /Cuidadores son familiares/i, /círculo de cuidado de tu familia/, /Únete a tu familia/, /toda la familia ve/, /Familiares ilimitados/],
  fr: [/Frères, sœurs, conjoints/, /Les aidants sont des proches qui/, /cercle de soins de votre famille/, /Rejoignez votre famille/, /toute la famille voit/, /Membres de la famille en nombre illimité/],
  de: [/Geschwister, Partner/, /Pflegepersonen sind Familienmitglieder/, /Pflegekreis Ihrer Familie/, /gemeinsam mit Ihrer Familie/, /die ganze Familie sieht/, /Unbegrenzt viele Familienmitglieder/],
  it: [/Fratelli, coniugi/, /Caregiver sono familiari/i, /cerchia di cura della tua famiglia/, /cerchia della tua famiglia/, /tutta la famiglia vede/, /Familiari illimitati/],
  pt: [/Irmãos, cônjuges/, /Cuidadores são familiares/i, /círculo de cuidado da sua família/, /Junte-se à sua família/, /toda a família vê/, /Familiares ilimitados/],
};
BANNED['fr-CA'] = BANNED.fr;
BANNED['pt-PT'] = BANNED.pt;

describe('member and role descriptions never assume relatives', () => {
  it.each(LOCALES)('%s: no relative-only member description survives', (code) => {
    const hits = allStrings(code).filter(([, v]) => BANNED[code].some((re) => re.test(v)));
    expect(hits).toEqual([]);
  });

  it.each(['en', 'es', 'fr', 'de', 'it', 'pt'])(
    '%s: the help "roles" answer names friends and paid caregivers too',
    (code) => {
      const roles = get(load(code, 'help'), 'sections.roles.items.0.answer') ?? '';
      const friend: Record<string, RegExp> = {
        en: /a friend or a paid caregiver/, es: /un amigo o un cuidador contratado/,
        fr: /un ami ou un aidant rémunéré/, de: /Freunde oder eine bezahlte Pflegekraft/,
        it: /un amico o un assistente a pagamento/, pt: /um amigo ou um cuidador contratado/,
      };
      expect(roles).toMatch(friend[code]);
    }
  );

  it('the en preview annotation and premium benefit read inclusively', () => {
    expect(get(load('en', 'auth'), 'preview.annotations.familySync')).toBe(
      'Family, friends and paid caregivers stay in sync'
    );
    expect(get(load('en', 'upgrade'), 'benefits.caregivers.title')).toBe('Unlimited caregivers');
  });
});
