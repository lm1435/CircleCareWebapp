import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// For its side effect only: the trigger buttons and the dialogs are found by
// their translated names, which are the raw keys until i18n has booted.
import '@/i18n';
import { DateField } from '../DateField';
import { Modal } from '../Modal';
import { TimeField } from '../TimeField';
import { MAX_PANEL_HEIGHT, SCROLL_GUTTER } from '../pickerPopover';

/**
 * THE SHELL BOTH PICKERS SHARE, tested through both of them.
 *
 * Everything here is `pickerPopover.tsx` behaviour — placement, the max-height
 * clamp, the scrollbar lane, the open-time scroll, outside-click focus — and
 * every one of these was a defect on the shipped time picker before the shell
 * existed. They are asserted against the DATE field as well as the TIME field
 * on purpose: the reason the machinery was extracted is that a second copy is
 * how a fixed bug comes back, and a calendar is taller than a column of
 * minutes, so it hits the placement cases harder.
 */

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// "Today" must not drift with the day the suite runs on.
vi.mock('@/utils/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timezone')>()),
  getDateInTimezone: () => '2026-09-11',
}));

/**
 * jsdom has no layout: every box is 0×0, `scrollTop` is a no-op, and nothing
 * below could be asserted at all. So the handful of measurements the shell
 * actually reads are stubbed — a row is `ROW` tall, a scrolling column shows
 * five of them — and restored after each test. Only what the shell reads is
 * faked; the arithmetic under test is the real thing.
 */
/** `TimePickerPanel`'s `ROW_HEIGHT`. Every expectation below derives from it. */
const ROW = 36;
const VISIBLE_ROWS = 5;
const VIEWPORT_GUTTER = 8;

const scrollTops = new WeakMap<Element, number>();
const restores: Array<() => void> = [];
/**
 * Rects for the handful of nodes that are NOT the anchor — the modal footer,
 * so far. `stubLayout` gives every element the same box, which is all the
 * placement tests need; anything that has to be somewhere ELSE registers here
 * and the shared stub defers to it.
 */
const explicitRects = new Map<Element, DOMRect>();

/** A box `height` tall with its top edge at `top`, in the 1024px-wide stub viewport. */
function rectAt(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 400,
    width: 400,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubRect(element: Element, rect: DOMRect): void {
  explicitRects.set(element, rect);
}

function override(target: object, key: string, descriptor: PropertyDescriptor): void {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  restores.push(() => {
    if (previous) Object.defineProperty(target, key, previous);
  });
}

interface LayoutOptions {
  /** Where the field shell sits in the viewport. */
  fieldTop: number;
  innerHeight: number;
  /** What the panel would be tall if nothing capped it. */
  panelHeight: number;
}

/** What `stubLayout` hands back: a way to move the field, as a scroll would. */
interface LayoutControl {
  moveField: (top: number) => void;
}

function fieldRect(fieldTop: number): DOMRect {
  return {
    top: fieldTop,
    bottom: fieldTop + 44,
    left: 40,
    right: 240,
    width: 200,
    height: 44,
    x: 40,
    y: fieldTop,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubLayout({ fieldTop, innerHeight, panelHeight }: LayoutOptions): LayoutControl {
  let rect = fieldRect(fieldTop);

  override(window, 'innerHeight', { get: () => innerHeight });
  override(window, 'innerWidth', { get: () => 1024 });
  override(Element.prototype, 'getBoundingClientRect', {
    value(this: Element) {
      return explicitRects.get(this) ?? rect;
    },
    writable: true,
  });
  override(HTMLElement.prototype, 'offsetHeight', {
    get(this: HTMLElement) {
      // THE PANEL REPORTS ITS CAPPED HEIGHT ONCE IT HAS ONE, as a real box does.
      // A stub that always answered the uncapped `panelHeight` could not express
      // the ratchet at all: re-measuring on every reposition read back the
      // natural height either way, so "measure once" was untestable.
      if (this.getAttribute('role') === 'dialog') {
        const cap = parseFloat(this.style.maxHeight);
        return Number.isNaN(cap) ? panelHeight : Math.min(panelHeight, cap);
      }
      return this.hasAttribute('data-index') || this.hasAttribute('data-day') ? ROW : 0;
    },
  });
  override(HTMLElement.prototype, 'offsetWidth', {
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? 200 : 0;
    },
  });
  override(HTMLElement.prototype, 'offsetTop', {
    get(this: HTMLElement) {
      const index = this.getAttribute('data-index');
      return index === null ? 0 : Number(index) * ROW;
    },
  });
  override(Element.prototype, 'clientHeight', {
    get(this: Element) {
      const role = this.getAttribute('role');
      return role === 'listbox' || role === 'grid' ? VISIBLE_ROWS * ROW : 0;
    },
  });
  override(Element.prototype, 'scrollHeight', {
    get(this: Element) {
      return this.getAttribute('role') === 'listbox' ? this.childElementCount * ROW : 0;
    },
  });
  override(Element.prototype, 'scrollTop', {
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, next: number) {
      scrollTops.set(this, next);
    },
  });

  return {
    moveField: (top: number) => {
      rect = fieldRect(top);
    },
  };
}

afterEach(() => {
  restores.splice(0).forEach((restore) => restore());
  explicitRects.clear();
});

function TimeHost({ initial = '' }: { initial?: string }): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <>
      <TimeField id="at" label="Time" value={value} onChange={(e) => setValue(e.target.value)} />
      <div data-testid="outside">nothing focusable here</div>
      <button type="button">Somewhere else</button>
    </>
  );
}

