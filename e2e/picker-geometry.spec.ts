import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * THE ONE PICKER SPEC THAT MEASURES REAL PIXELS.
 *
 * `centerInColumn` (`src/components/ui/pickerPopover.tsx`) is the only part of
 * this widget whose correctness is a LAYOUT fact, and jsdom has no layout:
 * `offsetTop` is 0 for every element, `scrollTop` writes are ignored, and
 * `clientHeight`/`scrollHeight` are 0. The ~99 vitest specs around the pickers
 * therefore assert against a hand-built stub of exactly those numbers — and a
 * stub that returns `index * ROW_HEIGHT` for `offsetTop` is a stub that returns
 * THE ANSWER THE CODE IS SUPPOSED TO COMPUTE. That is why they all stayed green
 * while `offsetTop` was being measured against the panel instead of the
 * scrolling column, leaving every centred selection ~30px (time) / ~52px (date)
 * too far down the list.
 *
 * So this runs in Chromium, against the app's real stylesheet, and asserts the
 * selected row's real `getBoundingClientRect()` against its scroller's. Nothing
 * here is stubbed. A jsdom copy of this file would pass against the bug and is
 * worth nothing.
 *
 * TWO PROJECTS, TWO PRESENTATIONS, ONE FILE. `picker-geometry` is Desktop
 * Chrome, i.e. a FINE pointer, which is the only pointer class that gets the
 * anchored panel these first describes measure. `picker-geometry-sheet` is a
 * Pixel 5, where the same widget presents as a bottom SHEET whose geometry is a
 * different set of claims entirely — and one that no mouse-pointer project can
 * observe. The two halves skip each other on `isMobile`, the same fixture
 * `coarse-pointer.spec.ts` switches on, so a future touch project inherits the
 * right half by being a touch project.
 *
 * BACKEND-FREE, like the `a11y-*` projects: it drives `e2e/harness/`, a page
 * that mounts ONE field and nothing else, so there is no session, no API call
 * and no isolated account (see `PROJECTS_NEEDING_ISOLATION`). `locale` and
 * `timezoneId` are pinned because `useHourCycle` falls back to the browser
 * locale while signed out — en-US is the 12-hour cycle the hour expectations
 * below are written against.
 */

test.use({ locale: 'en-US', timezoneId: 'America/Denver' });

const HARNESS = '/e2e/harness/picker-geometry.html';

/** The calendar's `sticky top-0` weekday row. A day under it is not visible. */
const WEEKDAY_ROW_HEIGHT = 22;

/**
 * WCAG 2.2 §2.5.8 Target Size (Minimum), AA: 24x24 CSS px. Asserted in REAL
 * pixels for the same reason the centring is — jsdom reports every rect as
 * zero, so a unit test can only ever re-read the class string back to itself
 * and would stay green while the rendered row collapsed.
 *
 * This defends `ROW_HEIGHT` and its hand-copied `min-h-[36px]` twin, which
 * Tailwind forces to be written out separately and which therefore drift
 * silently. Shrink either one — or let a padding change eat the difference —
 * and 60 minute rows become a target a shaky finger cannot land on, with no
 * other test in the suite noticing: the centring specs above measure each row
 * against its own column, so they are scale-invariant and pass just as happily
 * at 20px as at 36px.
 */
const MIN_TARGET_PX = 24;

/**
 * `TimePickerPanel`'s `ROW_HEIGHT`, restated. Asserting the WCAG floor ALONE is
 * not enough to hold this: `text-md` at the 1.5 leading `globals.css` sets has a
 * natural line box of ~23.7px, so a row with its `min-h` removed entirely still
 * lands within a third of a pixel of 24 and would pass the floor by accident.
 * Pinning the designed height is what makes the check fail loudly instead of by
 * a rounding margin — and 36 is a number with a reason (half again over the
 * minimum, and above the ~32 where a row stops reading as a row), so a change to
 * it is a decision, not a tidy-up.
 *
 * THE NUMBER LIVES IN FIVE PLACES, not the two an earlier version of this
 * comment named: `TimePickerPanel.tsx`'s `ROW_HEIGHT` constant, the
 * `min-h-[36px]` class beside it that Tailwind forces to be hand-copied,
 * `pickerPopover.test.tsx`'s `ROW` (every stubbed jsdom measurement is built
 * from it), `pickerPopover.tsx`'s `MAX_PANEL_HEIGHT = 288` (seven rows plus the
 * panel chrome), and this constant. Change one and change all five —
 * `src/__tests__/bans/pickerRowHeight.test.ts` is the source scan that now makes
 * that mandatory, and it exists because this spec CANNOT enforce it: rendered
 * pixels come only from the class, so editing `ROW_HEIGHT` alone leaves this
 * file green while the popover's squeeze floor silently drops 72 → 56.
 */
const DESIGNED_ROW_PX = 36;

