import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import {
  circleTimezone,
  createAppointment,
  createDailyMedication,
  dateInTz,
  uniqueSuffix,
} from '../notesFirstClassShared';

// TODAY (docs/plans/simple-ui-1-3-1.md). The old Overview page is now "Today":
//   header "Today for {name}"  ->  ONE coaching element at most
//   (next-step card > shifts nudge > first-dose hint)  ->  Next up (first 3 rows,
//   one primary action each, then "All of today · N items")  ->  Quick access
//   (2x2 tiles with live status lines + quiet links Shifts / Vitals / Health info
//   / Activity).
//
// Every test builds its own account + circle (so the coaching state, the dose and
// the localStorage are ours alone) and talks to the REAL backend and DB.
//
// TIMEZONES: browser and care recipient both America/Denver. The dose is 00:01 in
// the recipient's zone, started yesterday, so today's dose is due (and late).
// A run within 5 minutes of the recipient's midnight is skipped.

const TZ = 'America/Denver';
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: TZ });
test.setTimeout(90_000);

const CONFIRM = /\/api\/circles\/[^/]+\/medications\/confirm$/;

function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  return h * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
}

interface Arranged {
  owner: Awaited<ReturnType<typeof createScopedAccount>>;
  session: Awaited<ReturnType<typeof ownerApi>>;
  circleId: string;
  recipient: string;
  today: string;
  medName: string | null;
}

/** A fresh owner + circle; optionally with one daily 00:01 medication that is due now. */
async function arrange(
  request: import('@playwright/test').APIRequestContext,
  label: string,
  opts: { med?: boolean } = {}
): Promise<Arranged> {
  const m = minutesIntoDay(TZ);
  test.skip(m < 5 || m > 24 * 60 - 5, 'within 5 minutes of midnight in the recipient zone');
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const base = uniq(label);
  const recipient = `E2E ${base}`;
  const circleId = await createCircle(session, base);
  const tz = await circleTimezone(session, circleId);
  expect(tz, 'recipient zone follows the owner profile zone').toBe(TZ);
  let medName: string | null = null;
  if (opts.med) {
    medName = `ZZ_E2E_TODAY_${uniqueSuffix()}`;
    await createDailyMedication(session, circleId, medName, dateInTz(tz, -1), { time: '00:01' });
  }
  return { owner, session, circleId, recipient, today: dateInTz(tz, 0), medName };
}

async function openToday(page: Page, a: Arranged): Promise<void> {
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: `Today for ${a.recipient}` })).toBeVisible({
    timeout: 30_000,
  });
}

const coachingCount = (page: Page) =>
  page
    .locator('[data-testid="next-step-card"], [data-testid="shifts-nudge-card"], [data-testid="dose-hint"]')
    .count();

