import type { APIRequestContext, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { countRequests, dbQuery, failRequest, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { errorToast, successToast } from '../unhappy/writes/_helpers';
import { circleTimezone, createDailyMedication, dateInTz, deleteSeries, uniqueSuffix } from '../notesFirstClassShared';

// W13 (verify before alert, lib/confirmVerify.ts + hooks/useMedConfirmation.ts):
// when a dose confirm fails AMBIGUOUSLY (5xx, timeout, network) the app re-reads
// the dose's day BEFORE it says anything. Production 2026-09-10/11: every
// "failed to confirm" alert was for a dose the server HAD recorded (only the
// response was lost), and "Couldn't save. Please try again." invited a second
// dose. The failure branches were unit-tested only (confirmVerifyBeforeAlert
// .test.tsx); todays-meds-undo.spec.ts covers just the happy path.
//
// Driven through Home "Today's medications" (Take, 5 s undo window, then the
// POST) against the real backend and DB:
//   (a) RESPONSE LOST: the POST reaches the server and is written, the browser
//       gets a 500 -> the re-read finds it -> success toast, NO error, exactly
//       one POST and one confirmation row.
//   (b) REALLY NOT WRITTEN: a 500 that never reached the server -> the re-read
//       finds nothing -> "Couldn't save. Please try again.", no row, Confirm
//       offered again (the control: verify never hides a real failure).
//   (c) CANNOT TELL: the POST fails AND the re-read fails -> "We couldn't check
//       whether <med> was recorded…", never the claimed failure; no row.
//   (d) Spanish: (a) and (c) speak Spanish.
//
// FALSIFY: PW_FALSIFY=dose-verify-before-alert stops forwarding the "lost" POST
// in (a)/(d), so nothing is written and the success expectation must go red.
// The app-level proof (verify removed from useMedConfirmation in a scratch copy
// of the web app) is recorded in docs/plans/web-e2e-coverage-2026-10-02.md.
//
// TIMEZONE: the dose is 00:01 "today" in the recipient's zone (= the owner's
// profile zone, Denver by default); a run within 5 minutes of that midnight is
// skipped, exactly like todays-meds-undo.

const RECIPIENT_TZ = process.env.DOSE_RECIPIENT_TZ ?? 'America/Denver';
const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: RECIPIENT_TZ });
test.setTimeout(90_000);

const CONFIRM = '/api/circles/:id/medications/confirm';
const CONFIRM_RE = /^\/api\/circles\/[^/]+\/medications\/confirm$/;
const EVENTS_RE = /^\/api\/circles\/[^/]+\/events$/;
const SERVER_ERROR = { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } };

function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date()
  );
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** Confirmations of the series on TODAY (recipient zone). */
const todayRows = (circleId: string, root: string, today: string): { status: string }[] =>
  dbQuery<{ status: string }>(
    `select mc.status from medication_confirmations mc join calendar_events ce on ce.id = mc.event_id
      where ce.circle_id = ${sqlStr(circleId)}::uuid
        and (ce.id = ${sqlStr(root)}::uuid or ce.parent_event_id = ${sqlStr(root)}::uuid)
        and ce.scheduled_date = ${sqlStr(today)}::date`
  );