/**
 * `TimePickerPanel`'s `TOUCH_ROW_HEIGHT`, restated — the same number in the
 * sheet presentation, where the pointer is a finger.
 *
 * The WCAG floor alone is even less use here than it is above: 44 clears 24 by
 * nearly double, so a row that silently reverted to the 36px desktop size would
 * sail past `MIN_TARGET_PX` while handing touch users a target this change
 * exists to enlarge. Pinning the designed height is the only way that reads as
 * a failure. Counted as one of the eight copies by
 * `src/__tests__/bans/pickerRowHeight.test.ts`.
 */
const DESIGNED_TOUCH_ROW_PX = 44;

/**
 * `pickerPopover`'s sheet `px-4`, restated — the side gutter that made the sheet
 * a placed surface instead of one that had overflowed.
 *
 * The sheet wore the anchored panel's `p-1` for the whole of its first life,
 * and 4px is the right number for exactly one of those boxes: anchored it holds
 * a bordered 328px card off its own content, and on a full-bleed surface it put
 * the weekday header and the month grid ~4px from the glass on both sides.
 *
 * RESTATED, with the drift that implies, and deliberately: the alternative is
 * to compute the expected gap from the class, which is reading the
 * implementation back to itself. 16 is the house's mobile margin (`Sheet`'s own
 * rows are `px-4 py-3`) and a change to it is a design decision, so it should
 * fail here and be re-typed.
 */
const SHEET_GUTTER_PX = 16;

/**
 * Wait until nothing on the page is still animating.
 *
 * THE PANEL OPENS AT 98% OF ITS SIZE. `pickerPopover.tsx` enters with
 * `animate-[modal-in_200ms_var(--ease-spring)]`, and `modal-in` runs
 * `transform: translateY(8px) scale(0.98)` → `scale(1)`. `getBoundingClientRect`
 * reports the TRANSFORMED box, so every measurement below is multiplied by
 * whatever the spring is part-way through — a 36px row measures 35.49 and the
 * sub-pixel tolerances this file is built on evaporate. `toBeVisible()` is not
 * enough: an element is visible on its first painted frame, which is the frame
 * the animation has barely started.
 *
 * That is not hypothetical — it is the flake this helper was written for: the
 * WCAG row-height case failed once at 35.4918 (i.e. 36 × 0.9859) and passed on
 * retry, which under this config reports as FLAKY rather than failed and would
 * have been read as noise. Awaiting the animations makes the measurement
 * deterministic instead of a race against a 200ms spring, WITHOUT loosening a
 * single tolerance — the numbers stay pinned where the design put them.
 *
 * `.catch()` per animation because an animation that is cancelled (a panel that
 * closes and reopens) rejects `finished`, and a cancelled animation is exactly
 * as settled as a completed one for our purposes.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/** The shortest row in `list`, measured — not the class it was asked for. */
async function shortestRow(list: Locator): Promise<number> {
  return list.evaluate((scroller: HTMLElement) => {
    const rows = Array.from(scroller.querySelectorAll('[role="option"],[role="gridcell"]'));
    if (rows.length === 0) return 0;
    return Math.min(...rows.map((row) => row.getBoundingClientRect().height));
  });
}

/**
 * The smallest target box in `container`, on BOTH axes, plus how many were
 * measured.
 *
 * Two axes because the calendar's day cells are the one target here whose WIDTH
 * is a layout result rather than a class: the grid is seven `flex-1` columns of
 * whatever the panel got clamped to, so the cells narrow with the viewport while
 * their height stays put. `shortestRow` above measures height only, which is the
 * right answer for the time columns (fixed-width, `min-h` driven) and the wrong
 * one here.
 *
 * `count` is the anti-vacuity half: `Math.min()` over an empty list is
 * `Infinity`, so a container that rendered no cells at all would sail past every
 * `toBeGreaterThanOrEqual` below by having nothing to fail them.
 */
async function smallestTarget(
  container: Locator
): Promise<{ width: number; height: number; count: number }> {
  return container.evaluate((root: HTMLElement) => {
    const cells = Array.from(root.querySelectorAll('[role="option"],[role="gridcell"]')).map((c) =>
      c.getBoundingClientRect()
    );
    return {
      width: Math.min(...cells.map((r) => r.width)),
      height: Math.min(...cells.map((r) => r.height)),
      count: cells.length,
    };
  });
}

interface Geometry {
  /** (selected row's centre) − (scroller's centre). 0 is dead centre. */
  centreOffset: number;
  /** The row's top edge, relative to the scroller's top edge. */
  topOffset: number;
  /** The scroller's bottom edge, relative to the row's bottom edge. */
  bottomOffset: number;
  scrollTop: number;
  /** The largest `scrollTop` this scroller can hold. */
  maxScroll: number;
  clientHeight: number;
  rowHeight: number;
}