test.describe('Today: header, nav and Next up', () => {
  test('the page is "Today for {name}", the nav says Today, and a due dose is a Taken row that writes ONE confirmation after the undo window', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'todaya', { med: true });
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);

    // Nav label + the date eyebrow in the recipient's zone.
    const nav = page.getByRole('navigation', { name: 'Main navigation' }).first();
    await expect(nav.getByRole('link', { name: 'Today' }).first()).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('overview-hero')).toContainText(
      new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })
    );

    // The old Overview blocks are gone.
    for (const gone of ['Get started', "Today's medications", 'Open tasks', 'Care team', 'Adherence']) {
      await expect(page.getByRole('heading', { name: gone })).toHaveCount(0);
    }

    // The series started yesterday, so yesterday's unanswered 00:01 dose is listed too (late);
    // today's is the last of the two.
    const rowsForMed = page.getByTestId('next-up-row').filter({ hasText: a.medName! });
    await expect(rowsForMed).toHaveCount(2, { timeout: 30_000 });
    const row = rowsForMed.last();
    // Late is said in TEXT, not colour alone.
    await expect(row).toContainText(/late/i);
    await expect(page.getByRole('region', { name: 'Next up' })).toBeVisible();

    const posts = countRequests(page, 'POST', '/api/circles/:id/medications/confirm');
    const answered = page.waitForResponse(
      (r) => r.request().method() === 'POST' && CONFIRM.test(new URL(r.url()).pathname),
      { timeout: 40_000 }
    );
    await row.getByRole('button', { name: `Taken, ${a.medName}` }).click();
    // Inside the 5 s window: Undo is offered and nothing was written.
    await expect(row.getByRole('button', { name: /^Undo/ })).toBeVisible();
    expect(posts.count).toBe(0);

    expect((await answered).status()).toBe(201);
    await posts.expectCount(1);
    const rows = dbQuery<{ status: string; confirmed_by: string }>(
      `select mc.status, mc.confirmed_by::text from medication_confirmations mc
         join calendar_events ce on ce.id = mc.event_id
        where ce.circle_id = ${sqlStr(a.circleId)}::uuid and ce.scheduled_date = ${sqlStr(a.today)}::date`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toMatch(/^taken/);
    expect(rows[0].confirmed_by).toBe(a.owner.userId);
    await expect(page.getByRole('status').filter({ hasText: /^\s*Marked as taken/ })).toBeVisible();
  });

  test('Undo inside the window cancels the write', async ({ page, context, request, baseURL }) => {
    const a = await arrange(request, 'todayu', { med: true });
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);
    const rowsForMed = page.getByTestId('next-up-row').filter({ hasText: a.medName! });
    await expect(rowsForMed).toHaveCount(2, { timeout: 30_000 }); // yesterday's unanswered dose + today's
    const row = rowsForMed.last();
    const posts = countRequests(page, 'POST', '/api/circles/:id/medications/confirm');

    await row.getByRole('button', { name: `Taken, ${a.medName}` }).click();
    await row.getByRole('button', { name: /^Undo/ }).click();
    await expect(row.getByRole('button', { name: `Taken, ${a.medName}` })).toBeVisible();
    await page.waitForTimeout(6_500);
    expect(posts.count).toBe(0);
    expect(
      dbQuery<{ n: string }>(
        `select count(*)::text as n from medication_confirmations where circle_id = ${sqlStr(a.circleId)}::uuid`
      )[0].n
    ).toBe('0');
  });

  test('meds, appointments and tasks merge in time order; only the first 3 show, then "All of today · N items" opens the calendar', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    // The appointments run 23:30-23:55 today: past due (so not listed) after ~23:30 recipient time.
    test.skip(minutesIntoDay(TZ) > 22 * 60, 'after 22:00 in the recipient zone the late appointments are past due');
    const a = await arrange(request, 'todayn', { med: true });
    const suffix = uniqueSuffix();
    const apptTitle = `ZZ_E2E_APPT_${suffix}`;
    const tz = await circleTimezone(a.session, a.circleId);
    await createAppointment(a.session, a.circleId, apptTitle, dateInTz(tz, 0), '23:30');
    for (const [i, time] of ['23:40', '23:50', '23:55'].entries()) {
      await createAppointment(a.session, a.circleId, `ZZ_E2E_LATE_${i}_${suffix}`, dateInTz(tz, 0), time);
    }
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);

    const rows = page.getByTestId('next-up-row');
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    // Date then time: yesterday's unanswered 00:01 dose, today's 00:01 dose, then the 23:30 appointment.
    await expect(rows.nth(0)).toContainText(a.medName!);
    await expect(rows.nth(0)).toContainText(/late/i);
    await expect(rows.nth(1)).toContainText(a.medName!);
    await expect(rows.nth(2)).toContainText(apptTitle);
    // All 6 items (2 doses + 4 appointments) are counted in the footer link.
    const all = page.getByRole('link', { name: /^All of today · 6 items/ });
    await expect(all).toBeVisible();
    await all.click();
    await expect(page).toHaveURL(new RegExp(`/circles/${a.circleId}/calendar`));
  });

  test('a circle with nothing today says so in one sentence (no empty card chrome)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'todaye');
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);
    await expect(page.getByText(`Nothing else scheduled for ${a.recipient} today.`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('next-up-row')).toHaveCount(0);
  });
});

