import type { APIRequestContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { successToast } from '../unhappy/writes/_helpers';
import { circleTimezone, createDailyMedication, dateInTz, deleteSeries, uniqueSuffix } from '../notesFirstClassShared';

// OS-undo-hold (undo badge held until the refetch lands; lib/refetchCap.ts,
// hooks/useMedConfirmation.ts `return todaysMedsRefetched`).
//
// The bug it fixed: after Home's 5 s undo window the confirm POST landed, the
// undo badge cleared as soon as the mutation settled, and the row fell back to
// the STALE cached dose while the day's refetch was still in flight: Take/Skip
// reappeared under the cursor on a dose that had just been answered, and a
// second click wrote a duplicate confirmation (plus a duplicate feed row and a
// duplicate push to the whole circle). Unit-tested only until now.
//
//   (a) refetch slow: while the day's re-read is held, the answered dose NEVER
//       offers Confirm again; once it lands the row shows the answer. One POST,
//       one row.
//   (b) refetch never lands (offline-style pause): the wait is CAPPED (4 s):
//       the success toast still arrives, so nothing stays pending forever.
//
// The re-read is held at the network edge (page.route) from the moment the
// confirm POST is sent; everything else is the real app, backend and DB.
//
// FALSIFIED against a scratch copy of the web app (no harness switch: holding
// the re-read IS the test): (a) goes red with the awaited refetch dropped from
// the confirm's onSuccess, (b) with the 4 s cap removed. Logged in
// docs/plans/web-e2e-coverage-2026-10-02.md.

const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: RECIPIENT_TZ });
test.setTimeout(90_000);

const CONFIRM = '/api/circles/:id/medications/confirm';
const CONFIRM_RE = /^\/api\/circles\/[^/]+\/medications\/confirm$/;
const EVENTS_RE = /^\/api\/circles\/[^/]+\/events$/;

function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date()
  );
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

const todayRows = (circleId: string, root: string, today: string): number =>
  dbQuery<{ n: string }>(
    `select count(*)::text as n from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.circle_id = ${sqlStr(circleId)}::uuid
        and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)
        and ce.scheduled_date = ${sqlStr(today)}::date`
  ).map((r) => Number(r.n))[0];

async function arrange(request: APIRequestContext, label: string) {
  test.skip(
    (() => {
      const m = minutesIntoDay(RECIPIENT_TZ);
      return m < 5 || m > 24 * 60 - 5;
    })(),
    'within 5 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount(label);
  sqlExec(
    `update users set timezone = ${sqlStr(RECIPIENT_TZ)}, language = 'en', language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
  );
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  const tz = await circleTimezone(session, circleId);
  expect(tz).toBe(RECIPIENT_TZ);
  const name = `ZZ_E2E_HOLD_${uniqueSuffix()}`;
  const root = await createDailyMedication(session, circleId, name, dateInTz(tz, -1), { time: '00:01' });
  return { owner, session, circleId, name, root, today: dateInTz(tz, 0) };
}

function todayList(page: Page) {
  return page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
}

/**
 * From the moment the confirm POST is SENT, every GET of the medication day is
 * held until `release()` (or forever). Requests before that pass through.
 */
async function holdDayReReadAfterConfirm(page: Page) {
  let armed = false;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let held = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && CONFIRM_RE.test(new URL(req.url()).pathname)) armed = true;
  });
  await page.route(
    (url) => EVENTS_RE.test(url.pathname) && url.searchParams.get('event_type') === 'medication',
    async (route: Route) => {
      if (!armed || route.request().method() !== 'GET') return route.fallback();
      held += 1;
      await gate;
      await route.fallback().catch(() => undefined);
    }
  );
  return { held: () => held, release: () => open() };
}

/** Resolves with the confirm POST response. Start BEFORE the click. */
function confirmResponse(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && CONFIRM_RE.test(new URL(r.url()).pathname),
    { timeout: 40_000 }
  );
}

test('(a) while the post-confirm re-read is slow, the answered dose never offers Confirm again; one POST, one row', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'holda');
  try {
    await cookieLogin(context, s.owner, baseURL);
    await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
    const list = todayList(page);
    const confirmBtn = list.getByRole('button', { name: `Confirm ${s.name}` });
    await expect(confirmBtn.first()).toBeVisible({ timeout: 30_000 });

    const hold = await holdDayReReadAfterConfirm(page);
    const posts = countRequests(page, 'POST', CONFIRM);
    const answered = confirmResponse(page);
    await confirmBtn.first().click();
    await expect(list.getByRole('button', { name: `Undo ${s.name}` })).toBeVisible();
    expect((await answered).status()).toBe(201);
    await expect.poll(hold.held, { timeout: 10_000, message: 'the day re-read is being held' }).toBeGreaterThan(0);

    // The window the bug lived in (well inside the 4 s cap): the stale cache
    // still says "not answered", and the row must not say so.
    for (let i = 0; i < 10; i += 1) {
      await expect(confirmBtn, `Confirm re-offered ${i * 250} ms into the held re-read`).toHaveCount(0);
      await page.waitForTimeout(250);
    }
    expect(todayRows(s.circleId, s.root, s.today)).toBe(1);

    hold.release();
    await expect(successToast(page, 'Marked as taken')).toBeVisible({ timeout: 20_000 });
    await expect(confirmBtn).toHaveCount(0);
    await posts.expectCount(1);
    expect(todayRows(s.circleId, s.root, s.today)).toBe(1);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(b) a re-read that never lands is capped: the dose still reports "Marked as taken" within seconds, never pending forever', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'holdb');
  const hold = { release: () => {} };
  try {
    await cookieLogin(context, s.owner, baseURL);
    await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
    const list = todayList(page);
    const confirmBtn = list.getByRole('button', { name: `Confirm ${s.name}` });
    await expect(confirmBtn.first()).toBeVisible({ timeout: 30_000 });

    const h = await holdDayReReadAfterConfirm(page);
    hold.release = h.release;
    const answered = confirmResponse(page);
    await confirmBtn.first().click();
    expect((await answered).status()).toBe(201);
    const answeredAt = Date.now();
    await expect.poll(h.held, { timeout: 10_000 }).toBeGreaterThan(0);

    // Never released: the 4 s cap must end the wait on its own.
    await expect(successToast(page, 'Marked as taken')).toBeVisible({ timeout: 12_000 });
    expect(Date.now() - answeredAt, 'the toast waited for the cap, not for the held re-read').toBeGreaterThan(3_000);
    await expect(list.getByRole('button', { name: `Undo ${s.name}` })).toHaveCount(0);
    expect(todayRows(s.circleId, s.root, s.today)).toBe(1);
  } finally {
    hold.release();
    await deleteSeries(s.session, s.circleId, s.root);
  }
});