/** Measure `row` against the scrolling column or grid it lives in. */
async function measure(row: Locator): Promise<Geometry> {
  return row.evaluate((option: HTMLElement): Geometry => {
    const list = option.closest('[role="listbox"],[role="grid"]') as HTMLElement;
    const listRect = list.getBoundingClientRect();
    const rowRect = option.getBoundingClientRect();
    return {
      centreOffset: rowRect.top + rowRect.height / 2 - (listRect.top + listRect.height / 2),
      topOffset: rowRect.top - listRect.top,
      bottomOffset: listRect.bottom - rowRect.bottom,
      scrollTop: list.scrollTop,
      maxScroll: list.scrollHeight - list.clientHeight,
      clientHeight: list.clientHeight,
      rowHeight: rowRect.height,
    };
  });
}

test.describe('picker opens centred on its value (real geometry)', () => {
  // ANCHORED ONLY. Every number below — `top=24` deciding the clamp, the flip,
  // the day cell's width as a fraction of a 328px panel — is a property of a
  // panel hung off a field, which is what a FINE pointer gets. The sheet's
  // equivalents are at the bottom of this file.
  test.skip(({ isMobile }) => Boolean(isMobile), 'Anchored presentation only.');

  test('centres a mid-list minute in its own column, not 30px above it', async ({ page }) => {
    await page.goto(`${HARNESS}?field=time&time=20:30&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).click();
    await expect(page.getByRole('dialog', { name: 'Time picker' })).toBeVisible();
    await settle(page);

    const minutes = page.getByRole('listbox', { name: 'Minute' });
    const geo = await measure(minutes.getByRole('option', { name: '30', exact: true }));

    // The column really is scrolling — otherwise "centred" is free.
    expect(geo.maxScroll).toBeGreaterThan(0);
    // …and the clamp is not what put it there, so this is the centring case.
    expect(geo.scrollTop).toBeGreaterThan(0);
    expect(geo.scrollTop).toBeLessThan(geo.maxScroll);
    expect(Math.abs(geo.centreOffset)).toBeLessThanOrEqual(1.5);
  });

  test('pins minute 00 to the top of the column with the row visible', async ({ page }) => {
    await page.goto(`${HARNESS}?field=time&time=20:00&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).click();
    await expect(page.getByRole('dialog', { name: 'Time picker' })).toBeVisible();
    await settle(page);

    const minutes = page.getByRole('listbox', { name: 'Minute' });
    const geo = await measure(minutes.getByRole('option', { name: '00', exact: true }));

    // Cannot be centred (the ideal offset is negative), so it clamps — and the
    // row it clamped for is the one still on screen.
    expect(geo.scrollTop).toBe(0);
    expect(geo.topOffset).toBeGreaterThanOrEqual(-0.5);
    expect(geo.bottomOffset).toBeGreaterThanOrEqual(-0.5);
  });

  test('pins hour 12 to the top of the 12-hour column with the row visible', async ({ page }) => {
    await page.goto(`${HARNESS}?field=time&time=12:30&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).click();
    await expect(page.getByRole('dialog', { name: 'Time picker' })).toBeVisible();
    await settle(page);

    const hours = page.getByRole('listbox', { name: 'Hour' });
    const geo = await measure(hours.getByRole('option', { name: '12', exact: true }));

    expect(geo.scrollTop).toBe(0);
    expect(geo.topOffset).toBeGreaterThanOrEqual(-0.5);
    expect(geo.bottomOffset).toBeGreaterThanOrEqual(-0.5);
  });

  test('pins minute 59 to the bottom of the column with the row visible', async ({ page }) => {
    await page.goto(`${HARNESS}?field=time&time=20:59&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).click();
    await expect(page.getByRole('dialog', { name: 'Time picker' })).toBeVisible();
    await settle(page);

    const minutes = page.getByRole('listbox', { name: 'Minute' });
    const geo = await measure(minutes.getByRole('option', { name: '59', exact: true }));

    expect(geo.maxScroll).toBeGreaterThan(0);
    expect(geo.scrollTop).toBe(geo.maxScroll);
    expect(geo.topOffset).toBeGreaterThanOrEqual(-0.5);
    expect(geo.bottomOffset).toBeGreaterThanOrEqual(-0.5);
  });

  test('keeps every time row at or above the 24px WCAG 2.5.8 target minimum', async ({ page }) => {
    await page.goto(`${HARNESS}?field=time&time=20:30&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).click();
    await expect(page.getByRole('dialog', { name: 'Time picker' })).toBeVisible();
    await settle(page);

    for (const column of ['Hour', 'Minute']) {
      const list = page.getByRole('listbox', { name: column });
      // Non-zero first: a column that rendered nothing would otherwise satisfy
      // a bare `toBeGreaterThanOrEqual` by having no rows to fail it.
      await expect(list.getByRole('option').first()).toBeVisible();
      const shortest = await shortestRow(list);
      expect(shortest, `${column} column vs WCAG 2.5.8`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      // Sub-pixel slack only — the browser rounds, the design does not.
      expect(shortest, `${column} column vs ROW_HEIGHT`).toBeGreaterThanOrEqual(
        DESIGNED_ROW_PX - 0.5
      );
    }
  });

  test('centres a week-4 day in a capped calendar grid', async ({ page }) => {
    // Short enough that the panel is clamped to the room below the field, so
    // the grid genuinely scrolls — the geometry where the bug pinned the grid
    // to its bottom and jammed the focused day under the sticky weekday row.
    await page.setViewportSize({ width: 1280, height: 360 });
    await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
    await page.getByRole('button', { name: 'Choose a date' }).click();
    await expect(page.getByRole('dialog', { name: 'Date picker' })).toBeVisible();
    await settle(page);

    const geo = await measure(page.locator('[data-day="2026-09-24"]'));

    expect(geo.maxScroll).toBeGreaterThan(0);
    expect(geo.scrollTop).toBeGreaterThan(0);
    expect(geo.scrollTop).toBeLessThan(geo.maxScroll);
    expect(Math.abs(geo.centreOffset)).toBeLessThanOrEqual(1.5);
    // Not behind the `sticky top-0` weekday row, which paints over the grid's
    // first 22px and hides a day that has merely been scrolled "into view".
    expect(geo.topOffset).toBeGreaterThanOrEqual(WEEKDAY_ROW_HEIGHT);
  });

  /**
   * The calendar's day cells, held to the same WCAG 2.2 §2.5.8 floor as the time
   * rows above — which until now nothing measured, even though `shortestRow`
   * already knew how to find them and the date panel is loaded two tests up.
   *
   * A GUARD, NOT A BUG HUNT: today these measure 43.7 × 44 at 390px and
   * 40.3 × 44 at 320px, so they clear 24 on both axes with room to spare. What
   * makes the guard worth its runtime is that the WIDTH is not a class anywhere
   * — it is seven `flex-1` columns dividing whatever width the panel was clamped
   * to, so it moves whenever the panel's `min-w`, its `p-1`, the scrollbar lane
   * or the phone breakpoint moves. Nothing else in the suite would notice a
   * change that took a day cell under 24px wide: the centring specs measure each
   * cell against its own grid, so they are scale-invariant and pass just as
   * happily at 12px.
   *
   * Both ends of the phone range, because narrower is where it would break and
   * 320px is the narrowest viewport the app claims to support.
   */
  for (const width of [390, 320]) {
    test(`keeps every day cell at or above the 24px WCAG 2.5.8 minimum at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
      await page.getByRole('button', { name: 'Choose a date' }).click();
      await expect(page.getByRole('dialog', { name: 'Date picker' })).toBeVisible();
      await settle(page);

      const grid = page.getByRole('grid');
      await expect(grid.getByRole('gridcell').first()).toBeVisible();
      const smallest = await smallestTarget(grid);

      // The grid draws whole weeks, so it is 35 or 42 cells (42 for this month,
      // counting the leading/trailing `outside` days) — never fewer than 28.
      // Fewer means it did not render, and the minima below would then be
      // measuring nothing at all (see `smallestTarget`).
      expect(smallest.count, `day cells rendered at ${width}px`).toBeGreaterThanOrEqual(28);
      expect(smallest.width, `narrowest day cell at ${width}px`).toBeGreaterThanOrEqual(
        MIN_TARGET_PX
      );
      expect(smallest.height, `shortest day cell at ${width}px`).toBeGreaterThanOrEqual(
        MIN_TARGET_PX
      );
    });
  }
});

