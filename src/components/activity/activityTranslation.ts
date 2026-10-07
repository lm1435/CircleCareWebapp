// PORT of mobile/src/utils/activityTranslation.ts, with keys scoped to the
// `activity` namespace (web loads per-namespace JSON resources).
//
// Activity descriptions are generated in English by the backend. Translate by
// replacing known English phrases with localized ones; names, medication
// names, and other proper nouns are preserved. Raw YYYY-MM-DD dates the
// backend embeds are reformatted with formatDateShort (viewer-local
// Today/Yesterday, else a localized short date) instead of leaking ISO dates.

import i18n from '@/i18n';
import { formatDateShort } from './activityFormat';
import { baseLanguage } from '@/i18n/locales';
import { formatTimeOfDay, getTimezoneSuffix, type TimeLanguage } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The subset of an activity row this module renders from. Declared structurally
 * (rather than importing `ActivityFeedItem`) to keep this a leaf module.
 */
export interface ActivityDescriptionSource {
  description: string;
  /**
   * The row's `action_type`. Optional so a caller that has only a description
   * still compiles, but REQUIRED for the whole-sentence rows in
   * {@link translateSentenceRow}: they are recognised by action type PLUS the
   * exact stored sentence, never by the sentence alone. A row without it simply
   * keeps today's behaviour (the English `description`).
   */
  action_type?: string | null;
  /** Stable key, WITHOUT a namespace prefix -- web already resolves inside the
   *  `activity` namespace, so the stored value is used verbatim. Null on rows
   *  written before parameterization and on sites not yet parameterized. */
  description_key?: string | null;
  /** RAW values: 'HH:MM:SS' times, 'YYYY-MM-DD' dates, titles, emails/names. */
  description_params?: Record<string, unknown> | null;
}

interface RenderContext {
  t: TFn;
  locale: string;
  hourCycle: HourCycle;
  language: TimeLanguage;
  /** The CARE RECIPIENT's IANA zone — the frame every `scheduledTime` is in. */
  timezone: string;
  /**
   * The instant the viewer/recipient zone comparison is judged at.
   *
   * Two zones where only one observes DST (Phoenix / Denver) share a clock for
   * part of the year, so "are these different" has no answer without saying
   * WHEN. The feed shows recent activity, so "now" is the right default — but
   * it is passed explicitly rather than read inside `renderTime` so that a
   * single entry cannot have its time and its date judged at two instants.
   */
  now: Date;
}

/**
 * 'HH:MM(:SS)' in the viewer's 12h/24h clock and language, LABELLED with the
 * care recipient's timezone.
 *
 * The digits are NOT converted, and must not be: a `scheduledTime` param is a
 * medication's `scheduled_time`, a naive wall clock in the CARE RECIPIENT's
 * zone. Only the presentation (12h/24h, AM/PM wording) is the viewer's.
 *
 * The zone label is the fix. Unlabelled, "Rescheduled Medication: Metformin
 * to 8:00 PM" reads to a caregiver as EIGHT PM WHERE THEY ARE — which for a
 * Denver caregiver and a Tokyo recipient is off by fifteen hours, and there is
 * nothing in the sentence to suggest otherwise. Every other time surface in
 * this app (formatEventTimeCompact, formatEventTimeForDisplay) already carries
 * this suffix; the activity feed was the one that did not.
 *
 * SUPPRESSED when the viewer shares the recipient's zone — see
 * {@link getTimezoneSuffix}. Naming a zone the reader is already standing in
 * answers a question nobody asked.
 */
function renderTime(raw: unknown, ctx: RenderContext): string {
  if (typeof raw !== 'string') return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!m) return raw;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return raw;
  const time = formatTimeOfDay(hours, minutes, ctx.hourCycle, ctx.language);
  // The label is appended only when the zones actually DIFFER, so single-zone
  // circles — the overwhelming majority — read "2:30 PM" rather than
  // "2:30 PM MT". `getTimezoneSuffix` owns that rule for every surface in the
  // app; this one used to open-code the opposite.
  return `${time}${getTimezoneSuffix(ctx.timezone, ctx.now, { language: ctx.language })}`;
}

