/**
 * The simple forms' "Reminders" summary row (owner 2026-11-10): it must state what WILL happen,
 * from the same state the Reminders card edits. The medication follow-ups run whenever
 * notifications are on, so the line names them: that is the exact misreading a customer hit
 * (all boxes off, escalations still firing).
 *
 * Rendered through the REAL en / es bundles, so a missing or reworded string fails here.
 * Mobile pins the identical strings (mobile/src/__tests__/utils/reminderSummary.test.ts).
 */
import i18n from '@/i18n';
import {
  reminderSummary,
  reminderSummaryLabel,
  reminderSummaryText,
  type ReminderSummaryInput,
} from '../reminderSummary';

const NONE = { reminder24h: false, reminder1h: false, reminder30m: false, reminder15m: false };
const base = (over: Partial<ReminderSummaryInput>): ReminderSummaryInput => ({
  eventType: 'medication',
  notificationsEnabled: true,
  reminderAtDue: true,
  ...NONE,
  ...over,
});

function text(input: ReminderSummaryInput, lng = 'en'): string {
  return reminderSummaryText(i18n.getFixedT(lng, 'calendar'), reminderSummary(input), lng);
}

describe('reminder summary state', () => {
  it('maps the card state onto off / none / follow_ups_only / set', () => {
    expect(reminderSummary(base({ notificationsEnabled: false })).state).toBe('off');
    expect(reminderSummary(base({ eventType: 'task', reminderAtDue: false })).state).toBe('none');
    expect(reminderSummary(base({ reminderAtDue: false })).state).toBe('follow_ups_only');
    expect(reminderSummary(base({})).state).toBe('set');
  });
});

describe('reminder summary text', () => {
  it('master off reads "off" on every type', () => {
    expect(text(base({ notificationsEnabled: false, reminder1h: true }))).toBe('off');
    expect(text(base({ eventType: 'task', notificationsEnabled: false }))).toBe('off');
    expect(text(base({ notificationsEnabled: false }), 'es')).toBe('desactivados');
  });

  it('medication at-due only names the follow-ups', () => {
    expect(text(base({}))).toBe('At the scheduled time · follow-ups on');
    expect(text(base({}), 'es')).toBe('A la hora programada · seguimientos activados');
  });

  it('appointment at-due only says no follow-ups (there is no chain)', () => {
    expect(text(base({ eventType: 'appointment' }))).toBe('At the scheduled time');
    expect(text(base({ eventType: 'appointment' }), 'es')).toBe('A la hora programada');
  });

  it('earlier + at-due lists earliest first, the at-time alert last', () => {
    expect(text(base({ eventType: 'task', reminder1h: true }))).toBe(
      '1 hour before, at the scheduled time'
    );
    expect(text(base({ eventType: 'appointment', reminder24h: true, reminder15m: true }))).toBe(
      '24 hours before, 15 minutes before, at the scheduled time'
    );
    expect(text(base({ eventType: 'task', reminder1h: true }), 'es')).toBe(
      '1 hora antes, a la hora programada'
    );
  });

  it('medication with every box off but notifications on: follow-ups only, said out loud', () => {
    expect(text(base({ reminderAtDue: false }))).toBe(
      'Follow-ups only · nothing at the scheduled time'
    );
    expect(text(base({ reminderAtDue: false }), 'es')).toBe(
      'Solo seguimientos · nada a la hora programada'
    );
  });

  it('medication with an earlier reminder but no at-due still names the follow-ups', () => {
    expect(text(base({ reminderAtDue: false, reminder1h: true }))).toBe(
      '1 hour before · nothing at the scheduled time · follow-ups on'
    );
  });

  it('task with everything off while the master is on reads "none" (silent)', () => {
    expect(text(base({ eventType: 'task', reminderAtDue: false }))).toBe('none');
    expect(text(base({ eventType: 'task', reminderAtDue: false }), 'es')).toBe('ninguno');
  });

  it('the accessibility label carries the full sentence', () => {
    expect(
      reminderSummaryLabel(i18n.getFixedT('en', 'calendar'), reminderSummary(base({})), 'en')
    ).toBe('Reminders: At the scheduled time · follow-ups on');
    expect(
      reminderSummaryLabel(i18n.getFixedT('es', 'calendar'), reminderSummary(base({})), 'es')
    ).toBe('Recordatorios: A la hora programada · seguimientos activados');
  });
});