/**
 * `Checkbox` IS A `<label htmlFor>` POINTING AT A `<button role="checkbox">`.
 *
 * That is legal — HTML's labelable-element rules cover it and the label's
 * activation behaviour forwards a click to its labelled control — but it is
 * ENGINE behaviour, and the only place it was asserted was jsdom, whose click
 * delegation is its own reimplementation of those rules rather than Chromium's.
 * A jsdom pass is therefore evidence about jsdom. Hitting the WORDS is how most
 * people tick a checkbox (the box itself is 24px of visible target inside a 44px
 * button; the label is the rest of the row), so "the label does nothing" would
 * be a quiet, total loss of the affordance that the whole unit suite would call
 * green.
 *
 * Lives in this project because it needs the same thing the pickers do and
 * nothing more: the real component, the real stylesheet, a real browser, and no
 * backend at all.
 */
test.describe('Checkbox label forwarding (real browser)', () => {
  // One engine is enough for an engine behaviour; this rides along in the
  // desktop project and does not need running twice.
  test.skip(({ isMobile }) => Boolean(isMobile), 'Desktop project only.');

  test('clicking the label text toggles the checkbox, and toggles it back', async ({ page }) => {
    await page.goto(`${HARNESS}?field=checkbox`);

    const box = page.getByRole('checkbox', { name: 'Remind the circle' });
    await expect(box).toHaveAttribute('aria-checked', 'false');

    // Found by its OWN id, not by `label[for=…]` and not by the accessible name.
    // `getByLabel`/`getByRole` would resolve back to the BUTTON and click the
    // thing already known to work; `label[for="notify"]` would make a dropped
    // `htmlFor` fail as "element not found", which reports the attribute rather
    // than the behaviour. Addressing the element independently of the wiring is
    // what makes the failure read "clicking the label did not toggle it".
    const label = page.locator('label#notify-label');
    await expect(label).toBeVisible();
    // Non-overlapping: if the label's box sat on top of the button, a click
    // "on the label" would be a click on the button and prove nothing.
    const [labelBox, buttonBox] = await Promise.all([label.boundingBox(), box.boundingBox()]);
    expect(labelBox!.x, 'label starts right of the button').toBeGreaterThanOrEqual(
      buttonBox!.x + buttonBox!.width
    );

    await label.click();
    await expect(box).toHaveAttribute('aria-checked', 'true');

    // Back off again — a label wired to `onChange(true)` rather than
    // `onChange(!checked)` would pass a one-way check forever.
    await label.click();
    await expect(box).toHaveAttribute('aria-checked', 'false');
  });
});

