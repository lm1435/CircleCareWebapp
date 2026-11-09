import { test, expect } from '../fixtures';
import { apiSession, dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, uniq } from '../unhappy/auth-invites/_helpers';

// A STORED RULE THE REPEAT CONTROL HAS NO OPTION FOR (sweep 2026-11-08). A phone-calendar import on mobile writes
// `custom:N` (a fortnightly event arrives as `custom:14`). The web edit form parsed it to "none" and LIT
// "Once" on a series that repeats every 14 days. It now lights nothing and names the rule under the grid
// (mobile's AddEventScreen `how-often-summary`), and an untouched save still leaves the stored rule alone —
// read back from the real DB.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

test('an imported custom:14 medication: the edit form names "Every 14 days", lights no tile, and a save keeps the rule', async ({
  browser,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('custom14');
  const api = await apiSession(request, owner);
  const circleId = await createCircle(api, uniq('custom14'));
  const name = `Alendronate ${uniq('x').slice(-6)}`;
  const res = await api.post(`/api/circles/${circleId}/events`, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '70 mg',
    scheduled_date: new Date().toISOString().slice(0, 10),
    scheduled_time: '08:00',
    recurrence_rule: 'custom:14',
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const eventId = ((await res.json()) as { data: { event: { id: string } } }).data.event.id;

  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ctx = await browser.newContext({ baseURL: origin, timezoneId: process.env.PW_E2E_TZ || 'America/Denver' });
  try {
    await cookieLogin(ctx, owner, baseURL);
    const page = await ctx.newPage();
    await page.goto(`/circles/${circleId}/meds`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /'s meds$/ })).toBeVisible({ timeout: 30_000 });
    const card = page.getByRole('listitem').filter({ hasText: name });
    await card.getByRole('button', { name: `More actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit medication' });

    await expect(edit.getByTestId('how-often-summary')).toHaveText('Every 14 days');
    const howOften = edit.getByRole('radiogroup', { name: 'How often?' });
    for (const radio of await howOften.getByRole('radio').all()) {
      await expect(radio).not.toBeChecked();
    }

    await edit.getByLabel(/Dosage/i).fill('70 mg weekly-ish');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toBeHidden({ timeout: 20_000 });
    // The card names the kept rule, and so does the real row.
    await expect(card).toContainText('70 mg weekly-ish');
    await expect(card).toContainText('Every 14 days');
    await expect
      .poll(() =>
        dbQuery<{ recurrence_rule: string | null; medication_dosage: string }>(
          `select recurrence_rule, medication_dosage from calendar_events where id = ${sqlStr(eventId)}`
        )
      )
      .toEqual([{ recurrence_rule: 'custom:14', medication_dosage: '70 mg weekly-ish' }]);
  } finally {
    await ctx.close();
  }
});
