import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import {
  apiSession,
  circleTimezone,
  createAppointment,
  createDailyMedication,
  dateInTz,
  deleteEventById,
  deleteSeries,
  escapeRegExp,
  uniqueSuffix,
} from '../notesFirstClassShared';

// docs/plans/notes-first-class.md, Slice 2, task 26: `/circles/:id/calendar
// ?date=D&eventId=ROOT&panel=notes` opens EventDetailModal on that occurrence
// with the notes panel visible, then scrubs the params — for (a) a
// non-recurring root on its own date, (b) a recurring series' root id
// addressed on a CHILD/virtual day, and (c) an unknown/deleted event, which
// must toast instead of opening anything.

const PREFIX = 'ZZ_E2E_CALDEEPLINK_';

test.describe('Calendar note deep link (?date & eventId & panel=notes)', () => {
  test('(a) a non-recurring root on its own date opens with the notes panel visible', async ({
    page,
    request,
    circleId,
    account,
  }, testInfo) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const title = `${PREFIX}appt_${uniqueSuffix()}`;
    const eventId = await createAppointment(session, circleId, title, today);

    try {
      await page.goto(`/circles/${circleId}/calendar?date=${today}&eventId=${eventId}&panel=notes`, {
        waitUntil: 'domcontentloaded',
      });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expect(dialog.getByRole('heading', { name: new RegExp(escapeRegExp(title)) })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 10_000 });

      // New UI state: the deep-linked detail modal open with its notes panel visible.
      await checkA11y(page, `/circles/${circleId}/calendar`, testInfo);

      // Params scrubbed once resolved.
      await expect(page).not.toHaveURL(/eventId=/, { timeout: 15_000 });
      await expect(page).not.toHaveURL(/panel=/, { timeout: 15_000 });
    } finally {
      await deleteEventById(session, circleId, eventId);
    }
  });

  test('(b) a recurring series root id + a CHILD day opens that occurrence with notes visible', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const childDate = dateInTz(tz, 2);
    // Start YESTERDAY, never "today" — see medication-start-roll note in
    // medication-dose-remove.spec.ts.
    const start = dateInTz(tz, -1);
    const name = `${PREFIX}med_${uniqueSuffix()}`;
    const rootId = await createDailyMedication(session, circleId, name, start);

    try {
      await page.goto(`/circles/${circleId}/calendar?date=${childDate}&eventId=${rootId}&panel=notes`, {
        waitUntil: 'domcontentloaded',
      });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expect(dialog.getByRole('heading', { name: new RegExp(escapeRegExp(name)) })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 10_000 });

      await expect(page).not.toHaveURL(/eventId=/, { timeout: 15_000 });
    } finally {
      await deleteSeries(session, circleId, rootId);
    }
  });

  test('(c) an unknown event id toasts "no longer available" and opens no modal', async ({ page, request, circleId, account }, testInfo) => {
    const session = await apiSession(request, account);
    const today = dateInTz(await circleTimezone(session, circleId), 0);
    const bogusId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/circles/${circleId}/calendar?date=${today}&eventId=${bogusId}&panel=notes`, {
      waitUntil: 'domcontentloaded',
    });
    // A fresh circle's week may be empty (no grid): either outcome means settled.
    await expect(page.getByRole('grid').or(page.getByText('No events this week'))).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText('That note is no longer available.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // New UI state: the "note no longer available" toast over the calendar.
    await checkA11y(page, `/circles/${circleId}/calendar`, testInfo);
    await expect(page).not.toHaveURL(/eventId=/, { timeout: 15_000 });
  });
});