/**
 * ── THE SHEET'S GEOMETRY, WHICH IS A DIFFERENT SET OF CLAIMS ───────────────
 *
 * Runs only under `picker-geometry-sheet` (Pixel 5). These pin the three
 * defects that had to be answered before the picker could be shown on touch at
 * all — the first was `readOnly` and lives in `coarse-pointer.spec.ts`; the
 * other two are measurements, and they are these:
 *
 *   - OCCLUSION. The anchored panel covered 65% of the Add Medication modal at
 *     390x664 and INTERCEPTED taps meant for Close, the event type, the name
 *     and the dosage — Playwright refused one outright ("gridcell … intercepts
 *     pointer events"). The sheet covers things too, deliberately: it is modal.
 *     The difference is that what is over them is a SCRIM whose only behaviour
 *     is to dismiss, which is what `elementFromPoint` below reads back.
 *   - HEIGHT. At 390x360 (the keyboard up) the anchored calendar clamped to
 *     176px and showed about 1.5 of 6 week rows. And at 320px the 304px panel
 *     was WIDER than the modal card it sat in and broke out past its edges.
 *
 * Everything here is a real `getBoundingClientRect` for the reason the top of
 * this file gives at length: jsdom reports every box as zero, so a jsdom copy
 * of any of it would pass against the bug.
 */
