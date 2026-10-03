import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  expireInvite,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { gotoActivitySettled } from '../notesFirstClassShared';

// Row "F-1 + Spanish feed sentences (10-02)": the legacy and rare Activity feed
// entry types. Each is a WHOLE-SENTENCE row recognised by action_type plus an
// anchored match of the stored English (activityTranslation.ts SENTENCE_RULES /
// translateSentenceRow; backend twin utils/activityDescription.ts):
//
//   member_invited  "A member was invited to the circle"             F-1 scrub of "Invited <email> ..."
//   member_left     "A member left the circle"                       user lookup failed on leave
//   member_left     "<Name> left the circle (account deleted)"       rows written before 2026-07-07
//   circle_created  "Created Self-Care Circle for <Name>"
//   medication_updated "Rescheduled Medication: <title> to HH:MM"    rows 2026-07-30..08-20, before keys
//   note_added      "Added notes to <title>"                         rows 2026-06-02..09-27, before keys
//
// Most of them cannot be produced by an ordinary click today (the backend no
// longer writes the legacy forms, and the bare "left" needs a failed user lookup),
// so the first test SEEDS the rows straight into a run-scoped circle's `activity_feed`
// with psql (the way the other e2e helpers seed; local-only guard in e2e/db.ts) in
// the exact shape the writers produce: NO description_key, NO description_params.
// The owner then reads the Activity page through the UI:
//   EN  every sentence renders exactly as stored;
//   ES  every sentence is the translated one, with the name / title / time kept as
//       stored, and no English fragment of any of them is left on the page.
//
// The second test pins the SEEDED shapes to what the current backend really
// writes, for the two rows it still can: the self-care circle row (POST /circles
// with is_self_care) and the F-1 scrub of a member_invited row (the addressee of a
// lapsed invite deletes their account). It reads the REAL rows back from the
// database, compares them to the seeded shapes, and renders them in ES and EN.
//
// People and titles are located by NAME (every name below is unique to the run).
// Seeded rows are deleted at the end; the circles and accounts are run-scoped and
// purged at teardown.
//
// FALSIFY: PW_FALSIFY=legacy-feed seeds nothing (every row assertion must go
// red); PW_FALSIFY=legacy-feed:<key> drops one row:
//   invited | left | leftNamed | selfCare | rescheduled | notes | real
// (`real` leaves the invite's addressee undeleted, so the real invited row keeps
// its pre-scrub "Invited <e-mail>..." shape).
// Proven against the app too (activityTranslation.ts edited in place, then restored
// byte-identical, 10-02): with the self-care, rescheduled and added-notes rules
// removed both tests go red; with the bare member_left rule listed AFTER the named
// one the first test goes red (ES "A member salió del círculo"); with the
// member_invited and named account-deleted rules removed both go red.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').filter(Boolean);
const falsify = (key: string): boolean =>
  FALSIFY.includes('legacy-feed') || FALSIFY.includes(`legacy-feed:${key}`);

const setLanguage = (account: ScopedAccount, lang: 'en' | 'es') =>
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );

interface SeedRow {
  key: string;
  id: string;
  actionType: string;
  subjectType: string;
  /** Stored English; the EN page must show exactly this. */
  en: string;
  /** The ES page must show exactly this. */
  es: string;
  minutesAgo: number;
}

/** The English fragments of the six sentences: none may survive on the ES page. */
const ENGLISH_FRAGMENTS =
  /left the circle|was invited to the circle|Created Self-Care Circle|Rescheduled Medication|Added notes to/;