function DateHost({ initial = '' }: { initial?: string }): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateField id="on" label="Date" value={value} onChange={(e) => setValue(e.target.value)} />
      <div data-testid="outside">nothing focusable here</div>
      <button type="button">Somewhere else</button>
    </>
  );
}

async function openTimePicker(): Promise<HTMLElement> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a time' }));
  return screen.findByRole('dialog', { name: 'Time picker' });
}

async function openDatePicker(): Promise<HTMLElement> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a date' }));
  return screen.findByRole('dialog', { name: 'Date picker' });
}

/** `top` / `maxHeight` as the shell wrote them, in pixels. */
function box(panel: HTMLElement): { top: number; maxHeight: number } {
  return {
    top: parseFloat(panel.style.top),
    maxHeight: parseFloat(panel.style.maxHeight),
  };
}

describe('picker placement', () => {
  it('sits under the field when there is room below', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 500 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    // 100 + 44 (the field) + 4 (the anchor gap).
    expect(box(panel).top).toBe(148);
  });

  it('flips above the field when there is not room below', async () => {
    stubLayout({ fieldTop: 500, innerHeight: 700, panelHeight: 400 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    const { top, maxHeight } = box(panel);
    // Above the field, not overlapping it, and not off the top of the window.
    expect(top + maxHeight).toBeLessThanOrEqual(500 - 4);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
  });

  /**
   * THE DEFECT THE SCREENSHOT CAUGHT. The time picker flipped above a field
   * near the bottom of a long modal — correctly — and then ran off the TOP of
   * the window, with its first rows unreachable. Flipping is not the whole
   * answer; the panel has to live inside the room it chose.
   */
  it('clamps to the room on the chosen side rather than running off the top', async () => {
    // The window has to be SHORTER than `MAX_PANEL_HEIGHT` for this case to
    // exist at all now: with a ceiling in the shell, a 2000px panel never asks
    // for more than 288, so the room is only the binding cap when it is
    // tighter than that. The defect being pinned is unchanged — the panel
    // flipped above a field near the bottom of a long modal, correctly, and
    // then ran off the TOP of the window with its first rows unreachable.
    stubLayout({ fieldTop: 200, innerHeight: 250, panelHeight: 2000 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    const { top, maxHeight } = box(panel);
    expect(top).toBe(VIEWPORT_GUTTER);
    // Room above = 200 - 4 (gap) - 8 (edge gutter).
    expect(maxHeight).toBe(188);
    expect(top + maxHeight).toBeLessThanOrEqual(250 - VIEWPORT_GUTTER);
  });

  // A calendar is ~380px tall, so it meets this case on a laptop, not just on
  // a phone — which is why the clamp is in the shell and not in one panel.
  it('clamps the calendar the same way, on whichever side has more room', async () => {
    stubLayout({ fieldTop: 300, innerHeight: 420, panelHeight: 2000 });
    render(<DateHost initial="2026-09-11" />);
    const panel = await openDatePicker();

    const { top, maxHeight } = box(panel);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
    expect(top + maxHeight).toBeLessThanOrEqual(420 - VIEWPORT_GUTTER);
  });

  // Neither side can hold the panel's minimum: it must still be ON SCREEN, even
  // though it now overlaps its own field.
  it('stays inside the viewport when neither side has room', async () => {
    stubLayout({ fieldTop: 90, innerHeight: 200, panelHeight: 2000 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    const { top, maxHeight } = box(panel);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
    expect(top + maxHeight).toBeLessThanOrEqual(200 - VIEWPORT_GUTTER);
  });

  /**
   * The panel is measured ONCE, uncapped. Re-measuring reads back the CLAMPED
   * height, so a capped panel "fits" its own cap, gets capped again to whatever
   * the next scroll offers, and ratchets smaller on every scroll of the modal
   * behind it.
   *
   * THE FIELD HAS TO MOVE for the ratchet to show. Scrolling a modal whose
   * geometry does not change re-reads the same cap and writes it straight back,
   * so a re-measuring shell passes a stationary scroll. The real symptom is a
   * scroll that squeezes the panel and a scroll back that never lets it grow:
   * the shrunken height has been re-measured as its "natural" one.
   */
  it('does not shrink a little more on every scroll behind it', async () => {
    const layout = stubLayout({ fieldTop: 100, innerHeight: 500, panelHeight: 2000 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();
    // Room below = 500 - 144 - 4 - 8 = 344, so the ceiling is what binds.
    expect(box(panel).maxHeight).toBe(MAX_PANEL_HEIGHT);

    // Scrolled to where neither side holds 288: above = 250 - 4 - 8 = 238 wins.
    layout.moveField(250);
    act(() => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(box(panel).maxHeight).toBe(238);

    // Scrolled back. The room is 344 again, so the panel is owed its 288 — a
    // shell that re-measured would read the 238 cap back as natural and stay.
    layout.moveField(100);
    act(() => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(box(panel).maxHeight).toBe(MAX_PANEL_HEIGHT);
  });
});

/**
 * THE SECOND SCREENSHOT: the time picker opened inside Add Event with an empty
 * value and stood ~470px tall — twelve hour rows, from above the dialog's top
 * edge down past the Repeat field. Nothing was broken by the clamp above,
 * which is exactly why it went unnoticed: there was ~740px of room under the
 * field, so the clamp had nothing to do and the panel simply took its natural
 * height. A dropdown needs a cap on its own APPETITE as well as on the room it
 * is given, and the two are different caps.
 */
describe('picker height ceiling', () => {
  it('caps a panel taller than the ceiling even when the viewport has room', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 2000 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    const { top, maxHeight } = box(panel);
    expect(maxHeight).toBe(MAX_PANEL_HEIGHT);
    // Still below the field, because the ceiling is applied before the side is
    // chosen — a panel cut to 288 fits where its natural 2000 could not.
    expect(top).toBe(148);
    // And the columns are what absorbs the difference, rather than the rows
    // being cut off at the panel's edge.
    for (const name of ['Hour', 'Minute', 'AM/PM']) {
      expect(screen.getByRole('listbox', { name }).className).toContain('overflow-y-auto');
    }
  });

  /**
   * The calendar raises the ceiling to its own fixed height (`GRID_ROWS` is
   * pinned at six so it never moves), so a month grid with room to draw in is
   * NOT made to scroll to reach the 30th.
   */
  it('leaves a panel that fits under its own ceiling at its natural height', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 380 });
    render(<DateHost initial="2026-09-11" />);
    const panel = await openDatePicker();

    expect(box(panel).maxHeight).toBe(380);
  });

  // The ceiling is an appetite, not an entitlement: it still loses to a window
  // that cannot hold it.
  it('gives way to the room on the chosen side when that is tighter', async () => {
    stubLayout({ fieldTop: 150, innerHeight: 300, panelHeight: 2000 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    const { top, maxHeight } = box(panel);
    // Room above = 150 - 4 (gap) - 8 (edge gutter), which is less than 288.
    expect(maxHeight).toBe(138);
    expect(maxHeight).toBeLessThan(MAX_PANEL_HEIGHT);
    expect(top + maxHeight).toBeLessThanOrEqual(150 - 4);
  });
});

describe('picker scrollbar lane', () => {
  // The overlay scrollbar takes no layout width and paints ON TOP of the
  // rightmost pixels of whatever scrolls — the minute digits, in the shipped
  // version. Same defect `Modal` documents; same technique, different budget.
  it('gives every scrolling column a gutter of its own', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 400 });
    render(<TimeHost initial="08:30" />);
    await openTimePicker();

    for (const name of ['Hour', 'Minute', 'AM/PM']) {
      const column = screen.getByRole('listbox', { name });
      expect(column.className).toContain('overflow-y-auto');
      expect(column.className).toContain(SCROLL_GUTTER);
    }
  });

  it('gives the calendar grid the same gutter', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 400 });
    render(<DateHost initial="2026-09-11" />);
    await openDatePicker();

    const grid = screen.getByRole('grid');
    expect(grid.className).toContain('overflow-y-auto');
    expect(grid.className).toContain(SCROLL_GUTTER);
  });
});

/**
 * THE OTHER DEFECT THE SCREENSHOT CAUGHT: an `08:00` field opened with its
 * minute column showing `02` — the selected `00` scrolled out of sight above —
 * while the hour column beside it centred correctly. `scrollIntoView` scrolls
 * every scrollable ANCESTOR as well as the column, and this panel is fixed
 * inside a portal, so the ancestors it reached were the document's.
 *
 * The rule these assert is the one that matters, not the arithmetic: on open,
 * the selected option is WITHIN the column's visible range. Near the start and
 * near the end are where a centring calculation stops being able to centre, and
 * those are exactly the rows this bug class hits.
 */
describe('picker opens on its value', () => {
  function assertVisible(column: HTMLElement, option: HTMLElement): void {
    const top = Number(option.getAttribute('data-index')) * ROW;
    expect(column.scrollTop).toBeLessThanOrEqual(top);
    expect(top + ROW).toBeLessThanOrEqual(column.scrollTop + VISIBLE_ROWS * ROW);
  }

  it('shows the selected minute when it is the FIRST row (08:00)', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    render(<TimeHost initial="08:00" />);
    await openTimePicker();

    const minutes = screen.getByRole('listbox', { name: 'Minute' });
    assertVisible(minutes, within(minutes).getByRole('option', { name: '00' }));
    // It cannot be centred, so it pins to the top rather than landing wherever
    // `offsetTop - clientHeight / 2` fell.
    expect(minutes.scrollTop).toBe(0);
  });

  it('shows the selected minute when it is the LAST row (08:59)', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    render(<TimeHost initial="08:59" />);
    await openTimePicker();

    const minutes = screen.getByRole('listbox', { name: 'Minute' });
    assertVisible(minutes, within(minutes).getByRole('option', { name: '59' }));
    expect(minutes.scrollTop).toBe(60 * ROW - VISIBLE_ROWS * ROW);
  });

  it('shows the selected hour when it is the first row of the 12-hour column (12:30)', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    render(<TimeHost initial="12:30" />);
    await openTimePicker();

    const hours = screen.getByRole('listbox', { name: 'Hour' });
    assertVisible(hours, within(hours).getByRole('option', { name: '12' }));
    expect(hours.scrollTop).toBe(0);
  });

  it('centres a selection with room on both sides', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    render(<TimeHost initial="08:30" />);
    await openTimePicker();

    const minutes = screen.getByRole('listbox', { name: 'Minute' });
    const option = within(minutes).getByRole('option', { name: '30' });
    assertVisible(minutes, option);
    // (the 30th row's top) - (half the column, less half a row).
    expect(minutes.scrollTop).toBe(30 * ROW - (VISIBLE_ROWS * ROW - ROW) / 2);
  });

  it('opens the calendar focused on the value, not on the first cell', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    render(<DateHost initial="2026-09-24" />);
    await openDatePicker();

    expect(document.querySelector('[data-day="2026-09-24"]')).toHaveFocus();
  });
});

