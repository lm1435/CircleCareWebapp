import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { nonLocalDbTargetReasons } from './db';
import { runScopedEmail } from './isolation';
import {
  API_ERRORS,
  apiSession,
  countRequests,
  dbCount,
  dbQuery,
  errorCodeOf,
  failRequest,
  generateSignupOtp,
  holdRequest,
  pathMatcher,
  readVerificationCode,
  sendMailpitMessage,
  sqlStr,
} from './unhappy';

// ===========================================================================
// HELPER PROOF — every helper in e2e/unhappy.ts observes a REAL request (or
// row, or message) and FAILS when the thing it checks does not happen.
//
// `/api/e2e-probe/*` is a path the app never calls: the request is real (it
// goes through the Vite proxy to the backend, whose 404 handler answers
// `NOT_FOUND`), so pass-through is observable and counts are deterministic.
// Where it matters, a real app request is used too.
// ===========================================================================

const PROBE = '/api/e2e-probe';

type ProbeWindow = Window & { __probeStatus?: number | null };

async function openApp(page: Page, circleId: string): Promise<void> {
  const loaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === `/api/circles/${circleId}` &&
      r.ok(),
    { timeout: 20_000 }
  );
  await page.goto(`/circles/${circleId}/notes`);
  await loaded;
}

test('pathMatcher: named segments, wildcards and regexps', () => {
  expect(pathMatcher('/api/circles/:id')('/api/circles/abc')).toBe(true);
  expect(pathMatcher('/api/circles/:id')('/api/circles/abc/notes')).toBe(false);
  expect(pathMatcher('/api/circles/*/care-notes')('/api/circles/abc/care-notes')).toBe(true);
  expect(pathMatcher('/api/circles/**')('/api/circles')).toBe(true);
  expect(pathMatcher('/api/circles/**')('/api/circles/a/b')).toBe(true);
  expect(pathMatcher('/api/circles/**')('/api/circlesx')).toBe(false);
  expect(pathMatcher(/care-notes$/)('/api/circles/a/care-notes')).toBe(true);
});

test('countRequests: sees the app’s real requests and asserts exact counts', async ({ page, circleId }) => {
  const detail = countRequests(page, 'GET', '/api/circles/:id');
  await openApp(page, circleId);
  expect(detail.count, 'the app fetched the circle detail').toBeGreaterThan(0);
  detail.dispose();

  const probe = countRequests(page, 'GET', `${PROBE}/count`);
  await page.evaluate(async (u) => {
    await fetch(u);
    await fetch(u);
  }, `${PROBE}/count`);
  await probe.expectCount(2, { settleMs: 500 });

  // Fails in both directions, and when nothing is sent at all.
  await expect(probe.expectCount(3, { settleMs: 200, timeoutMs: 800 })).rejects.toThrow(/expected exactly 3/);
  await expect(probe.expectCount(1, { settleMs: 200, timeoutMs: 800 })).rejects.toThrow(/expected exactly 1/);
  const never = countRequests(page, 'POST', `${PROBE}/never`);
  await expect(never.expectCount(1, { settleMs: 200, timeoutMs: 800 })).rejects.toThrow(/saw 0/);
  await never.expectCount(0, { settleMs: 300 });
});

test('failRequest: backend error shape for N requests, then real pass-through; abort; method filter', async ({
  page,
  circleId,
}) => {
  await openApp(page, circleId);

  const fault = await failRequest(page, 'GET', `${PROBE}/fault`, { ...API_ERRORS.viewOnly, times: 1 });
  const out = await page.evaluate(async (u) => {
    const results: Array<{ status: number; body: unknown }> = [];
    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(u);
      results.push({ status: res.status, body: await res.json() });
    }
    return results;
  }, `${PROBE}/fault`);
  expect(out[0]).toEqual({
    status: 403,
    body: { success: false, error: { code: 'VIEW_ONLY', message: API_ERRORS.viewOnly.message } },
  });
  // The second one reached the real backend.
  expect(out[1].status).toBe(404);
  expect((out[1].body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  await fault.expectHits(1);
  expect(fault.remaining).toBe(0);

  const aborted = await failRequest(page, 'POST', `${PROBE}/abort`, { abort: true });
  const outcome = await page.evaluate(async (u) => {
    try {
      await fetch(u, { method: 'POST' });
      return 'resolved';
    } catch (err) {
      return String(err);
    }
  }, `${PROBE}/abort`);
  expect(outcome).toMatch(/Failed to fetch/);
  await aborted.expectHits(1);

  // Method mismatch: not faulted, and expectHits says so.
  const getOnly = await failRequest(page, 'GET', `${PROBE}/method`, { status: 500 });
  expect(await page.evaluate(async (u) => (await fetch(u, { method: 'POST' })).status, `${PROBE}/method`)).toBe(404);
  await expect(getOnly.expectHits(1, { timeoutMs: 500 })).rejects.toThrow();
});

test('failRequest: faults a real request the app makes', async ({ page, circleId }) => {
  const fault = await failRequest(page, 'GET', '/api/circles/:id/care-notes', API_ERRORS.serviceUnavailable);
  await openApp(page, circleId);
  await fault.expectHits(1, { timeoutMs: 20_000 });
});

test('holdRequest: pending until released; releaseWith; fails when nothing is held', async ({ page, circleId }) => {
  await openApp(page, circleId);

  const hold = await holdRequest(page, 'GET', `${PROBE}/hold`);
  await page.evaluate((u) => {
    const w = window as ProbeWindow;
    w.__probeStatus = null;
    void fetch(u).then((r) => {
      w.__probeStatus = r.status;
    });
  }, `${PROBE}/hold`);
  await hold.waitForHeld();
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => (window as ProbeWindow).__probeStatus), 'still pending while held').toBeNull();
  await hold.release();
  await expect.poll(() => page.evaluate(() => (window as ProbeWindow).__probeStatus)).toBe(404);
  // After release, matching requests pass straight through.
  expect(await page.evaluate(async (u) => (await fetch(u)).status, `${PROBE}/hold`)).toBe(404);

  const hold2 = await holdRequest(page, 'POST', `${PROBE}/hold2`);
  const pending = page.evaluate(async (u) => (await fetch(u, { method: 'POST' })).status, `${PROBE}/hold2`);
  await hold2.waitForHeld();
  await hold2.releaseWith(API_ERRORS.serviceUnavailable);
  expect(await pending).toBe(503);

  const none = await holdRequest(page, 'GET', `${PROBE}/never`);
  await expect(none.waitForHeld(1, { timeoutMs: 500 })).rejects.toThrow(/expected 1 held/);
});

