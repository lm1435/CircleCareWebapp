import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { dateInTz, uniqueSuffix } from '../notesFirstClassShared';

// THE ADD MENU AND THE TWO SIMPLE FORMS (docs/plans/simple-ui-1-3-1.md).
//
//   Add menu: Med, Appt, Task, Note, Shift for EVERYONE. At a large root font
//   (24px) it becomes a vertical list of full-word rows.
//   New medication: "What is it?" / "When?" (4 time chips + Other time + "+ Another
//   dose") / "How often?" (Every day, Some days, When needed) / "More details".
//   Save = "Add medication". No Medication/Appointment/Task type switch.
//   New appointment: "What is it?" then "When?" then "Who's going?", optional rows
//   after. Save = "Add appointment".
//
// A fresh owner + circle per test: the writes are asserted in the REAL database.

const TZ = 'America/Denver';
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: TZ });
test.setTimeout(90_000);
// Entrance animations scale the pop-up rows; measure them settled.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const EVENTS_POST = '/api/circles/:id/events';

async function arrange(request: import('@playwright/test').APIRequestContext, label: string) {
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  return { owner, session, circleId };
}

function newTrigger(page: Page) {
  return page.locator('aside').getByRole('button', { name: 'New', exact: true });
}

async function openAddMenu(page: Page) {
  const trigger = newTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'New' });
  await expect(menu).toBeVisible();
  return menu;
}

interface EventRow {
  id: string;
  title: string;
  event_type: string;
  scheduled_time: string | null;
  recurrence_rule: string | null;
  recurrence_days: number[] | null;
  as_needed: boolean | null;
  parent_event_id: string | null;
}

function medRoots(circleId: string, name: string): EventRow[] {
  return dbQuery<EventRow>(
    `select id::text, title, event_type, scheduled_time::text, recurrence_rule, recurrence_days,
            as_needed, parent_event_id::text
       from calendar_events
      where circle_id = ${sqlStr(circleId)}::uuid and event_type = 'medication'
        and medication_name = ${sqlStr(name)} and parent_event_id is null
      order by scheduled_time nulls first`
  );
}

test.describe('Add menu', () => {
  test('five options for everyone, in order, each opens the right form (no type switch)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'addmenu');
    await cookieLogin(context, a.owner, baseURL);
    await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });

    let menu = await openAddMenu(page);
    await expect(menu.getByRole('menuitem')).toHaveText(['Med', 'Appt', 'Task', 'Note', 'Shift']);

    await menu.getByRole('menuitem', { name: 'Med', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'New medication' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('simple-medication-form')).toBeVisible();
    // Opened for a type: the type switch is gone.
    await expect(dialog.locator('#event_type')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add medication' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    menu = await openAddMenu(page);
    await menu.getByRole('menuitem', { name: 'Appt', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'New appointment' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('simple-appointment-form')).toBeVisible();
    await expect(dialog.locator('#event_type')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add appointment' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    menu = await openAddMenu(page);
    await menu.getByRole('menuitem', { name: 'Task', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.locator('#title')).toBeVisible();
    await expect(dialog.locator('#event_type')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Shift: opens the shifts surface of the calendar.
    menu = await openAddMenu(page);
    await menu.getByRole('menuitem', { name: 'Shift', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'New shift' })).toBeVisible();
  });

  test('Escape closes the menu and hands focus back to the New button', async ({ page, context, request, baseURL }) => {
    const a = await arrange(request, 'addmenuesc');
    await cookieLogin(context, a.owner, baseURL);
    await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
    await openAddMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'New' })).toHaveCount(0);
    await expect(newTrigger(page)).toBeFocused();
  });

  test('large text (24px root font): the pop-up is a vertical list of full-word rows', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'addmenulg');
    await cookieLogin(context, a.owner, baseURL);
    await page.addInitScript(() => {
      const apply = () => {
        if (document.documentElement) document.documentElement.style.fontSize = '24px';
      };
      apply();
      document.addEventListener('DOMContentLoaded', apply);
    });
    await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
      .toBe('24px');
    const menu = await openAddMenu(page);
    await expect(menu).toHaveAttribute('aria-orientation', 'vertical');
    // Full words, not Med / Appt.
    await expect(menu.getByRole('menuitem')).toHaveText(['Medication', 'Appointment', 'Task', 'Note', 'Shift']);
    const boxes = await menu.getByRole('menuitem').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: r.y, w: r.width, h: r.height };
      })
    );
    // One column: identical left edge, strictly increasing top, every row >= 44px tall.
    expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44);
    // And the menu itself is within the viewport (no row pushed off screen).
    const viewport = page.viewportSize()!;
    for (const b of boxes) expect(b.y + b.h).toBeLessThanOrEqual(viewport.height);
  });
});

