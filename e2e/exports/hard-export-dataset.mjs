/**
 * THE "HARD" EXPORT DATASET — one definition, both platforms.
 *
 * CANONICAL COPY: mobile/.maestro/parity/exports/hard-export-dataset.mjs.
 * Byte-for-byte MIRROR: webapp/e2e/exports/hard-export-dataset.mjs (three repos,
 * no shared package — the same reason mobile/src/pdf/shared is mirrored). Edit
 * the mobile copy, then `cp` it over the web copy; both consumers (the Maestro
 * `exports` suite and webapp/e2e/flows/export-content.spec.ts) compare the two
 * files and fail on drift when both trees are present.
 *
 * Plain ESM, node builtins only, no imports: each platform hands in its own
 * adapters —
 *   api(method, path, token, body) -> parsed JSON body with `__status`
 *                                     (`path` is relative to `/api`)
 *   sqlExec(statement)             -> runs SQL on the LOCAL database
 *   sqlRows(select)                -> rows of a single SELECT
 *
 * WHAT IS IN IT (docs/plans/export-test-coverage-2026-09-30.md): a circle whose
 * care recipient lives in Pacific/Kiritimati (UTC+14; the circle owner's
 * `users.timezone`, the documented fallback when no recipient member exists),
 * exported by a viewer somewhere else (Denver, Midway):
 *   - Metformin 500mg at 08:00 AND 20:00 (two dose-time series, one medication)
 *   - Lisinopril 10mg at 09:00 AND 21:00
 *   - Atorvastatin 20mg, ENDED with "This and future" (recurrence_end_date)
 *   - Warfarin 5mg, DISCONTINUED at noon (recipient clock) three days ago
 *   - Ibuprofen 200mg, DELETED as a whole medication AFTER doses were recorded
 *     (PK3: soft delete — hidden from every list and the Care Summary, its recorded
 *     doses stay in the adherence report)
 *   - a REMOVED occurrence ("Delete this instance only" -> removed_at tombstone)
 *   - taken, taken_late, skipped, a legacy `missed` row and unmarked doses
 *   - answers by a SECOND caregiver
 *   - allergies, conditions, and a DNR that must never print
 * plus a separate ROW-CAP circle whose 90-day report reads > 1000 dose rows
 * and > 1000 confirmations (PostgREST caps an unpaged read at 1000 silently).
 *
 * THE TRUTH IS COMPUTED HERE, INDEPENDENTLY of the backend: `expectedAdherence`
 * walks the seeded plan (dates, stops, removals, answers) with its own few
 * lines of arithmetic. The specs assert printed == API == this. The plan is
 * seeded as ABSOLUTE dates, and the expected window is derived from the
 * recipient's "today" at ASSERT time, so a Kiritimati midnight between seed
 * and export moves the window exactly as the backend moves it.
 */

export const DATASET_VERSION = 1;
export const HARD_TZ = 'Pacific/Kiritimati';

// ---------------------------------------------------------------- dates

/** YYYY-MM-DD of `now` in `tz`. */
export function todayIn(tz, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Calendar arithmetic on a naive date string (never an instant ± 24h). */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n, 12));
  return x.toISOString().slice(0, 10);
}

function offsetMs(tz, utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

/** The real instant (ms) of a naive wall-clock `date` `HH:MM` in `tz`. */
export function zonedToUtcMs(dateStr, hhmm, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mi);
  let ms = guess - offsetMs(tz, guess);
  ms = guess - offsetMs(tz, ms);
  return ms;
}

// ---------------------------------------------------------------- the plan

/**
 * Answers per series, keyed by the day OFFSET from the seed day T.
 *   T taken on time   L taken late   S skipped   M legacy 'missed' row
 *   R removed ("this instance only")   - unmarked (listed only for the reader)
 *   2 suffix: answered by the SECOND caregiver
 */
