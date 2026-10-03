// B4 finding, fixed in B5: a Spanish 12-hour time ends in a period ("8:02 a. m."), so the
// change-answer sentence "... a las {{time}}. ¿Cambiarla ..." printed "a. m.. ¿Cambiarla".
import i18n from '@/i18n';
import { changeAnswerCopy, type DoseAlreadyRecorded } from '@/lib/doseAlreadyRecorded';

const ana = (status: 'taken' | 'skipped', name: string | null): DoseAlreadyRecorded => ({
  status,
  recordedByName: name,
  // 08:02 in Denver (MDT, UTC-6).
  recordedAt: '2026-06-12T14:02:00Z',
  timezone: 'America/Denver',
});

describe('changeAnswerCopy: no double period after a Spanish meridiem', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['named, taken -> skip', ana('taken', 'Ana'), 'skipped'],
    ['named, skipped -> take', ana('skipped', 'Ana'), 'taken'],
    ['no name, taken -> skip', ana('taken', null), 'skipped'],
    ['no name, skipped -> take', ana('skipped', null), 'taken'],
  ] as const)('ES 12h, %s', async (_label, details, mine) => {
    await i18n.changeLanguage('es');
    const copy = changeAnswerCopy(i18n.t.bind(i18n) as never, details, mine, '12h' as never)!;
    expect(copy.message).toMatch(/a las 8:02\s[a]\.\s?m\. ¿Cambiarla a /);
    expect(copy.message).not.toMatch(/m\.\./);
  });

  it('ES 24h and EN are unchanged', async () => {
    await i18n.changeLanguage('es');
    const es24 = changeAnswerCopy(i18n.t.bind(i18n) as never, ana('taken', 'Ana'), 'skipped', '24h' as never)!;
    expect(es24.message).toContain('a las 08:02. ¿Cambiarla a omitida?');
    await i18n.changeLanguage('en');
    const en = changeAnswerCopy(i18n.t.bind(i18n) as never, ana('taken', 'Ana'), 'skipped', '12h' as never)!;
    expect(en.message).toContain('taken at 8:02 AM. Change it to skipped?');
  });
});
