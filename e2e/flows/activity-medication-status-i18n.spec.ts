import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { createDailyMedication, dateInTz, circleTimezone, escapeRegExp, gotoActivitySettled } from '../notesFirstClassShared';

// Spanish feed sentences (10-02, activityTranslation.ts `translateSentenceRow`):
// "Discontinued medication: <title>" / "Reactivated medication: <title>" are
// written by the backend with NO description_key (calendarEvents.ts
// medication-status), so a Spanish reader used to get them in English. They now
// read "Medicamento suspendido: <title>" / "Medicamento reactivado: <title>"; an
// English reader sees the stored sentence byte for byte.
//
// Seeding through the public API (a medication, then a discontinue and a
// reactivate through PATCH …/medication-status, as the Meds page does); the
// owner reads the Activity page through the UI, in Spanish and English.
//
// FALSIFY: PW_FALSIFY=activity-medication-status skips the status changes, so
// no such rows exist and the sentence assertions must go red. The app-level
// proof (the sentence rules emptied in a scratch copy) is logged in
// docs/plans/web-e2e-coverage-2026-10-02.md.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('activity-medication-status');

test('discontinued / reactivated medication rows read in Spanish, and stay byte-identical in English', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('medstat');
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq('medstat'));
  const tz = await circleTimezone(api, circleId);
  const name = `ZZ_E2E_MEDSTAT_${uniq('m').replace(/[^a-z0-9]/gi, '')}`;
  const root = await createDailyMedication(api, circleId, name, dateInTz(tz, -3), { time: '08:00' });

  if (!FALSIFY) {
    for (const discontinued of [true, false]) {
      const res = await api.patch(`/api/circles/${circleId}/events/${root}/medication-status`, {
        discontinued,
        scope: 'medication',
      });
      expect(res.status(), await res.text()).toBe(200);
    }
  }

  // The writer's contract is untouched: English prose, no key.
  const stored = dbQuery<{ description: string; description_key: string | null }>(
    `select description, description_key from activity_feed
      where circle_id = ${sqlStr(circleId)}::uuid and action_type = 'medication_updated'
      order by created_at`
  );
  expect(stored).toEqual([
    { description: `Discontinued medication: ${name}`, description_key: null },
    { description: `Reactivated medication: ${name}`, description_key: null },
  ]);

  const setLanguage = (lang: 'en' | 'es') =>
    sqlExec(
      `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
    );

  // --- SPANISH ---
  setLanguage('es');
  await cookieLogin(context, owner, baseURL);
  await gotoActivitySettled(page, circleId);
  await expect(page.getByRole('heading', { name: 'Actividad', exact: true }).first()).toBeVisible({ timeout: 25_000 });
  // `.first()`: the newest row is mirrored into the "Latest" hero as well.
  await expect(page.getByText(`Medicamento suspendido: ${name}`, { exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(`Medicamento reactivado: ${name}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`(Discontinued|Reactivated) medication: ${escapeRegExp(name)}`))).toHaveCount(0);

  // --- ENGLISH: byte-identical to what is stored ---
  setLanguage('en');
  await gotoActivitySettled(page, circleId);
  await expect(page.getByRole('heading', { name: 'Activity', exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(`Discontinued medication: ${name}`, { exact: true }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(`Reactivated medication: ${name}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Medicamento (suspendido|reactivado)/)).toHaveCount(0);
});
