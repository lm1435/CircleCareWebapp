import i18n from '@/i18n';
import {
  renderActivityDescription,
  type ActivityDescriptionSource,
} from '@/components/activity/activityTranslation';

// Activity-feed rows whose sentence NO client used to translate. Web twin of
// mobile/src/__tests__/utils/activityMembershipSpanish.test.ts: same rows, same
// Spanish, same keys (under `sentences.*`).
//
// THE DEFECT: `member_left`, `member_removed`, the account-deletion row, the
// scrubbed `member_invited` / `member_joined` rows, and four more keyless shapes
// reached a Spanish reader in ENGLISH, because the backend writes them with no
// `description_key` and no client substring matched them. Verified before the
// fix: every `es` case below printed the stored English sentence verbatim.
//
// `t` is the REAL i18next fixed-T over the shipped `activity` namespace, so a
// missing string fails the test. EN is asserted BYTE-IDENTICAL to the stored
// sentence: the fix adds Spanish and must not move a single English character.
//
// Wording matches what the app already says elsewhere and is gender-neutral
// (no "fue eliminado/eliminada"):
//   left     "salió del círculo"          `members.manage.leaveSuccess` = "Saliste del círculo."
//   removed  "Se eliminó a X del círculo" `members.manage.removeSuccess`
//   invited  "Se invitó a un miembro al círculo"
//   stopped  "Medicamento suspendido"     `calendar.discontinueMed.discontinuedToast`

const tEn = i18n.getFixedT('en', 'activity');
const tEs = i18n.getFixedT('es', 'activity');

// The VIEWER's zone, pinned (the dev machine is America/Denver, CI is not). No
// row below carries a date or time zone label, but the frame is fixed anyway.
beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/Denver',
  } as Intl.ResolvedDateTimeFormatOptions);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Row = ActivityDescriptionSource & { action_type: string };

const CTX = { timezone: 'America/Denver', hourCycle: '12h' as const };
const render = (r: Row, lng: 'en' | 'es'): string =>
  renderActivityDescription(r, lng === 'es' ? tEs : tEn, { ...CTX, locale: lng });

const row = (
  action_type: string,
  description: string,
  description_key: string | null = null,
  description_params: Record<string, unknown> | null = null
): Row => ({ action_type, description, description_key, description_params });

// Names chosen so that NO token in them is an English word: the "no English left
// over" check below must be able to tell a leak from a person's name.
const NAME = 'Alicia Smith';
const EMAIL = 'alicia.smith@example.org';

// [label, row, expected Spanish]. EN is always the stored description.
const FIXED_SHAPES: Array<[string, Row, string]> = [
  // member_left: circles.ts leave (named, e-mail-as-name, nameless)
  ['left, named', row('member_left', `${NAME} left the circle`), `${NAME} salió del círculo`],
  ['left, e-mail as name', row('member_left', `${EMAIL} left the circle`), `${EMAIL} salió del círculo`],
  ['left, nameless / scrubbed', row('member_left', 'A member left the circle'), 'Un miembro salió del círculo'],
  // member_left: users.ts account deletion (current, and the pre-2026-07-07 wording)
  [
    'left, account deleted',
    row('member_left', 'A member left the circle (account deleted)'),
    'Un miembro salió del círculo (cuenta eliminada)',
  ],
  [
    'left, account deleted, historical named',
    row('member_left', `${NAME} left the circle (account deleted)`),
    `${NAME} salió del círculo (cuenta eliminada)`,
  ],
  // member_removed: circles.ts kick
  [
    'removed, named',
    row('member_removed', `${NAME} was removed from the circle`),
    `Se eliminó a ${NAME} del círculo`,
  ],
  [
    'removed, e-mail as name',
    row('member_removed', `${EMAIL} was removed from the circle`),
    `Se eliminó a ${EMAIL} del círculo`,
  ],
  [
    'removed, nameless / scrubbed',
    row('member_removed', 'A member was removed from the circle'),
    'Se eliminó a un miembro del círculo',
  ],
  // member_invited: accountDeletionFeedScrub FEED_NEUTRAL_INVITED (key + params null)
  [
    'invited, scrubbed',
    row('member_invited', 'A member was invited to the circle'),
    'Se invitó a un miembro al círculo',
  ],
  // member_joined: the scrub's fallback when the role cannot be recovered (key null)
  [
    'joined, scrubbed without a role',
    row('member_joined', 'A member joined the circle'),
    'Un miembro se unió al círculo',
  ],
  // sweep: keyless shapes found while checking every action_type the backend writes
  [
    'circle created, self-care',
    row('circle_created', 'Created Self-Care Circle for Sam'),
    'Círculo de autocuidado creado para Sam',
  ],
  [
    'medication discontinued',
    row('medication_updated', 'Discontinued medication: Metformina 500mg'),
    'Medicamento suspendido: Metformina 500mg',
  ],
  [
    'medication reactivated',
    row('medication_updated', 'Reactivated medication: Metformina 500mg'),
    'Medicamento reactivado: Metformina 500mg',
  ],
  [
    'medication rescheduled, pre-key row',
    row('medication_updated', 'Rescheduled Medication: Metformina 500mg to 14:30'),
    'Medicamento reprogramado: Metformina 500mg a las 14:30',
  ],
  [
    'event note, pre-key row',
    row('note_added', 'Added notes to Dra. Pérez'),
    'Agregó notas a Dra. Pérez',
  ],
];