test('dbQuery / dbCount: read real rows, see a real API write and its removal', async ({ request, account, circleId }) => {
  // Scoped to the provisioned circles: other specs in this worker slot create
  // (and archive) circles of their own in the same account.
  const provisioned = account.circleIds.map((id) => `${sqlStr(id)}::uuid`).join(', ');
  expect(
    dbCount(`select 1 from care_circles where owner_id = ${sqlStr(account.userId)}::uuid and id in (${provisioned})`)
  ).toBe(account.circleIds.length);
  expect(dbCount(`select 1 from care_circles where id = ${sqlStr('00000000-0000-0000-0000-000000000000')}::uuid`)).toBe(0);

  const body = `E2E dbCount probe ${Date.now()}`;
  const probeRows = `select 1 from care_notes where circle_id = ${sqlStr(circleId)}::uuid and body = ${sqlStr(body)}`;
  expect(dbCount(probeRows)).toBe(0);

  const api = await apiSession(request, account);
  const created = await api.post(`/api/circles/${circleId}/care-notes`, { body });
  expect(created.status(), await created.text()).toBe(201);
  const noteId = ((await created.json()) as { data: { note: { id: string } } }).data.note.id;
  try {
    expect(dbCount(probeRows)).toBe(1);
    const [row] = dbQuery<{ author_id: string }>(
      `select author_id::text as author_id from care_notes where id = ${sqlStr(noteId)}::uuid`
    );
    expect(row.author_id).toBe(account.userId);
  } finally {
    const del = await api.delete(`/api/circles/${circleId}/care-notes/${noteId}`);
    expect(del.ok(), await del.text()).toBe(true);
  }
  expect(dbCount(probeRows)).toBe(0);

  expect(() => dbQuery('select * from e2e_no_such_table')).toThrow();
  // The guard dbQuery/dbCount sit behind refuses a remote target.
  expect(
    nonLocalDbTargetReasons('postgresql://postgres@db.example.com:5432/postgres', 'http://127.0.0.1:55321', {})
  ).not.toEqual([]);
});

test('readVerificationCode: reads a code from Mailpit, fails when no mail arrives', async () => {
  const email = runScopedEmail(`mail-${Date.now()}`);
  const since = new Date(Date.now() - 2_000);
  await sendMailpitMessage(
    email,
    'Your CircleCare verification code',
    'Your verification code is 482913. It expires in one hour.'
  );
  expect(await readVerificationCode(email, { since, timeoutMs: 5_000 })).toBe('482913');

  await expect(
    readVerificationCode(runScopedEmail(`mail-none-${Date.now()}`), { timeoutMs: 1_500 })
  ).rejects.toThrow(/no message with a code/);
});

test('generateSignupOtp: a code the real /api/auth/verify-otp accepts, and a wrong one it refuses', async ({
  request,
}) => {
  const email = runScopedEmail(`signup-${Date.now()}`);
  const otp = await generateSignupOtp(email);
  expect(otp).toMatch(/^\d{6}$/);
  expect(dbCount(`select 1 from auth.users where email = ${sqlStr(email)} and email_confirmed_at is null`)).toBe(1);

  const wrong = await request.post('/api/auth/verify-otp', {
    data: { email, otp: otp === '000000' ? '111111' : '000000' },
  });
  expect(wrong.status()).toBe(400);
  expect(await errorCodeOf(wrong)).toBe('VERIFICATION_FAILED');

  const ok = await request.post('/api/auth/verify-otp', { data: { email, otp } });
  expect(ok.status(), await ok.text()).toBe(200);
  expect(dbCount(`select 1 from auth.users where email = ${sqlStr(email)} and email_confirmed_at is not null`)).toBe(1);
  // The welcome e-mail claim was pre-taken, so verify-otp sent nothing.
  expect(dbCount(`select 1 from public.users where email = ${sqlStr(email)} and welcome_email_sent`)).toBe(1);
});