/**
 * `useMenu`'s own outside-click listener calls `setOpen(false)` and nothing
 * else, so clicking away from an open picker dropped focus on the floor —
 * Escape, Enter and a second trigger click all restored it, and the one path
 * that did not was the common one. Fixed in the shell rather than in `useMenu`:
 * every other consumer of that hook is a menu whose items navigate, where
 * forcing focus back to a trigger would fight the click that just landed.
 */
describe('picker outside click', () => {
  it('closes the time picker AND puts focus back on the trigger', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<TimeHost initial="08:30" />);
    await openTimePicker();

    await user.click(screen.getByTestId('outside'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose a time' })).toHaveFocus();
    });
  });

  it('closes the date picker AND puts focus back on the trigger', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<DateHost initial="2026-09-11" />);
    await openDatePicker();

    await user.click(screen.getByTestId('outside'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose a date' })).toHaveFocus();
    });
  });

  // The restore must not fight a click that asked for focus somewhere else.
  it('leaves focus alone when the outside click landed on something focusable', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<TimeHost initial="08:30" />);
    await openTimePicker();

    const elsewhere = screen.getByRole('button', { name: 'Somewhere else' });
    await user.click(elsewhere);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    // Give the deferred re-assert a turn to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(elsewhere).toHaveFocus();
  });
});