/**
 * 'YYYY-MM-DD' → "Today" / "Yesterday" / a localized short date, judged in the
 * CARE RECIPIENT's frame.
 *
 * `ctx.timezone` is passed explicitly. `formatDateShort` defaults its timezone
 * to `getDeviceTimezone()`, and omitting it decided Today/Yesterday in the
 * VIEWER's frame for a date that is in the RECIPIENT's — so for a Tokyo
 * recipient read by a Denver caregiver at 22:00 MDT, the recipient's today
 * rendered as "Aug 26" instead of "Today", and the recipient's yesterday
 * rendered as "Today".
 *
 * Unlike {@link renderTime}, a date carries no zone label to disclose which
 * frame it is in, so getting the frame right is the only signal there is.
 */
function renderDate(raw: unknown, ctx: RenderContext): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return typeof raw === 'string' ? raw : '';
  }
  return formatDateShort(raw, ctx.t, ctx.locale, ctx.timezone);
}

/**
 * THE EXPLICIT KEY ALLOW-LIST.
 *
 * A LOOKUP, not `t(key)`. This is the whole safety property of a partial
 * rollout: `t()` on an unrecognised key renders the raw key text
 * ("entries.somethingNew") straight to a user, and since the backend and this
 * client deploy independently, a backend writing a key this build has never
 * heard of WILL happen. A miss here falls back to `description`, which every
 * row always carries, so an unknown key degrades to exactly the behaviour of
 * the build before this one.
 *
 * KEEP THIS MAP IN SYNC WITH mobile/src/utils/activityTranslation.ts -- same
 * keys, same params. The two renderers have drifted before (see the file
 * header there); a key present in one and absent from the other is a silent
 * per-platform copy difference, not an error.
 */
interface KeyRenderer {
  /**
   * The params this renderer actually reads. A row missing any of them cannot
   * produce a complete sentence, so it falls back to `description` instead of
   * emitting one with holes in it — "Rescheduled Medication:  to " was a real
   * output for a `{}` params object, and it DISCARDED the complete
   * server-written description sitting on the same row.
   */
  requires: string[];
  render: (params: Record<string, unknown>, ctx: RenderContext) => string;
}

/**
 * A `Map`, NOT an object literal.
 *
 * An object literal is walked through its PROTOTYPE: `KEY_RENDERERS['constructor']`
 * resolves to `Object`, which is truthy and callable, so a row whose
 * `description_key` happened to be `constructor` (or `toString`, `valueOf`…)
 * would call it and return the params OBJECT as a `string`. React then throws
 * "Objects are not valid as a React child" and the whole feed blanks. A Map has
 * no prototype chain to walk, which makes the allow-list actually a list.
 */