// Words that mean the sentence is still (partly) English. None may appear in a
// Spanish rendering of any row above. Names/titles in the fixtures contain none.
const ENGLISH_LEFTOVER =
  /\b(left|removed|was|the|circle|member|invited|joined|account|deleted|added|notes?|created|discontinued|reactivated|rescheduled|medication|self-care|to|for|from|someone)\b/i;

describe('membership + keyless rows: Spanish, with no English left over', () => {
  it.each(FIXED_SHAPES)('es / %s', (_label, r, expected) => {
    expect(render(r, 'es')).toBe(expected);
  });

  it.each(FIXED_SHAPES)('es / %s has no English words left', (_label, r) => {
    expect(render(r, 'es')).not.toMatch(ENGLISH_LEFTOVER);
  });

  it.each(FIXED_SHAPES)('en / %s is byte-identical to the stored sentence', (_label, r) => {
    expect(render(r, 'en')).toBe(r.description);
  });

  it('never leaks a raw key or a bare {{param}} placeholder', () => {
    for (const lng of ['en', 'es'] as const) {
      for (const [, r] of FIXED_SHAPES) {
        expect(render(r, lng)).not.toMatch(/\{\{|\}\}|sentences\.|entries\.|phrases\./);
      }
    }
  });
});

describe('the match is anchored and gated by action_type (no false positives)', () => {
  it('a TASK titled like a leave sentence is untouched by the membership rules', () => {
    const r = row('task_created', 'Added Task: Mom left the circle');
    expect(render(r, 'es')).toBe('Tarea agregada: Mom left the circle');
    expect(render(r, 'en')).toBe('Added Task: Mom left the circle');
  });

  it('the same sentence under a different action_type is not rewritten', () => {
    const r = row('member_removed', `${NAME} left the circle`);
    expect(render(r, 'es')).toBe(`${NAME} left the circle`);
  });

  it('a row without an action_type is not rewritten (the gate is real)', () => {
    const r: ActivityDescriptionSource = { description: `${NAME} left the circle` };
    expect(render(r as Row, 'es')).toBe(`${NAME} left the circle`);
  });

  it('a sentence that merely contains the phrase is not rewritten', () => {
    const r = row('member_left', `${NAME} left the circle yesterday`);
    expect(render(r, 'es')).toBe(`${NAME} left the circle yesterday`);
  });

  it('a name that itself reads like a sentence is kept whole', () => {
    const r = row('member_left', 'Bea was removed from the circle left the circle');
    expect(render(r, 'es')).toBe('Bea was removed from the circle salió del círculo');
  });
});

describe('rows that were ALREADY translated are unchanged', () => {
  it.each([
    [row('member_invited', `Invited ${EMAIL} to join as Caregiver`, 'entries.memberInvited.caregiver', { email: EMAIL }), `Invitó a ${EMAIL} a unirse como cuidador`],
    [row('member_invited', `Invited ${EMAIL} to join as Care Recipient`, 'entries.memberInvited.careRecipient', { email: EMAIL }), `Invitó a ${EMAIL} a unirse como receptor de cuidado`],
    [row('member_invited', `Invited ${EMAIL} to join as Caregiver`), `Invitó a ${EMAIL} a unirse como cuidador`],
    // The LEGACY keyless phrases for the care recipient: mobile used to say "paciente".
    [row('member_invited', `Invited ${EMAIL} to join as Care Recipient`), `Invitó a ${EMAIL} a unirse como receptor de cuidado`],
    [row('member_joined', `${NAME} joined the circle as Care Recipient`), `${NAME} se unió al círculo como receptor de cuidado`],
    [row('member_joined', `${NAME} joined the circle as Caregiver`, 'entries.memberJoined.caregiver', { name: NAME }), `${NAME} se unió al círculo como cuidador`],
    [row('member_joined', 'A member joined the circle', 'entries.memberJoined.caregiverUnknown', {}), 'Alguien se unió al círculo como cuidador'],
    [row('circle_created', 'Created Care Circle for Maria'), 'Círculo de cuidado creado para Maria'],
    [row('medication_created', 'Added Medication: Metformina'), 'Medicamento agregado: Metformina'],
    [row('appointment_created', 'Added Appointment: Dra. Pérez'), 'Cita agregada: Dra. Pérez'],
    [row('task_completed', 'Completed Task: Pagar'), 'Tarea completada: Pagar'],
    [row('medication_confirmed', 'Confirmed Medication: Metformina (taken late)'), 'Medicamento confirmado: Metformina (tomado tarde)'],
    [row('emergency_info_updated', 'Updated emergency information'), 'Actualizó la información de emergencia'],
    [row('events_imported', 'Imported 3 appointments from calendar'), 'Importó 3 citas del calendario'],
    [row('care_note_added', 'Added a care note', 'entries.careNoteAdded', {}), 'Agregó una nota de cuidado diaria'],
    [row('note_added', 'Added a note to Dra. Pérez', 'entries.eventNoteAdded', { title: 'Dra. Pérez' }), 'Agregó una nota a Dra. Pérez'],
  ] as Array<[Row, string]>)('es / %#', (r, expected) => {
    expect(render(r, 'es')).toBe(expected);
  });
});