test.describe('New medication (simple form)', () => {
  async function openMedForm(page: Page, circleId: string) {
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
    const menu = await openAddMenu(page);
    // Short label normally, the full word at large text.
    await menu.getByRole('menuitem', { name: /^(Med|Medication)$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New medication' });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('section order: What is it? > When? > How often? > More details (collapsed)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'medorder');
    await cookieLogin(context, a.owner, baseURL);
    const dialog = await openMedForm(page, a.circleId);
    const headings = await dialog.locator('[id^="sf-"]').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    expect(headings).toEqual(['What is it?', 'When?', 'How often?']);
    // Four chips with their times, and the secondary controls.
    const chips = dialog.getByRole('radiogroup', { name: /time/i }).getByRole('radio');
    await expect(chips).toHaveCount(4);
    await expect(chips.nth(0)).toContainText('Morning');
    await expect(chips.nth(0)).toContainText('8:00 AM');
    await expect(chips.nth(1)).toContainText('12:00 PM');
    await expect(chips.nth(2)).toContainText('6:00 PM');
    await expect(chips.nth(3)).toContainText('Bedtime');
    await expect(chips.nth(3)).toContainText('9:00 PM');
    await expect(dialog.getByRole('button', { name: 'Other time' })).toBeVisible();
    // No "+ Another dose" until a time is chosen.
    await expect(dialog.getByTestId('add-another-dose')).toHaveCount(0);
    // Every day is the default How-often answer.
    await expect(dialog.getByRole('radio', { name: 'Every day' })).toBeChecked();
    // More details starts collapsed.
    await expect(dialog.getByRole('button', { name: /More details/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a chip is the saved time; Every day saves a daily series at that time', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'medchip');
    await cookieLogin(context, a.owner, baseURL);
    const name = `ZZ_E2E_SIMPLE_${uniqueSuffix()}`;
    const dialog = await openMedForm(page, a.circleId);
    await dialog.locator('#medication_name').fill(name);
    await dialog.locator('#medication_dosage').fill('5 mg');
    const evening = dialog.getByRole('radio', { name: /Evening/ });
    await evening.click();
    await expect(evening).toBeChecked();
    const posts = countRequests(page, 'POST', EVENTS_POST);
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await posts.expectCount(1);
    const rows = medRoots(a.circleId, name);
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduled_time?.slice(0, 5)).toBe('18:00');
    expect(rows[0].recurrence_rule).toBe('daily');
    expect(rows[0].as_needed).toBeFalsy();
    // The med appears on the Meds page under EVENING, at the chip time.
    await page.goto(`/circles/${a.circleId}/meds`, { waitUntil: 'domcontentloaded' });
    const evening2 = page.locator('section[aria-labelledby="meds-part-evening"]');
    await expect(evening2.getByTestId('med-time-row').filter({ hasText: name })).toContainText('6:00 PM', {
      timeout: 20_000,
    });
  });

  test('"+ Another dose" saves one sibling series per time (two POSTs, two times)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'meddose');
    await cookieLogin(context, a.owner, baseURL);
    const name = `ZZ_E2E_SIMPLE_${uniqueSuffix()}`;
    const dialog = await openMedForm(page, a.circleId);
    await dialog.locator('#medication_name').fill(name);
    await dialog.getByRole('radio', { name: /Morning/ }).click();
    await dialog.getByTestId('add-another-dose').click();
    const extra = dialog.getByTestId('extra-dose-1');
    await expect(extra).toBeVisible();
    // The new row starts on the first chip time not already used (Midday).
    await expect(extra.locator('#extra_dose_time_1')).toHaveValue('12:00');
    await extra.locator('#extra_dose_time_1').fill('21:00');

    const posts = countRequests(page, 'POST', EVENTS_POST);
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await posts.expectCount(2);
    const bodies = posts.requests.map((r) => JSON.parse(r.postData() ?? '{}') as Record<string, unknown>);
    expect(bodies.map((b) => String(b.scheduled_time).slice(0, 5)).sort()).toEqual(['08:00', '21:00']);
    for (const b of bodies) {
      expect(b.event_type).toBe('medication');
      expect(b.medication_name).toBe(name);
      expect(b.recurrence_rule).toBe('daily');
    }
    const rows = medRoots(a.circleId, name);
    expect(rows.map((r) => r.scheduled_time?.slice(0, 5))).toEqual(['08:00', '21:00']);
  });

  test('a dose row can be removed again before saving', async ({ page, context, request, baseURL }) => {
    const a = await arrange(request, 'medrm');
    await cookieLogin(context, a.owner, baseURL);
    const dialog = await openMedForm(page, a.circleId);
    await dialog.getByRole('radio', { name: /Morning/ }).click();
    await dialog.getByTestId('add-another-dose').click();
    await expect(dialog.getByTestId('extra-dose-1')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove dose 2' }).click();
    await expect(dialog.getByTestId('extra-dose-1')).toHaveCount(0);
  });

  test('How often maps to the existing schedule: Some days = weekly + days, When needed = as-needed with no time', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'medoften');
    await cookieLogin(context, a.owner, baseURL);

    // --- Some days ---
    const daysName = `ZZ_E2E_SIMPLE_${uniqueSuffix()}_d`;
    let dialog = await openMedForm(page, a.circleId);
    await dialog.locator('#medication_name').fill(daysName);
    await dialog.getByRole('radio', { name: /Midday/ }).click();
    await dialog.getByRole('radio', { name: 'Some days' }).click();
    // The weekday picker appears; pick Monday and Friday on top of the start day.
    const picker = dialog.getByRole('group', { name: 'Repeat on' });
    await expect(picker).toBeVisible();
    const monday = picker.getByRole('checkbox', { name: 'Monday' });
    if ((await monday.getAttribute('aria-checked')) !== 'true') await monday.click();
    await expect(monday).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const days = medRoots(a.circleId, daysName);
    expect(days).toHaveLength(1);
    expect(days[0].scheduled_time?.slice(0, 5)).toBe('12:00');
    expect(days[0].recurrence_rule).toBe('weekly'); // weekly + recurrence_days = "Some days"
    expect(days[0].recurrence_days?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(days[0].recurrence_days).toContain(1);

    // --- When needed ---
    const prnName = `ZZ_E2E_SIMPLE_${uniqueSuffix()}_p`;
    dialog = await openMedForm(page, a.circleId);
    await dialog.locator('#medication_name').fill(prnName);
    await dialog.getByRole('radio', { name: 'When needed' }).click();
    // No time is asked for an as-needed medication.
    await expect(dialog.getByRole('radiogroup', { name: /time/i })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const prn = medRoots(a.circleId, prnName);
    expect(prn).toHaveLength(1);
    expect(prn[0].as_needed).toBe(true);
    expect(prn[0].scheduled_time).toBeNull();
  });

  test('saving with no name or time points at the first missing field and writes nothing', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'medmiss');
    await cookieLogin(context, a.owner, baseURL);
    const dialog = await openMedForm(page, a.circleId);
    const posts = countRequests(page, 'POST', EVENTS_POST);
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#medication_name')).toBeFocused();
    await expect(dialog.locator('#medication_name')).toHaveAttribute('aria-invalid', 'true');
    expect(posts.count).toBe(0);
  });

  test('large text: the time chips go to ONE column', async ({ page, context, request, baseURL }) => {
    const a = await arrange(request, 'medlg');
    await cookieLogin(context, a.owner, baseURL);
    await page.addInitScript(() => {
      const apply = () => {
        if (document.documentElement) document.documentElement.style.fontSize = '24px';
      };
      apply();
      document.addEventListener('DOMContentLoaded', apply);
    });
    const dialog = await openMedForm(page, a.circleId);
    const group = dialog.getByRole('radiogroup', { name: /time/i });
    await expect(group).toHaveAttribute('data-columns', '1');
    const xs = await group.getByRole('radio').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(xs).size).toBe(1);
  });
});

