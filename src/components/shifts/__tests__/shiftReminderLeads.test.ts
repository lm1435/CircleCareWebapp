/**
 * Multiple shift reminders (1.4.2): `reminder_leads_minutes` is every lead, longest first, `null` = off and
 * never `[]`. Reading falls back to the legacy single `reminder_lead_minutes`. Mobile twin:
 * mobile/src/__tests__/utils/shiftReminderLeads.test.ts.
 */
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import {
  formatShiftReminders,
  normalizeShiftLeads,
  sameShiftLeads,
  shiftReminderBody,
  setShiftRemindersEnabled,
  shiftReminderLeads,
  shiftReminderStateFrom,
  shiftRemindersForSave,
  toggleShiftLead,
} from '../shiftUtils';

const t = i18n.getFixedT('en') as unknown as (key: string, o?: Record<string, unknown>) => string;

describe('reading a shift row', () => {
  it('P: prefers reminder_leads_minutes, sorted longest first', () => {
    expect(shiftReminderLeads({ reminder_leads_minutes: [60, 1440], reminder_lead_minutes: 60 })).toEqual([1440, 60]);
  });
  it('P: a legacy row with only reminder_lead_minutes = 120 reads [120]', () => {
    expect(shiftReminderLeads({ reminder_lead_minutes: 120 })).toEqual([120]);
  });
  it('N: an explicit null / [] array wins over the legacy field and reads Off', () => {
    expect(shiftReminderLeads({ reminder_leads_minutes: null, reminder_lead_minutes: 120 })).toBeNull();
    expect(shiftReminderLeads({ reminder_leads_minutes: [], reminder_lead_minutes: 120 })).toBeNull();
  });
  it('N: neither field, a null legacy value, or no row = Off', () => {
    expect(shiftReminderLeads({})).toBeNull();
    expect(shiftReminderLeads({ reminder_lead_minutes: null })).toBeNull();
    expect(shiftReminderLeads(null)).toBeNull();
  });
  it('N: unknown leads and duplicates are dropped', () => {
    expect(normalizeShiftLeads([30, 60, 60, 999, 240])).toEqual([240, 60]);
    expect(normalizeShiftLeads([30])).toBeNull();
  });
});

describe('the card state', () => {
  it('P: checking 1 day on top of 1 hour = [1440, 60]', () => {
    expect(shiftRemindersForSave(toggleShiftLead(shiftReminderStateFrom([60]), 1440))).toEqual([1440, 60]);
  });
  it('N: unchecking the last lead turns the toggle off; saves null, never []', () => {
    const s = toggleShiftLead(shiftReminderStateFrom([60]), 60);
    expect(s.enabled).toBe(false);
    expect(shiftRemindersForSave(s)).toBeNull();
  });
  it('P: toggle off keeps the checks and saves null; back on restores them', () => {
    const off = setShiftRemindersEnabled(shiftReminderStateFrom([1440, 60]), false);
    expect(off.leads).toEqual([1440, 60]);
    expect(shiftRemindersForSave(off)).toBeNull();
    expect(shiftRemindersForSave(setShiftRemindersEnabled(off, true))).toEqual([1440, 60]);
  });
  it('P: back on with nothing checked = [60]', () => {
    expect(shiftRemindersForSave(setShiftRemindersEnabled(shiftReminderStateFrom(null), true))).toEqual([60]);
  });
  it('sameShiftLeads is order-insensitive and treats null / [] alike', () => {
    expect(sameShiftLeads([60, 1440], [1440, 60])).toBe(true);
    expect(sameShiftLeads(null, [])).toBe(true);
    expect(sameShiftLeads([60], null)).toBe(false);
    expect(sameShiftLeads([60], [60, 120])).toBe(false);
  });
});

describe('the summary line', () => {
  it('P: two leads read like the task card list: "1 day before, 1 hour before"', () => {
    expect(formatShiftReminders([60, 1440], t)).toBe('1 day before, 1 hour before');
  });
  it('one lead and Off', () => {
    expect(formatShiftReminders([120], t)).toBe('2 hours before');
    expect(formatShiftReminders(null, t)).toBe('Off');
    expect(formatShiftReminders([], t)).toBe('Off');
  });
});

describe('the write body (list + legacy mirror)', () => {
  it('P: [1440, 60] sends reminder_lead_minutes 60', () => {
    expect(shiftReminderBody([1440, 60])).toEqual({ reminder_lead_minutes: 60, reminder_leads_minutes: [1440, 60] });
  });
  it('P: off sends both null', () => {
    expect(shiftReminderBody(null)).toEqual({ reminder_lead_minutes: null, reminder_leads_minutes: null });
  });
  it('N: never the list without the mirror; [] folds to Off', () => {
    for (const r of [[60], [240, 120], [1440, 240, 120, 60], [], null] as never[]) {
      const b = shiftReminderBody(r);
      expect(Object.keys(b)).toEqual(['reminder_lead_minutes', 'reminder_leads_minutes']);
      expect(b.reminder_leads_minutes).not.toEqual([]);
    }
  });
});
