import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  apiSession,
  circleTimezone,
  dateInTz,
  dayCell,
  deleteEventById,
  escapeRegExp,
  gotoCalendarSettled,
  uniqueSuffix,
  type ApiSession,
} from '../notesFirstClassShared';

// Mobile parity (TimelineEventBlock): a week-grid event chip prints WHO it is
// assigned to and HOW MANY notes it has, and both join the chip's accessible
// name. jsdom has no layout engine, so this spec is the proof that the new
// meta line fits: every text box inside a chip must sit inside the chip (no
// clipping), chips in a collision group must not overlap, and the meta line
// must not collide with the title/time lines — at desktop and phone widths, in
// English and Spanish, with an over-long name, and in 1-, 2- and 3-lane slots.
//
// Rules under test (WeekView.renderEventButton):
//   - 60-minute chip, 1 or 2 lanes  -> title / time / meta (name + badge)
//   - 30-minute chip                -> title / time only (no third line);
//                                      name + count still in the aria-label
//   - 3+ lanes                      -> title only; name + count aria-only
//
// Events are created through the real API on TODAY (recipient zone), so the
// default week is the right one and no week stepping (English-only heading
// regex) is needed. Slots are picked around whatever the cloned demo circle
// already has on today, so the lane counts are the ones this spec intends.

const PREFIX = 'ZZ_E2E_CHIPMETA_';
const SCRATCH = process.env.PW_CHIP_SCREENSHOT_DIR;
const LONG_FIRST = 'Maximiliano Alejandro';
const LONG_LAST = 'Fernández-Castellanos de la Torre';
const LONG_NAME = `${LONG_FIRST} ${LONG_LAST}`;

interface ListedEvent {
  id: string;
  title: string;
  scheduled_date: string;
  scheduled_time: string | null;
  duration_minutes?: number | null;
  note_count?: number;
  assigned_to_user?: { first_name: string | null; last_name: string | null; email?: string | null } | null;
}

async function listDay(session: ApiSession, circleId: string, date: string): Promise<ListedEvent[]> {
  const res = await session.get(
    `/api/circles/${circleId}/events?start_date=${date}&end_date=${date}`
  );
  expect(res.ok(), `list events: ${res.status()}`).toBe(true);
  return ((await res.json()) as { data: { events: ListedEvent[] } }).data.events;
}

async function me(session: ApiSession): Promise<{ id: string; name: string }> {
  const res = await session.get('/api/users/me');
  expect(res.ok(), `GET /users/me: ${res.status()}`).toBe(true);
  const user = ((await res.json()) as {
    data: { user: { id: string; first_name: string | null; last_name: string | null; email: string } };
  }).data.user;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  return { id: user.id, name };
}

function toMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * `count` hour-aligned start times between 06:00 and 21:00 whose
 * [start - 30, start + 90) window touches no existing timed event, so a slot
 * forms its OWN collision group (lanes = only the events this spec puts there).
 */
function freeSlots(existing: ListedEvent[], count: number): string[] {
  const busy = existing
    .filter((e) => !!e.scheduled_time)
    .map((e) => {
      const start = toMinutes(e.scheduled_time as string);
      return [start, start + (e.duration_minutes || 30)] as const;
    });
  const out: string[] = [];
  for (let start = 6 * 60; start <= 21 * 60 && out.length < count; start += 60) {
    const lo = start - 30;
    const hi = start + 90;
    if (busy.every(([s, e]) => e <= lo || s >= hi)) out.push(hhmm(start));
  }
  if (out.length < count) throw new Error(`only ${out.length} free slots today, need ${count}`);
  return out;
}

