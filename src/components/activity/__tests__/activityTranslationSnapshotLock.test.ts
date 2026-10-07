import i18n from '@/i18n';
import {
  renderActivityDescription,
  translateActivityDescription,
  translateSentenceRow,
  type ActivityDescriptionSource,
} from '@/components/activity/activityTranslation';

// PRE-REFACTOR SNAPSHOT LOCK (Wave 0, i18n plumbing generalization).
//
// Every SENTENCE_RULE, every legacy phrase, every dated/regex form, both plural
// forms, every KEY_RENDERERS entry and the time formatting, rendered through the
// REAL en/es `activity` resources and locked as exact output. The refactor must
// not move a single character for en/es. Input shapes are the stored-English
// descriptions the backend writes (routes/circles.ts, invites.ts, users.ts,
// calendarEvents.ts, ...).
//
// Frame is pinned: viewer zone = America/Denver (mocked), "now" = 2026-10-06
// 18:00Z (fake timers for the legacy path, explicit `now` for the keyed path).
// Nothing depends on the machine zone or the wall clock.
//
// LOCKED DIVERGENCES (learning 4), asserted explicitly at the bottom:
//   - web formats phrase dates via formatDateShort ('15 ene' in es); mobile keeps
//     the raw ISO date in the same sentence.
//   - EN stored 'Not taken:' renders as 'Skipped:' on both platforms.

const tEn = i18n.getFixedT('en', 'activity');
const tEs = i18n.getFixedT('es', 'activity');
const tFor = (l: 'en' | 'es') => (l === 'es' ? tEs : tEn);
const NOW = new Date('2026-10-06T18:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/Denver',
  } as Intl.ResolvedDateTimeFormatOptions);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Row = ActivityDescriptionSource;
const row = (
  action_type: string | null,
  description: string,
  description_key: string | null = null,
  description_params: Record<string, unknown> | null = null
): Row => ({ action_type, description, description_key, description_params });

const render = (
  r: Row,
  l: 'en' | 'es',
  o: { timezone?: string | null; hourCycle?: '12h' | '24h' } = {}
): string =>
  renderActivityDescription(r, tFor(l), {
    timezone: o.timezone === undefined ? 'America/Denver' : o.timezone,
    hourCycle: o.hourCycle ?? '12h',
    locale: l,
    now: NOW,
  });

/** { label: { en, es } } for a list of [label, row]. */
const both = (
  cases: Array<[string, Row]>,
  o?: Parameters<typeof render>[2]
): Record<string, { en: string; es: string }> =>
  Object.fromEntries(cases.map(([k, r]) => [k, { en: render(r, 'en', o), es: render(r, 'es', o) }]));

const NAME = 'Alicia Smith';
const EMAIL = 'alicia.smith@example.org';