const KEY_RENDERERS = new Map<string, KeyRenderer>(Object.entries({
  'entries.medicationRescheduled': { requires: ['title', 'scheduledTime'], render: (p, ctx) =>
    ctx.t('entries.medicationRescheduled', {
      title: p.title ?? '',
      time: renderTime(p.scheduledTime, ctx),
    }) },
  'entries.medicationNotTaken': { requires: ['title', 'scheduledDate'], render: (p, ctx) =>
    ctx.t('entries.medicationNotTaken', {
      title: p.title ?? '',
      date: renderDate(p.scheduledDate, ctx),
    }) },
  'entries.medicationOccurrenceRemoved': { requires: ['title', 'scheduledDate'], render: (p, ctx) =>
    ctx.t('entries.medicationOccurrenceRemoved', {
      title: p.title ?? '',
      date: renderDate(p.scheduledDate, ctx),
    }) },
  'entries.appointmentOccurrenceRemoved': { requires: ['title', 'scheduledDate'], render: (p, ctx) =>
    ctx.t('entries.appointmentOccurrenceRemoved', {
      title: p.title ?? '',
      date: renderDate(p.scheduledDate, ctx),
    }) },
  'entries.taskOccurrenceRemoved': { requires: ['title', 'scheduledDate'], render: (p, ctx) =>
    ctx.t('entries.taskOccurrenceRemoved', {
      title: p.title ?? '',
      date: renderDate(p.scheduledDate, ctx),
    }) },
  'entries.recurrenceStopped': { requires: ['title', 'scheduledDate'], render: (p, ctx) =>
    ctx.t('entries.recurrenceStopped', {
      title: p.title ?? '',
      date: renderDate(p.scheduledDate, ctx),
    }) },
  'entries.memberInvited.careRecipient': { requires: ['email'], render: (p, ctx) =>
    ctx.t('entries.memberInvited.careRecipient', { email: p.email ?? '' }) },
  'entries.memberInvited.caregiver': { requires: ['email'], render: (p, ctx) =>
    ctx.t('entries.memberInvited.caregiver', { email: p.email ?? '' }) },
  'entries.memberJoined.careRecipient': { requires: ['name'], render: (p, ctx) =>
    ctx.t('entries.memberJoined.careRecipient', { name: p.name ?? '' }) },
  'entries.memberJoined.caregiver': { requires: ['name'], render: (p, ctx) =>
    ctx.t('entries.memberJoined.caregiver', { name: p.name ?? '' }) },
  // THE JOINER HAD NO FEED NAME (an OAuth signup with no first_name), which the
  // backend writes as its own key (routes/invites.ts, both accept paths) and
  // which the account-deletion feed scrub rewrites every deleted member's join
  // row to. Absent here, the row fell through to the legacy English-phrase
  // substitution, which replaces only the matched substring: a Spanish reader
  // saw "Someone se unió al círculo como cuidador", or the scrub's English
  // "A member joined the circle" verbatim.
  //
  // No params by design -- the sentence has no name slot -- so `requires` is
  // empty and the `{}` the backend sends is a COMPLETE params object here.
  'entries.memberJoined.careRecipientUnknown': { requires: [], render: (_p, ctx) =>
    ctx.t('entries.memberJoined.careRecipientUnknown') },
  'entries.memberJoined.caregiverUnknown': { requires: [], render: (_p, ctx) =>
    ctx.t('entries.memberJoined.caregiverUnknown') },
  // Notes first-class (Slice 1/2, plan docs/plans/notes-first-class.md task
  // 24). `careNoteAdded` carries NO params -- there is no subject to
  // interpolate, just "someone added a daily care note" -- so `requires` is
  // empty and `hasRenderableParams` is trivially satisfied.
  'entries.eventNoteAdded': { requires: ['title'], render: (p, ctx) =>
    ctx.t('entries.eventNoteAdded', { title: p.title ?? '' }) },
  'entries.careNoteAdded': { requires: [], render: (_p, ctx) =>
    ctx.t('entries.careNoteAdded') },
  // As-needed (PRN) doses. `time` is the dose's wall clock in the CARE
  // RECIPIENT's zone ('HH:MM:SS'), so it renders (and zone-labels) like every
  // other time here. NEW rows only — no existing key or phrase is touched.
  'entries.asNeededDoseLogged': { requires: ['title', 'time'], render: (p, ctx) =>
    ctx.t('entries.asNeededDoseLogged', {
      title: p.title ?? '',
      time: renderTime(p.time, ctx),
    }) },
  'entries.asNeededDoseRemoved': { requires: ['title', 'time'], render: (p, ctx) =>
    ctx.t('entries.asNeededDoseRemoved', {
      title: p.title ?? '',
      time: renderTime(p.time, ctx),
    }) },
}));

/**
 * Can this renderer produce a COMPLETE sentence from these params?
 *
 * Every required key must be a NON-BLANK STRING. `!= null` is not enough, and
 * that was the first version of this guard: `{ name: '' }` and
 * `{ scheduledTime: 2000 }` both pass a null check and then render
 * " joined the circle as Caregiver" or "Rescheduled Medication: Metformin to "
 * — a holed sentence that also DISCARDS the complete server-written
 * `description` sitting on the same row.
 *
 * A blank name is not hypothetical: it is what an OAuth signup with no
 * first_name leaves behind, which api/invites documents as routine.
 */