export const HARD_SERIES = [
  {
    key: 'metAm', name: 'Metformin', dosage: '500mg', time: '08:00', start: -10,
    answers: { '-10': 'T', '-9': 'T', '-8': 'T', '-7': 'T', '-6': 'T', '-5': 'T', '-4': 'T', '-3': 'L', '-2': 'R', '-1': 'T2' },
  },
  {
    key: 'metPm', name: 'Metformin', dosage: '500mg', time: '20:00', start: -10,
    answers: { '-10': 'T', '-9': 'T', '-8': 'T', '-7': 'T', '-6': 'S', '-5': 'T', '-4': '-', '-3': 'T', '-2': 'T', '-1': '-' },
  },
  {
    key: 'lisAm', name: 'Lisinopril', dosage: '10mg', time: '09:00', start: -6,
    answers: { '-6': 'T', '-5': 'T', '-4': 'M', '-3': 'T', '-2': 'S', '-1': 'T' },
  },
  {
    key: 'lisPm', name: 'Lisinopril', dosage: '10mg', time: '21:00', start: -6,
    answers: { '-6': 'T2', '-5': '-', '-4': 'T', '-3': 'T', '-2': 'T', '-1': 'L2' },
  },
  {
    // "This and future" from T-3: recurrence_end_date becomes T-4.
    key: 'ato', name: 'Atorvastatin', dosage: '20mg', time: '22:00', start: -12, endFrom: -3,
    answers: { '-12': 'T', '-11': 'T', '-10': 'T', '-9': 'T', '-8': 'T', '-7': 'T', '-6': 'T', '-5': 'S', '-4': 'T' },
  },
  {
    // Discontinued at 12:00 on T-3 (recipient clock): T-3's 18:00 dose is not owed.
    key: 'war', name: 'Warfarin', dosage: '5mg', time: '18:00', start: -9, stopAt: { day: -3, time: '12:00' },
    answers: { '-9': 'T', '-8': 'T', '-7': 'T', '-6': '-', '-5': 'T', '-4': '-' },
  },
  {
    // Whole-medication DELETE with recorded doses (PK3): the server keeps the rows (soft delete:
    // `deleted_at`, `discontinued_at` = the delete instant). The delete instant is backdated to
    // the start of seed day T (recipient clock) like Warfarin's stop, so the owed doses are the
    // same whatever time the run happens: T-8..T-1 at 14:00, none on T.
    key: 'ibu', name: 'Ibuprofen', dosage: '200mg', time: '14:00', start: -8, deleteAt: { day: 0, time: '00:00' },
    answers: { '-8': 'T', '-7': 'T', '-6': 'S', '-5': 'T', '-4': 'L', '-3': 'T2', '-2': 'S', '-1': '-' },
  },
];

export const HARD_EMERGENCY = {
  medication_allergies: ['Penicillin'],
  allergies: ['Peanuts'],
  medical_conditions: ['Type 2 diabetes', 'Atrial fibrillation'],
  has_dnr: true,
};
/** Code status is hidden everywhere (memory project_dnr_hidden_both_platforms). */
export const DNR_MARKER = 'DNRMARKER do not resuscitate';

const STATUS = { T: 'taken', L: 'taken_late', S: 'skipped', M: 'missed' };