function legacyRows(suffix: string): SeedRow[] {
  const leaver = `Gilberto Salida${suffix}`;
  const selfCare = `Marisol Vega${suffix}`;
  const medTitle = `Metformina${suffix}`;
  const apptTitle = `Cita Cardiologia${suffix}`;
  return [
    {
      key: 'invited',
      id: randomUUID(),
      actionType: 'member_invited',
      subjectType: 'invite',
      en: 'A member was invited to the circle',
      es: 'Se invitó a un miembro al círculo',
      minutesAgo: 10,
    },
    {
      key: 'left',
      id: randomUUID(),
      actionType: 'member_left',
      subjectType: 'membership',
      en: 'A member left the circle',
      es: 'Un miembro salió del círculo',
      minutesAgo: 20,
    },
    {
      key: 'leftNamed',
      id: randomUUID(),
      actionType: 'member_left',
      subjectType: 'membership',
      en: `${leaver} left the circle (account deleted)`,
      es: `${leaver} salió del círculo (cuenta eliminada)`,
      minutesAgo: 30,
    },
    {
      key: 'selfCare',
      id: randomUUID(),
      actionType: 'circle_created',
      subjectType: 'circle',
      en: `Created Self-Care Circle for ${selfCare}`,
      es: `Círculo de autocuidado creado para ${selfCare}`,
      minutesAgo: 40,
    },
    {
      key: 'rescheduled',
      id: randomUUID(),
      actionType: 'medication_updated',
      subjectType: 'event',
      en: `Rescheduled Medication: ${medTitle} to 14:30`,
      es: `Medicamento reprogramado: ${medTitle} a las 14:30`,
      minutesAgo: 50,
    },
    {
      key: 'notes',
      id: randomUUID(),
      actionType: 'note_added',
      // Pre-Slice-2 note rows carried subject_type 'event': no note_target, no preview, read-only.
      subjectType: 'event',
      en: `Added notes to ${apptTitle}`,
      es: `Agregó notas a ${apptTitle}`,
      minutesAgo: 60,
    },
  ];
}

function seed(circleId: string, actorId: string, rows: SeedRow[]): void {
  for (const r of rows) {
    if (falsify(r.key)) continue;
    // The shape the writers produced: no description_key, no description_params, no metadata.
    sqlExec(
      `insert into activity_feed (id, circle_id, actor_id, action_type, subject_type, subject_id, description, created_at)
       values (${sqlStr(r.id)}::uuid, ${sqlStr(circleId)}::uuid, ${sqlStr(actorId)}::uuid, ${sqlStr(r.actionType)},
               ${sqlStr(r.subjectType)}, ${sqlStr(randomUUID())}::uuid, ${sqlStr(r.en)},
               now() - interval '${r.minutesAgo} minutes');`
    );
  }
}

function unseed(rows: SeedRow[]): void {
  const ids = rows.map((r) => `${sqlStr(r.id)}::uuid`).join(', ');
  sqlExec(`delete from activity_feed where id in (${ids});`);
}

test('legacy and rare feed entries: EN shows the stored sentence, ES the translated one with no English left', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
  const owner = await createScopedAccount('legacyfeed-owner');
  const circleId = await createCircle(await ownerApi(request, owner), uniq('legacyfeed'));
  const rows = legacyRows(suffix);
  seed(circleId, owner.userId, rows);

  try {
    // The stored rows are the legacy shape: English prose, no key, no params.
    const stored = dbQuery<{ id: string; description: string; description_key: string | null; params: string | null }>(
      `select id::text as id, description, description_key, description_params::text as params
         from activity_feed where circle_id = ${sqlStr(circleId)}::uuid and id in (${rows
           .map((r) => `${sqlStr(r.id)}::uuid`)
           .join(', ')})`
    );
    expect(stored).toHaveLength(rows.filter((r) => !falsify(r.key)).length);
    for (const row of stored) {
      expect(row.description_key, `${row.description}: no key`).toBeNull();
      expect(row.params, `${row.description}: no params`).toBeNull();
    }

    // `.first()`: the newest row is mirrored into the "Latest" hero as well.
    const main = page.locator('main');
    const text = (s: string) => main.getByText(s, { exact: true }).first();

    // --- EN: every sentence is the stored one ---
    setLanguage(owner, 'en');
    await cookieLogin(context, owner, baseURL);
    await gotoActivitySettled(page, circleId);
    await expect(page.getByRole('heading', { name: 'Activity', exact: true }).first()).toBeVisible({
      timeout: 25_000,
    });
    for (const r of rows) {
      await expect(text(r.en), `EN row "${r.en}"`).toBeVisible({ timeout: 25_000 });
    }
    // None of them was rewritten into Spanish.
    await expect(page.getByText(/salió del círculo|Se invitó|autocuidado creado|reprogramado|Agregó notas/)).toHaveCount(0);

    // --- ES: every sentence is the translated one ---
    setLanguage(owner, 'es');
    await gotoActivitySettled(page, circleId);
    await expect(page.getByRole('heading', { name: 'Actividad', exact: true }).first()).toBeVisible({
      timeout: 25_000,
    });
    for (const r of rows) {
      await expect(text(r.es), `ES row "${r.es}"`).toBeVisible({ timeout: 25_000 });
    }
    // No English fragment of any of the six is left, and the bare "A member left" did not lose
    // its sentence to the named rule ("A member salió del círculo").
    await expect(page.getByText(ENGLISH_FRAGMENTS)).toHaveCount(0);
    await expect(page.getByText(/A member/)).toHaveCount(0);
    // The time is kept as stored (24h "HH:MM"), the name and titles are not translated.
    await expect(main.getByText(/a las 14:30$/).first()).toBeVisible();
  } finally {
    unseed(rows);
  }
});