async function arrange(request: APIRequestContext, label: string, lang: 'en' | 'es' = 'en') {
  test.skip(
    (() => {
      const m = minutesIntoDay(RECIPIENT_TZ);
      return m < 5 || m > 24 * 60 - 5;
    })(),
    'within 5 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount(label);
  // language_set_at stamped: a NULL stamp lets the next sign-in overwrite the language.
  sqlExec(
    `update users set timezone = ${sqlStr(RECIPIENT_TZ)}, language = ${sqlStr(lang)}, language_set_at = now() ` +
      `where id = ${sqlStr(owner.userId)}::uuid;`
  );
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  const tz = await circleTimezone(session, circleId);
  expect(tz, 'recipient zone follows the owner profile zone').toBe(RECIPIENT_TZ);
  const name = `ZZ_E2E_VERIFY_${uniqueSuffix()}`;
  // Started yesterday so today's 00:01 dose is due (a start of TODAY with a past
  // time would be rolled to tomorrow by the late-add rule).
  const root = await createDailyMedication(session, circleId, name, dateInTz(tz, -1), { time: '00:01' });
  return { owner, session, circleId, name, root, today: dateInTz(tz, 0) };
}

function todayList(page: Page) {
  return page.locator('section[aria-labelledby="todays-meds-heading"] > ul');
}

async function openHome(page: Page, circleId: string, confirmLabel: string) {
  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
  const list = todayList(page);
  await expect(list.getByRole('button', { name: confirmLabel }).first()).toBeVisible({ timeout: 30_000 });
  return list;
}

/**
 * The FIRST confirm POST goes to the real server (it is written) and the browser
 * is answered 500 SERVER_ERROR: the response was lost. Under the falsifier the
 * request is NOT forwarded, so nothing is written.
 */
async function loseTheResponse(page: Page): Promise<{ forwarded: number[] }> {
  const forwarded: number[] = [];
  let used = false;
  await page.route(
    (url) => CONFIRM_RE.test(url.pathname),
    async (route: Route) => {
      if (route.request().method() !== 'POST' || used) return route.fallback();
      used = true;
      if (!FALSIFY.has('dose-verify-before-alert')) {
        const real = await route.fetch();
        forwarded.push(real.status());
      }
      await route.fulfill({ status: 500, json: SERVER_ERROR });
    }
  );
  return { forwarded };
}

/** From the first confirm POST on, every medication-day read answers 500 (the re-read cannot tell). */
async function failTheReRead(page: Page): Promise<{ readsFailed: () => number }> {
  let armed = false;
  let failed = 0;
  // The 'request' event fires for every request the browser SENDS, before any
  // route answers it (the confirm's own fault route fulfills without falling back).
  page.on('request', (req) => {
    if (req.method() === 'POST' && CONFIRM_RE.test(new URL(req.url()).pathname)) armed = true;
  });
  await page.route(
    (url) => EVENTS_RE.test(url.pathname) && url.searchParams.get('event_type') === 'medication',
    async (route: Route) => {
      if (!armed || route.request().method() !== 'GET') return route.fallback();
      failed += 1;
      await route.fulfill({ status: 500, json: SERVER_ERROR });
    }
  );
  return { readsFailed: () => failed };
}

test('(a) response lost after the write landed: the re-read finds it -> "Marked as taken", no error, one POST, one row', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'vba');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, `Confirm ${s.name}`);
    // Registered AFTER the page settled, so the lost-response route sits in front
    // of the counter's listener; the counter still sees every request the browser SENT.
    const lost = await loseTheResponse(page);
    const posts = countRequests(page, 'POST', CONFIRM);

    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    await expect(list.getByRole('button', { name: `Undo ${s.name}` })).toBeVisible();

    await expect(successToast(page, 'Marked as taken')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
    expect(lost.forwarded, 'the lost POST really reached the server').toEqual([201]);
    // No retry, no second write: the app never re-sends after a lost response.
    await posts.expectCount(1);
    const rows = todayRows(s.circleId, s.root, s.today);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toMatch(/^taken/);
    // The row now shows the answer, not Take/Skip.
    await expect(list.getByRole('button', { name: `Confirm ${s.name}` })).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(b) control: a 500 that never reached the server -> "Couldn\'t save. Please try again.", no row, Confirm offered again', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'vbb');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, `Confirm ${s.name}`);
    const fault = await failRequest(page, 'POST', CONFIRM, { status: 500, code: 'SERVER_ERROR' });

    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    await expect(errorToast(page, "Couldn't save. Please try again.")).toBeVisible({ timeout: 40_000 });
    await fault.expectHits(1);
    await expect(page.getByRole('status').filter({ hasText: /Marked as/ })).toHaveCount(0);
    await expect(page.getByText(/couldn't check whether/i)).toHaveCount(0);
    expect(todayRows(s.circleId, s.root, s.today)).toHaveLength(0);
    await expect(list.getByRole('button', { name: `Confirm ${s.name}` }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test('(c) the POST fails and the re-read fails too -> "We couldn\'t check whether <med> was recorded", never "Couldn\'t save"; no row', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const s = await arrange(request, 'vbc');
  try {
    await cookieLogin(context, s.owner, baseURL);
    const list = await openHome(page, s.circleId, `Confirm ${s.name}`);
    const reread = await failTheReRead(page);
    const fault = await failRequest(page, 'POST', CONFIRM, { status: 500, code: 'SERVER_ERROR' });

    await list.getByRole('button', { name: `Confirm ${s.name}` }).first().click();
    await expect(
      errorToast(page, `We couldn't check whether ${s.name} was recorded. Check the calendar once you're back online.`)
    ).toBeVisible({ timeout: 40_000 });
    await fault.expectHits(1);
    expect(reread.readsFailed(), 'the verify re-read was attempted and failed').toBeGreaterThan(0);
    await expect(errorToast(page, "Couldn't save. Please try again.")).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /Marked as/ })).toHaveCount(0);
    expect(todayRows(s.circleId, s.root, s.today)).toHaveLength(0);
  } finally {
    await deleteSeries(s.session, s.circleId, s.root);
  }
});

test.describe('Spanish', () => {
  test('(d) ES: a lost response says "Marcado como tomado" (one row); a failed re-read says "No pudimos verificar…"', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const s = await arrange(request, 'vbd', 'es');
    // A second medication for the "cannot tell" half, so each half has its own dose.
    const name2 = `ZZ_E2E_VERIFY_ES2_${uniqueSuffix()}`;
    const root2 = await createDailyMedication(s.session, s.circleId, name2, dateInTz(RECIPIENT_TZ, -1), { time: '00:01' });
    try {
      await cookieLogin(context, s.owner, baseURL);
      // Spanish accessible name of the Take button: "Confirmar <med>".
      const list = await openHome(page, s.circleId, `Confirmar ${s.name}`);
      await expect(page.locator('html')).toHaveAttribute('lang', /^es/);

      const lost = await loseTheResponse(page);
      await list.getByRole('button', { name: `Confirmar ${s.name}` }).first().click();
      await expect(successToast(page, 'Marcado como tomado')).toBeVisible({ timeout: 40_000 });
      await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
      expect(lost.forwarded).toEqual([201]);
      expect(todayRows(s.circleId, s.root, s.today)).toHaveLength(1);
      // The lost-response route is one-shot: from here on confirms pass through.

      const reread = await failTheReRead(page);
      const fault = await failRequest(page, 'POST', CONFIRM, { status: 500, code: 'SERVER_ERROR' });
      await list.getByRole('button', { name: `Confirmar ${name2}` }).first().click();
      await expect(
        errorToast(page, `No pudimos verificar si ${name2} se registró. Revisa el calendario cuando tengas conexión.`)
      ).toBeVisible({ timeout: 40_000 });
      await fault.expectHits(1);
      expect(reread.readsFailed()).toBeGreaterThan(0);
      await expect(errorToast(page, 'No se pudo guardar. Inténtalo de nuevo.')).toHaveCount(0);
      expect(todayRows(s.circleId, root2, s.today)).toHaveLength(0);
    } finally {
      await deleteSeries(s.session, s.circleId, root2);
      await deleteSeries(s.session, s.circleId, s.root);
    }
  });
});
