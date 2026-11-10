import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { refuseZoneSync } from '../helpers';
import { dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';

// THE "JUAN" SCENARIO IN A REAL BROWSER (docs/plans/circle-timezone.md).
//
// Juan (owner) lives in New York; his parents (no account) in Monterrey; the circle zone is
// America/Monterrey. Mexico has had no DST since Oct 2022, New York does: the gap is 1 h in US
// winter and 2 h from 2027-03-14 to 2027-11-07. The unit twin
// (src/utils/__tests__/circleTimezoneJuanScenario.test.ts) owns the arithmetic and the strings;
// this spec proves the same strings reach the event detail of a REAL calendar, rendered by the
// browser's own Intl under Playwright's `timezoneId`, against the real backend and database.
//
// Every test: a run-scoped account (purged by globalTeardown) with a fresh circle whose zone is
// written straight to `care_circles.timezone` (the Circle settings picker itself is covered by
// circle-timezone.spec.ts; case 3 here goes through it for the zone CHANGE). Doses open through
// the calendar's `?date=&eventId=` deep link, so each dated day is navigated to, not computed.
//
// Mobile: CircleTimezoneJuanScenario.test.tsx (unit twin); no Maestro twin of this spec.

const NY = 'America/New_York';
const MTY = 'America/Monterrey';

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);
// The account / circle zones differ from the browser's on purpose; keep the session-start
// profile-zone sync from rewriting them (helpers.ts refuseZoneSync).
test.beforeEach(async ({ page }) => {
  await refuseZoneSync(page);
});

interface Scene {
  circleId: string;
  session: Awaited<ReturnType<typeof ownerApi>>;
}

async function scene(
  context: BrowserContext,
  request: APIRequestContext,
  baseURL: string | undefined,
  { circleZone, ownerZone }: { circleZone: string; ownerZone: string }
): Promise<Scene> {
  const owner = await createScopedAccount('juandst');
  sqlExec(`update users set timezone = ${sqlStr(ownerZone)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq('juandst'));
  sqlExec(`update care_circles set timezone = ${sqlStr(circleZone)} where id = ${sqlStr(circleId)}::uuid;`);
  await cookieLogin(context, owner, baseURL);
  return { circleId, session };
}

/** A daily medication starting on `date` at the circle's wall `time` (HH:MM). Returns the root id. */
async function dailyMed(s: Scene, date: string, time: string): Promise<{ id: string; name: string }> {
  const name = `ZZ_E2E_JUAN_${uniq('m').replace(/-/g, '_')}`;
  const res = await s.session.post(`/api/circles/${s.circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '5 mg',
    scheduled_date: date,
    scheduled_time: time,
    recurrence_rule: 'daily',
    notifications_enabled: false,
  });
  expect(res.status(), `create med: ${await res.text()}`).toBe(201);
  const row = dbQuery<{ id: string; scheduled_time: string }>(
    `select id::text, scheduled_time::text from calendar_events
      where circle_id = ${sqlStr(s.circleId)}::uuid and medication_name = ${sqlStr(name)}
        and parent_event_id is null`
  );
  expect(row, 'one root row').toHaveLength(1);
  expect(row[0].scheduled_time.slice(0, 5), 'stored wall time').toBe(time);
  return { id: row[0].id, name };
}

/** Intl separates time and meridiem with U+202F on some ICU builds; compare on plain spaces. */
const norm = (s: string | null): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Open the dose on `date` through the calendar deep link; return the detail's time line. */
async function openDose(page: Page, circleId: string, eventId: string, date: string) {
  await page.goto(`/circles/${circleId}/calendar?date=${date}&eventId=${eventId}`, {
    waitUntil: 'domcontentloaded',
  });
  const time = page.getByTestId('event-detail-time');
  await expect(time, `detail for ${date}`).toBeVisible({ timeout: 25_000 });
  return time;
}

async function expectDoseTime(page: Page, circleId: string, eventId: string, date: string, want: string) {
  const time = await openDose(page, circleId, eventId, date);
  await expect.poll(async () => norm(await time.textContent()), { message: `time on ${date}` }).toBe(want);
}

// ---------------------------------------------------------------------------
// 1. Monterrey circle, New York browser: the 1 h / 2 h / 1 h gap across the US switches.
// ---------------------------------------------------------------------------
const JUAN_ROWS: Array<{ date: string; want: string; why: string }> = [
  { date: '2026-11-16', want: '8:00 PM (Monterrey) / 9:00 PM (New York)', why: 'US winter, 1 h' },
  { date: '2027-03-13', want: '8:00 PM (Monterrey) / 9:00 PM (New York)', why: 'day before spring-forward' },
  { date: '2027-03-14', want: '8:00 PM (Monterrey) / 10:00 PM (New York)', why: 'spring-forward day' },
  { date: '2027-07-15', want: '8:00 PM (Monterrey) / 10:00 PM (New York)', why: 'US summer, 2 h' },
  { date: '2027-11-06', want: '8:00 PM (Monterrey) / 10:00 PM (New York)', why: 'day before fall-back' },
  { date: '2027-11-07', want: '8:00 PM (Monterrey) / 9:00 PM (New York)', why: 'fall-back day' },
];

