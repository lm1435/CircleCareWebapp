import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { countRequests, dbQuery } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { apiCreateEvent, dateInZone, errorToast } from '../unhappy/writes/_helpers';
import { circleTimezone, createDailyMedication, deleteSeries, escapeRegExp, uniqueSuffix } from '../notesFirstClassShared';

// Row "OS-remove-occurrence": the two toasts a caregiver sees when ANOTHER member
// removes the single occurrence they are looking at ("This event / dose only"
// tombstones it, docs/plans/medication-remove-occurrence.md) and they then act on
// the stale screen. Both write routes answer 409 OCCURRENCE_REMOVED and write
// nothing; the clients must say so in words (not "Please try again": no retry can
// ever succeed) and keep what the person typed.
//
//   (1) EventNotesPanel: an appointment-series occurrence is open in the calendar
//       detail sheet with its notes panel (the deep link the Activity feed uses);
//       the note is typed; a second member removes THAT occurrence; "Add note" is
//       pressed. Toast (type-neutral, a visit is not a dose):
//         EN "This event was removed from the calendar for that day."
//         ES "Este evento se eliminó del calendario para ese día."
//       No note is written, the composer keeps the text, one POST was sent.
//   (2) TodaysMeds (Home): today's dose is on the card; a second member removes it;
//       Confirm is pressed (5 s undo window, then the POST).
//         EN "This dose was removed from the schedule."
//         ES "Esta dosis se eliminó del horario."
//       No confirmation row is written, one POST was sent.
//
// The removal is done by a second, joined caregiver through the public API while
// the owner's page is open; the owner's page is NOT reloaded in between.
// Run-scoped accounts only (`runScopedEmail`, purged at teardown).
//
// TIMEZONE: the recipient's zone follows the owner's profile zone (Denver by
// default) and the browser is pinned to it. The dose is 00:01 "today" in that zone
// and the card test is skipped within 5 minutes of that midnight, exactly like
// dose-verify-before-alert / todays-meds-undo.
//
// FALSIFY: PW_FALSIFY=occurrence-removed skips the removal in both tests, so the
// write succeeds and the error-toast assertion must go red; =occurrence-removed:panel
// or :meds drops one.
// Proven against the app too (edited in place, then restored byte-identical,
// 10-02): with the OCCURRENCE_REMOVED branch of EventNotesPanel reverted to the
// generic "Couldn't save your note" both panel tests go red; with the branch of
// TodaysMeds reverted to the generic "Couldn't save" both card tests go red.

const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';
const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').filter(Boolean);
const falsify = (step: 'panel' | 'meds'): boolean =>
  FALSIFY.includes('occurrence-removed') || FALSIFY.includes(`occurrence-removed:${step}`);

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: RECIPIENT_TZ });
test.setTimeout(120_000);

type Lang = 'en' | 'es';

const COPY = {
  en: {
    panelToast: 'This event was removed from the calendar for that day.',
    doseToast: 'This dose was removed from the schedule.',
    addNote: 'Add note',
    confirm: (name: string) => `Confirm ${name}`,
    undo: (name: string) => `Undo ${name}`,
  },
  es: {
    panelToast: 'Este evento se eliminó del calendario para ese día.',
    doseToast: 'Esta dosis se eliminó del horario.',
    addNote: 'Agregar nota',
    confirm: (name: string) => `Confirmar ${name}`,
    undo: (name: string) => `Deshacer ${name}`,
  },
} as const;

function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date()
  );
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

// `language_set_at` is stamped: with a NULL stamp the backend treats the language as "never decided"
// and overwrites it with the device's on the next sign-in (routes/auth.ts).
function profile(account: ScopedAccount, lang: Lang, first?: string, last?: string): void {
  sqlExec(
    `update public.users set timezone = ${sqlStr(RECIPIENT_TZ)}, language = ${sqlStr(lang)}, language_set_at = now()` +
      (first ? `, first_name = ${sqlStr(first)}, last_name = ${sqlStr(last ?? '')}` : '') +
      ` where id = ${sqlStr(account.userId)}::uuid;`
  );
}

/** An owner with a circle and a second, joined caregiver (located by NAME, never by position). */
async function circleWithCaregiver(request: APIRequestContext, label: string, lang: Lang) {
  const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
  const owner = await createScopedAccount(`${label}-owner`);
  profile(owner, lang, 'Ofelia', `Duena${suffix}`);
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq(label));
  const tz = await circleTimezone(ownerSession, circleId);
  expect(tz, 'recipient zone follows the owner profile zone').toBe(RECIPIENT_TZ);

  const caregiver = await createScopedAccount(`${label}-cg`);
  profile(caregiver, lang, 'Teodoro', `Retirado${suffix}`);
  const caregiverSession = await ownerApi(request, caregiver);
  const invite = await createInvite(ownerSession, circleId); // @example.com, never mailed
  const accept = await caregiverSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(accept.status(), await accept.text()).toBeLessThan(300);
  expect(membershipCount(circleId, caregiver.userId)).toBe(1);
  return { owner, ownerSession, caregiver, caregiverSession, circleId, tz };
}

/** The caregiver removes ONE occurrence ("This ... only") through the public API. */
async function removeOccurrence(
  s: Awaited<ReturnType<typeof circleWithCaregiver>>,
  rootId: string,
  date: string
): Promise<void> {
  const res = await s.caregiverSession.delete(
    `/api/circles/${s.circleId}/events/${rootId}?deleteScope=single&scheduledDate=${date}`
  );
  expect(res.ok(), `caregiver DELETE single failed: ${res.status()} ${await res.text()}`).toBe(true);
}

