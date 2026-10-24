// FIND_NOTES reply actions — the pure half (components/ai/aiReplyActions.ts).
// Mobile twin: mobile/src/__tests__/components/aiReplyActions.test.ts.
import i18n from 'i18next';
import '@/i18n';
import en from '@/i18n/en/ai.json';
import es from '@/i18n/es/ai.json';
import fr from '@/i18n/fr/ai.json';
import it_ from '@/i18n/it/ai.json';
import pt from '@/i18n/pt/ai.json';
import de from '@/i18n/de/ai.json';
import enCommon from '@/i18n/en/common.json';
import esCommon from '@/i18n/es/common.json';
import frCommon from '@/i18n/fr/common.json';
import itCommon from '@/i18n/it/common.json';
import ptCommon from '@/i18n/pt/common.json';
import deCommon from '@/i18n/de/common.json';
import {
  MAX_REPLY_ACTIONS,
  parseNotesPath,
  replyActionKey,
  replyActionLabel,
  replyActionRoute,
  sanitizeReplyActions,
} from '../aiReplyActions';

const ID = '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

describe('sanitizeReplyActions', () => {
  it('keeps the three known shapes in server order', () => {
    expect(
      sanitizeReplyActions([
        { type: 'open_provider', provider_id: ID, provider_name: ' Dr Patel ' },
        { type: 'open_notes' },
        { type: 'open_doctors', extra: 1 },
      ])
    ).toEqual([
      { type: 'open_provider', provider_id: ID, provider_name: 'Dr Patel' },
      { type: 'open_notes' },
      { type: 'open_doctors' },
    ]);
  });

  it('an older backend (no field) and junk give no actions', () => {
    expect(sanitizeReplyActions(undefined)).toEqual([]);
    expect(sanitizeReplyActions({ type: 'open_notes' })).toEqual([]);
  });

  it('drops unknown types and malformed providers', () => {
    expect(
      sanitizeReplyActions([
        { type: 'open_web_page', url: 'https://x' },
        { type: 'open_provider', provider_id: '../../admin', provider_name: 'X' },
        { type: 'open_provider', provider_id: ID, provider_name: ' ' },
        null,
        { type: 'open_notes' },
      ])
    ).toEqual([{ type: 'open_notes' }]);
  });

  it(`caps at ${MAX_REPLY_ACTIONS}`, () => {
    expect(sanitizeReplyActions(Array.from({ length: 20 }, () => ({ type: 'open_doctors' })))).toHaveLength(
      MAX_REPLY_ACTIONS
    );
  });
});

describe('parseNotesPath', () => {
  it('accepts the three targets, coerces booleans, rejects the rest', () => {
    expect(parseNotesPath({ target: 'doctor_list', doctor_named: true })).toEqual({
      target: 'doctor_list',
      doctor_named: true,
      doctor_matched: false,
    });
    expect(parseNotesPath({ target: 'x' })).toBeNull();
    expect(parseNotesPath(undefined)).toBeNull();
  });
});

describe('labels', () => {
  it('uses the real English UI labels', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.getFixedT('en', 'ai');
    expect(replyActionLabel(t, { type: 'open_notes' })).toBe('Open Notes');
    expect(replyActionLabel(t, { type: 'open_doctors' })).toBe('See Doctors');
    expect(replyActionLabel(t, { type: 'open_provider', provider_id: ID, provider_name: 'Dr Patel' })).toBe(
      'Dr Patel: Visits & notes'
    );
  });

  it.each([
    ['en', en, enCommon],
    ['es', es, esCommon],
    ['fr', fr, frCommon],
    ['it', it_, itCommon],
    ['pt', pt, ptCommon],
    ['de', de, deCommon],
  ])('%s: the provider label carries the Visits & notes page title', (_code, ai, common) => {
    const actions = (ai as any).actions;
    expect(actions.openProvider).toContain('{{name}}');
    expect(actions.openProvider).toContain((common as any).pageTitles.providerVisits);
    expect(actions.openNotes.length).toBeGreaterThan(0);
    expect(actions.openDoctors.length).toBeGreaterThan(0);
  });

  it('mobile and web use the same notes/doctors button copy', async () => {
    // Parity: identical strings to mobile/src/i18n/locales/<code>.json aiAssistant.actions.
    expect([en.actions.openNotes, en.actions.openDoctors]).toEqual(['Open Notes', 'See Doctors']);
    expect([es.actions.openNotes, es.actions.openDoctors]).toEqual(['Abrir notas', 'Ver doctores']);
  });
});

describe('replyActionRoute', () => {
  it('open_notes -> Care > Notes', () => {
    expect(replyActionRoute({ type: 'open_notes' }, 'c1')).toEqual({ to: '/circles/c1/notes' });
  });
  it('open_doctors -> Health > Emergency Info', () => {
    expect(replyActionRoute({ type: 'open_doctors' }, 'c1')).toEqual({ to: '/circles/c1/emergency' });
  });
  it('open_provider -> that doctor\'s Visits & notes, source ai_chat in router state', () => {
    expect(
      replyActionRoute({ type: 'open_provider', provider_id: ID, provider_name: 'Dr Patel' }, 'c1')
    ).toEqual({ to: `/circles/c1/providers/${ID}`, state: { source: 'ai_chat' } });
  });
  it('keys are unique per provider', () => {
    expect(replyActionKey({ type: 'open_provider', provider_id: ID, provider_name: 'x' })).toBe(`open_provider-${ID}`);
  });
});
