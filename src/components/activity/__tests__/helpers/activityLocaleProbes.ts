/**
 * THIS FILE HOLDS ITS OWN COPY of the probe inputs in activityTranslationSnapshotLock.test.ts
 * (the lock is frozen and byte-identical to HEAD). Do NOT 'fix' the duplication by making the
 * lock import from here, or this from the lock.
 *
 * PROBE SET for the activity-feed word-order locks. The probe INPUTS (stored-English
 * descriptions the backend writes) live here so `activityTranslationSnapshotLock.test.ts`
 * (en + es, frozen) and every per-locale twin
 * `activityTranslationSnapshot.<code>.test.ts` render the same rows. Adding a probe here
 * changes no existing snapshot only if the lock does not enumerate it; DO NOT edit the cases
 * from a language lane (shared file) -- ask the owner.
 *
 */
import {
  renderActivityDescription,
  type ActivityDescriptionSource,
} from '@/components/activity/activityTranslation';

export type Row = ActivityDescriptionSource;
export const NOW = new Date('2026-10-06T18:00:00Z');
export const NAME = 'Alicia Smith';
export const EMAIL = 'alicia.smith@example.org';

export const row = (
  action_type: string | null,
  description: string,
  description_key: string | null = null,
  description_params: Record<string, unknown> | null = null
): Row => ({ action_type, description, description_key, description_params });

export const SENTENCE_CASES: Array<[string, Row]> = [
  ['left nameless', row('member_left', 'A member left the circle')],
  ['left nameless account deleted', row('member_left', 'A member left the circle (account deleted)')],
  ['left named account deleted', row('member_left', `${NAME} left the circle (account deleted)`)],
  ['left named', row('member_left', `${NAME} left the circle`)],
  ['left email', row('member_left', `${EMAIL} left the circle`)],
  ['removed nameless', row('member_removed', 'A member was removed from the circle')],
  ['removed named', row('member_removed', `${NAME} was removed from the circle`)],
  ['invited scrubbed', row('member_invited', 'A member was invited to the circle')],
  ['joined scrubbed', row('member_joined', 'A member joined the circle')],
  ['self-care circle', row('circle_created', `Created Self-Care Circle for ${NAME}`)],
  ['discontinued med', row('medication_updated', 'Discontinued medication: Metformin 500mg')],
  ['reactivated med', row('medication_updated', 'Reactivated medication: Metformin 500mg')],
  ['rescheduled med legacy', row('medication_updated', 'Rescheduled Medication: Metformin to 20:00')],
  ['rescheduled med legacy 1-digit hour', row('medication_updated', 'Rescheduled Medication: Metformin to 8:05')],
  ['added notes', row('note_added', 'Added notes to Dr. Lee visit')],
  // gating: wrong action_type must NOT match (falls to phrase path, stays English)
  ['gate: left text under task_added', row('task_added', 'Mom left the circle')],
  ['gate: no action type', row(null, `${NAME} left the circle`)],
  // anchoring: trailing junk does not match
  ['anchor: junk after discontinued', row('note_added', 'Added notes to')],
];

