import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { sqlExec } from '../../db';
import {
  apiSession,
  countRequests,
  dbCount,
  dbQuery,
  failRequest,
  sqlStr,
  type ApiSession,
  type FaultOptions,
} from '../../unhappy';
import {
  apiCreateEvent,
  dateInZone,
  errorToast,
  localDate,
  openCalendarEvent,
  purgeEventsTitled,
  recipientTimezone,
  successToast,
} from './_helpers';

// FAILURE THEN RETRY — the guard must RELEASE on failure.
//
// Every save is guarded (claim on submit, release on settle). A guard that is
// never released after an error leaves a form that looks usable and silently
// ignores every later click — the user's input is still there, the button is
// enabled, and nothing is ever sent. For each surface, and for both a 500 and a
// network abort on the FIRST attempt:
//   - the error is surfaced with the surface's own copy (exactly one toast),
//   - the user's input is still in the form and the button is enabled again,
//   - nothing reached the database,
//   - a second click goes through: exactly TWO requests in total, ONE row.

test.use({ persona: 'premiumOwner' });
// Two full saves per test (plus a calendar open for event notes).
test.setTimeout(60_000);

interface Ctx {
  page: Page;
  circleId: string;
  api: ApiSession;
  label: string;
  state: Record<string, string>;
}

interface Surface {
  name: string;
  method: 'POST' | 'PUT' | 'PATCH';
  path: string;
  /** The exact error copy this surface shows for a non-access failure. */
  toast: string;
  /**
   * The failure is shown INLINE in the surface's own form (`role="alert"`), not
   * as a toast — so there is no toast to measure or to click past; the retry
   * must clear the inline error instead. (The Notes composer: at 360x640 no
   * toast band cleared it — toast-page-overlap.spec.ts.)
   */
  inline?: boolean;
  /** Open + fill the form; return the save control. */
  prepare(ctx: Ctx): Promise<Locator>;
  /** The user's input is still in place after the failure. */
  inputKept(ctx: Ctx): Promise<void>;
  /** The UI's success signal after the retry. */
  succeeded(ctx: Ctx): Promise<void>;
  /** SELECT for the row the save writes — 0 after the failure, 1 after the retry. */
  rows(ctx: Ctx): string;
  cleanup(ctx: Ctx): void;
}

const c = (ctx: Ctx) => `${sqlStr(ctx.circleId)}::uuid`;