describe('picker key containment', () => {
  // React portals bubble along the REACT tree, so without stopPropagation a
  // keydown in the panel still reaches whatever wraps the field.
  it('keeps Escape and Tab from reaching an enclosing dialog', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const onKeyDown = vi.fn();
    const user = userEvent.setup();
    render(
      <div onKeyDown={onKeyDown}>
        <TimeHost initial="08:30" />
      </div>
    );
    await openTimePicker();
    onKeyDown.mockClear();

    await user.keyboard('{Tab}');
    await user.keyboard('{Escape}');
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Choose a time' })).toHaveFocus();
  });

  it('keeps the calendar keys from reaching an enclosing dialog', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const onKeyDown = vi.fn();
    const user = userEvent.setup();
    render(
      <div onKeyDown={onKeyDown}>
        <DateHost initial="2026-09-11" />
      </div>
    );
    await openDatePicker();
    onKeyDown.mockClear();

    // PageDown in particular would otherwise scroll the modal behind the panel.
    await user.keyboard('{ArrowRight}{PageDown}{Tab}{Escape}');
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});

/**
 * THE PANEL'S OWN CHROME IS NOT A FOCUS BLACK HOLE.
 *
 * Clicking the `p-1` ring, the time picker's column-header strip or the
 * calendar's weekday row lands on a node nothing can focus, so the browser's
 * focus fixup drops focus on `document.body` — and the Escape handler lives on
 * the panel div, so from `body` the keydown never reaches it and Escape STOPS
 * DISMISSING THE POPOVER (verified in Chromium: the panel is still there after
 * Escape). One Tab recovers it and nothing tells the user that.
 */
