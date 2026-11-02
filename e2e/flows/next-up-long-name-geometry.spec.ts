import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import {
  answerYesterdaysDose,
  circleTimezone,
  createDailyMedication,
  dateInTz,
  deleteSeries,
  type ApiSession,
} from '../notesFirstClassShared';

// Today > Next up: a medication name NEVER breaks inside a word (owner report, mobile 1.4.0
// build 8, phone in Pacific/Auckland, recipient in America/Denver: "Escitalopra / m" beside
// "Taken | Undo", "Escitalop / ram" beside "Taken | Saving..."). Web twin of mobile
// NextUpCardNameNoMidWordBreak.test.tsx + Maestro night-parity/home-long-name-layout.
//
// REAL LAYOUT (jsdom has none, memory jsdom_geometry_blind): at a phone viewport, with the
// zone-labelled time in the first column, every word of the name and of the time is measured
// with a DOM Range: a word whose rects sit on two lines was split. The name box must also keep
// its height across the badge's states (just shown, held by hover / keyboard focus).
//
// FALSIFIED: with the name column's `min-w-0` and the no-wrap Taken row restored (the pre-fix
// NextUp.tsx), the owner's own "Escitalopram" splits beside Taken at 390px (en and es) and
// the spec goes red.

test.use({
  storageState: { cookies: [], origins: [] },
  timezoneId: 'Pacific/Auckland',
  viewport: { width: 390, height: 844 },
});
test.setTimeout(120_000);

/**
 * The profile zone follows the browser (DeviceTimezoneSync, 1.4.0), and a circle created from
 * the API follows its owner's zone: left alone, the Auckland browser would re-zone the circle
 * mid-test (no zone label, yesterday's doses back as rows). The owner case is a viewer whose
 * phone zone differs from the recipient's, so the session-start zone write is refused
 * (timezone-frame.spec.ts does the same).
 */
test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/users\/me$/, (route) =>
    route.request().method() === 'PATCH' ? route.abort() : route.continue()
  );
});

function minutesIntoDay(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(
    new Date()
  );
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

interface Arranged {
  owner: { email: string; password: string; userId: string };
  session: ApiSession;
  circleId: string;
  roots: string[];
}

async function arrange(
  request: APIRequestContext,
  label: string,
  recipientTz: string,
  language: string,
  names: string[]
): Promise<Arranged> {
  test.skip(
    (() => {
      const m = minutesIntoDay(recipientTz);
      return m < 5 || m > 24 * 60 - 5;
    })(),
    'within 5 minutes of midnight in the recipient zone'
  );
  const owner = await createScopedAccount(label);
  sqlExec(
    `update users set timezone = ${sqlStr(recipientTz)}, language = ${sqlStr(language)}, language_set_at = now() where id = ${sqlStr(owner.userId)}::uuid;`
  );
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  const tz = await circleTimezone(session, circleId);
  expect(tz).toBe(recipientTz);
  const roots: string[] = [];
  for (const name of names) {
    const root = await createDailyMedication(session, circleId, name, dateInTz(tz, -1), { time: '00:01' });
    // Yesterday's unanswered dose would be a second row for the same med.
    await answerYesterdaysDose(session, circleId, root, tz);
    roots.push(root);
  }
  return { owner, session, circleId, roots };
}

/** Words of `el`'s text that the browser laid out across more than one line. */
async function splitWords(el: Locator): Promise<string[]> {
  return el.evaluate((node) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      const text = t.data;
      const re = /\S+/g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const range = document.createRange();
        range.setStart(t, m.index);
        range.setEnd(t, m.index + m[0].length);
        const tops = new Set(
          Array.from(range.getClientRects())
            .filter((r) => r.width > 0)
            .map((r) => Math.round(r.top))
        );
        if (tops.size > 1) out.push(m[0]);
      }
    }
    return out;
  });
}

const heightOf = (el: Locator) => el.evaluate((n) => Math.round(n.getBoundingClientRect().height));

function nextUp(page: Page) {
  return page.locator('section[aria-labelledby="next-up-heading"]');
}

async function checkRows(page: Page, s: Arranged, names: string[], zoneLabel: RegExp) {
  await page.goto(`/circles/${s.circleId}`, { waitUntil: 'domcontentloaded' });
  const list = nextUp(page);
  for (const name of names) {
    const row = list.locator('[data-next-up-key]').filter({ hasText: name });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    const nameText = row.locator('[data-next-up-name] > span').first();
    const time = row.locator('[data-next-up-name]').locator('xpath=preceding-sibling::span[1]');
    await expect(nameText).toHaveText(name);
    await expect(time, 'the time carries the recipient zone label').toHaveText(zoneLabel);

    // 1) Beside Taken.
    const taken = row.locator('[data-next-up-taken]');
    await expect(taken).toBeVisible();
    expect(await splitWords(nameText), `"${name}" beside Taken`).toEqual([]);
    expect(await splitWords(time), 'time beside Taken').toEqual([]);
    const hTaken = await heightOf(nameText);

    // 2) The undo badge (just shown; the pointer is moved away so it is not held).
    await taken.click();
    await page.mouse.move(0, 0);
    const badge = row.locator('[role="status"]');
    await expect(badge).toBeVisible();
    expect(await splitWords(nameText), `"${name}" beside the undo badge`).toEqual([]);
    expect(await splitWords(time), 'time beside the undo badge').toEqual([]);
    const hBadge = await heightOf(nameText);

    // 3) Held (hover pauses the window, WCAG 2.2.1): same box.
    await badge.hover();
    await expect(badge).toHaveAttribute('data-held', 'true');
    expect(await splitWords(nameText), `"${name}" beside the held badge`).toEqual([]);
    const hHeld = await heightOf(nameText);

    expect(hBadge, `"${name}" name box height: badge vs Taken`).toBe(hTaken);
    expect(hHeld, `"${name}" name box height: held badge vs badge`).toBe(hBadge);

    // Undo inside the window: nothing is written, Taken is back, still one piece.
    await badge.getByRole('button').click();
    await expect(taken).toBeVisible();
    expect(await splitWords(nameText), `"${name}" after Undo`).toEqual([]);
  }
}

test('en, recipient Denver, phone in Auckland: long names never split beside Taken or the undo badge', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const names = ['Escitalopram', 'Hydrochlorothiazide'];
  const s = await arrange(request, 'nugeoen', 'America/Denver', 'en', names);
  try {
    await cookieLogin(context, s.owner, baseURL);
    await checkRows(page, s, names, /\(Denver\)/);
  } finally {
    for (const r of s.roots) await deleteSeries(s.session, s.circleId, r);
  }
});

test('es, recipient Mexico City ("(Ciudad de México)"): long names never split', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const names = ['Escitalopram', 'Hidroclorotiazida'];
  const s = await arrange(request, 'nugeoes', 'America/Mexico_City', 'es', names);
  try {
    await cookieLogin(context, s.owner, baseURL);
    await checkRows(page, s, names, /\(Ciudad de México\)/);
  } finally {
    for (const r of s.roots) await deleteSeries(s.session, s.circleId, r);
  }
});