test.describe('picker sheet geometry (real pixels, touch pointer)', () => {
  test.skip(({ isMobile }) => !isMobile, 'Sheet presentation only.');

  /** The sheet panel and the viewport it must live inside. */
  async function sheetBox(
    page: Page
  ): Promise<{ x: number; y: number; width: number; height: number; vw: number; vh: number }> {
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await settle(page);
    const [box, viewport] = await Promise.all([
      panel.boundingBox(),
      page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight })),
    ]);
    return { ...box!, ...viewport };
  }

  test('every time row is at least the 44px touch target, not the 36px mouse one', async ({
    page,
  }) => {
    await page.goto(`${HARNESS}?field=time&time=20:30&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).tap();
    await expect(page.getByRole('dialog', { name: 'Time picker' })).toBeVisible();
    await settle(page);

    for (const column of ['Hour', 'Minute']) {
      const list = page.getByRole('listbox', { name: column });
      // Non-zero first: a column that rendered nothing would satisfy a bare
      // `toBeGreaterThanOrEqual` by having no rows to fail it.
      await expect(list.getByRole('option').first()).toBeVisible();
      const shortest = await shortestRow(list);
      expect(shortest, `${column} column vs WCAG 2.5.8`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      // Sub-pixel slack only — the browser rounds, the design does not.
      expect(shortest, `${column} column vs TOUCH_ROW_HEIGHT`).toBeGreaterThanOrEqual(
        DESIGNED_TOUCH_ROW_PX - 0.5
      );
    }
  });

  test('sits flush on the viewport floor across the full width', async ({ page }) => {
    await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
    await page.getByRole('button', { name: 'Choose a date' }).tap();

    const box = await sheetBox(page);
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeCloseTo(box.vw, 0);
    expect(box.y + box.height).toBeCloseTo(box.vh, 0);
  });

  test('leaves a strip of scrim rather than taking the whole screen', async ({ page }) => {
    await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
    await page.getByRole('button', { name: 'Choose a date' }).tap();

    const box = await sheetBox(page);
    // `SHEET_VIEWPORT_FRACTION` is 0.85, and the 15% it leaves is not
    // decoration: it is the visible evidence that there is a page behind this
    // and that tapping it comes back. A sheet at full height is a route.
    expect(box.height).toBeLessThanOrEqual(box.vh * 0.85 + 1);
    expect(box.y).toBeGreaterThan(0);
  });

  /**
   * THE OCCLUSION DEFECT, STATED POSITIVELY.
   *
   * The anchored panel put a `gridcell` over the controls behind it, so a tap
   * aimed at Close committed a date. The sheet puts a scrim there instead —
   * the tap still does not reach Close, but what it does reach dismisses the
   * picker rather than silently editing the form.
   */
  test('covers the field with a scrim, not with a day cell', async ({ page }) => {
    await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
    const input = page.getByLabel('Date', { exact: true });
    const field = await input.boundingBox();
    await page.getByRole('button', { name: 'Choose a date' }).tap();
    await expect(page.getByRole('dialog', { name: 'Date picker' })).toBeVisible();
    await settle(page);

    const onTop = await page.evaluate(
      ([x, y]: number[]) => {
        const el = document.elementFromPoint(x!, y!);
        return {
          scrim: el?.hasAttribute('data-picker-scrim') ?? false,
          role: el?.getAttribute('role') ?? null,
          tag: el?.tagName ?? null,
        };
      },
      [field!.x + field!.width / 2, field!.y + field!.height / 2]
    );

    expect(onTop.scrim, `what covers the field: ${onTop.tag}/${onTop.role}`).toBe(true);
    // Named explicitly, because it is the exact thing that used to be there.
    expect(onTop.role).not.toBe('gridcell');
  });

  /**
   * 390x360 IS THE KEYBOARD-UP CASE, and the number that used to be 1.5.
   *
   * The anchored calendar clamped to 176px in this viewport and showed about a
   * week and a half of six. A sheet is sized by the viewport rather than by the
   * gap under a field, so what it can show is a real fraction of the month.
   */
  test('shows most of the month at 390x360 with the keyboard up', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 360 });
    await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
    await page.getByRole('button', { name: 'Choose a date' }).tap();
    await expect(page.getByRole('dialog', { name: 'Date picker' })).toBeVisible();
    await settle(page);

    const grid = await page.getByRole('grid').evaluate((el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      // The `sticky top-0` weekday row paints over the grid's first 22px, so a
      // cell "scrolled into view" under it is not visible at all.
      const top = box.top + 22;
      const rows = new Set<number>();
      for (const cell of Array.from(el.querySelectorAll('[role="gridcell"]'))) {
        const r = cell.getBoundingClientRect();
        if (r.top >= top - 0.5 && r.bottom <= box.bottom + 0.5) rows.add(Math.round(r.top));
      }
      return { completeRows: rows.size, usableRows: (el.clientHeight - 22) / 44 };
    });

    // TWO NUMBERS, BECAUSE THEY ANSWER DIFFERENT THINGS.
    //
    // `usableRows` is the apples-to-apples one: the grid's own visible height
    // in 44px weeks, which is what "1.5 of 6" measured on the anchored panel
    // (69px of a 286px grid, in a panel clamped to 176px). The sheet measures
    // 200px here — 4.05 weeks — because its height comes from the viewport
    // (85% of 360 = 306) rather than from the gap under a field.
    //
    // `completeRows` is what a caregiver actually counts, and it is lower by
    // design: the grid opens CENTRED on the focused day, so the top row on
    // screen is usually part-scrolled. Three whole weeks plus two slivers,
    // against one and a half.
    //
    // Neither is six. 360px of viewport minus the sheet's chrome (month header,
    // weekday row, the Clear/Today row) genuinely cannot hold six 44px weeks,
    // and the grid scrolls for the rest — which is the right trade at a
    // viewport this short, and the reason the cells were NOT shrunk to fit.
    expect(grid.usableRows, 'week rows the grid can show at 390x360').toBeGreaterThanOrEqual(4);
    expect(grid.completeRows, 'complete week rows visible at 390x360').toBeGreaterThanOrEqual(3);
  });

  /**
   * THE DEFECT THIS PADDING EXISTS FOR, MEASURED — and the cost of fixing it,
   * measured in the same breath.
   *
   * The report was that the weekday header row and the month grid nearly touch
   * the left and right screen edges. Nothing in the suite could see that: every
   * sheet assertion above is about the PANEL (flush on the floor, full width,
   * under the 85% cap), and a panel that is exactly as wide as the viewport
   * satisfies all of them whether its contents clear the glass by 16px or by 4.
   *
   * AND THE TWO HALVES ARE ONE TEST ON PURPOSE. Side padding narrows the
   * content box, and the calendar's seven day columns are `flex-1` of whatever
   * is left — so the gutter is bought directly out of the cells' width, and
   * 320px is where that runs out first. Asserting the gutter alone invites a
   * later "make it roomier" that quietly takes a touch target under WCAG 2.2
   * §2.5.8's 24px; asserting the floor alone is what let the cramped version
   * ship. Measured here: 49.42px per cell at 390 and 39.42 at 320, against a
   * 24px floor — so the 16px gutter spends about a fifth of the margin it has.
   *
   * Both ends of the phone range for the reason the anchored pair gives: 320px
   * is the narrowest viewport the app claims to support, and narrower is where
   * it would break.
   */
  for (const width of [390, 320]) {
    test(`clears both screen edges by the sheet gutter at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
      await page.getByLabel('Date', { exact: true }).tap();
      await expect(page.getByRole('dialog', { name: 'Date picker' })).toBeVisible();
      await settle(page);

      const grid = page.getByRole('grid');
      await expect(grid.getByRole('gridcell').first()).toBeVisible();

      // Against the VIEWPORT, not against the panel: the panel is the full
      // width of the screen in this presentation (pinned two tests up), so the
      // glass is what the gap is actually to.
      const edges = await grid.evaluate((el: HTMLElement) => {
        const cells = Array.from(el.querySelectorAll('[role="gridcell"]'));
        const heads = Array.from(el.querySelectorAll('[role="columnheader"]'));
        const rects = [...cells, ...heads].map((c) => c.getBoundingClientRect());
        return {
          left: Math.min(...rects.map((r) => r.left)),
          right: window.innerWidth - Math.max(...rects.map((r) => r.right)),
          // Anti-vacuity, the same argument `smallestTarget` makes: `Math.min`
          // over an empty list is `Infinity` and would clear every floor below
          // by having nothing in it. 42 day cells + 7 weekday headers.
          count: rects.length,
        };
      });

      expect(edges.count, `grid boxes measured at ${width}px`).toBe(49);
      // Sub-pixel slack only — the browser rounds, the design does not.
      expect(edges.left, `gap to the left screen edge at ${width}px`).toBeGreaterThanOrEqual(
        SHEET_GUTTER_PX - 0.5
      );
      // The right-hand gap is the gutter PLUS `SCROLL_GUTTER`'s 12px lane, so
      // the floor is the same 16 and the measurement will read higher. Pinned
      // at the gutter rather than at 28 so the scrollbar lane stays free to
      // move without a second failure here describing the same box.
      expect(edges.right, `gap to the right screen edge at ${width}px`).toBeGreaterThanOrEqual(
        SHEET_GUTTER_PX - 0.5
      );

      // AND WHAT THE GUTTER COST. Same helper, same floor, same anti-vacuity
      // guard as the anchored pair — this is the axis the padding moves.
      const smallest = await smallestTarget(grid);
      expect(smallest.count, `day cells rendered at ${width}px`).toBeGreaterThanOrEqual(28);
      expect(smallest.width, `narrowest sheet day cell at ${width}px`).toBeGreaterThanOrEqual(
        MIN_TARGET_PX
      );
      expect(smallest.height, `shortest sheet day cell at ${width}px`).toBeGreaterThanOrEqual(
        MIN_TARGET_PX
      );
    });
  }

  /**
   * THE WHOLE MONTH, WHERE THE VIEWPORT HAS ROOM FOR IT — the other end of the
   * 390x360 case above, and the one that caught the sheet's padding.
   *
   * `GRID_ROWS` is pinned at six so the calendar's height never moves, and
   * `NATURAL_PANEL_HEIGHT` is the ceiling that stops the panel growing past
   * what those six rows need. Both are sums over the panel's chrome — and the
   * sheet's chrome changed when it stopped wearing the anchored panel's `p-1`.
   * Adding 12px of padding at each end without moving the ceiling left the
   * panel capped 8px short of its own content: the sixth week row went behind
   * a scrollbar on every phone, at a viewport with 300px to spare.
   *
   * That is a silent failure in every other test here. The panel still opened,
   * still measured 44px rows, still cleared the WCAG floor, still sat flush on
   * the viewport floor; the grid simply scrolled where it used to fit. Only
   * counting the rows catches it, and `scrollable` is asserted alongside the
   * count because a grid that scrolls is the mechanism — six rows reachable BY
   * SCROLLING is what the broken version already did.
   *
   * Not a duplicate of the 390x360 case: that one pins what survives when the
   * viewport cap bites, this one pins that the cap is the ONLY thing that ever
   * takes a row away.
   */
  test('shows all six week rows on a phone with the height for them', async ({ page }) => {
    await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
    await page.getByRole('button', { name: 'Choose a date' }).tap();
    await expect(page.getByRole('dialog', { name: 'Date picker' })).toBeVisible();
    await settle(page);

    const grid = await page.getByRole('grid').evaluate((el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      // The `sticky top-0` weekday row paints over the grid's first 22px, so a
      // cell "scrolled into view" under it is not visible at all.
      const top = box.top + 22;
      const rows = new Set<number>();
      for (const cell of Array.from(el.querySelectorAll('[role="gridcell"]'))) {
        const r = cell.getBoundingClientRect();
        if (r.top >= top - 0.5 && r.bottom <= box.bottom + 0.5) rows.add(Math.round(r.top));
      }
      return {
        completeRows: rows.size,
        cells: el.querySelectorAll('[role="gridcell"]').length,
        scrollable: el.scrollHeight - el.clientHeight,
      };
    });

    // Anti-vacuity: six whole weeks is 42 cells, and a grid that rendered none
    // would report zero rows visible and zero overflow — passing the scroll
    // assertion by having nothing to scroll.
    expect(grid.cells, 'day cells rendered').toBe(42);
    expect(grid.completeRows, 'complete week rows at the default phone viewport').toBe(6);
    // Sub-pixel slack only. `NATURAL_PANEL_HEIGHT` carries a few px of it
    // deliberately, so the grid should have NO overflow rather than a little.
    expect(grid.scrollable, 'grid overflow past its own box').toBeLessThanOrEqual(1);
  });

  /**
   * 320px IS THE NARROWEST VIEWPORT THIS APP CLAIMS TO SUPPORT, and where the
   * anchored panel's declared `w-[20.5rem]` (328px) broke out past the modal
   * card it sat in. A sheet has no declared width at all.
   */
  test('does not break out of a 320px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${HARNESS}?field=date&date=2026-09-24&top=8`);
    // Opened from the INPUT rather than the trailing button: at 320px the
    // harness column is the full viewport width, so the trailing 44px slot sits
    // hard against the right edge where a synthetic tap is awkward to land.
    // The input is the realistic touch gesture anyway — it is the one `readOnly`
    // exists to intercept.
    await page.getByLabel('Date', { exact: true }).tap();

    const box = await sheetBox(page);
    expect(box.width).toBeCloseTo(320, 0);
    expect(box.x).toBeCloseTo(0, 0);
    // And the document itself did not grow sideways to accommodate it, which is
    // the symptom a user actually sees: a page that scrolls horizontally.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow, 'horizontal document overflow').toBeLessThanOrEqual(0);

    // The cells still clear the WCAG floor at the narrowest width — seven
    // `flex-1` columns of 320px is where that would go first.
    const grid = page.getByRole('grid');
    await expect(grid.getByRole('gridcell').first()).toBeVisible();
    const smallest = await smallestTarget(grid);
    expect(smallest.count, 'day cells rendered at 320px').toBeGreaterThanOrEqual(28);
    expect(smallest.width, 'narrowest day cell at 320px').toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(smallest.height, 'shortest day cell at 320px').toBeGreaterThanOrEqual(MIN_TARGET_PX);
  });

  /**
   * THE SHEET'S HEIGHT BUDGET, IN RENDERED PIXELS — both caps, each where it is
   * the one that binds.
   *
   * The time panel's natural height is sixty 44px minute rows, so something
   * always caps it, and which something is the whole claim: on a phone with
   * room it is `SHEET_MAX_PANEL_HEIGHT` (seven 44px rows plus the sheet's own
   * chrome, 359), NOT the anchored `MAX_PANEL_HEIGHT` (288, seven 36px rows) the
   * shell falls back to when the panel passes no ceiling; at 390x360 it is 85%
   * of the viewport (306), which is what leaves the strip of scrim above it.
   * The unit suite pins the same arithmetic against a stubbed natural height;
   * this is the box a finger actually gets.
   */
  test('caps the time sheet at seven touch rows, and at 85% of a short viewport', async ({
    page,
  }) => {
    await page.goto(`${HARNESS}?field=time&time=20:30&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).tap();
    const tall = await sheetBox(page);
    // 359 = `SHEET_MAX_PANEL_HEIGHT`, restated for the reason `SHEET_GUTTER_PX`
    // gives: a change to it is a design decision and should fail here.
    expect(tall.vh * 0.85, 'viewport cap must not be what binds here').toBeGreaterThan(359);
    expect(tall.height, 'sheet height on a phone with room').toBeCloseTo(359, 0);

    await page.setViewportSize({ width: 390, height: 360 });
    await page.goto(`${HARNESS}?field=time&time=20:30&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).tap();
    const short = await sheetBox(page);
    expect(short.vh).toBe(360);
    expect(short.height, 'sheet height at 390x360').toBeCloseTo(360 * 0.85, 0);
    expect(short.y, 'scrim strip left above the sheet').toBeGreaterThan(0);
  });

  /**
   * The open-scroll arithmetic is shared with the anchored panel and has to
   * keep working in a box the shell positions differently — `centerInColumn`
   * reads `clientHeight`, which is now a function of the sheet's cap rather
   * than of the room under a field.
   */
  test('still opens centred on its value in sheet mode', async ({ page }) => {
    await page.goto(`${HARNESS}?field=time&time=20:30&top=24`);
    await page.getByRole('button', { name: 'Choose a time' }).tap();
    await expect(page.getByRole('dialog', { name: 'Time picker' })).toBeVisible();
    await settle(page);

    const minutes = page.getByRole('listbox', { name: 'Minute' });
    const geo = await measure(minutes.getByRole('option', { name: '30', exact: true }));

    expect(geo.maxScroll).toBeGreaterThan(0);
    expect(geo.scrollTop).toBeGreaterThan(0);
    expect(geo.scrollTop).toBeLessThan(geo.maxScroll);
    expect(Math.abs(geo.centreOffset)).toBeLessThanOrEqual(1.5);
  });
});