describe('SENTENCE_RULES (whole-sentence rows)', () => {
  const cases: Array<[string, Row]> = [
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
  it('locks every rule, en and es', () => {
    expect(both(cases)).toMatchInlineSnapshot(`
      {
        "added notes": {
          "en": "Added notes to Dr. Lee visit",
          "es": "Agregó notas a Dr. Lee visit",
        },
        "anchor: junk after discontinued": {
          "en": "Added notes to",
          "es": "Added notes to",
        },
        "discontinued med": {
          "en": "Discontinued medication: Metformin 500mg",
          "es": "Medicamento suspendido: Metformin 500mg",
        },
        "gate: left text under task_added": {
          "en": "Mom left the circle",
          "es": "Mom left the circle",
        },
        "gate: no action type": {
          "en": "Alicia Smith left the circle",
          "es": "Alicia Smith left the circle",
        },
        "invited scrubbed": {
          "en": "A member was invited to the circle",
          "es": "Se invitó a un miembro al círculo",
        },
        "joined scrubbed": {
          "en": "A member joined the circle",
          "es": "Un miembro se unió al círculo",
        },
        "left email": {
          "en": "alicia.smith@example.org left the circle",
          "es": "alicia.smith@example.org salió del círculo",
        },
        "left named": {
          "en": "Alicia Smith left the circle",
          "es": "Alicia Smith salió del círculo",
        },
        "left named account deleted": {
          "en": "Alicia Smith left the circle (account deleted)",
          "es": "Alicia Smith salió del círculo (cuenta eliminada)",
        },
        "left nameless": {
          "en": "A member left the circle",
          "es": "Un miembro salió del círculo",
        },
        "left nameless account deleted": {
          "en": "A member left the circle (account deleted)",
          "es": "Un miembro salió del círculo (cuenta eliminada)",
        },
        "reactivated med": {
          "en": "Reactivated medication: Metformin 500mg",
          "es": "Medicamento reactivado: Metformin 500mg",
        },
        "removed named": {
          "en": "Alicia Smith was removed from the circle",
          "es": "Se eliminó a Alicia Smith del círculo",
        },
        "removed nameless": {
          "en": "A member was removed from the circle",
          "es": "Se eliminó a un miembro del círculo",
        },
        "rescheduled med legacy": {
          "en": "Rescheduled Medication: Metformin to 20:00",
          "es": "Medicamento reprogramado: Metformin a las 20:00",
        },
        "rescheduled med legacy 1-digit hour": {
          "en": "Rescheduled Medication: Metformin to 8:05",
          "es": "Medicamento reprogramado: Metformin a las 8:05",
        },
        "self-care circle": {
          "en": "Created Self-Care Circle for Alicia Smith",
          "es": "Círculo de autocuidado creado para Alicia Smith",
        },
      }
    `);
  });
  it('translateSentenceRow returns null for non-matches', () => {
    expect(translateSentenceRow('member_left', 'something else', tEs)).toBeNull();
    expect(translateSentenceRow(undefined, 'A member left the circle', tEs)).toBeNull();
    expect(translateSentenceRow('', 'A member left the circle', tEs)).toBeNull();
  });
});

describe('legacy phrase substitution', () => {
  const legacy = (d: string): Row => row(null, d);
  const cases: Array<[string, Row]> = [
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
  it('locks every phrase, en and es', () => {
    expect(both(cases)).toMatchInlineSnapshot(`
      {
        "added appt": {
          "en": "Added Appointment: Cardiology",
          "es": "Cita agregada: Cardiology",
        },
        "added med": {
          "en": "Added Medication: Aspirin",
          "es": "Medicamento agregado: Aspirin",
        },
        "added task": {
          "en": "Added Task: Buy milk",
          "es": "Tarea agregada: Buy milk",
        },
        "completed appt": {
          "en": "Completed Appointment: Cardiology",
          "es": "Cita completada: Cardiology",
        },
        "completed med": {
          "en": "Completed Medication: Aspirin",
          "es": "Medicamento completado: Aspirin",
        },
        "completed task": {
          "en": "Completed Task: Buy milk",
          "es": "Tarea completada: Buy milk",
        },
        "confirmed missed": {
          "en": "Confirmed Medication: Aspirin (missed)",
          "es": "Medicamento confirmado: Aspirin (no tomado)",
        },
        "confirmed not taken": {
          "en": "Confirmed Medication: Aspirin (skipped)",
          "es": "Medicamento confirmado: Aspirin (omitido)",
        },
        "confirmed overwrite": {
          "en": "Confirmed Medication: Aspirin (skipped) (changed another caregiver's answer)",
          "es": "Medicamento confirmado: Aspirin (omitido) (cambió la respuesta de otro cuidador)",
        },
        "confirmed skipped": {
          "en": "Confirmed Medication: Aspirin (skipped)",
          "es": "Medicamento confirmado: Aspirin (omitido)",
        },
        "confirmed taken": {
          "en": "Confirmed Medication: Aspirin (taken)",
          "es": "Medicamento confirmado: Aspirin (tomado)",
        },
        "confirmed taken late": {
          "en": "Confirmed Medication: Aspirin (taken late)",
          "es": "Medicamento confirmado: Aspirin (tomado tarde)",
        },
        "created care circle": {
          "en": "Created Care Circle for Alicia Smith",
          "es": "Círculo de cuidado creado para Alicia Smith",
        },
        "deleted appt": {
          "en": "Deleted Appointment: Cardiology",
          "es": "Cita eliminada: Cardiology",
        },
        "deleted med": {
          "en": "Deleted Medication: Aspirin",
          "es": "Medicamento eliminado: Aspirin",
        },
        "deleted task": {
          "en": "Deleted Task: Buy milk",
          "es": "Tarea eliminada: Buy milk",
        },
        "emergency info": {
          "en": "Updated emergency info",
          "es": "Actualizó la información de emergencia",
        },
        "empty": {
          "en": "",
          "es": "",
        },
        "invited care recipient": {
          "en": "Invited alicia.smith@example.org to join as Care recipient",
          "es": "Invitó a alicia.smith@example.org a unirse como receptor de cuidado",
        },
        "invited caregiver": {
          "en": "Invited alicia.smith@example.org to join as Caregiver",
          "es": "Invitó a alicia.smith@example.org a unirse como cuidador",
        },
        "joined as care recipient": {
          "en": "Alicia Smith joined the circle as Care recipient",
          "es": "Alicia Smith se unió al círculo como receptor de cuidado",
        },
        "joined as caregiver": {
          "en": "Alicia Smith joined the circle as Caregiver",
          "es": "Alicia Smith se unió al círculo como cuidador",
        },
        "joined as family member": {
          "en": "Alicia Smith joined the circle as Caregiver",
          "es": "Alicia Smith se unió al círculo como cuidador",
        },
        "no match passthrough": {
          "en": "Something the backend invented",
          "es": "Something the backend invented",
        },
        "prn logged": {
          "en": "Logged a dose: Tylenol",
          "es": "Dosis registrada: Tylenol",
        },
        "prn removed": {
          "en": "Removed a logged dose: Tylenol",
          "es": "Dosis registrada quitada: Tylenol",
        },
        "updated appt": {
          "en": "Updated Appointment: Cardiology",
          "es": "Cita actualizada: Cardiology",
        },
        "updated med": {
          "en": "Updated Medication: Aspirin",
          "es": "Medicamento actualizado: Aspirin",
        },
        "updated task": {
          "en": "Updated Task: Buy milk",
          "es": "Tarea actualizada: Buy milk",
        },
      }
    `);
  });
});

describe('dated / regex forms (legacy path)', () => {
  const legacy = (d: string): Row => row(null, d);
  const cases: Array<[string, Row]> = [
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
  it('locks dated forms and plural forms, en and es', () => {
    expect(both(cases)).toMatchInlineSnapshot(`
      {
        "dated no match (not anchored)": {
          "en": "Not taken: Aspirin on June 10",
          "es": "Not taken: Aspirin on June 10",
        },
        "imported 0": {
          "en": "Imported 0 appointments from calendar",
          "es": "Importó 0 citas del calendario",
        },
        "imported 1": {
          "en": "Imported 1 appointment from calendar",
          "es": "Importó 1 cita del calendario",
        },
        "imported 2": {
          "en": "Imported 2 appointments from calendar",
          "es": "Importó 2 citas del calendario",
        },
        "imported 25": {
          "en": "Imported 25 appointments from calendar",
          "es": "Importó 25 citas del calendario",
        },
        "not taken (new) old date": {
          "en": "Skipped: Aspirin on Jun 10",
          "es": "Omitido: Aspirin el 10 jun",
        },
        "not taken (new) today": {
          "en": "Skipped: Aspirin today",
          "es": "Omitido: Aspirin hoy",
        },
        "not taken (new) yesterday": {
          "en": "Skipped: Aspirin yesterday",
          "es": "Omitido: Aspirin ayer",
        },
        "not taken Jan 15": {
          "en": "Skipped: Aspirin on Jan 15",
          "es": "Omitido: Aspirin el 15 ene",
        },
        "skipped (legacy) Jan 15": {
          "en": "Skipped: Aspirin on Jan 15",
          "es": "Omitido: Aspirin el 15 ene",
        },
        "skipped (legacy) old date": {
          "en": "Skipped: Aspirin on Jun 10",
          "es": "Omitido: Aspirin el 10 jun",
        },
        "stopped recurrence": {
          "en": "Stopped recurrence for Aspirin from Jun 10",
          "es": "Detuvo recurrencia de Aspirin desde 10 jun",
        },
        "stopped recurrence Jan 15": {
          "en": "Stopped recurrence for Aspirin from Jan 15",
          "es": "Detuvo recurrencia de Aspirin desde 15 ene",
        },
        "stopped recurrence today": {
          "en": "Stopped recurrence for Aspirin from today",
          "es": "Detuvo recurrencia de Aspirin desde hoy",
        },
        "title with " on "": {
          "en": "Skipped: Visit on call on Jun 10",
          "es": "Omitido: Visit on call el 10 jun",
        },
      }
    `);
  });
});

describe('KEY_RENDERERS (parameterized rows)', () => {
  const k = (key: string, params: Record<string, unknown>): Row =>
    row('x', 'STORED ENGLISH FALLBACK', key, params);
  const cases: Array<[string, Row]> = [
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
  it('locks every keyed renderer, 12h, same zone', () => {
    expect(both(cases)).toMatchInlineSnapshot(`
      {
        "appt occurrence removed": {
          "en": "Removed appointment: Cardiology on Jun 10",
          "es": "Cita eliminada: Cardiology el 10 jun",
        },
        "care note added": {
          "en": "Added a daily care note",
          "es": "Agregó una nota de cuidado diaria",
        },
        "event note added": {
          "en": "Added a note to Dr. Lee visit",
          "es": "Agregó una nota a Dr. Lee visit",
        },
        "fallback blank name": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
        "fallback empty params": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
        "fallback null params": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
        "fallback numeric time": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
        "fallback prototype key": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
        "fallback unknown key": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
        "invited care recipient": {
          "en": "Invited alicia.smith@example.org to join as Care Recipient",
          "es": "Invitó a alicia.smith@example.org a unirse como receptor de cuidado",
        },
        "invited caregiver": {
          "en": "Invited alicia.smith@example.org to join as Caregiver",
          "es": "Invitó a alicia.smith@example.org a unirse como cuidador",
        },
        "joined care recipient": {
          "en": "Alicia Smith joined the circle as Care Recipient",
          "es": "Alicia Smith se unió al círculo como receptor de cuidado",
        },
        "joined care recipient unknown": {
          "en": "Someone joined the circle as care recipient",
          "es": "Alguien se unió al círculo como receptor de cuidado",
        },
        "joined caregiver": {
          "en": "Alicia Smith joined the circle as Caregiver",
          "es": "Alicia Smith se unió al círculo como cuidador",
        },
        "joined caregiver unknown": {
          "en": "Someone joined the circle as caregiver",
          "es": "Alguien se unió al círculo como cuidador",
        },
        "med occurrence removed": {
          "en": "Removed dose: Aspirin on Jun 10",
          "es": "Dosis eliminada: Aspirin el 10 jun",
        },
        "not taken Jan 15": {
          "en": "Skipped: Aspirin on Jan 15",
          "es": "Omitido: Aspirin el 15 ene",
        },
        "not taken non-ISO date raw": {
          "en": "Skipped: Aspirin on June 10",
          "es": "Omitido: Aspirin el June 10",
        },
        "not taken old": {
          "en": "Skipped: Aspirin on Jun 10",
          "es": "Omitido: Aspirin el 10 jun",
        },
        "not taken today": {
          "en": "Skipped: Aspirin today",
          "es": "Omitido: Aspirin hoy",
        },
        "not taken yesterday": {
          "en": "Skipped: Aspirin yesterday",
          "es": "Omitido: Aspirin ayer",
        },
        "prn logged": {
          "en": "Logged a dose: Tylenol at 2:30 PM",
          "es": "Dosis registrada: Tylenol a las 2:30 p. m.",
        },
        "prn removed": {
          "en": "Removed a logged dose: Tylenol (2:30 PM)",
          "es": "Dosis registrada quitada: Tylenol (2:30 p. m.)",
        },
        "recurrence stopped": {
          "en": "Stopped recurrence for Aspirin from Jun 10",
          "es": "Detuvo recurrencia de Aspirin desde 10 jun",
        },
        "rescheduled": {
          "en": "Rescheduled Medication: Metformin to 8:00 PM",
          "es": "Medicamento reprogramado: Metformin a las 8:00 p. m.",
        },
        "rescheduled midnight": {
          "en": "Rescheduled Medication: Metformin to 12:00 AM",
          "es": "Medicamento reprogramado: Metformin a las 12:00 a. m.",
        },
        "rescheduled morning HH:MM": {
          "en": "Rescheduled Medication: Metformin to 8:05 AM",
          "es": "Medicamento reprogramado: Metformin a las 8:05 a. m.",
        },
        "rescheduled noon": {
          "en": "Rescheduled Medication: Metformin to 12:00 PM",
          "es": "Medicamento reprogramado: Metformin a las 12:00 p. m.",
        },
        "rescheduled out-of-range raw": {
          "en": "Rescheduled Medication: Metformin to 25:00:00",
          "es": "Medicamento reprogramado: Metformin a las 25:00:00",
        },
        "rescheduled unparseable raw": {
          "en": "Rescheduled Medication: Metformin to evening",
          "es": "Medicamento reprogramado: Metformin a las evening",
        },
        "task occurrence removed": {
          "en": "Removed task: Buy milk on Jun 10",
          "es": "Tarea eliminada: Buy milk el 10 jun",
        },
      }
    `);
  });
  it('locks 24h clock', () => {
    expect(
      both(cases.filter(([n]) => n.startsWith('rescheduled') || n.startsWith('prn')), {
        hourCycle: '24h',
      })
    ).toMatchInlineSnapshot(`
      {
        "prn logged": {
          "en": "Logged a dose: Tylenol at 14:30",
          "es": "Dosis registrada: Tylenol a las 14:30",
        },
        "prn removed": {
          "en": "Removed a logged dose: Tylenol (14:30)",
          "es": "Dosis registrada quitada: Tylenol (14:30)",
        },
        "rescheduled": {
          "en": "Rescheduled Medication: Metformin to 20:00",
          "es": "Medicamento reprogramado: Metformin a las 20:00",
        },
        "rescheduled midnight": {
          "en": "Rescheduled Medication: Metformin to 00:00",
          "es": "Medicamento reprogramado: Metformin a las 00:00",
        },
        "rescheduled morning HH:MM": {
          "en": "Rescheduled Medication: Metformin to 08:05",
          "es": "Medicamento reprogramado: Metformin a las 08:05",
        },
        "rescheduled noon": {
          "en": "Rescheduled Medication: Metformin to 12:00",
          "es": "Medicamento reprogramado: Metformin a las 12:00",
        },
        "rescheduled out-of-range raw": {
          "en": "Rescheduled Medication: Metformin to 25:00:00",
          "es": "Medicamento reprogramado: Metformin a las 25:00:00",
        },
        "rescheduled unparseable raw": {
          "en": "Rescheduled Medication: Metformin to evening",
          "es": "Medicamento reprogramado: Metformin a las evening",
        },
      }
    `);
  });
  it('locks zone-labelled time when recipient zone differs from viewer (Tokyo)', () => {
    expect(
      both(cases.filter(([n]) => n.startsWith('rescheduled') || n.startsWith('prn')), {
        timezone: 'Asia/Tokyo',
      })
    ).toMatchInlineSnapshot(`
      {
        "prn logged": {
          "en": "Logged a dose: Tylenol at 2:30 PM (Tokyo)",
          "es": "Dosis registrada: Tylenol a las 2:30 p. m. (Tokio)",
        },
        "prn removed": {
          "en": "Removed a logged dose: Tylenol (2:30 PM (Tokyo))",
          "es": "Dosis registrada quitada: Tylenol (2:30 p. m. (Tokio))",
        },
        "rescheduled": {
          "en": "Rescheduled Medication: Metformin to 8:00 PM (Tokyo)",
          "es": "Medicamento reprogramado: Metformin a las 8:00 p. m. (Tokio)",
        },
        "rescheduled midnight": {
          "en": "Rescheduled Medication: Metformin to 12:00 AM (Tokyo)",
          "es": "Medicamento reprogramado: Metformin a las 12:00 a. m. (Tokio)",
        },
        "rescheduled morning HH:MM": {
          "en": "Rescheduled Medication: Metformin to 8:05 AM (Tokyo)",
          "es": "Medicamento reprogramado: Metformin a las 8:05 a. m. (Tokio)",
        },
        "rescheduled noon": {
          "en": "Rescheduled Medication: Metformin to 12:00 PM (Tokyo)",
          "es": "Medicamento reprogramado: Metformin a las 12:00 p. m. (Tokio)",
        },
        "rescheduled out-of-range raw": {
          "en": "Rescheduled Medication: Metformin to 25:00:00",
          "es": "Medicamento reprogramado: Metformin a las 25:00:00",
        },
        "rescheduled unparseable raw": {
          "en": "Rescheduled Medication: Metformin to evening",
          "es": "Medicamento reprogramado: Metformin a las evening",
        },
      }
    `);
  });
  it('locks Today/Yesterday judged in the recipient frame (Tokyo is already Oct 7)', () => {
    expect(
      both(cases.filter(([n]) => n.startsWith('not taken')), { timezone: 'Asia/Tokyo' })
    ).toMatchInlineSnapshot(`
      {
        "not taken Jan 15": {
          "en": "Skipped: Aspirin on Jan 15",
          "es": "Omitido: Aspirin el 15 ene",
        },
        "not taken non-ISO date raw": {
          "en": "Skipped: Aspirin on June 10",
          "es": "Omitido: Aspirin el June 10",
        },
        "not taken old": {
          "en": "Skipped: Aspirin on Jun 10",
          "es": "Omitido: Aspirin el 10 jun",
        },
        "not taken today": {
          "en": "Skipped: Aspirin yesterday",
          "es": "Omitido: Aspirin ayer",
        },
        "not taken yesterday": {
          "en": "Skipped: Aspirin on Oct 5",
          "es": "Omitido: Aspirin el 5 oct",
        },
      }
    `);
  });
  it('locks timezone-unresolved fallback (null timezone)', () => {
    expect(
      both(cases.filter(([n]) => n === 'rescheduled' || n === 'joined caregiver'), {
        timezone: null,
      })
    ).toMatchInlineSnapshot(`
      {
        "joined caregiver": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
        "rescheduled": {
          "en": "STORED ENGLISH FALLBACK",
          "es": "STORED ENGLISH FALLBACK",
        },
      }
    `);
  });
});

describe('locked cross-platform divergences (learning 4)', () => {
  it("web formats phrase dates via formatDateShort ('15 ene' in es); mobile keeps raw ISO", () => {
    expect(translateActivityDescription('Not taken: Aspirin on 2026-01-15', tEs, 'es')).toBe(
      'Omitido: Aspirin el 15 ene'
    );
    expect(
      translateActivityDescription('Stopped recurrence for Aspirin from 2026-01-15', tEs, 'es')
    ).toContain('15 ene');
    expect(translateActivityDescription('Not taken: Aspirin on 2026-01-15', tEs, 'es')).not.toContain(
      '2026-01-15'
    );
  });
  it("EN stored 'Not taken:' renders as 'Skipped:' (both platforms)", () => {
    expect(translateActivityDescription('Not taken: Aspirin on 2026-01-15', tEn, 'en')).toBe(
      'Skipped: Aspirin on Jan 15'
    );
  });
});