describe('picker dead-space click', () => {
  it('keeps Escape working after a click on the time panel chrome', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    await user.click(panel);
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Choose a time' })).toHaveFocus();
  });
});

/**
 * THE RE-ASSERT NEVER FIRED WHERE IT WAS WRITTEN TO FIRE.
 *
 * `reassertTriggerFocus` exists because an outside click that lands on nothing
 * focusable strands the keyboard at the top of the document — and every one of
 * this field's call sites is INSIDE a `Modal`, where that click does not strand
 * focus on `document.body` at all: `Modal`'s panel is `tabIndex={-1}`, so the
 * browser's focus fixup parks on the DIALOG. The old `active === document.body`
 * guard reads that as "someone claimed focus" and stands down, so focus ends at
 * the top of the dialog instead of on the field being edited — the guard was
 * only ever true for a picker outside a modal, which is nowhere.
 */
describe('picker outside click inside a modal', () => {
  function ModalTimeHost(): React.ReactElement {
    const [value, setValue] = useState('08:30');
    return (
      <Modal
        title="Add event"
        onClose={() => {}}
        closeLabel="Close"
        footer={
          <>
            <button type="button">Cancel</button>
            <button type="button">Create</button>
          </>
        }
      >
        <TimeField id="at" label="Time" value={value} onChange={(e) => setValue(e.target.value)} />
      </Modal>
    );
  }

  it('returns focus to the trigger when the click lands on the dialog chrome', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<ModalTimeHost />);
    await openTimePicker();

    // The dialog's own heading: outside the popover, inside the modal, and not
    // focusable — so the fixup lands on the `tabIndex={-1}` dialog panel.
    await user.click(screen.getByRole('heading', { name: 'Add event' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose a time' })).toHaveFocus();
    });
  });

  /**
   * …AND THE RE-ASSERT MUST NOT OVERRULE THE FIELD ABOUT WHERE "BACK" IS.
   *
   * `openedFromInput` exists because Alt+ArrowDown is the INPUT's native picker
   * opener: a keyboard user who tabbed into the field, opened the picker and
   * changed their mind belongs back in the segment they were editing, not one
   * Shift+Tab past it on the trailing icon button. Escape honours that, and the
   * outside click did not: `onDismiss` focused the input correctly, the
   * browser's own mousedown fixup then parked on the `tabIndex={-1}` dialog
   * panel, and the deferred re-assert — which read that as "nobody claimed
   * focus", correctly — sent it to the TRIGGER, because the trigger was the
   * only place it knew how to send it.
   *
   * The two halves were only ever tested apart: the re-assert through a
   * trigger-opened picker (above), `openedFromInput` through Escape
   * (`TimePicker.test.tsx`). Crossing them is where the ref is silently lost.
   */
  it('returns focus to the INPUT when Alt+ArrowDown is what opened it', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<ModalTimeHost />);
    const input = screen.getByLabelText('Time');
    await user.click(input);
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await screen.findByRole('dialog', { name: 'Time picker' });

    await user.click(screen.getByRole('heading', { name: 'Add event' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    // Held past the deferred re-assert, which is the whole point: the
    // synchronous focus in `onDismiss` was never what went wrong.
    await waitFor(() => expect(input).toHaveFocus());
  });
});

