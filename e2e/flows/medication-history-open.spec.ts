import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { apiSession, sqlStr, type ApiSession } from '../unhappy';
import { checkA11y } from '../helpers';
import { cookieLogin, createCircle, createScopedAccount, uniq } from '../unhappy/auth-invites/_helpers';

// Meds > History: tapping a medication's dose opens THAT medication's history
// (owner report 2026-10-09; mobile twin .maestro/parity/medications/history-open-medication.yaml).
//   - scheduled dose -> the History list narrowed to it ("Showing: <med>"), with
//     "Back to all history" to clear it
//   - as-needed dose -> its per-medication dose log
// Real backend + real DB, a run-scoped owner and circle. Read-only after the seed.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const RECIPIENT_TZ = 'America/New_York';
const dayIn = (tz: string, at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

async function createMed(
  session: ApiSession,
  circleId: string,
  name: string,
  extra: Record<string, unknown>
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '10 mg',
    ...extra,
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return ((await res.json()) as { data: { event: { id: string } } }).data.event.id;
}

async function seed(request: APIRequestContext) {
  const owner = await createScopedAccount('hist-open');
  // Recipient zone = the owner's zone (see as-needed-medications.spec.ts).
  sqlExec(`update public.users set timezone = ${sqlStr(RECIPIENT_TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await apiSession(request, owner);
  const circleId = await createCircle(session, `hist ${uniq('o')}`);
  const tag = uniq('m').slice(-6);
  const sched = `Metformin ${tag}`;
  const other = `Lisinopril ${tag}`;
  const prn = `Ibuprofen ${tag}`;
  const now = new Date();
  const yesterday = dayIn(RECIPIENT_TZ, new Date(now.getTime() - 24 * 3_600_000));
  const start = dayIn(RECIPIENT_TZ, new Date(now.getTime() - 3 * 24 * 3_600_000));
  for (const name of [sched, other]) {
    const id = await createMed(session, circleId, name, {
      scheduled_date: start,
      scheduled_time: '08:00',
      recurrence_rule: 'daily',
    });
    const res = await session.post(`/api/circles/${circleId}/medications/confirm`, {
      event_id: `${id}_${yesterday}`,
      status: 'taken',
      scheduled_time: '08:00:00',
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  }
  const prnId = await createMed(session, circleId, prn, {
    scheduled_date: dayIn(RECIPIENT_TZ, now),
    as_needed: true,
  });
  const dose = await session.post(`/api/circles/${circleId}/medications/${prnId}/as-needed-doses`, {
    client_request_id: crypto.randomUUID(),
    given_at: new Date(now.getTime() - 30 * 60_000).toISOString(),
  });
  expect(dose.status(), await dose.text()).toBeLessThan(300);
  return { owner, circleId, sched, other, prn };
}

test('History: a scheduled dose narrows History to its medication; an as-needed dose opens its dose log', async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  const s = await seed(request);
  const ctx = await browser.newContext({
    baseURL: new URL(baseURL ?? 'http://localhost:5173').origin,
    timezoneId: process.env.PW_E2E_TZ || 'America/Denver',
  });
  await cookieLogin(ctx, s.owner, baseURL);
  try {
    const page = await ctx.newPage();
    await page.goto(`/circles/${s.circleId}/meds?tab=history`, { waitUntil: 'domcontentloaded' });
    const openSched = page.getByRole('button', { name: `View history for ${s.sched}` });
    const openOther = page.getByRole('button', { name: `View history for ${s.other}` });
    const openPrn = page.getByRole('button', { name: `View history for ${s.prn}` });
    await expect(openSched).toBeVisible({ timeout: 30_000 });
    await expect(openOther).toBeVisible();
    await expect(openPrn).toBeVisible();
    // The button does not swallow the card: its "Taken by" detail is still on the page.
    await expect(page.getByTestId('history-confirmation-row').filter({ hasText: s.sched })).toContainText(
      'Taken by'
    );
    await checkA11y(page, 'meds history (rows open their medication)', testInfo);

    // 1. Scheduled -> the list narrows to that medication.
    await openSched.click();
    const trigger = page.getByRole('button', { name: `Filter by: ${s.sched}` });
    await expect(trigger).toHaveText(`Showing: ${s.sched}`);
    await expect(page.getByTestId('history-confirmation-row')).toHaveCount(1);
    await expect(page.getByTestId('history-dose-row')).toHaveCount(0);
    await expect(openOther).toHaveCount(0);
    await expect(openSched).toHaveCount(0); // already showing only it
    const clear = page.getByRole('button', { name: 'Back to all history' });
    const box = await clear.boundingBox();
    expect(box && box.width >= 44 && box.height >= 44).toBe(true);
    await clear.click();
    await expect(page.getByRole('button', { name: 'Filter by: All medications' })).toBeVisible();
    await expect(openOther).toBeVisible();

    // 2. As needed -> its dose log.
    await openPrn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(s.prn);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(openPrn).toBeVisible();
  } finally {
    await ctx.close();
  }
});