test.describe('Juan: Monterrey circle seen from a New York browser', () => {
  test.use({ timezoneId: NY });

  test('a daily 20:00 dose shows the dual clock with the seasonal gap', async ({ page, context, request, baseURL }) => {
    const s = await scene(context, request, baseURL, { circleZone: MTY, ownerZone: NY });
    const med = await dailyMed(s, '2026-11-16', '20:00');
    for (const r of JUAN_ROWS) {
      await test.step(`${r.date} (${r.why})`, async () => {
        await expectDoseTime(page, s.circleId, med.id, r.date, r.want);
      });
    }
  });

  test('zone change Monterrey -> New York via Circle settings keeps the 8:00 PM wall time, single clock', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const s = await scene(context, request, baseURL, { circleZone: MTY, ownerZone: NY });
    const med = await dailyMed(s, '2026-11-16', '20:00');
    // Precondition: dual before the change.
    await expectDoseTime(page, s.circleId, med.id, '2026-11-16', '8:00 PM (Monterrey) / 9:00 PM (New York)');

    await page.goto(`/circles/${s.circleId}/settings`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('circle-timezone-card');
    const field = card.getByRole('combobox', { name: 'Time zone' });
    await expect(field).toHaveValue('Monterrey (GMT-6)', { timeout: 20_000 });
    await field.click();
    await field.fill('new york');
    const list = page.getByRole('listbox', { name: 'Time zones' });
    await list.getByRole('option', { name: /^New York \(GMT-[45]\)/ }).first().click();
    await expect(page.getByText('Circle updated.')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          dbQuery<{ timezone: string | null }>(
            `select timezone from care_circles where id = ${sqlStr(s.circleId)}::uuid`
          )[0].timezone,
        { timeout: 15_000 }
      )
      .toBe(NY);

    // The stored wall time is untouched.
    const stored = dbQuery<{ scheduled_time: string }>(
      `select scheduled_time::text from calendar_events where id = ${sqlStr(med.id)}::uuid`
    )[0].scheduled_time;
    expect(stored.slice(0, 5)).toBe('20:00');

    await page.reload({ waitUntil: 'domcontentloaded' });
    // Winter and summer: one clock, no zone label, no " / ".
    for (const date of ['2026-11-16', '2027-07-15']) {
      await test.step(date, async () => {
        await expectDoseTime(page, s.circleId, med.id, date, '8:00 PM');
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. DST-hostile wall times: New York circle, Monterrey browser. The viewer half names the
//    instant the reminder fires (Postgres semantics: a MISSING time resolves with the pre-jump
//    offset, a REPEATED one to its SECOND occurrence).
// ---------------------------------------------------------------------------
test.describe('DST-hostile wall times: New York circle seen from a Monterrey browser', () => {
  test.use({ timezoneId: MTY });

  test('02:30 on spring-forward (missing) and 01:30 on fall-back (repeated)', async ({ page, context, request, baseURL }) => {
    const s = await scene(context, request, baseURL, { circleZone: NY, ownerZone: MTY });
    const hole = await dailyMed(s, '2027-03-14', '02:30');
    const repeat = await dailyMed(s, '2027-11-07', '01:30');

    await test.step('2027-03-14 02:30 NY = 07:30Z = 1:30 AM Monterrey (not 12:30 AM)', async () => {
      await expectDoseTime(page, s.circleId, hole.id, '2027-03-14', '2:30 AM (New York) / 1:30 AM (Monterrey)');
    });
    await test.step('2027-11-07 01:30 NY second occurrence = 06:30Z = 12:30 AM Monterrey', async () => {
      await expectDoseTime(page, s.circleId, repeat.id, '2027-11-07', '1:30 AM (New York) / 12:30 AM (Monterrey)');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Spanish (same technique as circle-timezone.spec.ts): case 1 on one date.
// ---------------------------------------------------------------------------
test.describe('Juan in Spanish', () => {
  test.use({ timezoneId: NY, locale: 'es' });

  test('US summer: the 2 h gap, Spanish place names', async ({ page, context, request, baseURL }) => {
    const s = await scene(context, request, baseURL, { circleZone: MTY, ownerZone: NY });
    const med = await dailyMed(s, '2026-11-16', '20:00');
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      try {
        const res = await route.fetch();
        const body = (await res.json()) as { data?: { user?: { language?: string } } };
        if (body?.data?.user) body.data.user.language = 'es';
        await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
      } catch {
        await route.continue().catch(() => undefined);
      }
    });
    const time = await openDose(page, s.circleId, med.id, '2027-07-15');
    // Browser locale `es` resolves hour12: false, so the viewer clock is 24 h (hourCycle.ts step 2,
    // hourCycle.test.ts "returns 24h when the locale resolves hour12: false").
    await expect
      .poll(async () => norm(await time.textContent()))
      .toBe('20:00 (Monterrey) / 22:00 (Nueva York)');
  });
});