async function createAppt(
  session: ApiSession,
  circleId: string,
  title: string,
  date: string,
  time: string,
  duration: number,
  assignee: string | null
): Promise<string> {
  const res = await session.post(`/api/circles/${circleId}/events`, {
    event_type: 'appointment',
    title,
    scheduled_date: date,
    scheduled_time: time,
    duration_minutes: duration,
    assigned_to: assignee,
  });
  if (!res.ok()) throw new Error(`create appointment: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { data: { event: { id: string } } }).data.event.id;
}

async function addNotes(session: ApiSession, circleId: string, eventId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const res = await session.post(`/api/circles/${circleId}/events/${eventId}/notes`, {
      body: `${PREFIX}note ${i + 1}`,
    });
    expect(res.ok(), `add note: ${res.status()}`).toBe(true);
  }
}

interface Seeded {
  ids: string[];
  single: string; // 60 min, 1 lane, assignee + 3 notes
  short: string; // 30 min, 1 lane, assignee + 1 note
  pair: [string, string]; // 60 min, 2 lanes; first has assignee + 2 notes
  triple: [string, string, string]; // 60 min, 3 lanes; first has assignee + 1 note
}

async function seedScenario(session: ApiSession, circleId: string, date: string, owner: string): Promise<Seeded> {
  const [s1, s2, s3, s4] = freeSlots(await listDay(session, circleId, date), 4);
  const tag = uniqueSuffix();
  const t = (name: string) => `${PREFIX}${name}_${tag}`;
  const ids: string[] = [];
  const mk = async (name: string, time: string, dur: number, assignee: string | null) => {
    const id = await createAppt(session, circleId, t(name), date, time, dur, assignee);
    ids.push(id);
    return t(name);
  };
  const seeded: Seeded = {
    ids,
    single: await mk('single', s1, 60, owner),
    short: await mk('short', s2, 30, owner),
    pair: [await mk('pairA', s3, 60, owner), await mk('pairB', s3, 60, null)],
    triple: [await mk('triA', s4, 60, owner), await mk('triB', s4, 60, null), await mk('triC', s4, 60, null)],
  };
  await addNotes(session, circleId, ids[0], 3);
  await addNotes(session, circleId, ids[1], 1);
  await addNotes(session, circleId, ids[2], 2);
  await addNotes(session, circleId, ids[4], 1);
  return seeded;
}

/**
 * Rewrite the assignee NAME (only the name, only on this spec's rows) in the
 * real events response to an over-long one — the layout stress case. The ids,
 * note counts, times and lanes stay exactly what the backend returned.
 */
async function longNameRoute(page: Page): Promise<void> {
  await page.route(/\/api\/circles\/[^/]+\/events(\?|$)/, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as { data?: { events?: ListedEvent[] } };
    for (const e of body?.data?.events ?? []) {
      if (e.title?.startsWith(PREFIX) && e.assigned_to_user) {
        e.assigned_to_user = { ...e.assigned_to_user, first_name: LONG_FIRST, last_name: LONG_LAST };
      }
    }
    await route.fulfill({ response, json: body });
  });
}

function chip(page: Page, date: string, title: string): Locator {
  return dayCell(page, date).getByRole('button', { name: new RegExp(`^${escapeRegExp(title)},`) });
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
  testid: string | null;
  text: string;
  overflowX: boolean;
  ellipsis: boolean;
}

/** Every rendered descendant text box of the chip, plus the chip itself. */
async function chipBoxes(c: Locator): Promise<{ chip: Box; parts: Box[] }> {
  return c.evaluate((el) => {
    const box = (n: Element): Box => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const he = n as HTMLElement;
      return {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        tag: n.tagName,
        testid: n.getAttribute('data-testid'),
        text: (he.innerText ?? '').trim(),
        overflowX: he.scrollWidth > he.clientWidth + 1,
        ellipsis: cs.textOverflow === 'ellipsis',
      };
    };
    // Text-bearing spans (a direct, non-blank text node) plus the named meta
    // parts. Pure layout wrappers are skipped: a flex wrapper's scrollWidth
    // reflects its children, and each child is checked on its own.
    const parts = Array.from(el.querySelectorAll('span'))
      .filter((n) => {
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const ownText = Array.from(n.childNodes).some(
          (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim() !== ''
        );
        return ownText || n.hasAttribute('data-testid');
      })
      .map(box);
    return { chip: box(el), parts };
  });
}

const EPS = 0.75;

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
  );
}

function disjoint(a: Box, b: Box): boolean {
  return (
    a.x + a.w <= b.x + EPS ||
    b.x + b.w <= a.x + EPS ||
    a.y + a.h <= b.y + EPS ||
    b.y + b.h <= a.y + EPS
  );
}

/**
 * No text box leaves the chip, no text overflows its own box unless it is an
 * ellipsis truncation, and the meta line overlaps neither the title nor the
 * time. Returns the boxes for scenario-specific checks.
 */
async function assertChipFits(c: Locator, label: string): Promise<{ chip: Box; parts: Box[] }> {
  await c.scrollIntoViewIfNeeded();
  const boxes = await chipBoxes(c);
  for (const p of boxes.parts) {
    expect(inside(p, boxes.chip), `${label}: "${p.text}" (${p.testid ?? p.tag}) is clipped by its chip`).toBe(true);
    if (p.overflowX) {
      expect(p.ellipsis, `${label}: "${p.text}" overflows without an ellipsis`).toBe(true);
    }
  }
  const meta = boxes.parts.find((p) => p.testid === 'event-chip-meta');
  if (meta) {
    const lines = boxes.parts.filter((p) => !p.testid);
    for (const l of lines) {
      expect(disjoint(meta, l), `${label}: meta line overlaps "${l.text}"`).toBe(true);
    }
    const name = boxes.parts.find((p) => p.testid === 'event-chip-assignee');
    const notes = boxes.parts.find((p) => p.testid === 'event-chip-notes');
    if (name && notes) {
      expect(disjoint(name, notes), `${label}: name overlaps the note badge`).toBe(true);
      expect(notes.overflowX, `${label}: note badge must never be cut`).toBe(false);
    }
  }
  return boxes;
}

async function assertLaneGroup(page: Page, date: string, titles: string[], label: string): Promise<void> {
  const cell = await dayCell(page, date).last().boundingBox();
  expect(cell).not.toBeNull();
  const boxes: Box[] = [];
  for (const title of titles) {
    const b = (await assertChipFits(chip(page, date, title), `${label}/${title}`)).chip;
    expect(b.x, `${label}: ${title} starts left of its day column`).toBeGreaterThanOrEqual(cell!.x - EPS);
    expect(b.x + b.w, `${label}: ${title} runs past its day column`).toBeLessThanOrEqual(
      cell!.x + cell!.width + EPS
    );
    boxes.push(b);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(disjoint(boxes[i], boxes[j]), `${label}: ${titles[i]} overlaps ${titles[j]}`).toBe(true);
    }
  }
}

async function shot(page: Page, date: string, name: string): Promise<void> {
  if (!SCRATCH) return;
  const cell = dayCell(page, date).last();
  await cell.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCRATCH}/${name}-viewport.png` });
}