test.describe('New appointment (simple form)', () => {
  test('order is What > When > Who; optional rows follow; Add appointment saves', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'apptform');
    await cookieLogin(context, a.owner, baseURL);
    await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
    const menu = await openAddMenu(page);
    await menu.getByRole('menuitem', { name: 'Appt', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New appointment' });
    await expect(dialog).toBeVisible();

    const headings = await dialog.locator('[id^="sf-"]').evaluateAll((els) => els.map((e) => e.textContent?.trim()));
    expect(headings).toEqual(['What is it?', 'When?', "Who's going?"]);
    // Optional rows after the three sections, in order.
    const rows = await dialog
      .locator('#row-doctor, #row-place, #row-notes, #row-repeat')
      .evaluateAll((els) => els.map((e) => e.id));
    expect(rows.length).toBeGreaterThan(0);
    // "Anyone" first in Who's going.
    await expect(dialog.getByRole('radio', { name: 'Anyone' })).toBeChecked();

    const title = `ZZ_E2E_APPT_${uniqueSuffix()}`;
    await dialog.locator('#title').fill(title);
    const tz = TZ;
    await dialog.locator('#scheduled_date').fill(dateInTz(tz, 3));
    await dialog.locator('#scheduled_time').fill('14:30');
    await dialog.locator('#endTime').fill('15:30');
    const posts = countRequests(page, 'POST', EVENTS_POST);
    await dialog.getByRole('button', { name: 'Add appointment' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await posts.expectCount(1);
    const saved = dbQuery<{ scheduled_time: string; event_type: string; assigned_to: string | null }>(
      `select scheduled_time::text, event_type, assigned_to::text from calendar_events
        where circle_id = ${sqlStr(a.circleId)}::uuid and title = ${sqlStr(title)}`
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].event_type).toBe('appointment');
    expect(saved[0].scheduled_time.slice(0, 5)).toBe('14:30');
    expect(saved[0].assigned_to).toBeNull();
  });
});