function must(res, what) {
  if (!res || typeof res.__status !== 'number' || res.__status >= 300) {
    throw new Error(`hard-export-dataset ${what}: ${res && res.__status} ${JSON.stringify(res).slice(0, 300)}`);
  }
  return res;
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const UUID = /^[0-9a-f-]{36}$/i;
function uuid(v, what) {
  if (!UUID.test(String(v))) throw new Error(`hard-export-dataset: ${what} is not a uuid: ${v}`);
  return String(v);
}

/**
 * Seed the hard dataset into an EXISTING circle owned by `owner`, with
 * `second` already an edit-capable member. Sets the OWNER's timezone to
 * HARD_TZ (the recipient zone). Returns the fixture (absolute dates) that
 * `expectedAdherence` / `expectedCareSummary` take.
 */
export async function seedHardDataset({ api, sqlExec, sqlRows }, { circleId, owner, second }) {
  uuid(circleId, 'circleId');
  uuid(owner.id, 'owner.id');
  uuid(second.id, 'second.id');
  sqlExec(`update public.users set timezone = ${q(HARD_TZ)} where id = ${q(owner.id)}`);
  const T = todayIn(HARD_TZ);
  const fixture = { version: DATASET_VERSION, tz: HARD_TZ, seedDay: T, circleId, series: [] };

  for (const s of HARD_SERIES) {
    const start = addDays(T, s.start);
    const res = must(
      await api('POST', `/circles/${circleId}/events`, owner.token, {
        event_type: 'medication',
        title: s.name,
        medication_name: s.name,
        medication_dosage: s.dosage,
        scheduled_date: start,
        scheduled_time: s.time,
        recurrence_rule: 'daily',
        notifications_enabled: false,
      }),
      `create ${s.key}`
    );
    const rootId = uuid(res.data.event.id, `${s.key} root`);
    const [row] = sqlRows(`select scheduled_date::text as d from public.calendar_events where id = ${q(rootId)}`);
    if (row?.d !== start) throw new Error(`precondition: ${s.key} starts ${row?.d}, want ${start} (start roll?)`);
    fixture.series.push({ key: s.key, name: s.name, dosage: s.dosage, time: s.time, rootId, start, end: null, stopAt: null, deleted: false, answers: {}, removed: [] });
  }
  const byKey = Object.fromEntries(fixture.series.map((x) => [x.key, x]));

  // Answers through the REAL confirm route (it materializes the child row the
  // way the app does), then SQL puts `confirmed_at` where a real caregiver
  // would have: a catch-up mark today is auto-classified taken_late by the
  // route (isConfirmationLate), which is not the history being modelled.
  for (const s of HARD_SERIES) {
    const f = byKey[s.key];
    for (const [off, code] of Object.entries(s.answers)) {
      const date = addDays(T, Number(off));
      if (code === '-') continue;
      if (code === 'R') {
        must(
          await api('DELETE', `/circles/${circleId}/events/${f.rootId}_${date}?deleteScope=single&scheduledDate=${date}`, owner.token),
          `remove ${s.key} ${date}`
        );
        f.removed.push(date);
        continue;
      }
      const letter = code[0];
      const who = code.endsWith('2') ? second : owner;
      must(
        await api('POST', `/circles/${circleId}/medications/confirm`, who.token, {
          event_id: date === f.start ? f.rootId : `${f.rootId}_${date}`,
          status: letter === 'S' || letter === 'M' ? 'skipped' : 'taken',
          scheduled_time: `${s.time}:00`,
        }),
        `confirm ${s.key} ${date} ${code}`
      );
      const due = zonedToUtcMs(date, s.time, HARD_TZ);
      const at = new Date(due + (letter === 'L' ? 3 * 3600_000 : 10 * 60_000)).toISOString();
      const dose = `from public.medication_confirmations mc join public.calendar_events ce on ce.id = mc.event_id
          where mc.circle_id = ${q(circleId)}
            and (ce.id = ${q(f.rootId)} or ce.parent_event_id = ${q(f.rootId)})
            and ce.scheduled_date = ${q(date)}`;
      sqlExec(
        `update public.medication_confirmations set status = ${q(STATUS[letter])}, confirmed_at = ${q(at)}
          where id in (select mc.id ${dose})`
      );
      const n = sqlRows(`select mc.id, mc.confirmed_by, mc.status ${dose}`);
      if (n.length !== 1 || n[0].confirmed_by !== who.id || n[0].status !== STATUS[letter]) {
        throw new Error(`precondition: ${s.key} ${date} expected one confirmation by ${who.id}, got ${JSON.stringify(n)}`);
      }
      f.answers[date] = { status: STATUS[letter], by: who === second ? 'second' : 'owner' };
    }
  }

  // Ended ("This and future" from T+endFrom) and discontinued (backdated stop).
  for (const s of HARD_SERIES) {
    const f = byKey[s.key];
    if (s.endFrom !== undefined) {
      const from = addDays(T, s.endFrom);
      must(
        await api('DELETE', `/circles/${circleId}/events/${f.rootId}_${from}?deleteScope=future&scheduledDate=${from}`, owner.token),
        `end ${s.key} from ${from}`
      );
      const [r] = sqlRows(`select recurrence_end_date::text as e, discontinued_at from public.calendar_events where id = ${q(f.rootId)}`);
      if (r?.e !== addDays(from, -1) || r?.discontinued_at) {
        throw new Error(`precondition: ${s.key} after "This and future" = ${JSON.stringify(r)}, want end ${addDays(from, -1)}, not discontinued`);
      }
      f.end = r.e;
    }
    if (s.stopAt) {
      must(
        await api('PATCH', `/circles/${circleId}/events/${f.rootId}/medication-status`, owner.token, { discontinued: true }),
        `discontinue ${s.key}`
      );
      const stopIso = new Date(zonedToUtcMs(addDays(T, s.stopAt.day), s.stopAt.time, HARD_TZ)).toISOString();
      sqlExec(
        `update public.calendar_events set discontinued_at = ${q(stopIso)}
          where id = ${q(f.rootId)} or parent_event_id = ${q(f.rootId)}`
      );
      f.stopAt = stopIso;
    }
  }

  // Whole-medication delete after recorded doses (PK3): the REAL route soft-deletes (the
  // confirmations stay); SQL then backdates the stop instant it stamped (now) to the plan's.
  for (const s of HARD_SERIES) {
    if (!s.deleteAt) continue;
    const f = byKey[s.key];
    const res = must(await api('DELETE', `/circles/${circleId}/events/${f.rootId}`, owner.token), `delete ${s.key}`);
    if (res.data?.history_kept !== true) throw new Error(`precondition: deleting ${s.key} must answer history_kept:true, got ${JSON.stringify(res.data)}`);
    const stopIso = new Date(zonedToUtcMs(addDays(T, s.deleteAt.day), s.deleteAt.time, HARD_TZ)).toISOString();
    sqlExec(
      `update public.calendar_events set discontinued_at = ${q(stopIso)}
        where (id = ${q(f.rootId)} or parent_event_id = ${q(f.rootId)}) and deleted_at is not null`
    );
    const rows = sqlRows(
      `select (select count(*)::int from public.calendar_events where (id = ${q(f.rootId)} or parent_event_id = ${q(f.rootId)}) and deleted_at is not null) as soft,
              (select count(*)::int from public.medication_confirmations mc join public.calendar_events ce on ce.id = mc.event_id
                where ce.id = ${q(f.rootId)} or ce.parent_event_id = ${q(f.rootId)}) as kept`
    );
    const wantKept = Object.values(s.answers).filter((c) => c !== '-' && c !== 'R').length;
    if (!rows[0] || rows[0].soft < 1 || rows[0].kept !== wantKept) {
      throw new Error(`precondition: ${s.key} after delete = ${JSON.stringify(rows)}, want soft-deleted rows and ${wantKept} kept confirmations`);
    }
    f.stopAt = stopIso;
    f.deleted = true;
  }

  must(
    await api('PUT', `/circles/${circleId}/emergency-info`, owner.token, { ...HARD_EMERGENCY, advance_directives: DNR_MARKER }),
    'emergency info'
  );
  assertSeededAsPlanned(fixture);
  return fixture;
}

/**
 * The fixture the plan DESCRIBES for seed day `T`, without touching a database
 * (root ids are placeholders). `seedHardDataset` must produce exactly this;
 * the unit test (hard-export-dataset.test.mjs) pins the hand-counted figures.
 */
export function fixtureFromPlan(T) {
  const series = HARD_SERIES.map((s) => {
    const answers = {};
    const removed = [];
    for (const [off, code] of Object.entries(s.answers)) {
      const date = addDays(T, Number(off));
      if (code === '-') continue;
      if (code === 'R') removed.push(date);
      else answers[date] = { status: STATUS[code[0]], by: code.endsWith('2') ? 'second' : 'owner' };
    }
    return {
      key: s.key, name: s.name, dosage: s.dosage, time: s.time, rootId: `plan-${s.key}`,
      start: addDays(T, s.start),
      end: s.endFrom !== undefined ? addDays(T, s.endFrom - 1) : null,
      stopAt: s.stopAt
        ? new Date(zonedToUtcMs(addDays(T, s.stopAt.day), s.stopAt.time, HARD_TZ)).toISOString()
        : s.deleteAt
          ? new Date(zonedToUtcMs(addDays(T, s.deleteAt.day), s.deleteAt.time, HARD_TZ)).toISOString()
          : null,
      deleted: !!s.deleteAt,
      answers,
      removed,
    };
  });
  return { version: DATASET_VERSION, tz: HARD_TZ, seedDay: T, circleId: 'plan', series };
}

/** Throws unless a seeded fixture carries exactly what the plan describes. */
export function assertSeededAsPlanned(fixture) {
  const plan = fixtureFromPlan(fixture.seedDay);
  const strip = (fx) => JSON.stringify(fx.series.map(({ rootId, ...rest }) => rest));
  if (strip(plan) !== strip(fixture)) {
    throw new Error(`seeded fixture differs from the plan:\n seeded ${strip(fixture)}\n plan   ${strip(plan)}`);
  }
}

// ---------------------------------------------------------------- the truth

function owedDates(f, winStart, winEnd, tz, { countRemoved = false } = {}) {
  const out = [];
  let d = f.start > winStart ? f.start : winStart;
  const last = f.end && f.end < winEnd ? f.end : winEnd;
  for (; d <= last; d = addDays(d, 1)) {
    if (!countRemoved && f.removed.includes(d)) continue;
    if (f.stopAt && zonedToUtcMs(d, f.time, tz) >= Date.parse(f.stopAt)) continue;
    out.push(d);
  }
  return out;
}

/** Whole days from naive date `a` to `b` (calendar arithmetic, never instants). */
function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * PK26 "All time": the backend starts the window at the day of the circle's EARLIEST
 * confirmation (recipient zone) and reports `period_days` = whole days from there to the
 * recipient's today. The hard dataset's earliest confirmation is Atorvastatin's first dose.
 */
export function allTimeDays(fixture, todayR) {
  const dates = fixture.series.flatMap((f) => Object.keys(f.answers));
  const earliest = dates.sort()[0];
  return Math.max(1, daysBetween(earliest, todayR));
}

const rate = (taken, total) => (total > 0 ? Math.round((taken / total) * 100) : 0);

/**
 * What the adherence report for `days` must say, from the fixture alone.
 * Window = `days` complete days ending YESTERDAY in the recipient zone
 * (`todayR` = the recipient's today at export time).
 * `falsify.countRemovedAsDue` models the old bug (a removed dose counted as
 * scheduled-and-unmarked) — used only to prove the specs go red.
 */
export function expectedAdherence(fixture, todayR, days, falsify = {}) {
  const start = addDays(todayR, -days);
  const end = addDays(todayR, -1);
  const zero = () => ({ total: 0, taken: 0, taken_late: 0, skipped: 0 });
  const all = zero();
  const byMed = new Map();
  const bySlot = new Map();
  const byDay = new Map();
  for (const f of fixture.series) {
    const medKey = `${f.name}|${f.dosage}`;
    if (!byMed.has(medKey)) byMed.set(medKey, { name: f.name, dosage: f.dosage, ...zero() });
    if (!bySlot.has(f.time)) bySlot.set(f.time, { time: f.time, ...zero() });
    for (const d of owedDates(f, start, end, fixture.tz, { countRemoved: !!falsify.countRemovedAsDue })) {
      const st = f.answers[d]?.status;
      if (!byDay.has(d)) byDay.set(d, { date: d, ...zero() });
      for (const b of [all, byMed.get(medKey), bySlot.get(f.time), byDay.get(d)]) {
        b.total += 1;
        if (st === 'taken' || st === 'taken_late') b.taken += 1;
        if (st === 'taken_late') b.taken_late += 1;
        if (st === 'skipped') b.skipped += 1;
      }
    }
  }
  const finish = (b) => ({ ...b, not_marked: b.total - b.taken - b.skipped, rate: rate(b.taken, b.total) });
  // PK25: the trend compares the halves of the window (first half = dates before start + floor(days/2));
  // with no dose due in either half there is nothing to compare and NO direction may print.
  const midpoint = addDays(start, Math.floor(days / 2));
  const dueFirstHalf = [...byDay.keys()].some((d) => d < midpoint);
  const dueSecondHalf = [...byDay.keys()].some((d) => d >= midpoint);
  return {
    start_date: start,
    end_date: end,
    trendAvailable: dueFirstHalf && dueSecondHalf,
    summary: finish(all),
    byMedication: [...byMed.values()].filter((b) => b.total > 0).map(finish),
    bySlot: [...bySlot.values()].filter((b) => b.total > 0).map(finish).sort((a, b) => a.time.localeCompare(b.time)),
    byDay: [...byDay.values()].map(finish).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * What the care summary must list (memory project_pdf_shared_templates):
 * current = recurring, not ended, not stopped; recently stopped = discontinued
 * (stop DAY in the recipient zone) AND, since PK26, a course ended with "This
 * and future" (its `recurrence_end_date`, a naive date, is the printed stop date),
 * newest stop first; a medication DELETED with recorded doses (PK3) is on no
 * list at all (`deleted`) though its doses stay in the adherence report.
 */
export function expectedCareSummary(fixture, now = new Date()) {
  const groups = new Map();
  const stopped = [];
  const deleted = [];
  for (const f of fixture.series) {
    if (f.deleted) {
      deleted.push(f.name);
      continue;
    }
    if (f.stopAt) {
      stopped.push({ name: f.name, dosage: f.dosage, stoppedDay: todayIn(fixture.tz, new Date(f.stopAt)), stopAt: f.stopAt });
      continue;
    }
    if (f.end && new Date(`${f.end}T12:00:00Z`) < now) {
      stopped.push({ name: f.name, dosage: f.dosage, stoppedDay: f.end, stopAt: `${f.end}T12:00:00Z` });
      continue;
    }
    const k = `${f.name}|${f.dosage}`;
    if (!groups.has(k)) groups.set(k, { name: f.name, dosage: f.dosage, times: [] });
    groups.get(k).times.push(f.time);
  }
  // Newest stop first (by day, then instant), as the shared selection orders them.
  stopped.sort((a, b) => b.stoppedDay.localeCompare(a.stoppedDay) || b.stopAt.localeCompare(a.stopAt));
  return {
    current: [...groups.values()],
    stopped: stopped.map(({ stopAt, ...rest }) => rest),
    absent: [],
    deleted,
    medicationAllergies: HARD_EMERGENCY.medication_allergies,
    otherAllergies: HARD_EMERGENCY.allergies,
    conditions: HARD_EMERGENCY.medical_conditions,
    mustNotContain: [DNR_MARKER, 'Code status', 'Estado de código', 'DNR'],
  };
}

// ---------------------------------------------------------------- row cap

export const ROWCAP_SERIES = 12;
export const ROWCAP_START = -95;
/** Series i (0-based) is left unmarked on T-(1+7i); every other owed dose is taken. */
export const rowCapGapOffset = (i) => -(1 + 7 * i);

/**
 * 12 daily dose-time series (06:00..17:00) from T-95, every dose in T-90..T-1
 * confirmed `taken` except one gap per series — 1068 child rows + 1068
 * confirmations inside a 90-day report, both over PostgREST's 1000-row cap.
 * Roots through the real API, the bulk rows by SQL (1068 confirm calls would
 * take minutes). Owner timezone = HARD_TZ.
 */
export async function seedRowCap({ api, sqlExec, sqlRows }, { circleId, owner, name = 'Levothyroxine', dosage = '25mcg' }) {
  uuid(circleId, 'circleId');
  uuid(owner.id, 'owner.id');
  sqlExec(`update public.users set timezone = ${q(HARD_TZ)} where id = ${q(owner.id)}`);
  const T = todayIn(HARD_TZ);
  const roots = [];
  for (let i = 0; i < ROWCAP_SERIES; i++) {
    const time = `${String(6 + i).padStart(2, '0')}:00`;
    const res = must(
      await api('POST', `/circles/${circleId}/events`, owner.token, {
        event_type: 'medication',
        title: name,
        medication_name: name,
        medication_dosage: dosage,
        scheduled_date: addDays(T, ROWCAP_START),
        scheduled_time: time,
        recurrence_rule: 'daily',
        notifications_enabled: false,
      }),
      `rowcap create ${i}`
    );
    roots.push({ id: uuid(res.data.event.id, 'rowcap root'), time, gap: addDays(T, rowCapGapOffset(i)) });
  }
  const from = addDays(T, -90);
  const to = addDays(T, -1);
  for (const r of roots) {
    sqlExec(`
      with days as (
        select d::date as d from generate_series(${q(from)}::date, ${q(to)}::date, interval '1 day') d
        where d::date <> ${q(r.gap)}::date
      ), kids as (
        insert into public.calendar_events (circle_id, parent_event_id, event_type, title, medication_name, medication_dosage,
                                            scheduled_date, scheduled_time, created_by, notifications_enabled)
        select ${q(circleId)}, ${q(r.id)}, 'medication', ${q(name)}, ${q(name)}, ${q(dosage)}, days.d, ${q(r.time)}::time, ${q(owner.id)}, false
          from days
        returning id, scheduled_date, scheduled_time
      )
      insert into public.medication_confirmations (event_id, circle_id, confirmed_by, confirmed_at, status, scheduled_time)
      select kids.id, ${q(circleId)}, ${q(owner.id)},
             ((kids.scheduled_date + kids.scheduled_time) at time zone ${q(HARD_TZ)}) + interval '5 minutes',
             'taken', kids.scheduled_time
        from kids`);
  }
  const [c] = sqlRows(
    `select count(*)::int as n from public.medication_confirmations where circle_id = ${q(circleId)}`
  );
  const expectedN = ROWCAP_SERIES * 90 - ROWCAP_SERIES;
  if (c?.n !== expectedN) throw new Error(`precondition: rowcap confirmations ${c?.n}, want ${expectedN}`);
  return { version: DATASET_VERSION, tz: HARD_TZ, seedDay: T, circleId, name, dosage, roots };
}

/** The 90-day (or `days`) truth for the row-cap circle. */
export function expectedRowCap(rc, todayR, days) {
  const start = addDays(todayR, -days);
  const end = addDays(todayR, -1);
  const rootStart = addDays(rc.seedDay, ROWCAP_START);
  const seededFrom = addDays(rc.seedDay, -90);
  const seededTo = addDays(rc.seedDay, -1);
  let total = 0;
  let taken = 0;
  const byDay = new Map();
  for (const r of rc.roots) {
    for (let d = start > rootStart ? start : rootStart; d <= end; d = addDays(d, 1)) {
      if (!byDay.has(d)) byDay.set(d, { date: d, total: 0, taken: 0, taken_late: 0, skipped: 0 });
      const day = byDay.get(d);
      total += 1;
      day.total += 1;
      if (d >= seededFrom && d <= seededTo && d !== r.gap) {
        taken += 1;
        day.taken += 1;
      }
    }
  }
  const summary = { total, taken, taken_late: 0, skipped: 0, not_marked: total - taken, rate: rate(taken, total) };
  // One medication at 12 dose times: the document merges the 12 series into ONE row.
  return {
    start_date: start,
    end_date: end,
    summary,
    byMedication: [{ name: rc.name, dosage: rc.dosage, ...summary }],
    byDay: [...byDay.values()]
      .map((x) => ({ ...x, not_marked: x.total - x.taken, rate: rate(x.taken, x.total) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------------------------------------------------------------- reading the document

const MONTHS = {
  en: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A tolerant pattern for a printed date (engines differ: "Sep"/"Sept."/"sept", "de"). */
export function datePattern(dateStr, lang, { year = true } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const mon = MONTHS[lang === 'es' ? 'es' : 'en'][m - 1];
  const yr = year ? y : '';
  return lang === 'es'
    ? `${d}\\s+(?:de\\s+)?${mon}[a-z]*\\.?${year ? `\\s+(?:de\\s+)?${yr}` : ''}`
    : `${mon}[a-z]*\\.?\\s+${d}${year ? `,?\\s+${yr}` : ''}`;
}

/** A printed wall-clock time for naive HH:MM, 12h or 24h, EN or ES meridiem. */
export function timePattern(hhmm) {
  const [h, mi] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mer = h < 12 ? '(?:AM|a\\.?\\s?m\\.?)' : '(?:PM|p\\.?\\s?m\\.?)';
  const mm = String(mi).padStart(2, '0');
  return `(?<![\\d:])(?:${h12}:${mm}\\s?${mer}|${String(h).padStart(2, '0')}:${mm}|${h}:${mm}(?!\\s?[AaPp]))`;
}

export const norm = (text) => String(text).replace(/ | /g, ' ').replace(/\s+/g, ' ').trim();

const LABELS = {
  en: {
    sentence: (x) => `took ${x.taken} of ${x.total} scheduled doses \\(${x.rate}%\\)\\. ${x.taken_late} were taken late and ${x.not_marked} were not marked`,
    tiles: ['Adherence rate', 'Taken on time', 'Taken late', 'Not marked', 'Skipped', 'Total'],
    range: 'to',
    current: 'Current medications',
    stopped: 'Recently stopped medications',
    medAllergies: 'Medication allergies',
    otherAllergies: 'Other allergies',
    trends: ['Improving', 'Declining', 'Stable'],
  },
  es: {
    sentence: (x) => `tomó ${x.taken} de ${x.total} dosis programadas \\(${x.rate}%\\)\\. ${x.taken_late} se tomaron tarde y ${x.not_marked} no se marcaron`,
    tiles: ['Tasa de adherencia', 'Tomados a tiempo', 'Tomados tarde', 'Sin marcar', 'Omitidos', 'Total'],
    range: 'al',
    current: 'Medicamentos actuales',
    stopped: 'Medicamentos suspendidos recientemente',
    medAllergies: 'Alergias a medicamentos',
    otherAllergies: 'Otras alergias',
    trends: ['Mejorando', 'Empeorando', 'Estable'],
  },
};

/** The six tile values, from either a DOM-order ("73% Adherence rate 22 Taken…") or a layout-order ("73% 22 … Adherence rate Taken…") text. */
export function readTiles(text, lang = 'en') {
  const t = norm(text);
  const L = LABELS[lang].tiles;
  // Case-insensitive: the labels are CSS-uppercased, and innerText / pdftotext both print what is rendered.
  const pairs = new RegExp(L.map((l, i) => `(\\d+)${i === 0 ? '%' : ''}\\s+${esc(l)}`).join('\\s+'), 'i');
  const m1 = t.match(pairs);
  if (m1) return m1.slice(1).map(Number);
  // Layout order (pdftotext -layout): six values on one line, then the labels —
  // which WRAP in the narrow tiles ("ADHERENCE / RATE"), so only the first
  // word of the first label is anchored.
  const grid = new RegExp(`(\\d+)%\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+${esc(L[0].split(' ')[0])}\\b`, 'i');
  const m2 = t.match(grid);
  return m2 ? m2.slice(1).map(Number) : null;
}

/**
 * Check an adherence-report document's TEXT (the print iframe's innerText on
 * web, `pdftotext -layout` of the file the app shared on mobile) against the
 * expected figures. Returns a list of problems (empty = pass).
 */
export function checkAdherenceText(text, exp, { lang = 'en', recipientName } = {}) {
  const t = norm(text);
  const L = LABELS[lang];
  const problems = [];
  const s = exp.summary;
  if (recipientName && !t.toLowerCase().includes(recipientName.toLowerCase())) problems.push(`recipient name "${recipientName}" missing`);
  const sentence = new RegExp(L.sentence(s), 'i');
  if (!sentence.test(t)) {
    const got = t.match(lang === 'es' ? /tomó \d+ de \d+ dosis[^.]*\.[^.]*\./ : /took \d+ of \d+ scheduled[^.]*\.[^.]*\./);
    problems.push(`summary sentence: want "${L.sentence(s).replace(/\\/g, '')}", got "${got ? got[0] : '(none)'}"`);
  }
  const tiles = readTiles(t, lang);
  const wantTiles = [s.rate, s.taken - s.taken_late, s.taken_late, s.not_marked, s.skipped, s.total];
  if (!tiles || tiles.join(',') !== wantTiles.join(',')) problems.push(`tiles: want ${wantTiles.join(',')}, got ${tiles ? tiles.join(',') : '(unreadable)'}`);
  const range = new RegExp(`${datePattern(exp.start_date, lang)}\\s+${L.range}\\s+${datePattern(exp.end_date, lang)}`, 'i');
  // PK26: each header date is a no-wrap unit, so the year can no longer wrap onto its own
  // line ("... al 30 sept / 2026" on iOS in Spanish): the range must read whole.
  if (!range.test(t)) problems.push(`period ${exp.start_date}..${exp.end_date} not printed as a range`);
  // PK25: no medication due in one half of the window -> the report carries no trend badge.
  // (A window that does have a trend prints one of the three labels; not asserted here: the
  // label depends on the figures, the API comparison in the specs pins those.)
  if (exp.trendAvailable === false && new RegExp(`\\b(?:${L.trends.join('|')})\\b`, 'i').test(t)) {
    problems.push(`trend printed (${L.trends.join('/')}) although nothing was due in one half of the window`);
  }
  for (const m of exp.byMedication || []) {
    const row = new RegExp(`${esc(m.name)}\\s+${esc(m.dosage)}\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)%`, 'i');
    const got = t.match(row);
    const want = [m.taken, m.not_marked, m.skipped, m.rate].join(',');
    if (!got || got.slice(1).join(',') !== want) problems.push(`by-medication ${m.name} ${m.dosage}: want ${want}, got ${got ? got.slice(1).join(',') : '(no row)'}`);
  }
  // The "days with a missed or unmarked dose" table: the last 30 days of the
  // window only (the template caps its day strip at 30), every short day listed
  // with its exact counts, and no full day listed.
  for (const day of (exp.byDay || []).slice(-30)) {
    const row = new RegExp(`${datePattern(day.date, lang)}\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)`, 'i');
    const got = t.match(row);
    if (day.taken < day.total) {
      const want = [day.total, day.taken, day.not_marked, day.skipped].join(',');
      if (!got || got.slice(1).join(',') !== want) problems.push(`short day ${day.date}: want ${want}, got ${got ? got.slice(1).join(',') : '(no row)'}`);
    } else if (got) {
      problems.push(`full day ${day.date} listed as short: ${got[0]}`);
    }
  }
  for (const b of exp.bySlot || []) {
    const row = new RegExp(`${timePattern(b.time)}\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)%`, 'i');
    const got = t.match(row);
    const want = [b.total, b.taken, b.not_marked, b.skipped, b.rate].join(',');
    if (!got || got.slice(1).join(',') !== want) problems.push(`time slot ${b.time}: want ${want}, got ${got ? got.slice(1).join(',') : '(no row)'}`);
  }
  return problems;
}

/** Check a care-summary document's TEXT against `expectedCareSummary`. */
export function checkCareSummaryText(text, exp, { lang = 'en', recipientName } = {}) {
  // Lower-cased: headings are CSS-uppercased on the page and in the PDF text.
  const t = norm(text).toLowerCase();
  const lc = (v) => String(v).toLowerCase();
  const L = LABELS[lang];
  const problems = [];
  if (recipientName && !t.includes(lc(recipientName))) problems.push(`recipient name "${recipientName}" missing`);
  const iCur = t.indexOf(lc(L.current));
  const iStop = t.indexOf(lc(L.stopped));
  if (iCur < 0) problems.push(`"${L.current}" section missing`);
  if (exp.stopped.length && iStop < 0) problems.push(`"${L.stopped}" section missing`);
  // The current table runs from its heading to the stopped heading (or the next section).
  const current = iCur >= 0 ? t.slice(iCur, iStop > iCur ? iStop : iCur + 600) : '';
  const stoppedPart = iStop >= 0 ? t.slice(iStop, iStop + 900) : '';
  for (const g of exp.current) {
    const at = current.indexOf(lc(g.name));
    if (at < 0) {
      problems.push(`current medication ${g.name} missing`);
      continue;
    }
    const row = current.slice(at, at + 160);
    if (!row.includes(lc(g.dosage))) problems.push(`current ${g.name}: dosage ${g.dosage} missing`);
    for (const time of g.times) {
      if (!new RegExp(timePattern(time), 'i').test(row)) problems.push(`current ${g.name}: time ${time} missing in "${row.slice(0, 120)}"`);
    }
    if (stoppedPart.includes(lc(g.name))) problems.push(`active ${g.name} also listed as stopped`);
  }
  // Each stopped row runs from its name to the next stopped row's name (or 200 chars), so a
  // neighbour's date can never satisfy this row. Order = newest stop first.
  const at = exp.stopped.map((s) => stoppedPart.indexOf(lc(s.name)));
  for (const [i, s] of exp.stopped.entries()) {
    if (current.includes(lc(s.name))) problems.push(`stopped ${s.name} listed as CURRENT`);
    if (at[i] < 0) {
      problems.push(`stopped medication ${s.name} missing`);
      continue;
    }
    const next = at.filter((x) => x > at[i]).sort((a, b) => a - b)[0];
    const row = stoppedPart.slice(at[i], next ?? at[i] + 200);
    if (!row.includes(lc(s.dosage))) problems.push(`stopped ${s.name}: dosage missing`);
    if (!new RegExp(datePattern(s.stoppedDay, lang), 'i').test(row)) problems.push(`stopped ${s.name}: stop day ${s.stoppedDay} not printed in "${row.slice(0, 140)}"`);
    if (i > 0 && at[i - 1] >= 0 && at[i] >= 0 && at[i] < at[i - 1]) problems.push(`stopped ${s.name} printed before a newer stop (${exp.stopped[i - 1].name})`);
  }
  for (const name of exp.deleted || []) {
    if (t.includes(lc(name))) problems.push(`deleted medication ${name} must not be printed anywhere`);
  }
  for (const name of exp.absent) {
    if (current.includes(lc(name))) problems.push(`ended ${name} listed as CURRENT`);
  }
  for (const a of exp.medicationAllergies) if (!t.includes(lc(a))) problems.push(`medication allergy ${a} missing`);
  for (const a of exp.otherAllergies) if (!t.includes(lc(a))) problems.push(`allergy ${a} missing`);
  if (!t.includes(lc(L.medAllergies))) problems.push(`"${L.medAllergies}" label missing`);
  for (const c of exp.conditions) if (!t.includes(lc(c))) problems.push(`condition ${c} missing`);
  for (const bad of exp.mustNotContain) if (t.includes(lc(bad))) problems.push(`must not print "${bad}"`);
  return problems;
}
