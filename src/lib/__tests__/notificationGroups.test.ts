import { describe, expect, it } from 'vitest';
import {
  GROUPS,
  NOTIFICATION_GROUP_ORDER,
  groupOn,
  groupMixed,
  groupPatchBody,
  type NotificationGroup,
} from '../notificationGroups';

const LEGACY = ['activity_updates', 'chat_messages', 'medication_reminders'];

describe('notificationGroups', () => {
  it('has the five groups in order with the exact child keys', () => {
    // 1.4.2: Medications is split into Doses taken / Doses not marked, one key each.
    expect(NOTIFICATION_GROUP_ORDER).toEqual([
      'doses_taken',
      'doses_not_marked',
      'tasks',
      'notes',
      'tips',
      'shifts',
    ]);
    expect(GROUPS.doses_taken).toEqual(['medication_confirmations']);
    expect(GROUPS.doses_not_marked).toEqual(['missed_medications']);
    expect(GROUPS.tasks).toEqual(['task_assignments', 'appointment_reminders', 'note_nudges']);
    expect(GROUPS.notes).toEqual(['event_notes', 'care_notes']);
    expect(GROUPS.tips).toEqual(['tips_and_suggestions']);
    // Care shifts: ONE key, absent = ON (docs/plans/care-shifts.md).
    expect(GROUPS.shifts).toEqual(['shift_alerts']);
  });

  it('never includes a legacy key in any group', () => {
    const all = Object.values(GROUPS).flat() as string[];
    for (const k of LEGACY) expect(all).not.toContain(k);
  });

  describe('groupOn / groupMixed', () => {
    it.each(NOTIFICATION_GROUP_ORDER)('%s: absent keys = ON, not mixed', (g) => {
      expect(groupOn({}, g)).toBe(true);
      expect(groupMixed({}, g)).toBe(false);
    });

    it('one child false (of several) = ON and mixed', () => {
      expect(groupOn({ task_assignments: false }, 'tasks')).toBe(true);
      expect(groupMixed({ task_assignments: false }, 'tasks')).toBe(true);
      expect(groupOn({ care_notes: false }, 'notes')).toBe(true);
      expect(groupMixed({ care_notes: false }, 'notes')).toBe(true);
      expect(groupMixed({ note_nudges: false }, 'tasks')).toBe(true);
    });

    it('all children false = OFF and not mixed', () => {
      const off = {
        medication_confirmations: false,
        missed_medications: false,
        task_assignments: false,
        appointment_reminders: false,
        note_nudges: false,
        event_notes: false,
        care_notes: false,
        tips_and_suggestions: false,
        shift_alerts: false,
      };
      for (const g of NOTIFICATION_GROUP_ORDER) {
        expect(groupOn(off, g)).toBe(false);
        expect(groupMixed(off, g)).toBe(false);
      }
    });

    it('single-child group: false = OFF, never mixed; true/absent = ON', () => {
      expect(groupOn({ tips_and_suggestions: false }, 'tips')).toBe(false);
      expect(groupMixed({ tips_and_suggestions: false }, 'tips')).toBe(false);
      expect(groupOn({ tips_and_suggestions: true }, 'tips')).toBe(true);
    });

    it('one child false, another explicitly true = ON + mixed (explicit true is on)', () => {
      const p = { event_notes: true, care_notes: false };
      expect(groupOn(p, 'notes')).toBe(true);
      expect(groupMixed(p, 'notes')).toBe(true);
    });

    it('legacy keys never affect any group', () => {
      const p = { activity_updates: false, chat_messages: false, medication_reminders: false };
      for (const g of NOTIFICATION_GROUP_ORDER) {
        expect(groupOn(p, g)).toBe(true);
        expect(groupMixed(p, g)).toBe(false);
      }
    });
  });

  describe('groupPatchBody', () => {
    it('P split: each dose switch writes ONLY its own key', () => {
      expect(groupPatchBody({}, 'doses_taken', false)).toEqual({ medication_confirmations: false });
      expect(groupPatchBody({}, 'doses_taken', true)).toEqual({ medication_confirmations: true });
      expect(groupPatchBody({}, 'doses_not_marked', false)).toEqual({ missed_medications: false });
      expect(groupPatchBody({}, 'doses_not_marked', true)).toEqual({ missed_medications: true });
    });

    it('P split: old values preserved: each switch reads its own stored key (absent = ON)', () => {
      expect(groupOn({}, 'doses_taken')).toBe(true);
      expect(groupOn({}, 'doses_not_marked')).toBe(true);
      const oldOff = { medication_confirmations: false, missed_medications: false };
      expect(groupOn(oldOff, 'doses_taken')).toBe(false);
      expect(groupOn(oldOff, 'doses_not_marked')).toBe(false);
      const halfOff = { missed_medications: false };
      expect(groupOn(halfOff, 'doses_taken')).toBe(true);
      expect(groupOn(halfOff, 'doses_not_marked')).toBe(false);
      // Single-key groups are never "mixed".
      expect(groupMixed(halfOff, 'doses_taken')).toBe(false);
      expect(groupMixed(halfOff, 'doses_not_marked')).toBe(false);
    });

    it('tasks body pins event_notes: absent -> true', () => {
      expect(groupPatchBody({}, 'tasks', false)).toEqual({
        task_assignments: false,
        appointment_reminders: false,
        note_nudges: false,
        event_notes: true,
      });
    });

    it('tasks body pins event_notes: stored false -> false', () => {
      expect(groupPatchBody({ event_notes: false }, 'tasks', false)).toEqual({
        task_assignments: false,
        appointment_reminders: false,
        note_nudges: false,
        event_notes: false,
      });
      expect(groupPatchBody({ event_notes: false }, 'tasks', true).event_notes).toBe(false);
    });

    it('notes body has exactly event_notes + care_notes and never note_nudges', () => {
      for (const next of [true, false]) {
        const body = groupPatchBody({ note_nudges: false }, 'notes', next);
        expect(body).toEqual({ event_notes: next, care_notes: next });
        expect(Object.keys(body)).not.toContain('note_nudges');
      }
    });

    it('shifts body is one key and is ON when absent', () => {
      expect(groupPatchBody({}, 'shifts', false)).toEqual({ shift_alerts: false });
      expect(groupOn({}, 'shifts')).toBe(true);
      expect(groupOn({ shift_alerts: false }, 'shifts')).toBe(false);
    });

    it('tips body is one key', () => {
      expect(groupPatchBody({}, 'tips', false)).toEqual({ tips_and_suggestions: false });
    });

    it('no body ever contains a legacy key or the whole prefs object', () => {
      const prefs = {
        activity_updates: false,
        chat_messages: false,
        medication_reminders: false,
        missed_medications: false,
      };
      for (const g of NOTIFICATION_GROUP_ORDER as readonly NotificationGroup[]) {
        for (const next of [true, false]) {
          const keys = Object.keys(groupPatchBody(prefs, g, next));
          for (const k of LEGACY) expect(keys).not.toContain(k);
        }
      }
      expect(Object.keys(groupPatchBody(prefs, 'doses_taken', false))).toEqual([
        'medication_confirmations',
      ]);
      expect(Object.keys(groupPatchBody(prefs, 'doses_not_marked', false))).toEqual([
        'missed_medications',
      ]);
    });

    it('does not mutate the input prefs', () => {
      const prefs = Object.freeze({ event_notes: false });
      expect(() => groupPatchBody(prefs, 'tasks', false)).not.toThrow();
    });
  });
});