/**
 * THE PANEL MUST NOT COVER THE BUTTONS THAT SUBMIT THE FORM.
 *
 * At <=400px of viewport width the calendar covers the modal footer's Cancel
 * AND Create outright (the time panel does it at short viewports), so a mouse
 * aimed at Create lands on a `gridcell` and COMMITS A DATE instead of
 * submitting. Keyboard users are safe — Tab is trapped in the popover, which is
 * what 2.4.11 leans on — and the coarse-pointer gate does not cover this at all
 * because a narrow DESKTOP window is a fine pointer.
 *
 * jsdom, not Playwright, and deliberately: what is under test is `reposition`'s
 * arithmetic over three measured rects, which a stub feeds exactly and
 * repeatably (the same reason the 21 placement tests above are here). A browser
 * would be testing that the footer is where `getBoundingClientRect` says it is,
 * which is not our code.
 */
describe('picker vs the modal footer', () => {
  /** The footer's top edge in the stub viewport — a short modal in a tall window. */
  const FOOTER_TOP = 300;

  function ModalDateHost(): React.ReactElement {
    const [value, setValue] = useState('2026-09-11');
    return (
      <Modal
        title="Add event"
        onClose={() => {}}
        closeLabel="Close"
        footer={
          <>
            <button type="button">Cancel</button>
            <button type="button">Create</button>
          </>
        }
      >
        <DateField id="on" label="Date" value={value} onChange={(e) => setValue(e.target.value)} />
      </Modal>
    );
  }

  function stubFooter(): HTMLElement {
    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    stubRect(footer, rectAt(FOOTER_TOP, 60));
    return footer;
  }

  /**
   * `DatePickerPanel`'s `MIN_USABLE_PANEL` (header 44 + weekday row 22 + one
   * week 44 + the action row 44 + `p-1` and borders), restated. The floor this
   * geometry has to be held to — the old `>= 100` was below it, so a panel
   * squeezed to 144 by NOT sliding passed as "usable".
   */
  const CALENDAR_MIN_USABLE_PANEL = 44 + 22 + 44 + 44 + 2 * 4 + 2;

  it('keeps the calendar clear of the footer instead of covering Create', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 400 });
    render(<ModalDateHost />);
    stubFooter();
    const panel = await openDatePicker();

    const { top, maxHeight } = box(panel);
    expect(top + maxHeight).toBeLessThanOrEqual(FOOTER_TOP);
    // ...and it is still a usable panel, not a sliver: the point is placement,
    // not surrender. Below the field is 300 - 144 - 12 = 144px and above it is
    // 88, neither of which holds the calendar's minimum — so the only way to
    // keep both the minimum AND the footer is the upward slide in `reposition`.
    expect(maxHeight).toBeGreaterThanOrEqual(CALENDAR_MIN_USABLE_PANEL);
    // Which is visible as the panel's top riding up over its own field (bottom
    // edge 144) rather than hanging from under it at 148.
    expect(top).toBeLessThan(100 + 44);
  });

  it('keeps the time panel clear of the footer too', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 400 });
    render(
      <Modal
        title="Add event"
        onClose={() => {}}
        closeLabel="Close"
        footer={<button type="button">Cancel</button>}
      >
        <TimeField id="at" label="Time" value="08:30" onChange={() => {}} />
      </Modal>
    );
    stubFooter();
    const panel = await openTimePicker();

    const { top, maxHeight } = box(panel);
    expect(top + maxHeight).toBeLessThanOrEqual(FOOTER_TOP);
  });

  // No dialog around the field, so there is no footer to reserve and the panel
  // keeps every pixel it had.
  it('reserves nothing when the field is not in a dialog', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 400 });
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    expect(box(panel)).toEqual({ top: 148, maxHeight: MAX_PANEL_HEIGHT });
  });
});

/**
 * THE TAB CYCLE IS THE WHOLE OF THIS WIDGET'S WCAG 2.2 §2.4.11 ANSWER.
 *
 * Focus Not Obscured passes for these pickers by CONTAINMENT, not by placement:
 * the panel genuinely covers the modal's Cancel and submit buttons in some
 * geometries, and it is compliant only because keyboard focus cannot reach them
 * while it is open. Relax the cycle — "Tab should just fall through", "the menu
 * hook already closes on Tab" — and 2.2 AA breaks the same day, silently, with
 * nothing else in the suite watching. This is that watcher. It is deliberately
 * a behavioural loop rather than an assertion about the handler's shape, so it
 * survives any refactor that keeps the promise.
 */