const legacy = (d: string): Row => row(null, d);
export const PHRASE_CASES: Array<[string, Row]> = [
  ['confirmed taken', legacy('Confirmed Medication: Aspirin (taken)')],
  ['confirmed taken late', legacy('Confirmed Medication: Aspirin (taken late)')],
  ['confirmed skipped', legacy('Confirmed Medication: Aspirin (skipped)')],
  ['confirmed missed', legacy('Confirmed Medication: Aspirin (missed)')],
  ['confirmed not taken', legacy('Confirmed Medication: Aspirin (not taken)')],
  ['confirmed overwrite', legacy("Confirmed Medication: Aspirin (skipped) (changed another caregiver's answer)")],
  ['added med', legacy('Added Medication: Aspirin')],
  ['updated med', legacy('Updated Medication: Aspirin')],
  ['deleted med', legacy('Deleted Medication: Aspirin')],
  ['completed med', legacy('Completed Medication: Aspirin')],
  ['added appt', legacy('Added Appointment: Cardiology')],
  ['updated appt', legacy('Updated Appointment: Cardiology')],
  ['deleted appt', legacy('Deleted Appointment: Cardiology')],
  ['completed appt', legacy('Completed Appointment: Cardiology')],
  ['added task', legacy('Added Task: Buy milk')],
  ['updated task', legacy('Updated Task: Buy milk')],
  ['deleted task', legacy('Deleted Task: Buy milk')],
  ['completed task', legacy('Completed Task: Buy milk')],
  ['created care circle', legacy(`Created Care Circle for ${NAME}`)],
  ['joined as care recipient', legacy(`${NAME} joined the circle as Care Recipient`)],
  ['joined as caregiver', legacy(`${NAME} joined the circle as Caregiver`)],
  ['joined as family member', legacy(`${NAME} joined the circle as Family Member`)],
  ['invited care recipient', legacy(`Invited ${EMAIL} to join as Care Recipient`)],
  ['invited caregiver', legacy(`Invited ${EMAIL} to join as Caregiver`)],
  ['emergency info', legacy('Updated emergency information')],
  ['prn logged', legacy('Logged a dose: Tylenol')],
  ['prn removed', legacy('Removed a logged dose: Tylenol')],
  ['no match passthrough', legacy('Something the backend invented')],
  ['empty', legacy('')],
];

export const DATED_CASES: Array<[string, Row]> = [
  ['not taken (new) old date', legacy('Not taken: Aspirin on 2026-06-10')],
  ['not taken (new) today', legacy('Not taken: Aspirin on 2026-10-06')],
  ['not taken (new) yesterday', legacy('Not taken: Aspirin on 2026-10-05')],
  ['not taken Jan 15', legacy('Not taken: Aspirin on 2026-01-15')],
  ['skipped (legacy) old date', legacy('Skipped Aspirin on 2026-06-10')],
  ['skipped (legacy) Jan 15', legacy('Skipped Aspirin on 2026-01-15')],
  ['title with " on "', legacy('Not taken: Visit on call on 2026-06-10')],
  ['stopped recurrence', legacy('Stopped recurrence for Aspirin from 2026-06-10')],
  ['stopped recurrence Jan 15', legacy('Stopped recurrence for Aspirin from 2026-01-15')],
  ['stopped recurrence today', legacy('Stopped recurrence for Aspirin from 2026-10-06')],
  ['imported 1', legacy('Imported 1 appointment from calendar')],
  ['imported 0', legacy('Imported 0 appointments from calendar')],
  ['imported 2', legacy('Imported 2 appointments from calendar')],
  ['imported 25', legacy('Imported 25 appointments from calendar')],
  ['dated no match (not anchored)', legacy('Not taken: Aspirin on June 10')],
];

const k = (key: string, params: Record<string, unknown>): Row =>
  row('x', 'STORED ENGLISH FALLBACK', key, params);