const SURFACES: Surface[] = [
  {
    name: 'create appointment (AddEventModal)',
    method: 'POST',
    path: '/api/circles/:id/events',
    toast: "Couldn't save your changes. Please try again.",
    async prepare({ page, circleId, label }) {
      await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Add event' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await expect(dialog).toBeVisible();
      await dialog.locator('#event_type').selectOption('appointment');
      await dialog.locator('#title').fill(label);
      await dialog.locator('#scheduled_date').fill(localDate(3));
      return dialog.getByRole('button', { name: 'Create', exact: true });
    },
    async inputKept({ page, label }) {
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#title')).toHaveValue(label);
    },
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'New event' })).toBeHidden({ timeout: 20_000 });
    },
    rows: (ctx) => `select 1 from calendar_events where circle_id = ${c(ctx)} and title = ${sqlStr(ctx.label)}`,
    cleanup: (ctx) => purgeEventsTitled(ctx.circleId, ctx.label),
  },
  {
    name: 'care note post (NotesPage)',
    method: 'POST',
    path: '/api/circles/:id/care-notes',
    toast: "Couldn't post your note. Your note is still here — try again.",
    inline: true,
    async prepare({ page, circleId, label }) {
      await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByLabel(/^Add a note/).fill(label);
      return page.getByRole('button', { name: 'Post', exact: true });
    },
    async inputKept({ page, label }) {
      await expect(page.getByLabel(/^Add a note/)).toHaveValue(label);
    },
    async succeeded({ page, label }) {
      await expect(page.getByLabel(/^Add a note/)).toHaveValue('', { timeout: 20_000 });
      await expect(page.locator('li').filter({ hasText: label }).first()).toBeVisible({ timeout: 20_000 });
    },
    rows: (ctx) => `select 1 from care_notes where circle_id = ${c(ctx)} and body = ${sqlStr(ctx.label)}`,
    cleanup: (ctx) => sqlExec(`delete from care_notes where circle_id = ${c(ctx)} and body = ${sqlStr(ctx.label)};`),
  },
  {
    name: 'event note create (EventNotesPanel)',
    method: 'POST',
    path: '/api/circles/:id/events/:eventId/notes',
    toast: "Couldn't save your note. Please try again.",
    async prepare(ctx) {
      const tz = await recipientTimezone(ctx.api, ctx.circleId);
      const date = dateInZone(tz, 0);
      ctx.state.host = `${ctx.label} host`;
      await apiCreateEvent(ctx.api, ctx.circleId, { event_type: 'task', title: ctx.state.host, scheduled_date: date });
      const detail = await openCalendarEvent(ctx.page, ctx.circleId, date, ctx.state.host);
      const composer = detail.locator('#event-note-composer');
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.fill(ctx.label);
      return detail.getByRole('button', { name: 'Add note', exact: true });
    },
    async inputKept({ page, label }) {
      await expect(page.locator('#event-note-composer')).toHaveValue(label);
    },
    async succeeded({ page, label }) {
      await expect(page.locator('#event-note-composer')).toHaveValue('', { timeout: 20_000 });
      await expect(page.getByRole('dialog').getByText(label, { exact: true })).toBeVisible({ timeout: 20_000 });
    },
    rows: (ctx) => `select 1 from event_notes where circle_id = ${c(ctx)} and body = ${sqlStr(ctx.label)}`,
    cleanup: (ctx) => {
      sqlExec(`delete from event_notes where circle_id = ${c(ctx)} and body = ${sqlStr(ctx.label)};`);
      if (ctx.state.host) purgeEventsTitled(ctx.circleId, ctx.state.host);
    },
  },
  {
    name: 'vital add (VitalFormModal)',
    method: 'POST',
    path: '/api/circles/:id/vitals',
    toast: "Couldn't save your changes. Please try again.",
    async prepare({ page, circleId, label }) {
      await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add reading' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add reading' });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await dialog.locator('#vital_type').selectOption('heart_rate');
      await dialog.locator('#value1').fill(String(240 + Math.floor(Math.random() * 50)));
      await dialog.locator('#notes').fill(label);
      return dialog.getByRole('button', { name: 'Save reading', exact: true });
    },
    async inputKept({ page, label }) {
      const dialog = page.getByRole('dialog', { name: 'Add reading' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#notes')).toHaveValue(label);
    },
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'Add reading' })).toBeHidden({ timeout: 20_000 });
    },
    rows: (ctx) => `select 1 from health_vitals where circle_id = ${c(ctx)} and notes = ${sqlStr(ctx.label)}`,
    cleanup: (ctx) => sqlExec(`delete from health_vitals where circle_id = ${c(ctx)} and notes = ${sqlStr(ctx.label)};`),
  },
  {
    name: 'emergency medical info (EditMedicalInfoModal)',
    method: 'PUT',
    path: '/api/circles/:id/emergency-info',
    toast: "We couldn't save your changes. Please try again.",
    async prepare({ page, circleId, label }) {
      await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Edit medical information' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Medical information' });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      const input = dialog.locator('#allergies-input');
      await input.fill(label);
      await input.press('Enter');
      await expect(dialog.getByRole('button', { name: `Remove ${label}` })).toBeVisible();
      return dialog.getByRole('button', { name: 'Save', exact: true });
    },
    async inputKept({ page, label }) {
      const dialog = page.getByRole('dialog', { name: 'Medical information' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: `Remove ${label}` })).toBeVisible();
    },
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'Medical information' })).toBeHidden({ timeout: 20_000 });
    },
    rows: (ctx) => `select 1 from emergency_info where circle_id = ${c(ctx)} and ${sqlStr(ctx.label)} = any(allergies)`,
    cleanup: (ctx) =>
      sqlExec(
        `update emergency_info set allergies = array_remove(allergies, ${sqlStr(ctx.label)}) where circle_id = ${c(ctx)};`
      ),
  },
  {
    name: 'circle settings (EditCirclePage)',
    method: 'PATCH',
    path: '/api/circles/:id',
    toast: "Couldn't save your changes. Please try again.",
    async prepare(ctx) {
      const [{ recipient_name }] = dbQuery<{ recipient_name: string }>(
        `select recipient_name from care_circles where id = ${c(ctx)}`
      );
      ctx.state.original = recipient_name;
      await ctx.page.goto(`/circles/${ctx.circleId}/settings`, { waitUntil: 'domcontentloaded' });
      const field = ctx.page.locator('#recipient_name');
      await expect(field).toHaveValue(recipient_name, { timeout: 20_000 });
      await field.fill(ctx.label);
      return ctx.page.getByRole('button', { name: 'Save changes', exact: true });
    },
    async inputKept({ page, label }) {
      await expect(page.locator('#recipient_name')).toHaveValue(label);
    },
    async succeeded({ page }) {
      await expect(successToast(page, 'Circle updated.')).toBeVisible({ timeout: 20_000 });
    },
    rows: (ctx) => `select 1 from care_circles where id = ${c(ctx)} and recipient_name = ${sqlStr(ctx.label)}`,
    cleanup: (ctx) => {
      if (ctx.state.original !== undefined) {
        sqlExec(`update care_circles set recipient_name = ${sqlStr(ctx.state.original)} where id = ${c(ctx)};`);
      }
    },
  },
  {
    name: 'invite member (InviteMemberModal)',
    method: 'POST',
    path: '/api/circles/:id/invites',
    toast: 'Something went wrong. Please try again.',
    async prepare(ctx) {
      ctx.state.email = `e2e-rt-invite-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
      await ctx.page.goto(`/circles/${ctx.circleId}/members`, { waitUntil: 'domcontentloaded' });
      await expect(ctx.page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
      await ctx.page.getByRole('button', { name: 'Invite member' }).first().click();
      const dialog = ctx.page.getByRole('dialog', { name: 'Invite a member' });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await dialog.locator('#invite-email').fill(ctx.state.email);
      return dialog.getByRole('button', { name: 'Send invite', exact: true });
    },
    async inputKept(ctx) {
      await expect(ctx.page.locator('#invite-email')).toHaveValue(ctx.state.email);
    },
    async succeeded({ page }) {
      await expect(page.getByRole('dialog', { name: 'Invite a member' }).getByText('Invitation sent')).toBeVisible({
        timeout: 20_000,
      });
    },
    rows: (ctx) =>
      `select 1 from invites where circle_id = ${c(ctx)} and invited_email = ${sqlStr(ctx.state.email ?? '')}`,
    cleanup: (ctx) => {
      if (ctx.state.email) {
        sqlExec(`delete from invites where circle_id = ${c(ctx)} and invited_email = ${sqlStr(ctx.state.email)};`);
      }
    },
  },
];

const FAULTS: Array<{ label: string; fault: FaultOptions }> = [
  { label: 'HTTP 500', fault: { status: 500, code: 'SERVER_ERROR', message: 'Internal server error' } },
  { label: 'network abort', fault: { abort: true } },
];

for (const surface of SURFACES) {
  for (const { label: faultLabel, fault } of FAULTS) {
    test(`${surface.name}: ${faultLabel} on the first save surfaces the error, keeps input, and a retry succeeds`, async ({
      page,
      request,
      account,
      circleId,
    }) => {
      const api = await apiSession(request, account);
      const ctx: Ctx = { page, circleId, api, label: uniqueLabel('RT'), state: {} };
      try {
        const save = await surface.prepare(ctx);
        const injected = await failRequest(page, surface.method, surface.path, { ...fault, times: 1 });
        const sent = countRequests(page, surface.method, surface.path);

        await save.click();
        await injected.expectHits(1);
        await expect(errorToast(page, surface.toast)).toBeVisible({ timeout: 15_000 });
        await expect(errorToast(page, surface.toast)).toHaveCount(1);
        await surface.inputKept(ctx);
        await expect(save).toBeEnabled();
        expect(sent.count, 'one request so far').toBe(1);
        expect(dbCount(surface.rows(ctx)), 'nothing written by the failed attempt').toBe(0);

        if (surface.inline) {
          const inlineError = errorToast(page, surface.toast);
          expect(await inlineError.evaluate((el) => !!el.closest('[data-toast-region]')), 'shown inline, not as a toast').toBe(false);
          expect(await inlineError.evaluate((el) => !!el.closest('form')), 'inside the surface form').toBe(true);
          await expect(page.locator('[data-toast-region] > [data-toast]'), 'no toast raised').toHaveCount(0);
          await save.click({ timeout: 2_000 });
          await expect(inlineError, 'the retry clears the inline error').toHaveCount(0);
          await surface.succeeded(ctx);
          await sent.expectCount(2);
          expect(dbCount(surface.rows(ctx)), 'exactly one row after the retry').toBe(1);
          sent.dispose();
          return;
        }

        // The guard released: the retry is sent and lands — clicked straight
        // away, WHILE the error toast is still on screen. A toast used to sit
        // over a modal's footer (AddEventModal's Create at 1280x720) and had to
        // be dismissed first; it must not block the retry
        // (toast-modal-overlap.spec.ts measures why).
        // A plain `click()` would wait out a covering toast (Playwright retries
        // until the hit target is clear, and the toast leaves after 5s), so the
        // control is checked for being uncovered NOW, with the toast still up.
        //
        // At the NATURAL scroll position — nothing is scrolled for the check: the
        // control is wherever the first click left it. (This used to
        // `scrollIntoView({ block: 'center' })` first, which moved EditCirclePage's
        // "Save changes" out from under a bottom-right toast that covered 54% of
        // it at 1280x720.) The toast's entrance animation is allowed to finish,
        // then its FULL box is intersected with the control's full box — any
        // shared area fails, not just a covered centre point.
        const toastEl = errorToast(page, surface.toast);
        await expect(toastEl).toBeVisible();
        await expect
          .poll(() => toastEl.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished').length))
          .toBe(0);
        const shared = await save.evaluate((el) => {
          const t = document.querySelector('[data-toast-region] > [data-toast]:not([data-leaving])');
          if (!t) return null;
          const a = el.getBoundingClientRect();
          const b = t.getBoundingClientRect();
          const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          return { area: w * h, control: [a.left, a.top, a.right, a.bottom].map(Math.round), toast: [b.left, b.top, b.right, b.bottom].map(Math.round) };
        });
        expect(shared, 'a live toast was on screen to measure').not.toBeNull();
        expect(shared!.area, `the save control shares no area with the toast ${JSON.stringify(shared)}`).toBe(0);

        // The real retry click, and proof it landed while the toast was still up:
        // the listener reads the region at the instant the click is dispatched.
        await save.evaluate((el) => {
          el.addEventListener(
            'click',
            () => {
              (window as unknown as { __e2eToastAtClick?: boolean }).__e2eToastAtClick =
                document.querySelector('[data-toast-region] > [data-toast]:not([data-leaving])') !== null;
            },
            { capture: true, once: true }
          );
        });
        await save.click({ timeout: 2_000 });
        expect(
          await page.evaluate(() => (window as unknown as { __e2eToastAtClick?: boolean }).__e2eToastAtClick),
          'the retry was clicked while the error toast was still up'
        ).toBe(true);
        await surface.succeeded(ctx);
        await sent.expectCount(2);
        expect(dbCount(surface.rows(ctx)), 'exactly one row after the retry').toBe(1);
        sent.dispose();
      } finally {
        surface.cleanup(ctx);
      }
    });
  }
}
