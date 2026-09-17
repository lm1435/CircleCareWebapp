import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

/**
 * THE TOUCH PRESENTATION, IN REAL ENGINES — and an honest account of what that
 * is worth.
 *
 * THIS FILE USED TO PIN A GATE, and the inversion below is the change. It
 * asserted that `DateField`/`TimeField` rendered no popover at all on a coarse
 * pointer and handed touch back to the browser's own picker. They no longer do:
 * the same custom picker now runs on every device, presented as a bottom SHEET
 * where the pointer is coarse. The gate's reasoning was never wrong, so the
 * three defects it existed to avoid are each answered rather than dropped:
 *
 *   1. Applying `PICKER_INDICATOR_HIDDEN` (`display: none` on
 *      `::-webkit-calendar-picker-indicator`) moves an `<input type="date">`'s
 *      intrinsic width in Chromium and does NOTHING in WebKit — WebKit never
 *      laid out an indicator to remove, and opens its date/time UI from the
 *      FOCUSED INPUT rather than from a button. ANSWERED by `readOnly` on the
 *      input, which is the only thing that closes that focus route. THE
 *      MEASUREMENT AT THE BOTTOM OF THIS FILE IS UNCHANGED AND NOW MATTERS
 *      MORE: it is the evidence that `readOnly` is not optional. Do not delete
 *      it as a test of a gate that no longer exists.
 *   2. The anchored panel covered 65% of the Add Medication modal at 390x664
 *      and intercepted taps on Close, event type, name and dosage. ANSWERED by
 *      the sheet, whose scrim makes those taps a dismissal; measured in
 *      `e2e/picker-geometry.spec.ts` under `picker-geometry-sheet`.
 *   3. A 36px row is a mouse target. ANSWERED by `TOUCH_ROW_HEIGHT` = 44.
 *
 * WHAT THIS PROVES. On two engines that really report `(pointer: coarse)`: the
 * trigger button IS rendered, a tap on the input opens our sheet, the lazy
 * panel chunk is fetched, the input is `readOnly` and still `type="date"` /
 * `type="time"` carrying its value, the suppression class is applied on touch
 * as well as on desktop, and the open sheet passes axe. Plus the measurement,
 * pinned per engine, so the day WebKit starts laying out an indicator this
 * suite says so.
 *
 * WHAT THIS DOES NOT PROVE — read this before quoting the file as iOS coverage.
 * Playwright's WebKit on macOS is not the engine build that ships in iOS
 * Safari, and it renders NO native date/time UI at all: there is no wheel here
 * to photograph, so "the iOS wheel does NOT appear when the user taps the
 * field" is not directly observable from this harness, in either direction. It
 * was not observable when this file asserted the opposite either. What is
 * tested is the STRUCTURAL half: the input is in the state — `readOnly` — for
 * which no engine opens a date/time UI, and our own picker is what the tap
 * reaches. The remaining half rests on a device check at release.
 * `devices['Pixel 5']` is the stronger leg: it is real Chromium, where the
 * native picker demonstrably exists and where `readOnly` + the suppression are
 * both observable.
 *
 * BACKEND-FREE, like `picker-geometry` and the `a11y-*` projects: it drives
 * `e2e/harness/`, with no session, no API call and no isolated account (see
 * `PROJECTS_NEEDING_ISOLATION`). `locale`/`timezoneId` are pinned for the same
 * reason the geometry spec pins them — signed out, `useHourCycle` falls back to
 * the browser locale.
 */

test.use({ locale: 'en-US', timezoneId: 'America/Denver' });

/** The same one-field page `picker-geometry.spec.ts` drives, mounted from source. */
const FIELD_HARNESS = '/e2e/harness/picker-geometry.html';

/** Four bare inputs; see `e2e/harness/pickerIndicatorHarness.ts`. */
const PROBE_HARNESS = '/e2e/harness/picker-indicator.html';

interface FieldCase {
  /** `field=` on the harness, and the name in the test title. */
  field: 'time' | 'date';
  query: string;
  type: string;
  value: string;
  /** The popover trigger's accessible name. Present on BOTH pointer classes now. */
  trigger: string;
  dialog: string;
  /** The field's visible label, i.e. how the native input is addressed. */
  label: 'Time' | 'Date';
}