function hasRenderableParams(entry: KeyRenderer, params: Record<string, unknown>): boolean {
  return entry.requires.every((key) => {
    const value = params[key];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/**
 * Render one activity row's description for this viewer.
 *
 * `hourCycle` is REQUIRED, matching `formatTimeOfDay`'s deliberate asymmetry:
 * a missing cycle is a WRONG ANSWER nothing downstream can recover (12-hour
 * digits shown to a 24-hour user), so it must be a compile error. Components
 * get it from `useHourCycle()`.
 *
 * THREE cases fall back to `description`, not two:
 *   1. `description_key` is null       -- historical / not-yet-parameterized row.
 *   2. `description_key` is UNKNOWN    -- a newer backend than this client build.
 *   3. `description_params` is missing OR INCOMPLETE -- malformed row, or a
 *      renamed param. `{}` counts: it is the column default.
 *   4. the recipient TIMEZONE has not resolved -- every parameterized sentence
 *      is frame-dependent, and the loading fallback is a real-looking zone.
 */
export function renderActivityDescription(
  activity: ActivityDescriptionSource,
  t: TFn,
  options: { hourCycle: HourCycle; timezone: string | null; locale?: string; now?: Date }
): string {
  const locale = options.locale ?? i18n.language;
  const key = activity.description_key;

  if (key) {
    // Case 2: UNKNOWN key -> fall through rather than render a raw key string.
    // Do NOT "improve" this into a t() call on the key.
    const entry = KEY_RENDERERS.get(key);
    const params = activity.description_params;
    // Case 4: the CARE RECIPIENT'S TIMEZONE has not resolved yet.
    //
    // Every parameterized sentence renders a time or a date in that frame, and
    // the circle query is often still in flight on first paint. `useCircle`
    // reports a hardcoded 'America/New_York' fallback that is indistinguishable
    // from a real New York circle, so rendering through it would silently label
    // a time with the wrong zone and judge Today/Yesterday in the wrong frame.
    //
    // Falling back to the server-written `description` — which every row always
    // carries — is the same trade as the three cases above: a less specific
    // sentence beats a confidently wrong one.
    const timezone = options.timezone;
    // Case 3: params missing OR INCOMPLETE. `params && …` alone was not enough:
    // `{}` is truthy (it is the JSONB column default, and it is what a renamed
    // param key leaves behind), so the renderer ran and emitted a sentence with
    // holes while throwing away the complete `description` on the same row.
    if (timezone && entry && params && hasRenderableParams(entry, params)) {
      return entry.render(params, {
        t,
        locale,
        hourCycle: options.hourCycle,
        // Lazy: a name-free membership row never reads it, and the
        // client-compat harness stubs the registry import to throw.
        get language() {
          return baseLanguage(locale);
        },
        timezone,
        now: options.now ?? new Date(),
      });
    }
  }

  // Whole-sentence rows first (see translateSentenceRow); everything else goes
  // through the unchanged phrase-substitution path.
  const sentence = translateSentenceRow(activity.action_type, activity.description, t);
  if (sentence !== null) return sentence;
  return translateActivityDescription(activity.description, t, locale);
}

/**
 * WHOLE-SENTENCE ROWS: recognised by `action_type` PLUS an anchored match of the
 * stored English sentence.
 *
 * WHY THIS EXISTS. These rows reach a Spanish reader in English from every
 * client that predates it, because the backend writes them with NO
 * `description_key` and none of the phrase substitutions below matches a sentence
 * like "<Name> left the circle":
 *
 *   member_left      "<name|email> left the circle"          circles.ts (leave)
 *                    "A member left the circle"              same, user lookup failed / F-1 scrub
 *                    "A member left the circle (account deleted)"   users.ts deletion + scrub
 *                    "<name|email> left the circle (account deleted)"   same, before 2026-07-07
 *   member_removed   "<name|email> was removed from the circle"      circles.ts (kick)
 *                    "A member was removed from the circle"          same / F-1 scrub
 *   member_invited   "A member was invited to the circle"            F-1 scrub of "Invited <email> ..."
 *   member_joined    "A member joined the circle"                    F-1 scrub, role unrecoverable
 *   circle_created   "Created Self-Care Circle for <name>"           circles.ts (the care variant has a phrase)
 *   medication_updated  "Discontinued|Reactivated medication: <title>"   calendarEvents.ts (never keyed)
 *                    "Rescheduled Medication: <title> to HH:MM"      rows 2026-07-30..08-20, before keys
 *   note_added       "Added notes to <title>"                        rows 2026-06-02..09-27, before keys
 *
 * WHY NOT A PHRASE SUBSTITUTION. A named row's "name" is arbitrary text (an
 * e-mail when the person had no name), so there is no fixed substring to swap,
 * and an UNANCHORED " left the circle" would also rewrite a task someone titled
 * "Mom left the circle" ("Added Task: Mom left the circle"). Gating on the
 * action type and anchoring both ends keeps the match to exactly the shape the
 * writer produces. Whatever sits in the name slot is shown as stored.
 *
 * ORDER MATTERS WITHIN AN ACTION TYPE: the nameless sentences are listed before
 * the named ones, otherwise "A member left the circle" would match the named rule
 * with the name "A member" and print "A member salió del círculo".
 *
 * EN IS BYTE-IDENTICAL to the stored sentence (these `sentences.*` strings are
 * the English the writers emit), so an English reader sees no change.
 *
 * NO BACKEND CHANGE: nothing writes a key for these rows and nothing here asks
 * it to. Builds that predate this keep showing the stored English.
 *
 * KEEP IN SYNC WITH mobile/src/utils/activityTranslation.ts -- same rules, same
 * `sentences.*` keys and strings (mobile stores them under `activity.sentences`).
 */
interface SentenceRule {
  actionType: string;
  /** Anchored at BOTH ends: the stored sentence must be exactly this shape. */
  pattern: RegExp;
  render: (match: RegExpExecArray, t: TFn) => string;
}

const SENTENCE_RULES: readonly SentenceRule[] = [
  // --- member_left ---------------------------------------------------------
  { actionType: 'member_left', pattern: /^A member left the circle$/,
    render: (_m, t) => t('sentences.memberLeft') },
  { actionType: 'member_left', pattern: /^A member left the circle \(account deleted\)$/,
    render: (_m, t) => t('sentences.memberLeftAccountDeleted') },
  { actionType: 'member_left', pattern: /^(.+) left the circle \(account deleted\)$/,
    render: (m, t) => t('sentences.memberLeftNamedAccountDeleted', { name: m[1] }) },
  { actionType: 'member_left', pattern: /^(.+) left the circle$/,
    render: (m, t) => t('sentences.memberLeftNamed', { name: m[1] }) },
  // --- member_removed ------------------------------------------------------
  { actionType: 'member_removed', pattern: /^A member was removed from the circle$/,
    render: (_m, t) => t('sentences.memberRemoved') },
  { actionType: 'member_removed', pattern: /^(.+) was removed from the circle$/,
    render: (m, t) => t('sentences.memberRemovedNamed', { name: m[1] }) },
  // --- member_invited / member_joined (F-1 scrub forms) --------------------
  { actionType: 'member_invited', pattern: /^A member was invited to the circle$/,
    render: (_m, t) => t('sentences.memberInvited') },
  { actionType: 'member_joined', pattern: /^A member joined the circle$/,
    render: (_m, t) => t('sentences.memberJoined') },
  // --- keyless shapes found by sweeping every action_type the backend writes ---
  { actionType: 'circle_created', pattern: /^Created Self-Care Circle for (.+)$/,
    render: (m, t) => t('sentences.createdSelfCareCircleFor', { name: m[1] }) },
  { actionType: 'medication_updated', pattern: /^Discontinued medication: (.+)$/,
    render: (m, t) => t('sentences.discontinuedMedication', { title: m[1] }) },
  { actionType: 'medication_updated', pattern: /^Reactivated medication: (.+)$/,
    render: (m, t) => t('sentences.reactivatedMedication', { title: m[1] }) },
  // The server-formatted 'HH:MM' is shown as stored: a row written before the
  // key carries no raw time to re-render in the viewer's clock.
  { actionType: 'medication_updated', pattern: /^Rescheduled Medication: (.+) to (\d{1,2}:\d{2})$/,
    render: (m, t) => t('sentences.rescheduledMedication', { title: m[1], time: m[2] }) },
  { actionType: 'note_added', pattern: /^Added notes to (.+)$/,
    render: (m, t) => t('sentences.addedNotes', { title: m[1] }) },
];

/**
 * The localized sentence for a whole-sentence row, or `null` when this row is not
 * one (so the caller falls through to the phrase-substitution path).
 */
export function translateSentenceRow(
  actionType: string | null | undefined,
  description: string,
  t: TFn
): string | null {
  if (!actionType) return null;
  for (const rule of SENTENCE_RULES) {
    if (rule.actionType !== actionType) continue;
    const match = rule.pattern.exec(description);
    if (match) return rule.render(match, t);
  }
  return null;
}

/**
 * LEGACY PATH, and it must stay: it renders every row written before
 * parameterization, every write site not in the current slice, and every row
 * whose key this build does not recognise.
 */
export function translateActivityDescription(
  description: string,
  t: TFn,
  locale: string = i18n.language
): string {
  const replacements: Record<string, string> = {
    'Confirmed Medication:': t('phrases.confirmedMedication'),
    'Added Medication:': t('phrases.addedMedication'),
    'Updated Medication:': t('phrases.updatedMedication'),
    'Deleted Medication:': t('phrases.deletedMedication'),
    'Completed Medication:': t('phrases.completedMedication'),
    'Added Appointment:': t('phrases.addedAppointment'),
    'Updated Appointment:': t('phrases.updatedAppointment'),
    'Deleted Appointment:': t('phrases.deletedAppointment'),
    'Completed Appointment:': t('phrases.completedAppointment'),
    'Added Task:': t('phrases.addedTask'),
    'Updated Task:': t('phrases.updatedTask'),
    'Deleted Task:': t('phrases.deletedTask'),
    'Completed Task:': t('phrases.completedTask'),
    'Created Care Circle for': t('phrases.createdCircleFor'),
    'joined the circle as Care Recipient': t('phrases.joinedAsCareRecipient'),
    'joined the circle as Caregiver': t('phrases.joinedAsCaregiver'),
    'joined the circle as Family Member': t('phrases.joinedAsCaregiver'),
    Invited: t('phrases.invited'),
    'to join as Care Recipient': t('phrases.toJoinAsCareRecipient'),
    'to join as Caregiver': t('phrases.toJoinAsCaregiver'),
    'Updated emergency information': t('phrases.updatedEmergencyInfo'),
    '(taken late)': `(${t('phrases.takenLate')})`,
    '(taken)': `(${t('phrases.taken')})`,
    '(skipped)': `(${t('phrases.skipped')})`,
    '(missed)': `(${t('phrases.missed')})`,
    '(not taken)': `(${t('phrases.skipped')})`,
    "(changed another caregiver's answer)": t('phrases.changedAnswer'),
    // As-needed doses: a keyless/unknown-key row still reads in Spanish. Added
    // at the END so no existing phrase's substitution order changes.
    'Removed a logged dose:': t('phrases.removedLoggedDose'),
    'Logged a dose:': t('phrases.loggedDose'),
  };

  let translated = description;
  for (const [english, localized] of Object.entries(replacements)) {
    translated = translated.replace(english, localized);
  }

  // Handle complex patterns with regex

  // "Not taken: {title} on {YYYY-MM-DD}" (new format) and "Skipped {title} on {YYYY-MM-DD}" (legacy)
  translated = translated.replace(
    /^Not taken: (.+) on (\d{4}-\d{2}-\d{2})$/,
    (_match, title: string, date: string) =>
      `${t('phrases.skippedEvent')} ${title} ${t('phrases.onDate')} ${formatDateShort(date, t, locale)}`
  );
  translated = translated.replace(
    /^Skipped (.+) on (\d{4}-\d{2}-\d{2})$/,
    (_match, title: string, date: string) =>
      `${t('phrases.skippedEvent')} ${title} ${t('phrases.onDate')} ${formatDateShort(date, t, locale)}`
  );

  // "Stopped recurrence for {title} from {YYYY-MM-DD}"
  translated = translated.replace(
    /^Stopped recurrence for (.+) from (\d{4}-\d{2}-\d{2})$/,
    (_match, title: string, date: string) =>
      `${t('phrases.stoppedRecurrence')} ${title} ${t('phrases.fromDate')} ${formatDateShort(date, t, locale)}`
  );

  // "Imported N appointment(s) from calendar"
  translated = translated.replace(/^Imported (\d+) appointments? from calendar$/, (_, count) => {
    // i18next picks `_one` / `_other` from the active locale's CLDR rules.
    return t('phrases.importedAppointment', { count: parseInt(count, 10) });
  });

  return translated;
}
