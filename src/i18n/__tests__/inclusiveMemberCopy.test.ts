/**
 * Copy rule (owner, 1.4.0): never assume the people in a circle are relatives. Role and member
 * DESCRIPTIONS say "family, a friend or a paid caregiver" (or a neutral "everyone in the
 * circle"), never "sibling or spouse" / "family members" as the only option. Role NAMES follow
 * the same rule (owner, 1.4.0): the care-team role line "Family member" -> "Member" (web's invite
 * and member list already said "Caregiver"). The paywall no longer assumes who the circles are
 * for ("One for Mom, Dad, or the whole family" -> "One for each person you care for") or that the
 * buyer is a family ("Everything your family needs..." -> "Everything you need..."). Mobile pins
 * the same copy in mobile/src/__tests__/i18n/inclusiveMemberCopy.test.ts.
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

  // Role display names (1.4.0). Keys keep their old names; only the values changed.
  const ROLE_NAMES: Record<string, { caregiver: string; member: string }> = {
    en: { caregiver: 'Caregiver', member: 'Member' },
    es: { caregiver: 'Cuidador', member: 'Miembro' },
    fr: { caregiver: 'Aidant', member: 'Membre' },
    de: { caregiver: 'Pflegeperson', member: 'Mitglied' },
    it: { caregiver: 'Caregiver', member: 'Membro' },
    pt: { caregiver: 'Cuidador', member: 'Membro' },
  };
  it.each(Object.keys(ROLE_NAMES))('%s: role names are "Caregiver" / "Member", never family-only', (code) => {
    expect(get(load(code, 'overview'), 'team.familyMember')).toBe(ROLE_NAMES[code].member);
    expect(get(load(code, 'members'), 'roles.caregiver')).toBe(ROLE_NAMES[code].caregiver);
  });

  it.each(['fr-CA', 'pt-PT'])('%s: does not re-override the care-team role line', (code) => {
    expect(get(load(code, 'overview'), 'team.familyMember')).toBeUndefined();
  });

  const OLD_ROLE_NAMES = /^(Family caregiver|Family member|Cuidador familiar|Familiar|Aidant familial|Proche|Membre de la famille|Pflegeperson aus der Familie|Familienmitglied|Caregiver familiare|Familiare)$/;
  it.each(LOCALES)('%s: no old role name survives anywhere', (code) => {
    expect(allStrings(code).filter(([, v]) => OLD_ROLE_NAMES.test(v))).toEqual([]);
  });

  // Paywall (upgrade.json): the circles benefit and the onboarding sub-line under "Better care, together."
  const PAYWALL: Record<string, { circles: string; subtitle: string }> = {
    en: {
      circles: 'One for each person you care for',
      subtitle: 'Everything you need to coordinate care for the people who matter most.',
    },
    es: {
      circles: 'Uno para cada persona que cuidas',
      subtitle: 'Todo lo que necesitas para coordinar el cuidado de quienes más importan.',
    },
    fr: {
      circles: 'Un pour chaque personne que vous aidez',
      subtitle: 'Tout ce dont vous avez besoin pour coordonner les soins des personnes qui comptent le plus.',
    },
    de: {
      circles: 'Einer für jede Person, die Sie betreuen',
      subtitle: 'Alles, was Sie brauchen, um die Pflege der Menschen zu koordinieren, die Ihnen am meisten bedeuten.',
    },
    it: {
      circles: 'Una per ogni persona di cui ti prendi cura',
      subtitle: 'Tutto ciò che ti serve per coordinare la cura delle persone più importanti.',
    },
    pt: {
      circles: 'Um para cada pessoa de quem você cuida',
      subtitle: 'Tudo o que você precisa para coordenar o cuidado de quem mais importa.',
    },
    // European override: no "você".
    'pt-PT': {
      circles: 'Um para cada pessoa de quem cuida',
      subtitle: 'Tudo o que precisa para coordenar o cuidado de quem mais importa.',
    },
  };
  it.each(Object.keys(PAYWALL))('%s: the paywall reads as approved', (code) => {
    const up = load(code, 'upgrade');
    expect(get(up, 'benefits.circles.sub')).toBe(PAYWALL[code].circles);
    expect(get(up, 'onboarding.subtitle')).toBe(PAYWALL[code].subtitle);
  });

  it('fr-CA inherits the French paywall copy (no override)', () => {
    const up = load('fr-CA', 'upgrade');
    expect(get(up, 'benefits.circles.sub')).toBeUndefined();
    expect(get(up, 'onboarding.subtitle')).toBeUndefined();
  });

  const OLD_PAYWALL = /Mom, Dad|mamá, papá|maman, papa|Mama, Papa|per il papà|a mãe, o pai/i;
  it.each(LOCALES)('%s: the old circles-row wording is gone from the paywall', (code) => {
    const up = load(code, 'upgrade');
    expect(get(up, 'benefits.circles.sub') ?? '').not.toMatch(OLD_PAYWALL);
  });

  // The general upgrade subtitle (upgrade:subtitle) and the Profile upgrade benefit
  // (profile:subscription.upgradeBenefit) no longer assume a family. Mobile pins the same line
  // in planSelection.upgradeSubtitleGeneral.
  const GENERAL: Record<string, { subtitle: string; benefit: string }> = {
    en: {
      subtitle: "Everything you need to coordinate care, for every circle you're part of.",
      benefit: "Everything you need to coordinate care, for every circle you're part of.",
    },
    es: {
      subtitle: 'Todo lo que necesitas para coordinar el cuidado, en cada círculo del que formas parte.',
      benefit: 'Todo lo que necesitas para coordinar el cuidado, en cada círculo del que formas parte.',
    },
    fr: {
      subtitle: 'Tout ce dont vous avez besoin pour coordonner les soins, pour chaque cercle dont vous faites partie.',
      benefit: 'Tout ce dont vous avez besoin pour coordonner les soins, dans chacun des cercles auxquels vous participez.',
    },
    de: {
      subtitle: 'Alles, was Sie brauchen, um die Pflege zu koordinieren – für jeden Kreis, in dem Sie dabei sind.',
      benefit: 'Alles, was Sie brauchen, um die Pflege gemeinsam zu organisieren – für jeden Kreis, in dem Sie Mitglied sind.',
    },
    it: {
      subtitle: 'Tutto ciò che ti serve per coordinare la cura, per ogni cerchia di cui fai parte.',
      benefit: 'Tutto ciò che ti serve per coordinare la cura, per ogni cerchia di cui fai parte.',
    },
    pt: {
      subtitle: 'Tudo o que você precisa para coordenar o cuidado, em cada círculo de que você participa.',
      benefit: 'Tudo o que você precisa para coordenar o cuidado, em todos os círculos de que faz parte.',
    },
    // European override: no "você".
    'pt-PT': {
      subtitle: 'Tudo o que precisa para coordenar o cuidado, em cada círculo de que faz parte.',
      benefit: 'Tudo o que precisa para coordenar o cuidado, em todos os círculos de que faz parte.',
    },
  };
  it.each(Object.keys(GENERAL))('%s: the general upgrade subtitle and Profile benefit read as approved', (code) => {
    expect(get(load(code, 'upgrade'), 'subtitle')).toBe(GENERAL[code].subtitle);
    expect(get(load(code, 'profile'), 'subscription.upgradeBenefit')).toBe(GENERAL[code].benefit);
  });

  it('fr-CA inherits the French general subtitle and benefit (no override)', () => {
    expect(get(load('fr-CA', 'upgrade'), 'subtitle')).toBeUndefined();
    expect(get(load('fr-CA', 'profile'), 'subscription.upgradeBenefit')).toBeUndefined();
  });

  const OLD_FAMILY_BUYER = /Everything your family needs|tu familia necesita|votre famille a besoin|Ihre Familie braucht|serve alla tua famiglia|sua família precisa/i;
  it.each(LOCALES)('%s: no paywall or Profile line assumes the buyer is a family', (code) => {
    const hits = allStrings(code).filter(
      ([k, v]) => (k.startsWith('upgrade:') || k.startsWith('profile:')) && OLD_FAMILY_BUYER.test(v)
    );
    expect(hits).toEqual([]);
  });
});