export const KEYED_CASES: Array<[string, Row]> = [
  ['rescheduled', k('entries.medicationRescheduled', { title: 'Metformin', scheduledTime: '20:00:00' })],
  ['rescheduled morning HH:MM', k('entries.medicationRescheduled', { title: 'Metformin', scheduledTime: '08:05' })],
  ['rescheduled noon', k('entries.medicationRescheduled', { title: 'Metformin', scheduledTime: '12:00:00' })],
  ['rescheduled midnight', k('entries.medicationRescheduled', { title: 'Metformin', scheduledTime: '00:00:00' })],
  ['rescheduled out-of-range raw', k('entries.medicationRescheduled', { title: 'Metformin', scheduledTime: '25:00:00' })],
  ['rescheduled unparseable raw', k('entries.medicationRescheduled', { title: 'Metformin', scheduledTime: 'evening' })],
  ['not taken old', k('entries.medicationNotTaken', { title: 'Aspirin', scheduledDate: '2026-06-10' })],
  ['not taken today', k('entries.medicationNotTaken', { title: 'Aspirin', scheduledDate: '2026-10-06' })],
  ['not taken yesterday', k('entries.medicationNotTaken', { title: 'Aspirin', scheduledDate: '2026-10-05' })],
  ['not taken Jan 15', k('entries.medicationNotTaken', { title: 'Aspirin', scheduledDate: '2026-01-15' })],
  ['not taken non-ISO date raw', k('entries.medicationNotTaken', { title: 'Aspirin', scheduledDate: 'June 10' })],
  ['med occurrence removed', k('entries.medicationOccurrenceRemoved', { title: 'Aspirin', scheduledDate: '2026-06-10' })],
  ['appt occurrence removed', k('entries.appointmentOccurrenceRemoved', { title: 'Cardiology', scheduledDate: '2026-06-10' })],
  ['task occurrence removed', k('entries.taskOccurrenceRemoved', { title: 'Buy milk', scheduledDate: '2026-06-10' })],
  ['recurrence stopped', k('entries.recurrenceStopped', { title: 'Aspirin', scheduledDate: '2026-06-10' })],
  ['invited care recipient', k('entries.memberInvited.careRecipient', { email: EMAIL })],
  ['invited caregiver', k('entries.memberInvited.caregiver', { email: EMAIL })],
  ['joined care recipient', k('entries.memberJoined.careRecipient', { name: NAME })],
  ['joined caregiver', k('entries.memberJoined.caregiver', { name: NAME })],
  ['joined care recipient unknown', k('entries.memberJoined.careRecipientUnknown', {})],
  ['joined caregiver unknown', k('entries.memberJoined.caregiverUnknown', {})],
  ['event note added', k('entries.eventNoteAdded', { title: 'Dr. Lee visit' })],
  ['care note added', k('entries.careNoteAdded', {})],
  ['prn logged', k('entries.asNeededDoseLogged', { title: 'Tylenol', time: '14:30:00' })],
  ['prn removed', k('entries.asNeededDoseRemoved', { title: 'Tylenol', time: '14:30:00' })],
  // fallbacks to the stored description
  ['fallback unknown key', k('entries.somethingNew', { title: 'X' })],
  ['fallback prototype key', k('constructor', { title: 'X' })],
  ['fallback empty params', k('entries.medicationRescheduled', {})],
  ['fallback blank name', k('entries.memberJoined.caregiver', { name: '   ' })],
  ['fallback numeric time', k('entries.medicationRescheduled', { title: 'M', scheduledTime: 2000 })],
  ['fallback null params', row('x', 'STORED ENGLISH FALLBACK', 'entries.careNoteAdded', null)],
];

export type RenderOpts = { timezone?: string | null; hourCycle?: '12h' | '24h' };
type TFn = Parameters<typeof renderActivityDescription>[1];

/** Render one row for `locale` in the pinned frame (viewer zone Denver unless overridden). */
export const renderFor = (r: Row, t: TFn, locale: string, o: RenderOpts = {}): string =>
  renderActivityDescription(r, t, {
    timezone: o.timezone === undefined ? 'America/Denver' : o.timezone,
    hourCycle: o.hourCycle ?? '12h',
    locale,
    now: NOW,
  });

/** { label: rendered } for a probe list. */
export const probeSet = (
  cases: Array<[string, Row]>,
  t: TFn,
  locale: string,
  o?: RenderOpts
): Record<string, string> =>
  Object.fromEntries(cases.map(([k, r]) => [k, renderFor(r, t, locale, o)]));

/** The time-sensitive subset of the keyed cases (24h / zone-label / null-zone variants). */
export const KEYED_TIME_CASES = KEYED_CASES.filter(
  ([n]) => n.startsWith('rescheduled') || n.startsWith('prn')
);
