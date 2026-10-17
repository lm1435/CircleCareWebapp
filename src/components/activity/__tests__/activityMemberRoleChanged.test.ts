import i18n from '@/i18n';
import {
  renderActivityDescription,
  type ActivityDescriptionSource,
} from '@/components/activity/activityTranslation';
import { getActivityIcon } from '@/components/activity/ActivityIcon';

// Manager role feed row (backend routes/circles.ts PATCH …/members/:userId/role):
//   action_type 'member_role_changed'
//   description "<Name> is now a manager" | "<Name> is no longer a manager"
//   description_key entries.memberRoleChanged.manager | .member, params { name }
// and the account-deletion scrub's key-less "A member's role in the circle
// changed" (services/accountDeletionFeedScrub.ts FEED_NEUTRAL_ROLE_CHANGED).
//
// EN must be BYTE-IDENTICAL to the stored sentence; every other locale must be
// translated (the real fixed-T over the shipped bundles, so a missing string fails).

const CTX = { timezone: 'America/Denver', hourCycle: '12h' as const };
type Row = ActivityDescriptionSource & { action_type: string };
const row = (
  description: string,
  description_key: string | null = null,
  description_params: Record<string, unknown> | null = null
): Row => ({ action_type: 'member_role_changed', description, description_key, description_params });

const render = (r: Row, lng: string): string =>
  renderActivityDescription(r, i18n.getFixedT(lng, 'activity'), { ...CTX, locale: lng });

beforeAll(async () => {
  await i18n.loadLanguages(['es', 'fr', 'de', 'it', 'pt', 'pt-PT', 'fr-CA']);
});

const PROMOTED = row('Nadia Okafor is now a manager', 'entries.memberRoleChanged.manager', { name: 'Nadia Okafor' });
const DEMOTED = row('Nadia Okafor is no longer a manager', 'entries.memberRoleChanged.member', { name: 'Nadia Okafor' });
const SCRUBBED = row("A member's role in the circle changed");

describe('member_role_changed feed row', () => {
  it('EN is byte-identical to the stored description', () => {
    expect(render(PROMOTED, 'en')).toBe('Nadia Okafor is now a manager');
    expect(render(DEMOTED, 'en')).toBe('Nadia Okafor is no longer a manager');
    expect(render(SCRUBBED, 'en')).toBe("A member's role in the circle changed");
  });

  it('ES renders from the key (Latin American, gender-neutral)', () => {
    expect(render(PROMOTED, 'es')).toBe('Nadia Okafor ahora ayuda a administrar el círculo');
    expect(render(DEMOTED, 'es')).toBe('Nadia Okafor ya no ayuda a administrar el círculo');
    expect(render(SCRUBBED, 'es')).toBe('Cambió el rol de un miembro en el círculo');
  });

  // The KEY is the source of truth: the params name wins over the stored
  // sentence (pins the key renderer itself, not the sentence fallback).
  it('renders from description_key + params, not from the stored sentence', () => {
    const r = row('Someone else is now a manager', 'entries.memberRoleChanged.manager', { name: 'Nadia Okafor' });
    expect(render(r, 'en')).toBe('Nadia Okafor is now a manager');
    expect(render(r, 'es')).toBe('Nadia Okafor ahora ayuda a administrar el círculo');
    const d = row('Someone else is no longer a manager', 'entries.memberRoleChanged.member', { name: 'Nadia Okafor' });
    expect(render(d, 'es')).toBe('Nadia Okafor ya no ayuda a administrar el círculo');
  });

  it('a row with an unusable name param falls back to the stored sentence, still translated', () => {
    const blank = row('Nadia Okafor is now a manager', 'entries.memberRoleChanged.manager', { name: '' });
    expect(render(blank, 'es')).toBe('Nadia Okafor ahora ayuda a administrar el círculo');
    const keyless = row('Nadia Okafor is no longer a manager');
    expect(render(keyless, 'es')).toBe('Nadia Okafor ya no ayuda a administrar el círculo');
  });

  it.each(['fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT'])('%s leaves no English behind', (lng) => {
    for (const r of [PROMOTED, DEMOTED, SCRUBBED]) {
      const out = render(r, lng);
      expect(out).not.toMatch(/manager|member's role/i);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('pt-PT uses the European wording, not the Brazilian one', () => {
    expect(render(PROMOTED, 'pt-PT')).toBe('Nadia Okafor agora ajuda a gerir o círculo');
    expect(render(PROMOTED, 'pt')).toBe('Nadia Okafor agora ajuda a gerenciar o círculo');
  });

  it('gets the circle glyph like the other membership rows', () => {
    expect(getActivityIcon('member_role_changed')).toBe(getActivityIcon('member_removed'));
  });
});