const CASES: readonly FieldCase[] = [
  {
    field: 'time',
    query: 'field=time&time=20:30&top=24',
    type: 'time',
    value: '20:30',
    trigger: 'Choose a time',
    dialog: 'Time picker',
    label: 'Time',
  },
  {
    field: 'date',
    query: 'field=date&date=2026-09-24&top=24',
    type: 'date',
    value: '2026-09-24',
    trigger: 'Choose a date',
    dialog: 'Date picker',
    label: 'Date',
  },
];

/**
 * Every request that names a picker panel chunk.
 *
 * Both panels are behind `React.lazy`. This list used to prove the chunk was
 * NEVER fetched on touch — the load-bearing half of "the popover does not exist
 * here", since a field that rendered no trigger but still imported the panel
 * would have meant the gate was cosmetic. It now proves the opposite for the
 * same reason: a sheet that is named in the DOM but whose panel module was
 * never requested is not a picker anyone can use. The pattern matches BOTH
 * shapes the chunk can take — `/src/components/ui/TimePickerPanel.tsx` from the
 * dev server this suite runs against, and `assets/TimePickerPanel-<hash>.js`
 * from a production build — so this keeps working if the target ever moves.
 *
 * Must be attached BEFORE `goto`, or the first navigation's requests are lost.
 */
function watchPanelChunks(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (/(Time|Date)PickerPanel/.test(request.url())) seen.push(request.url());
  });
  return seen;
}

/**
 * What the ENGINE says about the primary pointer, not what the device
 * descriptor claims.
 *
 * Asserted at the top of every case as an anti-vacuity guard: every touch
 * expectation below is of the form "this control is absent", and absent is also
 * what a harness that failed to load looks like. If a future Playwright stops
 * emulating a coarse pointer for these descriptors, this is the assertion that
 * fails — loudly, naming the reason — instead of the whole file passing while
 * testing a desktop browser.
 *
 * The two clauses are `COARSE_POINTER_QUERY`'s, restated (a spec cannot import
 * from `src/` without pulling React into the runner): `(pointer: coarse)` is
 * the decisive one, `(hover: none)` is the Android/stylus catch.
 */
async function pointerReport(page: Page): Promise<{ coarse: boolean; hoverNone: boolean }> {
  return page.evaluate(() => ({
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hoverNone: window.matchMedia('(hover: none)').matches,
  }));
}

/**
 * The field's native control — still `type="date"` / `type="time"`, still the
 * thing the form reads, and on touch the thing a caregiver taps. It is
 * `readOnly` there, which is what makes that tap ours rather than the OS's.
 */
function nativeInput(page: Page, label: 'Time' | 'Date'): Locator {
  return page.getByLabel(label, { exact: true });
}

// ===========================================================================
// TOUCH — devices['iPhone 13'] (WebKit) and devices['Pixel 5'] (Chromium)
// ===========================================================================

/**
 * Wait until nothing on the page is still animating.
 *
 * THE SHEET ENTERS FROM BELOW THE FLOOR. `sheet-in` runs
 * `transform: translateY(100%)` -> `0`, and `getBoundingClientRect` reports the
 * TRANSFORMED box — so a sheet measured on its first painted frame is ~98px
 * under the viewport's bottom edge and every "flush with the floor" assertion
 * fails by most of its own height. `toBeVisible()` does not help: an element is
 * visible on the frame the animation has barely started. Same helper, same
 * reasoning and the same flake as `picker-geometry.spec.ts`'s `settle` — which
 * caught it there as a 35.49px row that should have been 36.
 *
 * `.catch()` per animation because a cancelled animation (a sheet that closes
 * and reopens) rejects `finished`, and cancelled is as settled as completed.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/**
 * Axe, pointed AT THE SHEET rather than at the page.
 *
 * `.include` on the dialog and the scrim, not a whole-page scan like
 * `helpers.ts`'s `checkA11y`: this harness is one field on a blank page with no
 * `<h1>` and no landmarks, so a page-level best-practice scan would fail on the
 * HARNESS and say nothing about the widget. Narrowing the subject is what makes
 * a violation here mean "the sheet is wrong".
 *
 * `best-practice` is dropped with the page for the same reason; the WCAG 2.0 /
 * 2.1 A and AA tags are kept, which is the bar the rest of this app is held to
 * (`FAIL_IMPACTS` in `helpers.ts` — moderate and above).
 *
 * The animations are awaited first: the sheet enters with `sheet-in`, and
 * mid-animation opacity blends a token's true colour against whatever is behind
 * it, which axe reads as a contrast violation that does not exist once it
 * settles. Exactly the flake `picker-geometry.spec.ts` documents at `settle`.
 */