describe('picker tab containment (WCAG 2.2 §2.4.11)', () => {
  const PRESSES = 12;

  it('never lets Tab or Shift+Tab out of the open time panel', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<TimeHost initial="08:30" />);
    const panel = await openTimePicker();

    for (let press = 0; press < PRESSES; press += 1) {
      await user.keyboard('{Tab}');
      expect(panel.contains(document.activeElement)).toBe(true);
    }
    for (let press = 0; press < PRESSES; press += 1) {
      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(panel.contains(document.activeElement)).toBe(true);
    }
  });

  it('never lets Tab or Shift+Tab out of the open calendar', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    const user = userEvent.setup();
    render(<DateHost initial="2026-09-11" />);
    const panel = await openDatePicker();

    for (let press = 0; press < PRESSES; press += 1) {
      await user.keyboard('{Tab}');
      expect(panel.contains(document.activeElement)).toBe(true);
    }
    for (let press = 0; press < PRESSES; press += 1) {
      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(panel.contains(document.activeElement)).toBe(true);
    }
  });
});

/**
 * AT DEEP ZOOM, `minHeight` STOPS BEING A FLOOR AND BECOMES A LEAK.
 *
 * `MIN_USABLE_PANEL` is the shortest a panel may be squeezed to before the cap
 * stops being containment and starts being breakage — but it was also the LAST
 * word in the arithmetic, applied after the viewport clamp, so a band shorter
 * than the minimum gave a panel taller than the band. The calendar's Clear and
 * Today sat ~38 of their 44px past the bottom edge, and because the panel is
 * `position: fixed`, NO SCROLL CAN REACH THEM — the controls are simply gone.
 * When the choice is a squeezed panel or an unreachable one, squeezed wins:
 * below `minHeight` is a bad panel, off-screen is no panel.
 *
 * (The audit's own 320x256 reference is now handled one step earlier, by the
 * upward slide the footer reservation added — 256px still holds the calendar's
 * 164px minimum. What is left, and what these pin, is the case where the band
 * itself is shorter than that minimum: the next zoom step up, and — the
 * realistic one — the strip left above a dialog footer that stacks its buttons
 * full-width below 480px.)
 */
describe('picker at deep zoom', () => {
  it('never hangs past the bottom of a window shorter than its own minimum', async () => {
    // 1280x800 at 500% zoom. The calendar's `MIN_USABLE_PANEL` is 164.
    stubLayout({ fieldTop: 100, innerHeight: 160, panelHeight: 400 });
    render(<DateHost initial="2026-09-11" />);
    const panel = await openDatePicker();

    const { top, maxHeight } = box(panel);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
    expect(top + maxHeight).toBeLessThanOrEqual(160 - VIEWPORT_GUTTER);
  });

  it('gives up height rather than the footer when the band above it is tighter', async () => {
    // 320x256: the modal is ~230px tall and its footer STACKS below 480px, so
    // two full-width buttons plus padding leave ~95px of band above it.
    stubLayout({ fieldTop: 40, innerHeight: 256, panelHeight: 400 });
    render(
      <Modal
        title="Add event"
        onClose={() => {}}
        closeLabel="Close"
        footer={
          <>
            <button type="button">Cancel</button>
            <button type="button">Create</button>
          </>
        }
      >
        <DateField id="on" label="Date" value="2026-09-11" onChange={() => {}} />
      </Modal>
    );
    const footer = screen.getByRole('button', { name: 'Cancel' }).parentElement as HTMLElement;
    stubRect(footer, rectAt(103, 140));
    const panel = await openDatePicker();

    const { top, maxHeight } = box(panel);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
    expect(top + maxHeight).toBeLessThanOrEqual(103);
  });
});

/**
 * THE PANEL'S OWN COLUMNS ARE SCROLLERS TOO, and `scroll` does not bubble — so
 * the `capture: true` the shell needs to hear the modal body behind it is also
 * what makes it hear every wheel tick inside itself.
 *
 * Each one re-ran `reposition`, which is `getBoundingClientRect` on the anchor
 * plus `bottomLimitFor`'s `closest` + `querySelector` + a second rect: two
 * forced reflows per event, for a field that has not moved a pixel, while the
 * pointer is dragging a 60-row minute column. The open sequence paid it three
 * times over before the user touched anything — `onPositioned` writes
 * `scrollTop` on all three columns, and each write is a scroll event.
 */
