import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { apiCreateEvent } from '../unhappy/writes/_helpers';
import { circleTimezone, dateInTz, escapeRegExp, gotoWeekContaining, openChip } from '../notesFirstClassShared';

// Fix 4 (web parity, names of people): the calendar detail of an APPOINTMENT
// shows who it is assigned to ("Assigned to" / "Asignado a"), as mobile's
// calendar detail sheet does. Web used to show the row for tasks only. An
// UNASSIGNED appointment shows no row (mobile parity); tasks keep their
// "Unassigned" row (covered by the task specs).
//
// Seeding through the public API (a member joins; two appointments, one
// assigned to that member, one not); the detail dialog is read through the UI,
// in English and Spanish. The person is found by NAME.
//
// FALSIFY: PW_FALSIFY=appointment-detail-assignee creates the "assigned"
// appointment WITHOUT an assignee, so the name assertion must go red. The
// app-level proof (the appointment branch removed in a scratch copy of the web
// app) is logged in docs/plans/web-e2e-coverage-2026-10-02.md.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('appointment-detail-assignee');

/** The detail row whose <dt> is exactly `label`, and its <dd>. */
function detailRow(dialog: Locator, page: Page, label: string): { row: Locator; value: Locator } {
  const row = dialog.locator('dl > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`) }) });
  return { row, value: row.locator('dd') };
}

for (const lang of ['en', 'es'] as const) {
  const label = lang === 'es' ? 'Asignado a' : 'Assigned to';
  test(`${lang.toUpperCase()}: an assigned appointment names its assignee under "${label}"; an unassigned one has no such row`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
    const owner = await createScopedAccount(`apptasg-${lang}`);
    sqlExec(
      `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
    );
    const ownerSession = await ownerApi(request, owner);
    const circleId = await createCircle(ownerSession, uniq(`apptasg${lang}`));

    const member = await createScopedAccount(`apptasg-${lang}-m`);
    const first = 'Rosaura';
    const last = `Asignada${suffix}`;
    sqlExec(
      `update public.users set first_name = ${sqlStr(first)}, last_name = ${sqlStr(last)} where id = ${sqlStr(member.userId)}::uuid;`
    );
    const memberSession = await ownerApi(request, member);
    const invite = await createInvite(ownerSession, circleId); // @example.com, never mailed
    const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
    expect(acc.status(), await acc.text()).toBeLessThan(300);

    const tz = await circleTimezone(ownerSession, circleId);
    const today = dateInTz(tz, 0);
    const assignedTitle = `E2E Appt assigned ${suffix}`;
    const plainTitle = `E2E Appt nobody ${suffix}`;
    await apiCreateEvent(ownerSession, circleId, {
      event_type: 'appointment',
      title: assignedTitle,
      scheduled_date: today,
      scheduled_time: '10:00',
      ...(FALSIFY ? {} : { assigned_to: member.userId }),
    });
    await apiCreateEvent(ownerSession, circleId, {
      event_type: 'appointment',
      title: plainTitle,
      scheduled_date: today,
      scheduled_time: '14:00',
    });

    await cookieLogin(context, owner, baseURL);
    await gotoWeekContaining(page, circleId, today, today);
    await expect(page.locator('html')).toHaveAttribute('lang', lang === 'es' ? /^es/ : /^en/);

    const assigned = await openChip(page, today, new RegExp(escapeRegExp(assignedTitle)));
    const a = detailRow(assigned, page, label);
    await expect(a.row).toHaveCount(1, { timeout: 15_000 });
    await expect(a.value).toHaveText(`${first} ${last}`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });

    const plain = await openChip(page, today, new RegExp(escapeRegExp(plainTitle)));
    // The dialog has rendered its rows (date is always there) before "no row" is judged.
    await expect(plain.locator('dl > div').first()).toBeVisible();
    await expect(detailRow(plain, page, label).row).toHaveCount(0);
    // An appointment never borrows the task's "Unassigned" wording.
    await expect(plain.getByText(lang === 'es' ? /Sin asignar/ : /Unassigned/)).toHaveCount(0);
  });
}