async function expectSheetPassesAxe(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  await settle(page);

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  if (results.violations.length > 0) {
    await testInfo.attach(`axe-${name}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });
  }
  const failing = results.violations.filter((v) =>
    ['moderate', 'serious', 'critical'].includes(v.impact ?? '')
  );
  expect(
    failing,
    `a11y violations in ${name}:\n${failing.map((v) => `  [${v.impact}] ${v.id}: ${v.help}`).join('\n')}`
  ).toEqual([]);
}

test.describe('coarse pointer: our sheet is the picker', () => {
  // `isMobile` rather than a project-name check: it is the fixture the device
  // descriptors actually set, so a future touch project inherits this block by
  // being a touch project, and the desktop control skips it by not being one.
  test.skip(({ isMobile }) => !isMobile, 'Touch projects only — the desktop control is below.');

  for (const c of CASES) {
    test(`${c.field}: renders the trigger button, and our popover behind it`, async ({ page }) => {
      await page.goto(`${FIELD_HARNESS}?${c.query}`);

      const pointer = await pointerReport(page);
      expect(pointer.coarse || pointer.hoverNone).toBe(true);

      await expect(nativeInput(page, c.label)).toBeVisible();

      // INVERTED. This used to be `toHaveCount(0)` — the trigger was the
      // clearest symptom of the gate, since on touch the transparent native
      // indicator was the real button and a second named control would have
      // been read out twice by a screen reader. That indicator is suppressed on
      // every pointer class now, so this is the only named way in.
      await expect(page.getByRole('button', { name: c.trigger })).toHaveCount(1);
      await page.getByRole('button', { name: c.trigger }).tap();
      await expect(page.getByRole('dialog', { name: c.dialog })).toBeVisible();
    });

    test(`${c.field}: opens from a tap on the input the OS used to claim`, async ({ page }) => {
      const chunks = watchPanelChunks(page);
      await page.goto(`${FIELD_HARNESS}?${c.query}`);

      const input = nativeInput(page, c.label);
      await expect(input).toBeVisible();

      // A finger on the text — the gesture that summons the OS wheel from a
      // focused, EDITABLE `<input type="time">`, and the whole reason the input
      // is `readOnly` here. Our sheet is what it reaches instead.
      await input.tap();
      await expect(page.getByRole('dialog', { name: c.dialog })).toBeVisible();

      // INVERTED: the lazy chunk used to be asserted NEVER fetched, as the
      // load-bearing proof that the gate was structural rather than cosmetic.
      // The same list now proves the opposite thing — that the popover really
      // is mounted here and not merely named in the DOM.
      expect(chunks.length).toBeGreaterThan(0);
    });

    test(`${c.field}: opens from Alt+ArrowDown for a keyboard on a coarse device`, async ({
      page,
    }) => {
      await page.goto(`${FIELD_HARNESS}?${c.query}`);
      const input = nativeInput(page, c.label);
      await input.focus();

      // INVERTED, and this is the iPad-with-a-keyboard case specifically: that
      // device reports COARSE, so the field is `readOnly` and the user cannot
      // type a date. The keyboard route into the picker used to be left to the
      // browser here; it is intercepted on every pointer class now, so the
      // sheet is reachable without a finger.
      await input.press('Alt+ArrowDown');
      await expect(page.getByRole('dialog', { name: c.dialog })).toBeVisible();
    });

    test(`${c.field}: keeps the native input's type and value, and makes it readOnly`, async ({
      page,
    }) => {
      await page.goto(`${FIELD_HARNESS}?${c.query}`);

      const input = nativeInput(page, c.label);
      // The type is the whole contract: it is what emits the `HH:MM` /
      // `YYYY-MM-DD` string the app is written against. A field that "solved"
      // the double-picker problem by becoming `type="text"` would satisfy the
      // readOnly assertion below and break every call site.
      await expect(input).toHaveAttribute('type', c.type);
      await expect(input).toHaveValue(c.value);
      // INVERTED: was `readOnly, false`. This single property is the answer to
      // the measured fact at the bottom of this file — WebKit opens its picker
      // from the focused input, and `display:none` on an indicator it never
      // drew cannot stop it. An input that cannot be edited summons nothing.
      await expect(input).toHaveJSProperty('readOnly', true);
      await expect(input).toHaveJSProperty('disabled', false);

      // Still focusable, so the keyboard route above and the field's own focus
      // restore on dismiss both still have somewhere to land.
      await input.focus();
      await expect(input).toBeFocused();
    });

    test(`${c.field}: applies the suppression on touch too`, async ({ page }) => {
      await page.goto(`${FIELD_HARNESS}?${c.query}`);

      const className = await nativeInput(page, c.label).getAttribute('class');
      // INVERTED. Touch used to get the transparent-but-present overlay,
      // because that was the browser's own hit target for the picker it owned.
      // Nothing should reach a native picker now, so both routes are closed
      // together and the class is the same on every pointer class.
      expect(className).toContain('[&::-webkit-calendar-picker-indicator]:hidden');
      expect(className).not.toContain('[&::-webkit-calendar-picker-indicator]:opacity-0');
      expect(className).not.toContain('[&::-webkit-calendar-picker-indicator]:absolute');
    });

    test(`${c.field}: presents as a modal sheet on the viewport floor`, async ({ page }) => {
      await page.goto(`${FIELD_HARNESS}?${c.query}`);
      await nativeInput(page, c.label).tap();

      const panel = page.getByRole('dialog', { name: c.dialog });
      await expect(panel).toBeVisible();
      // `aria-modal` is claimed only where it is TRUE — the scrim really does
      // make the form behind it unreachable.
      await expect(panel).toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('[data-picker-scrim]')).toHaveCount(1);
      await settle(page);

      // Geometry, at the level this file cares about: flush with three edges.
      // The height budget, the week-row count and the target sizes are
      // `picker-geometry.spec.ts`'s under `picker-geometry-sheet`.
      const [box, viewport] = await Promise.all([
        panel.boundingBox(),
        page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
      ]);
      expect(box).not.toBeNull();
      expect(box!.x).toBeLessThanOrEqual(1);
      expect(box!.width).toBeCloseTo(viewport.width, 0);
      expect(box!.y + box!.height).toBeCloseTo(viewport.height, 0);
    });

    test(`${c.field}: the open sheet passes axe`, async ({ page }, testInfo) => {
      await page.goto(`${FIELD_HARNESS}?${c.query}`);
      await nativeInput(page, c.label).tap();
      await expect(page.getByRole('dialog', { name: c.dialog })).toBeVisible();

      await expectSheetPassesAxe(page, `${c.field}-sheet`, testInfo);
    });
  }
});

