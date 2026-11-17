import i18n from '@/i18n';
import {
  renderActivityDescription,
  type ActivityDescriptionSource,
} from '@/components/activity/activityTranslation';

// 1.4.3 invite decline (docs/plans/invite-decline-1-4-3.md): the backend writes
// `action_type: 'invite_declined'` with `entries.inviteDeclined` ({ name }) or
// `entries.inviteDeclinedUnknown` ({}), and a fixed English description. Web twin
// of the mobile snapshot rows (key.inviteDeclined*, phrase.declinedInvite).

const tEn = i18n.getFixedT('en', 'activity');
const tEs = i18n.getFixedT('es', 'activity');

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/Denver',
  } as Intl.ResolvedDateTimeFormatOptions);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const CTX = { timezone: 'America/Denver', hourCycle: '12h' as const };
const render = (r: ActivityDescriptionSource & { action_type: string }, lng: 'en' | 'es') =>
  renderActivityDescription(r, lng === 'es' ? tEs : tEn, { ...CTX, locale: lng });

const keyed = (description: string, key: string, params: Record<string, unknown>) => ({
  action_type: 'invite_declined',
  description,
  description_key: key,
  description_params: params,
});
const legacy = (description: string) => ({
  action_type: 'invite_declined',
  description,
  description_key: null,
  description_params: null,
});

describe('invite declined in the activity feed (1.4.3)', () => {
  it('POSITIVE: the keyed row names the invitee in EN and ES', () => {
    const r = keyed('Sarah Kim declined the invite', 'entries.inviteDeclined', { name: 'Sarah Kim' });
    expect(render(r, 'en')).toBe('Sarah Kim declined the invite');
    expect(render(r, 'es')).toBe('Sarah Kim rechazó la invitación');
  });

  it('POSITIVE: the nameless row', () => {
    const r = keyed('An invite was declined', 'entries.inviteDeclinedUnknown', {});
    expect(render(r, 'en')).toBe('An invite was declined');
    expect(render(r, 'es')).toBe('Se rechazó una invitación');
  });

  it('POSITIVE: the keyless (legacy) path still reads in Spanish', () => {
    expect(render(legacy('Sarah Kim declined the invite'), 'es')).toBe('Sarah Kim rechazó la invitación');
    expect(render(legacy('An invite was declined'), 'es')).toBe('Se rechazó una invitación');
  });

  it('NEGATIVE: an empty name never renders a holed sentence (falls back to the stored one)', () => {
    const r = keyed('An invite was declined', 'entries.inviteDeclined', { name: '  ' });
    const es = render(r, 'es');
    expect(es).not.toMatch(/^\s*rechazó/);
    expect(es).toBe('Se rechazó una invitación');
  });

  it('NEGATIVE: no English is left in the Spanish rows', () => {
    const out = render(keyed('Sarah Kim declined the invite', 'entries.inviteDeclined', { name: 'Sarah Kim' }), 'es');
    expect(out).not.toMatch(/declined|invite\b/);
  });
});