test.describe('Today: Quick access', () => {
  test('four live tiles in order, the quiet links, and every one goes where it says', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'todayq');
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);

    const grid = page.getByTestId('quick-access-grid');
    await expect(grid).toBeVisible();
    await expect(grid).toHaveAttribute('data-columns', '2');
    const tiles = grid.getByRole('link');
    await expect(tiles).toHaveCount(4);
    const base = `/circles/${a.circleId}`;
    const expected: Array<[string, string, string]> = [
      ['Notes', 'How today went', `${base}/notes`],
      ['Tasks', 'Shared to-dos', `${base}/tasks`],
      ['Calendar', 'Nothing yet', `${base}/calendar`],
      ['Meds', 'Nothing yet', `${base}/meds`],
    ];
    for (const [i, [label, status, href]] of expected.entries()) {
      await expect(tiles.nth(i)).toContainText(label);
      await expect(tiles.nth(i)).toContainText(status);
      await expect(tiles.nth(i)).toHaveAttribute('href', href);
    }

    // Quiet links below the card.
    const quiet = page.locator('section[aria-labelledby="quick-access-heading"] > ul');
    await expect(quiet.getByRole('link')).toHaveText(['Shifts', 'Vitals', 'Health info', 'Activity']);
    await expect(quiet.getByRole('link', { name: 'Shifts' })).toHaveAttribute('href', `${base}/calendar?mode=shifts`);
    await expect(quiet.getByRole('link', { name: 'Vitals' })).toHaveAttribute('href', `${base}/vitals`);
    await expect(quiet.getByRole('link', { name: 'Health info' })).toHaveAttribute('href', `${base}/emergency`);
    await expect(quiet.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', `${base}/activity`);

    // Click-through on one tile and one link, then come back.
    await tiles.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`${base}/tasks`));
    await page.goBack();
    await expect(page.getByTestId('quick-access-grid')).toBeVisible();
    await page.locator('section[aria-labelledby="quick-access-heading"] > ul').getByRole('link', { name: 'Vitals' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/vitals`));
  });

  test('status lines are live: open tasks and the next appointment show up', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'todayl');
    const tz = await circleTimezone(a.session, a.circleId);
    const res = await a.session.post(`/api/circles/${a.circleId}/events`, {
      event_type: 'task',
      title: `ZZ_E2E_TASK_${uniqueSuffix()}`,
      scheduled_date: dateInTz(tz, 1),
    });
    expect(res.ok(), await res.text()).toBe(true);
    await createAppointment(a.session, a.circleId, `ZZ_E2E_A_${uniqueSuffix()}`, dateInTz(tz, 1), '09:00');
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);
    const grid = page.getByTestId('quick-access-grid');
    await expect(grid.getByRole('link', { name: /Tasks/ })).toContainText('1 open', { timeout: 20_000 });
    await expect(grid.getByRole('link', { name: /Calendar/ })).toContainText('Next: Tomorrow', { timeout: 20_000 });
  });
});

test.describe('Today: coaching (never more than one element)', () => {
  test('next-step card: first medication step, "Not now" hides the whole card for 3 days (no second card), and it survives a reload', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'todayc');
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);

    const card = page.getByTestId('next-step-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute('data-step', 'first_med');
    await expect(card).toContainText(/Next step · 1 of \d/);
    await expect(card.getByRole('heading', { name: `Add ${a.recipient}'s first medication` })).toBeVisible();
    expect(await coachingCount(page)).toBe(1);
    // The old checklist / "Watch how it works" card are gone.
    await expect(page.getByText('Watch how it works')).toHaveCount(0);

    await card.getByRole('button', { name: 'Not now' }).click();
    // Hidden for 3 days: the card is gone, NOT answered by the next step.
    await expect(card).toHaveCount(0);
    expect(await coachingCount(page)).toBe(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    // Today has rendered once Next up is on screen; the card must still be absent.
    await expect(page.getByTestId('next-up-row').or(page.getByText(/Next up/i).first())).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('next-step-card')).toHaveCount(0);
  });

  test('priority next-step > dose hint: the hint waits until the card is gone, then shows once ("Got it" is remembered)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'todayh', { med: true });
    await cookieLogin(context, a.owner, baseURL);
    await openToday(page, a);

    // A med exists, so the open step is "invite"; the dose hint must NOT stack under it.
    const card = page.getByTestId('next-step-card');
    await expect(card).toHaveAttribute('data-step', 'invite', { timeout: 30_000 });
    await expect(page.getByTestId('next-up-row').filter({ hasText: a.medName! })).toHaveCount(2);
    await expect(page.getByTestId('dose-hint')).toHaveCount(0);
    expect(await coachingCount(page)).toBe(1);

    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
    const hint = page.getByTestId('dose-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('How this works');
    await expect(hint).toContainText(`Tap Taken when ${a.recipient} takes it.`);
    expect(await coachingCount(page)).toBe(1);
    // It sits directly under the first dose row.
    await expect(page.getByTestId('next-up-row').filter({ hasText: a.medName! }).first().getByTestId('dose-hint')).toBeVisible();

    await hint.getByRole('button', { name: 'Got it' }).click();
    await expect(hint).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('next-up-row').filter({ hasText: a.medName! })).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId('dose-hint')).toHaveCount(0);
  });
});