async function shotChip(c: Locator, name: string): Promise<void> {
  if (!SCRATCH) return;
  await c.scrollIntoViewIfNeeded();
  await c.screenshot({ path: `${SCRATCH}/${name}.png` });
}

test.describe('Week chip: assignee + note count (mobile TimelineEventBlock parity)', () => {
  test('the list API carries the assignee and note count, the chip prints and speaks them, and a new note bumps the badge', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const owner = await me(session);
    const [slot] = freeSlots(await listDay(session, circleId, today), 1);
    const title = `${PREFIX}api_${uniqueSuffix()}`;
    const id = await createAppt(session, circleId, title, today, slot, 60, owner.id);
    try {
      await addNotes(session, circleId, id, 2);

      // The real wire shape — the web reads exactly these two fields.
      const row = (await listDay(session, circleId, today)).find((e) => e.id === id);
      expect(row?.note_count).toBe(2);
      const wireName = [row?.assigned_to_user?.first_name, row?.assigned_to_user?.last_name]
        .filter(Boolean)
        .join(' ');
      expect(wireName).toBe(owner.name);

      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoCalendarSettled(page, circleId);
      const c = chip(page, today, title);
      await expect(c).toBeVisible({ timeout: 20_000 });
      await expect(c).toHaveAttribute('aria-label', new RegExp(`, ${escapeRegExp(owner.name)}, 2 notes$`));
      await expect(c.getByTestId('event-chip-assignee')).toHaveText(owner.name);
      await expect(c.getByTestId('event-chip-notes')).toHaveText('2');

      // Add a third note through the real detail modal: the calendar list is
      // invalidated and the badge follows.
      await c.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByLabel('Add a note').fill(`${PREFIX}ui note`);
      await dialog.getByRole('button', { name: 'Add note' }).click();
      await expect(dialog.getByText(`${PREFIX}ui note`)).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Close event details' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
      await expect(c.getByTestId('event-chip-notes')).toHaveText('3', { timeout: 15_000 });
      await expect(c).toHaveAttribute('aria-label', /, 3 notes$/);
    } finally {
      await deleteEventById(session, circleId, id);
    }
  });

  for (const vp of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    test(`layout fits at ${vp.name} width (${vp.width}px): long name, 1/2/3 lanes, 30-minute chip`, async ({
      page,
      request,
      circleId,
      account,
    }) => {
      test.slow();
      const session = await apiSession(request, account);
      const tz = await circleTimezone(session, circleId);
      const today = dateInTz(tz, 0);
      const owner = await me(session);
      const seeded = await seedScenario(session, circleId, today, owner.id);
      try {
        await longNameRoute(page);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await gotoCalendarSettled(page, circleId);
        await expect(chip(page, today, seeded.single)).toBeVisible({ timeout: 20_000 });

        // 1 lane, 60 min: name (ellipsised, never cut) + badge on their own line.
        const single = chip(page, today, seeded.single);
        await expect(single).toHaveAttribute('aria-label', new RegExp(`, ${escapeRegExp(LONG_NAME)}, 3 notes$`));
        await expect(single.getByTestId('event-chip-meta')).toBeVisible();
        await expect(single.getByTestId('event-chip-notes')).toHaveText('3');
        const sb = await assertChipFits(single, `${vp.name}/single`);
        const name = sb.parts.find((p) => p.testid === 'event-chip-assignee');
        expect(name, 'assignee printed').toBeTruthy();
        expect(name!.overflowX, 'the long name must truncate at this width').toBe(true);
        await shotChip(single, `chip-${vp.name}-en-single`);

        // 30 min: two lines only — title + time; name and count are aria-only.
        const short = chip(page, today, seeded.short);
        await expect(short).toHaveAttribute('aria-label', new RegExp(`, ${escapeRegExp(LONG_NAME)}, 1 note$`));
        await expect(short.getByTestId('event-chip-meta')).toHaveCount(0);
        await assertChipFits(short, `${vp.name}/short`);
        await shotChip(short, `chip-${vp.name}-en-30min`);

        // 2 lanes: meta line in the narrow lane, chips side by side.
        await expect(chip(page, today, seeded.pair[0]).getByTestId('event-chip-meta')).toBeVisible();
        await expect(chip(page, today, seeded.pair[1]).getByTestId('event-chip-meta')).toHaveCount(0);
        await assertLaneGroup(page, today, seeded.pair, `${vp.name}/2-lane`);

        // 3 lanes: title only; the name and count are still spoken.
        const triA = chip(page, today, seeded.triple[0]);
        await expect(triA.getByTestId('event-chip-meta')).toHaveCount(0);
        await expect(triA).toHaveAttribute('aria-label', new RegExp(`, ${escapeRegExp(LONG_NAME)}, 1 note$`));
        await assertLaneGroup(page, today, seeded.triple, `${vp.name}/3-lane`);

        // Single-lane chips stay inside their own day column too.
        await assertLaneGroup(page, today, [seeded.single, seeded.short], `${vp.name}/1-lane`);

        await shotChip(chip(page, today, seeded.pair[0]), `chip-${vp.name}-en-2lane`);
        await shot(page, today, `week-${vp.name}-en`);
      } finally {
        for (const id of seeded.ids) await deleteEventById(session, circleId, id);
      }
    });
  }

  test('month day panel: the note badge prints and joins the row name', async ({
    page,
    request,
    circleId,
    account,
  }) => {
    test.slow();
    const session = await apiSession(request, account);
    const tz = await circleTimezone(session, circleId);
    const today = dateInTz(tz, 0);
    const [slot] = freeSlots(await listDay(session, circleId, today), 1);
    const title = `${PREFIX}month_${uniqueSuffix()}`;
    const id = await createAppt(session, circleId, title, today, slot, 60, null);
    try {
      await addNotes(session, circleId, id, 3);
      for (const vp of [
        { name: 'desktop', width: 1280, height: 900 },
        { name: 'phone', width: 390, height: 844 },
      ]) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await gotoCalendarSettled(page, circleId);
        await page.getByRole('tab', { name: 'Month', exact: true }).click();
        await page.locator(`button[data-date="${today}"]`).click();
        const panel = page.getByRole('complementary', { name: 'Events for the selected day' });
        const row = panel.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)},.*, 3 notes$`) });
        await expect(row).toBeVisible({ timeout: 20_000 });
        await expect(row.getByTestId('event-chip-notes')).toHaveText('3');
        const rowBox = (await assertChipFits(row, `month/${vp.name}`)).chip;
        // The row must be inside the page and its panel must be inside the
        // layout column — at phone width the panel used to size to the
        // longest unbreakable title and run off the right edge, clipped.
        expect(rowBox.x + rowBox.w, `month/${vp.name}: row runs past the viewport`).toBeLessThanOrEqual(
          vp.width + EPS
        );
        const panelFits = await panel.evaluate((aside) => {
          const a = aside.getBoundingClientRect();
          const p = (aside.parentElement as HTMLElement).getBoundingClientRect();
          return a.left >= p.left - 0.75 && a.right <= p.right + 0.75;
        });
        expect(panelFits, `month/${vp.name}: day panel overflows its layout column`).toBe(true);
        await shotChip(row, `month-panel-${vp.name}-en`);
      }
    } finally {
      await deleteEventById(session, circleId, id);
    }
  });
});

test.describe('Week chip meta in Spanish', () => {
  test.use({ locale: 'es' });

  for (const vp of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    test(`Spanish chips at ${vp.name} width: "notas" in the name, layout still fits`, async ({
      page,
      request,
      circleId,
      account,
    }) => {
      test.slow();
      const session = await apiSession(request, account);
      const tz = await circleTimezone(session, circleId);
      const today = dateInTz(tz, 0);
      const owner = await me(session);
      const seeded = await seedScenario(session, circleId, today, owner.id);
      try {
        // Same technique as i18n-spanish.spec.ts: report language 'es' on this
        // context's GET /users/me so the profile does not pull the UI back to
        // English. Nothing is written to the account.
        await page.route('**/api/users/me', async (route) => {
          if (route.request().method() !== 'GET') return route.continue();
          const response = await route.fetch();
          const body = (await response.json()) as { data?: { user?: { language?: string } } };
          if (body?.data?.user) body.data.user.language = 'es';
          await route.fulfill({ response, json: body });
        });
        await longNameRoute(page);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await gotoCalendarSettled(page, circleId);

        const single = chip(page, today, seeded.single);
        await expect(single).toBeVisible({ timeout: 20_000 });
        await expect(single).toHaveAttribute('aria-label', new RegExp(`, ${escapeRegExp(LONG_NAME)}, 3 notas$`));
        await expect(chip(page, today, seeded.short)).toHaveAttribute('aria-label', /, 1 nota$/);
        await assertChipFits(single, `es/${vp.name}/single`);
        await assertChipFits(chip(page, today, seeded.short), `es/${vp.name}/short`);
        await assertLaneGroup(page, today, [seeded.single, seeded.short], `es/${vp.name}/1-lane`);
        await assertLaneGroup(page, today, seeded.pair, `es/${vp.name}/2-lane`);
        await assertLaneGroup(page, today, seeded.triple, `es/${vp.name}/3-lane`);
        await shotChip(single, `chip-${vp.name}-es-single`);
        await shot(page, today, `week-${vp.name}-es`);
      } finally {
        for (const id of seeded.ids) await deleteEventById(session, circleId, id);
      }
    });
  }
});