// ===========================================================================
// FINE POINTER — the control. Same assertions, opposite answers.
// ===========================================================================

test.describe('fine pointer control: our popover is the picker', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'Desktop control only.');

  for (const c of CASES) {
    test(`${c.field}: trigger opens the popover and fetches the panel chunk`, async ({ page }) => {
      const chunks = watchPanelChunks(page);
      await page.goto(`${FIELD_HARNESS}?${c.query}`);

      const pointer = await pointerReport(page);
      // The control is only a control if it really is the other case.
      expect(pointer.coarse).toBe(false);
      expect(pointer.hoverNone).toBe(false);

      await page.getByRole('button', { name: c.trigger }).click();
      await expect(page.getByRole('dialog', { name: c.dialog })).toBeVisible();

      // The chunk is fetched exactly when the popover is opened. Both pointer
      // classes assert this now — it used to be the desktop half of a pair
      // whose touch half asserted an EMPTY list.
      expect(chunks.length).toBeGreaterThan(0);

      const className = await nativeInput(page, c.field === 'time' ? 'Time' : 'Date').getAttribute(
        'class'
      );
      expect(className).toContain('[&::-webkit-calendar-picker-indicator]:hidden');
      expect(className).not.toContain('[&::-webkit-calendar-picker-indicator]:opacity-0');
    });
  }
});

// ===========================================================================
// THE MEASUREMENT ITSELF — runs in every project, touch and desktop.
// ===========================================================================

interface ProbeWidths {
  bare: number;
  suppressed: number;
  /** How many `::-webkit-calendar-picker-indicator { display: none }` rules the engine parsed. */
  suppressionRules: number;
  /** The classes actually on each probe — the other half of the vacuity guard. */
  bareClass: string;
  suppressedClass: string;
  /** What the harness says it rendered, vs. what was found. */
  declared: string | null;
  found: number;
}

/**
 * Measure one input type's intrinsic width with and without the suppression.
 *
 * The class strings and the `suppressionRules` count are the anti-vacuity half,
 * and the reason this is one evaluate rather than two `boundingBox()` calls:
 * WebKit's expected answer is "no difference", which is ALSO what a page with no
 * stylesheet, or with the class on neither input, reports. So both are ruled
 * out by reading them back — the class is on the element, the rule is in the
 * parsed CSSOM, and the width still does not move. That is a layout fact about
 * WebKit rather than a broken harness quietly agreeing with us.
 */