test('the seeded shapes are what the backend writes today: the scrubbed invite row and the self-care circle row read the same', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
  const owner = await createScopedAccount('legacyreal-owner');
  const ownerSession = await ownerApi(request, owner);

  // (1) A self-care circle, through the API: the writer's "Created Self-Care Circle for <name>".
  const selfName = `Marisol Vega${suffix}`;
  const created = await ownerSession.post('/api/circles', { recipient_name: selfName, is_self_care: true });
  expect(created.status(), await created.text()).toBe(201);
  const circleId = ((await created.json()) as { data: { circle: { id: string } } }).data.circle.id;
  const selfCareRows = dbQuery<{
    action_type: string;
    subject_type: string | null;
    description: string;
    description_key: string | null;
    params: string | null;
  }>(
    `select action_type, subject_type, description, description_key, description_params::text as params
       from activity_feed where circle_id = ${sqlStr(circleId)}::uuid and action_type = 'circle_created'`
  );
  expect(selfCareRows).toEqual([
    {
      action_type: 'circle_created',
      subject_type: 'circle',
      description: `Created Self-Care Circle for ${selfName}`,
      description_key: null,
      params: null,
    },
  ]);

  // (2) A lapsed invite addressed to someone who then deletes their account: F-1 rewrites its
  //     member_invited row to the e-mail-free sentence. Invited for @example.com (never mailed) and
  //     re-addressed in the DB to the addressee; the deletion is the real API call.
  const addressee = await createScopedAccount('legacyreal-gone');
  const invite = await createInvite(ownerSession, circleId);
  sqlExec(
    `update invites set invited_email = ${sqlStr(addressee.email.toLowerCase())} where id = ${sqlStr(invite.id)}::uuid;`
  );
  expireInvite(invite.id);
  const invitedRows = () =>
    dbQuery<{
      action_type: string;
      subject_type: string | null;
      description: string;
      description_key: string | null;
      params: string | null;
    }>(
      `select action_type, subject_type, description, description_key, description_params::text as params
         from activity_feed where subject_id = ${sqlStr(invite.id)}::uuid and action_type = 'member_invited'`
    );
  // Before the deletion the row names the address (and carries a key).
  expect(invitedRows()).toHaveLength(1);
  expect(invitedRows()[0].description).toContain('Invited ');
  if (!falsify('real')) {
    const del = await (await ownerApi(request, addressee)).delete('/api/users/me');
    expect(del.status(), `DELETE /api/users/me: ${await del.text()}`).toBe(200);
  }
  // The shape the first test seeds for this row.
  expect(invitedRows()).toEqual([
    {
      action_type: 'member_invited',
      subject_type: 'invite',
      description: 'A member was invited to the circle',
      description_key: null,
      params: null,
    },
  ]);

  const main = page.locator('main');
  const text = (s: string) => main.getByText(s, { exact: true }).first();
  await cookieLogin(context, owner, baseURL);

  setLanguage(owner, 'es');
  await gotoActivitySettled(page, circleId);
  await expect(page.getByRole('heading', { name: 'Actividad', exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await expect(text('Se invitó a un miembro al círculo')).toBeVisible({ timeout: 25_000 });
  await expect(text(`Círculo de autocuidado creado para ${selfName}`)).toBeVisible();
  await expect(page.getByText(/was invited to the circle|Created Self-Care Circle/)).toHaveCount(0);
  await expect(main).not.toContainText(addressee.email);

  setLanguage(owner, 'en');
  await gotoActivitySettled(page, circleId);
  await expect(page.getByRole('heading', { name: 'Activity', exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await expect(text('A member was invited to the circle')).toBeVisible({ timeout: 25_000 });
  await expect(text(`Created Self-Care Circle for ${selfName}`)).toBeVisible();
  await expect(main).not.toContainText(addressee.email);
});
