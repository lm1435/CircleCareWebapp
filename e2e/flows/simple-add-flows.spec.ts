import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { dateInTz, uniqueSuffix } from '../notesFirstClassShared';
import { checkA11y, fillSimpleDate, fillSimpleTime, unfoldSimpleEnd } from '../helpers';

// THE ADD MENU AND THE TWO SIMPLE FORMS (docs/plans/simple-ui-1-3-1.md).
//
//   Add menu: Med, Appt, Task, Note, Shift for EVERYONE. At a large root font
//   (24px) it becomes a vertical list of full-word rows.
//   Build 11 (owner 2026-11-10): one order on every simple form, new and edit.
//   New medication: "What is it?" (name, dose) / "When?" (Starts | Repeats until tiles, then How often?:
//   Every day, Every week, When needed, Custom…) / "What time?" (time-first chips, multi-select, + "Other…") /
//   Reminders / "More details". Save = "Add medication". No Medication/Appointment/Task type switch.
//   New appointment: "What is it?" / "When?" (Starts | Repeats until, How often?) / "What time?" (Pick a time |
//   Any time, then From | To) / "Who's going?" / Reminders / "More details". Save = "Add appointment".
//
// A fresh owner + circle per test: the writes are asserted in the REAL database.

const TZ = 'America/Denver';
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: TZ });
test.setTimeout(90_000);
// Entrance animations scale the pop-up rows; measure them settled.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const EVENTS_POST = '/api/circles/:id/events';
/** The simple form's section headings, without the required marker ("When? *"). */
const sectionHeadings = (dialog: import('@playwright/test').Locator) =>
  dialog.locator('h3[id^="sf-"]').evaluateAll((els) => els.map((e) => e.textContent?.replace(/\s*\*$/, '').trim()));

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
    // The simple task form too (owner 1.4.0): "New task", "What needs doing?", "Add task".
    dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog.getByTestId('simple-task-form')).toBeVisible();
    await expect(dialog.locator('#title')).toBeVisible();
    await expect(dialog.locator('#event_type')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add task' })).toBeVisible();
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

  test('section order: What is it? > When? (Starts | Repeats until, How often?) > What time? > More details (collapsed)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'medorder');
    await cookieLogin(context, a.owner, baseURL);
    const dialog = await openMedForm(page, a.circleId);
    expect(await sectionHeadings(dialog)).toEqual(['What is it?', 'When?', 'What time?']);
    // Four time-first chips (multi-select on a new medication), and "Other…".
    const chips = dialog.getByRole('group', { name: 'Common dose times' }).getByRole('checkbox');
    await expect(chips).toHaveCount(4);
    await expect(chips.nth(0)).toHaveText(/^8:00 AM\s*Morning$/);
    await expect(chips.nth(1)).toHaveText(/^12:00 PM\s*Midday$/);
    await expect(chips.nth(2)).toHaveText(/^6:00 PM\s*Evening$/);
    await expect(chips.nth(3)).toHaveText(/^9:00 PM\s*Bedtime$/);
    await expect(dialog.getByTestId('time-chip-other')).toHaveText(/^Other…/);
    // No "+ Another dose" tile: a further chip is a further time.
    await expect(dialog.getByTestId('add-another-dose')).toHaveCount(0);
    // When? opens on Starts | Repeats until; Every day is the default How-often answer, Custom… holds the rest.
    await expect(dialog.getByTestId('starts-tile')).toBeVisible();
    await expect(dialog.getByTestId('repeats-until-tile')).toHaveText(/Repeats until\s*Never/);
    await expect(dialog.getByRole('radio', { name: 'Every day' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: 'Every week' })).toBeVisible();
    await expect(dialog.getByTestId('repeat-custom')).toHaveAttribute('aria-expanded', 'false');
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
    const evening = dialog.getByRole('checkbox', { name: /Evening$/ });
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

  test('two chips save one sibling series per time (two POSTs, two times)', async ({
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
    // Multi-select (build 11): Morning is the medication's time, Bedtime a second one (what "+ Another dose" was).
    await dialog.getByRole('checkbox', { name: /Morning$/ }).click();
    await dialog.getByRole('checkbox', { name: /Bedtime$/ }).click();
    await expect(dialog.getByRole('checkbox', { name: /Morning$/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Bedtime$/ })).toBeChecked();

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

  test('Fix13: a custom dose changes in place; Repeats until clears in its tile (×); the save matches', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const a = await arrange(request, 'medfix13');
    await cookieLogin(context, a.owner, baseURL);
    const name = `ZZ_E2E_SIMPLE_${uniqueSuffix()}`;
    const dialog = await openMedForm(page, a.circleId);
    await dialog.locator('#medication_name').fill(name);
    await dialog.getByRole('checkbox', { name: /Morning$/ }).click();
    // "Other…" adds a second, custom time.
    await dialog.locator('#scheduled_time').fill('14:30');
    const custom = dialog.getByTestId('time-chip-custom');
    await expect(custom).toHaveText(/^2:30 PM\s*Other$/);
    // Its body is that dose's picker: change it in place (no remove + re-add).
    await dialog.getByLabel('Change 2:30 PM dose time').fill('15:00');
    await expect(custom).toHaveText(/^3:00 PM\s*Other$/);
    await expect(dialog.getByRole('button', { name: 'Remove 3:00 PM dose' })).toBeVisible();
    // Repeats until: "Mar 1 ×"-style, × back to Never.
    await dialog.locator('#recurrence_end_date').fill(dateInTz(TZ, 40));
    const clear = dialog.getByRole('button', { name: 'Clear repeat end' });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(dialog.getByTestId('repeats-until-tile')).toContainText('Never');
    await expect(clear).toHaveCount(0);
    const posts = countRequests(page, 'POST', EVENTS_POST);
    await dialog.getByRole('button', { name: 'Add medication' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await posts.expectCount(2);
    const rows = medRoots(a.circleId, name);
    expect(rows.map((r) => r.scheduled_time?.slice(0, 5))).toEqual(['08:00', '15:00']);
    const ends = dbQuery<{ e: string | null }>(
      `select recurrence_end_date::text as e from calendar_events
        where circle_id = ${sqlStr(a.circleId)}::uuid and title = ${sqlStr(name)} and parent_event_id is null`
    );
    expect(ends.map((r) => r.e)).toEqual([null, null]);
  });

  test('a second time can be un-chosen again before saving', async ({ page, context, request, baseURL }) => {
    const a = await arrange(request, 'medrm');
    await cookieLogin(context, a.owner, baseURL);
    const dialog = await openMedForm(page, a.circleId);
    await dialog.getByRole('checkbox', { name: /Morning$/ }).click();
    await dialog.getByRole('checkbox', { name: /Evening$/ }).click();
    await expect(dialog.getByTestId('extra-dose-1')).toHaveCount(1);
    await dialog.getByRole('checkbox', { name: /Evening$/ }).click();
    await expect(dialog.getByRole('checkbox', { name: /Evening$/ })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Morning$/ })).toBeChecked();
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
    await dialog.getByRole('checkbox', { name: /Midday$/ }).click();
    await dialog.getByTestId('repeat-custom').click();
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
    // No time (and no Starts / Repeats until) is asked for an as-needed medication.
    await expect(dialog.getByRole('group', { name: 'Common dose times' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'What time?' })).toHaveCount(0);
    await expect(dialog.getByTestId('when-date-tiles')).toHaveCount(0);
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

  test('large text: the time chips stay a content-sized wrapping row (never one full-width column)', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
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
    // Phone width once the form is open (the sidebar's New button is the desktop entry).
    await page.setViewportSize({ width: 375, height: 900 });
    // The row is "Other…"'s parent (located by structure, not by a test id, so the check also reads
    // an older layout).
    const row = dialog.getByTestId('time-chip-other').locator('xpath=..');
    await expect(row).toBeVisible();
    const rowBox = (await row.boundingBox())!;
    const tiles = await row
      .locator('button:visible')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    expect(tiles).toHaveLength(5);
    for (const t of tiles) {
      // Content-sized: no tile is stretched across the row; none spills past it.
      expect(t.width).toBeLessThan(rowBox.width - 1);
      expect(t.x + t.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    }
    // Wraps (more than one tile on some line), not one per row.
    const tops = tiles.map((t) => Math.round(t.y));
    expect(new Set(tops).size).toBeLessThan(tiles.length);
  });

  // Owner 1.4.0 (mobile parity), build 11: the four time chips and "Other…" are ONE content-sized wrapping row --
  // the same tile for every answer (and for "How often?"), never an equal-column grid and never a full-width
  // list -- and choosing a chip never moves a tile; a custom time joins as its own chip in the same style.
  // Measured in a real browser: jsdom has no layout.
  test('time chips + Other…: one wrapping row of content-sized tiles that selection never rearranges (375px + desktop)', async ({
    page,
    context,
    request,
    baseURL,
  }, testInfo) => {
    const a = await arrange(request, 'medgrid');
    await cookieLogin(context, a.owner, baseURL);
    await page.setViewportSize({ width: 1280, height: 900 });
    const dialog = await openMedForm(page, a.circleId);
    const other = dialog.getByTestId('time-chip-other');
    const row = other.locator('xpath=..');
    await expect(other).toBeVisible();

    const style = (loc: import('@playwright/test').Locator) =>
      loc.evaluate((e) => {
        const cs = getComputedStyle(e);
        return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, padLeft: cs.paddingLeft, minH: cs.minHeight };
      });
    /** Every tile's line (top), height and whether it is inside the row; plus the shared tile style. */
    async function layout() {
      const rowBox = (await row.boundingBox())!;
      // A custom chip counts once (its box), not as its picker body and its "×" (Fix13).
      const tiles = await row
        .locator(
          'button:visible:not([data-testid="time-chip-custom"]):not([data-testid="time-chip-custom-remove"]), [data-testid="time-chip-custom-box"]'
        )
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
      return {
        rowBox,
        tiles,
        lines: tiles.map((t) => Math.round(t.y - rowBox.y)),
        heights: tiles.map((t) => Math.round(t.height)),
        otherStyle: await style(other),
        chipStyle: await style(dialog.getByRole('checkbox', { name: /Morning$/ })),
        howOftenStyle: await style(dialog.getByRole('radio', { name: 'Every day' })),
      };
    }
    const near = (x: number, y: number) => Math.abs(x - y) <= 1;

    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const before = await layout();
      // Content-sized: the tiles are not all one width (Morning vs Midday differ), and none spills past the row.
      expect(new Set(before.tiles.map((t) => Math.round(t.width))).size).toBeGreaterThan(1);
      for (const t of before.tiles) expect(t.x + t.width).toBeLessThanOrEqual(before.rowBox.x + before.rowBox.width + 1);
      // One height for every tile: a one-line "Other…" lines up with the two-line chips.
      for (const h of before.heights) expect(near(h, before.heights[0])).toBe(true);
      // The same tile everywhere: Other…, the chips and "How often?".
      expect(before.otherStyle).toEqual(before.chipStyle);
      expect(before.howOftenStyle).toEqual(before.chipStyle);
      await checkA11y(page, `med-form-time-row-${width}`, testInfo, { include: '[data-testid="time-chip-row"]', wcag22: true });
    }

    // Selection never rearranges the row: a chip gives the same lines at phone width as nothing chosen. A custom
    // time ("Other…", the time picker) joins as its own chip ("10:45 AM / Other") after the four, in the same tile:
    // the four keep their lines and every tile keeps one height.
    await page.setViewportSize({ width: 375, height: 900 });
    const base = await layout();
    await dialog.getByRole('checkbox', { name: /Evening$/ }).click();
    await expect(dialog.getByRole('checkbox', { name: /Evening$/ })).toBeChecked();
    expect((await layout()).lines).toEqual(base.lines);
    await expect(row.getByTestId('add-another-dose')).toHaveCount(0);
    await other.click();
    await expect(other).toHaveAttribute('aria-expanded', 'true');
    await dialog.locator('#scheduled_time').fill('10:45');
    // Tapping "Other…" again closes its picker.
    await other.click();
    await expect(other).toHaveAttribute('aria-expanded', 'false');
    const customChip = dialog.getByTestId('time-chip-custom');
    await expect(customChip).toHaveText(/^10:45 AM\s*Other$/);
    // Fix13: the custom chip's body changes that dose, its own "×" (44px) removes it.
    const remove = dialog.getByRole('button', { name: 'Remove 10:45 AM dose' });
    const removeBox = (await remove.boundingBox())!;
    expect(removeBox.width).toBeGreaterThanOrEqual(44);
    expect(removeBox.height).toBeGreaterThanOrEqual(44);
    const custom = await layout();
    expect(custom.lines.slice(0, 4)).toEqual(base.lines.slice(0, 4));
    expect(custom.tiles).toHaveLength(base.tiles.length + 1);
    for (const h of custom.heights) expect(near(h, custom.heights[0])).toBe(true);
    // Same tile: the box has the chips' radius and border; its body the chips' padding and height.
    const boxStyle = await style(dialog.getByTestId('time-chip-custom-box'));
    const bodyStyle = await style(customChip);
    expect({ radius: boxStyle.radius, border: boxStyle.border, padLeft: bodyStyle.padLeft, minH: bodyStyle.minH }).toEqual(
      base.chipStyle
    );
    await expect(other).not.toContainText('·');
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

    expect(await sectionHeadings(dialog)).toEqual(['What is it?', 'When?', 'What time?', "Who's going?"]);
    // One More details (no Doctor / Place / Notes / Repeat rows).
    await expect(dialog.locator('#row-doctor, #row-place, #row-notes, #row-repeat')).toHaveCount(0);
    await expect(dialog.locator('#more-details')).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByRole('radio', { name: 'Once' })).toBeChecked();
    // "Anyone" first in Who's going.
    await expect(dialog.getByRole('radio', { name: 'Anyone' })).toBeChecked();

    const title = `ZZ_E2E_APPT_${uniqueSuffix()}`;
    await dialog.locator('#title').fill(title);
    const tz = TZ;
    await fillSimpleDate(dialog, 'scheduled_date', dateInTz(tz, 3));
    // What time? (build 11): Pick a time, then From | To (the circle's clock; the browser is in the circle's zone).
    await fillSimpleTime(dialog, '14:30');
    await expect(dialog.getByTestId('appt-to-tile')).toContainText('3:00 PM');
    await expect(dialog.locator('#more-details')).toHaveAttribute('aria-expanded', 'false');
    await (await unfoldSimpleEnd(dialog)).fill('15:30');
    await expect(dialog.getByTestId('appt-to-tile')).toContainText('3:30 PM');
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