describe('picker reposition churn', () => {
  /** Count `getBoundingClientRect` calls from here on. Restored with the stubs. */
  function countReflows(): () => number {
    const original = Element.prototype.getBoundingClientRect;
    let calls = 0;
    override(Element.prototype, 'getBoundingClientRect', {
      value(this: Element) {
        calls += 1;
        return original.call(this);
      },
      writable: true,
    });
    return () => calls;
  }

  it('does not re-measure the field when its own column scrolls', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    render(<TimeHost initial="08:30" />);
    await openTimePicker();

    const reflows = countReflows();
    const minutes = screen.getByRole('listbox', { name: 'Minute' });
    act(() => {
      // `bubbles: false` is what a real scroll is — which is why the shell's
      // listener is a capturing one, and why it hears this at all.
      minutes.dispatchEvent(new Event('scroll', { bubbles: false }));
      minutes.dispatchEvent(new Event('scroll', { bubbles: false }));
      minutes.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(reflows()).toBe(0);
  });

  it('still follows the field when something outside the panel scrolls', async () => {
    stubLayout({ fieldTop: 100, innerHeight: 900, panelHeight: 300 });
    render(<TimeHost initial="08:30" />);
    await openTimePicker();

    const reflows = countReflows();
    act(() => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    // The whole reason the listener is on `document` in capture: a `fixed`
    // panel does not move with the modal body its field is scrolling inside.
    expect(reflows()).toBeGreaterThan(0);
  });
});

/**
 * ESCAPE IN THE GAP BETWEEN "OPEN" AND "MOUNTED" — the one window in which this
 * widget has no keydown handler at all.
 *
 * The panel is behind `React.lazy` with `fallback={null}`, so from the gesture
 * that sets `menu.open` until the chunk arrives there is nothing in the DOM:
 * no panel, so none of `PickerPopover`'s `onKeyDown`, which is what stops
 * Escape reaching the dialog. Escape in that window therefore bubbles to
 * `Modal`, which closes — discarding a half-typed event — while the popover
 * the user was actually dismissing was never on screen. Narrow (a cold cache
 * over a slow link is the only way to be in it for longer than a frame) and
 * entirely real.
 *
 * Fixed in the FIELDS rather than in the shell, necessarily: the shell does not
 * exist yet at the moment in question. The trigger route is already covered by
 * `useMenu.onButtonKeyDown`, which swallows Escape whenever its own `open` is
 * true; the INPUT route — Alt+ArrowDown, which the fields intercept themselves
 * — had no Escape handling on either side of the gap.
 */
describe('Escape while the panel chunk is still in flight', () => {
  function ModalHost({ onClose, kind }: { onClose: () => void; kind: 'time' | 'date' }) {
    return (
      <Modal title="Add event" onClose={onClose} closeLabel="Close">
        {kind === 'time' ? (
          <TimeField id="at" label="Time" value="08:30" onChange={() => {}} />
        ) : (
          <DateField id="on" label="Date" value="2026-09-11" onChange={() => {}} />
        )}
      </Modal>
    );
  }

  it('TimeField closes the popover, not the dialog it lives in', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ModalHost onClose={onClose} kind="time" />);
    const input = screen.getByLabelText('Time');
    await user.click(input);
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    // WHAT DEFINES THE WINDOW IS NOT THE PANEL'S ABSENCE — it is that the
    // keystroke lands on the INPUT, because no panel has taken focus off it.
    // Asserting the absence directly is not available: Vitest caches the
    // dynamic import per FILE, so once any earlier test here has opened a
    // picker the chunk is warm and the panel mounts within the same `await`.
    // Focus is the honest half of the state, and it is the half that decides
    // the outcome: from the input the keydown travels input -> field -> Modal
    // and never through the portalled panel, whose `onKeyDown` sits on a node
    // this event does not pass through in the DOM tree or the React one.
    input.focus();

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    // And the popover really is shut — not merely un-mounted-yet, which would
    // let the chunk land on top of the form a beat later.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose a time' })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    );
    expect(input).toHaveFocus();
  });

  it('DateField closes the popover, not the dialog it lives in', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ModalHost onClose={onClose} kind="date" />);
    const input = screen.getByLabelText('Date');
    await user.click(input);
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    // See the note in the Time case: focus on the input IS the in-flight state.
    input.focus();

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose a date' })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    );
    expect(input).toHaveFocus();
  });
});