async function probeWidths(page: Page, type: 'date' | 'time'): Promise<ProbeWidths> {
  return page.evaluate((kind: string) => {
    const width = (id: string): number => {
      const el = document.querySelector(`[data-probe="${id}"]`);
      return el ? el.getBoundingClientRect().width : 0;
    };
    let suppressionRules = 0;
    const walk = (rules: CSSRule[]): void => {
      for (const rule of rules) {
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested) walk(Array.from(nested));
        const selector = (rule as CSSStyleRule).selectorText;
        if (
          selector &&
          selector.includes('-webkit-calendar-picker-indicator') &&
          /display:\s*none/.test(rule.cssText)
        ) {
          suppressionRules += 1;
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(Array.from(sheet.cssRules));
      } catch {
        // A cross-origin sheet cannot be read; there are none here, and one
        // appearing is not a reason to fail the measurement.
      }
    }
    return {
      bare: width(`${kind}-bare`),
      suppressed: width(`${kind}-suppressed`),
      suppressionRules,
      bareClass: document.querySelector(`[data-probe="${kind}-bare"]`)?.className ?? '',
      suppressedClass:
        document.querySelector(`[data-probe="${kind}-suppressed"]`)?.className ?? '',
      declared: document.documentElement.getAttribute('data-probes-ready'),
      found: document.querySelectorAll('[data-probe]').length,
    };
  }, type);
}

test.describe('the measured fact the whole gate rests on', () => {
  for (const type of ['date', 'time'] as const) {
    test(`${type}: suppressing the indicator resizes the input in Chromium only`, async ({
      page,
      browserName,
    }) => {
      await page.goto(PROBE_HARNESS);
      await page.waitForSelector('[data-probes-ready]');
      // Webfonts change an input's intrinsic width, and a measurement taken
      // mid-swap is a measurement of the fallback face.
      // Returns nothing on purpose: `document.fonts.ready` resolves with the
      // FontFaceSet itself, and handing an unserializable object back across
      // the bridge is a needless way for a measurement to fail.
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const w = await probeWidths(page, type);

      // FAIL LOUDLY, NOT SILENTLY. Every assertion below is a comparison
      // between two numbers, and 0 === 0 is a passing comparison. A probe that
      // did not render, a stylesheet that did not load and a typo in an id all
      // land there, so each is ruled out by name first.
      expect(w.declared).toBe('4');
      expect(w.found).toBe(4);
      expect(w.bare).toBeGreaterThan(0);
      expect(w.suppressed).toBeGreaterThan(0);
      // The difference between the two probes is the class and nothing else:
      // present on one, absent on the other, and parsed by this engine.
      expect(w.suppressedClass).toContain('[&::-webkit-calendar-picker-indicator]:hidden');
      expect(w.bareClass).toBe('');
      expect(w.suppressionRules).toBeGreaterThan(0);

      // Keep the numbers in the report: the point of this test is the pair, and
      // a green tick that does not say what was measured is a weaker record
      // than the source comment it replaces.
      test.info().annotations.push({
        type: 'measured',
        description: `${browserName} ${type}: bare ${w.bare}px, suppressed ${w.suppressed}px`,
      });

      if (browserName === 'webkit') {
        // THE CLAIM. WebKit lays out no indicator, so removing one costs
        // nothing — which is why the popover must not replace a native picker
        // this class cannot actually suppress. Exact equality (to a rounding
        // margin): the two probes differ by one class and nothing else.
        expect(w.suppressed).toBeCloseTo(w.bare, 3);
        return;
      }

      // Chromium. The indicator is a real box in the input's intrinsic width,
      // so taking it out narrows the control — measured at 143 -> 123 (date)
      // and ~108 -> 77 (time) on this page's stylesheet, and 153 -> 133 /
      // ~118 -> 87 at the Pixel 5's mobile viewport, where the whole control
      // renders 10px wider. The recorded pair in the source comments is
      // 148 -> 128, taken without this harness's font stack; the DELTA is the
      // invariant across all of them, so that is what is pinned — with a floor
      // (10px) well under any real indicator and well over rounding noise.
      expect(w.suppressed).toBeLessThan(w.bare);
      expect(w.bare - w.suppressed).toBeGreaterThan(10);
    });
  }
});
