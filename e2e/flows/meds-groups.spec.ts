import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { createDailyMedication, dateInTz, uniqueSuffix } from '../notesFirstClassShared';

// CARE > MEDS (docs/plans/simple-ui-1-3-1.md "Care > Meds"):
//   header "{name}'s meds"; ONE zone line "Times are {name}'s time . N hours
//   ahead of / behind you" ONLY when the device zone differs from the
//   recipient's; groups MORNING / MIDDAY / EVENING / BEDTIME / WHEN NEEDED (+
//   Anytime for an untimed scheduled med); ONE time per row, in the RECIPIENT's
//   time; and the 7-day summary "This week N% taken . Report" moved here from Home.

const BROWSER_TZ = 'America/Denver';
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: BROWSER_TZ });
test.setTimeout(90_000);

async function arrangeCircle(
  request: import('@playwright/test').APIRequestContext,
  label: string,
  recipientTz: string
) {
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(recipientTz)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const base = uniq(label);
  const recipient = `E2E ${base}`;
  const circleId = await createCircle(session, base);
  return { owner, session, circleId, recipient };
}

async function addPrn(session: Awaited<ReturnType<typeof ownerApi>>, circleId: string, name: string, date: string) {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '200 mg',
    scheduled_date: date,
    as_needed: true,
  });
  expect(res.ok(), await res.text()).toBe(true);
}

test('groups by the recipient clock, one time per row, the PRN section, the title, and the zone line when the zones differ', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // Recipient in New York, viewer in Denver: the recipient is 2 hours AHEAD of the viewer.
  const a = await arrangeCircle(request, 'medsgrp', 'America/New_York');
  const suffix = uniqueSuffix();
  const names = {
    morning: `ZZ_E2E_AM_${suffix}`,
    midday: `ZZ_E2E_NOON_${suffix}`,
    evening: `ZZ_E2E_PM_${suffix}`,
    bedtime: `ZZ_E2E_BED_${suffix}`,
    prn: `ZZ_E2E_PRN_${suffix}`,
  };
  const start = dateInTz('America/New_York', 0);
  await createDailyMedication(a.session, a.circleId, names.bedtime, start, { time: '22:15' });
  await createDailyMedication(a.session, a.circleId, names.morning, start, { time: '07:30' });
  await createDailyMedication(a.session, a.circleId, names.evening, start, { time: '18:30' });
  await createDailyMedication(a.session, a.circleId, names.midday, start, { time: '12:30' });
  await addPrn(a.session, a.circleId, names.prn, start);

  await cookieLogin(context, a.owner, baseURL);
  await page.goto(`/circles/${a.circleId}/meds`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: `${a.recipient}'s meds` })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(`Times are ${a.recipient}'s time · 2 hours ahead of you`)).toBeVisible();

  // Group headings in day order, upper-cased by CSS (the DOM text is the label).
  const headings = page.locator('h2[id^="meds-part-"]');
  await expect(headings).toHaveText(['Morning', 'Midday', 'Evening', 'Bedtime']);
  await expect(headings.first()).toHaveCSS('text-transform', 'uppercase');

  const rowIn = (part: string, name: string) =>
    page.locator(`section[aria-labelledby="meds-part-${part}"]`).getByTestId('med-time-row').filter({ hasText: name });
  // ONE time per row, in the recipient's own time (no "(Denver) / (New York)" pair).
  await expect(rowIn('morning', names.morning)).toContainText('7:30 AM');
  await expect(rowIn('midday', names.midday)).toContainText('12:30 PM');
  await expect(rowIn('evening', names.evening)).toContainText('6:30 PM');
  await expect(rowIn('bedtime', names.bedtime)).toContainText('10:15 PM');
  for (const [part, name] of [
    ['morning', names.morning],
    ['midday', names.midday],
    ['evening', names.evening],
    ['bedtime', names.bedtime],
  ] as const) {
    const text = (await rowIn(part, name).innerText()).replace(/\s+/g, ' ');
    expect(text, `${part} row shows one zone only`).not.toMatch(/\([A-Z][a-z]+( [A-Z][a-z]+)?\) \//);
    expect(text).not.toMatch(/Denver|New York/);
  }

  // When needed: its own section, no schedule.
  const prn = page.getByRole('region', { name: 'When needed' });
  await expect(prn.getByText(names.prn)).toBeVisible();
});

test('no zone line when the viewer and the recipient share a zone', async ({ page, context, request, baseURL }) => {
  const a = await arrangeCircle(request, 'medsnozone', BROWSER_TZ);
  await createDailyMedication(a.session, a.circleId, `ZZ_E2E_Z_${uniqueSuffix()}`, dateInTz(BROWSER_TZ, 0));
  await cookieLogin(context, a.owner, baseURL);
  await page.goto(`/circles/${a.circleId}/meds`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: `${a.recipient}'s meds` })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('med-time-row').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Times are .* time ·/)).toHaveCount(0);
});

test.describe('signed in as the worker premium owner', () => {
  // The file-level empty storageState is for the scoped-account tests above.
  test.use({ storageState: undefined });

test('the 7-day summary lives on Meds ("This week N% taken · Report") and Report opens History; Today no longer shows adherence', async ({
    page,
    circleId,
  }) => {
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const summary = page.getByTestId('week-adherence');
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary).toContainText(/This week \d{1,3}% taken/);
    await summary.getByRole('button', { name: /Report/ }).click();
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  
    // Today has no adherence card any more.
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Today');
    await expect(page.getByTestId('week-adherence')).toHaveCount(0);
    await expect(page.getByText(/This week \d+% taken/)).toHaveCount(0);
  });
});