const tombstones = (rootId: string, date: string): { removed_at: string | null }[] =>
  dbQuery<{ removed_at: string | null }>(
    `select removed_at::text as removed_at from calendar_events
      where parent_event_id = ${sqlStr(rootId)}::uuid and scheduled_date = ${sqlStr(date)}::date`
  );

for (const lang of ['en', 'es'] as const) {
  test(`EventNotesPanel (${lang.toUpperCase()}): a note on an occurrence another member removed says so, writes nothing and keeps the text`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const c = COPY[lang];
    const s = await circleWithCaregiver(request, `ort-panel-${lang}`, lang);
    const title = `Cita Control ${uniqueSuffix()}`;
    const start = dateInZone(s.tz, -14);
    const target = dateInZone(s.tz, -7); // a past occurrence of a weekly series: virtual, no row yet
    const root = await apiCreateEvent(s.ownerSession, s.circleId, {
      event_type: 'appointment',
      title,
      scheduled_date: start,
      scheduled_time: '10:00',
      duration_minutes: 30,
      recurrence_rule: 'weekly',
    });
    const body = `Nota de prueba ${uniqueSuffix()}`;
    try {
      await cookieLogin(context, s.owner, baseURL);
      await page.goto(`/circles/${s.circleId}/calendar?date=${target}&eventId=${root.id}&panel=notes`, {
        waitUntil: 'domcontentloaded',
      });
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: new RegExp(escapeRegExp(title)) })).toBeVisible({
        timeout: 25_000,
      });
      const composer = dialog.locator('#event-note-composer');
      await expect(composer).toBeVisible({ timeout: 15_000 });
      await composer.fill(body);

      // Another member removes THIS occurrence while the sheet is open.
      if (!falsify('panel')) {
        await removeOccurrence(s, root.id, target);
        const tomb = tombstones(root.id, target);
        expect(tomb, 'the occurrence is tombstoned').toHaveLength(1);
        expect(tomb[0].removed_at).not.toBeNull();
      }

      const posts = countRequests(page, 'POST', '/api/circles/:id/events/:eventId/notes');
      await dialog.getByRole('button', { name: c.addNote, exact: true }).click();

      await expect(errorToast(page, c.panelToast)).toBeVisible({ timeout: 20_000 });
      // The generic "try again" copy is not what is said.
      await expect(page.getByText(/Couldn't save your note|No se pudo guardar tu nota/)).toHaveCount(0);
      await posts.expectCount(1);
      // The typed text is still there, and nothing was written.
      await expect(composer).toHaveValue(body);
      expect(
        dbQuery<{ id: string }>(
          `select id from event_notes where circle_id = ${sqlStr(s.circleId)}::uuid and body = ${sqlStr(body)}`
        )
      ).toHaveLength(0);
    } finally {
      await deleteSeries(s.ownerSession, s.circleId, root.id);
    }
  });

  test(`TodaysMeds (${lang.toUpperCase()}): confirming a dose another member removed says so and writes no confirmation`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    test.skip(
      (() => {
        const m = minutesIntoDay(RECIPIENT_TZ);
        return m < 5 || m > 24 * 60 - 5;
      })(),
      'within 5 minutes of midnight in the recipient zone'
    );
    const c = COPY[lang];
    const s = await circleWithCaregiver(request, `ort-meds-${lang}`, lang);
    const name = `ZZ_E2E_OCCREM_${uniqueSuffix()}`;
    const today = dateInZone(s.tz, 0);
    // Started yesterday so today's 00:01 dose is due (a start of TODAY with a past time would be
    // rolled to tomorrow by the late-add rule).
    const root = await createDailyMedication(s.ownerSession, s.circleId, name, dateInZone(s.tz, -1), { time: '00:01' });
    try {
      await cookieLogin(context, s.owner, baseURL);
      await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
      const list = page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
      const confirm = list.getByRole('button', { name: c.confirm(name) }).first();
      await expect(confirm).toBeVisible({ timeout: 30_000 });

      // Another member removes today's dose while the card is on screen.
      if (!falsify('meds')) {
        await removeOccurrence(s, root, today);
        const tomb = tombstones(root, today);
        expect(tomb, "today's dose is tombstoned").toHaveLength(1);
        expect(tomb[0].removed_at).not.toBeNull();
      }

      const posts = countRequests(page, 'POST', '/api/circles/:id/medications/confirm');
      await confirm.click();
      await expect(list.getByRole('button', { name: c.undo(name) })).toBeVisible();

      // The POST goes out when the 5 s undo window closes.
      await expect(errorToast(page, c.doseToast)).toBeVisible({ timeout: 40_000 });
      await expect(page.getByText(/Couldn't save\. Please try again|No se pudo guardar\. Inténtalo/)).toHaveCount(0);
      await posts.expectCount(1);
      expect(
        dbQuery<{ id: string }>(
          `select mc.id from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
            where ce.circle_id = ${sqlStr(s.circleId)}::uuid
              and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)
              and ce.scheduled_date = ${sqlStr(today)}::date`
        ),
        'no confirmation was written for the removed dose'
      ).toHaveLength(0);
    } finally {
      await deleteSeries(s.ownerSession, s.circleId, root);
    }
  });
}
