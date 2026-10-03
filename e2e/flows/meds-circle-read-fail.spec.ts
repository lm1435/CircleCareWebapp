import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { failRequest } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { dateInZone } from '../unhappy/writes/_helpers';
import { circleTimezone, createDailyMedication, deleteSeries, uniqueSuffix } from '../notesFirstClassShared';

// Row "NEW-MEDS-CIRCLE-READ-FAIL": the Medications page when the CIRCLE read
// (GET /api/circles/:id, the source of the recipient's time zone) fails.
//
// MedicationsPage holds its skeleton while `timezone === null` ("a placeholder
// zone paints a wrong label"). When the circle read itself FAILED nothing is left
// to wait for, so the page must show the error card (title, hint, Retry) instead
// of an endless skeleton, and Retry must re-read the circle and bring the roster
// back. A 5xx is not "access lost" (that is 403/404 and has its own screen,
// flows/circle-access-lost-purge), so the card is the page's own.
//
// Driven with a stubbed 500 on GET /api/circles/:id (`failRequest`, twice per
// attempt: React Query retries a failed query once), against a real circle that
// really holds a medication. EN and ES.
//
//   - while the read fails: the error card is shown, no skeleton is left, the
//     medication is NOT shown, the page does not hang;
//   - Retry with the fault lifted: the card is gone and the roster lists the
//     medication.
// Run-scoped account and circle (purged at teardown); the medication is deleted.
//
// FALSIFY: PW_FALSIFY=meds-circle-read-fail never injects the fault, so the error
// card is never shown and the first expectation must go red.
// Proven against the app too (MedicationsPage.tsx edited in place, then restored
// byte-identical, 10-02): with the `timezone === null && circleReadFailed` branch
// disabled (the page then sits on its skeleton) both tests go red.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('meds-circle-read-fail');

const COPY = {
  en: {
    title: "Couldn't load medications",
    hint: 'Check your connection and try again.',
    retry: 'Retry',
    loading: 'Loading medications…',
  },
  es: {
    title: 'No se pudieron cargar los medicamentos',
    hint: 'Revisa tu conexión e intenta de nuevo.',
    retry: 'Reintentar',
    loading: 'Cargando medicamentos…',
  },
} as const;

for (const lang of ['en', 'es'] as const) {
  test(`Medications page (${lang.toUpperCase()}): a failed circle read shows the error card, not an endless skeleton, and Retry brings the roster back`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const c = COPY[lang];
    const owner = await createScopedAccount(`medsfail-${lang}`);
    sqlExec(
      `update public.users set language = ${sqlStr(lang)}, language_set_at = now() ` +
        `where id = ${sqlStr(owner.userId)}::uuid;`
    );
    const session = await ownerApi(request, owner);
    const circleId = await createCircle(session, uniq('medsfail'));
    const tz = await circleTimezone(session, circleId);
    const medName = `ZZ_E2E_MEDSFAIL_${uniqueSuffix()}`;
    const root = await createDailyMedication(session, circleId, medName, dateInZone(tz, -1));
    try {
      await cookieLogin(context, owner, baseURL);

      // Every read of THIS circle fails (first try + React Query's one retry + a focus refetch to spare).
      const fault = FALSIFY
        ? null
        : await failRequest(page, 'GET', '/api/circles/:id', { status: 500, times: 50 });
      await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });

      const main = page.locator('main');
      await expect(main.getByText(c.title, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(main.getByText(c.hint, { exact: true })).toBeVisible();
      const retry = main.getByRole('button', { name: c.retry, exact: true });
      await expect(retry).toBeVisible();
      // Not an endless skeleton: the roster's loading list (aria-busy) is gone.
      await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(main.getByText(c.loading, { exact: true })).toHaveCount(0);
      // And no medication is shown against a zone nobody knows.
      await expect(main.getByText(medName)).toHaveCount(0);
      expect(fault!.hits, 'the circle read was refused (first try + retry)').toBeGreaterThanOrEqual(2);

      // Lift the fault; Retry re-reads the circle and the roster appears.
      await fault!.dispose();
      await retry.click();
      await expect(main.getByText(medName).first()).toBeVisible({ timeout: 30_000 });
      await expect(main.getByText(c.title, { exact: true })).toHaveCount(0);
      await expect(main.getByRole('button', { name: c.retry, exact: true })).toHaveCount(0);
    } finally {
      await deleteSeries(session, circleId, root);
    }
  });
}
