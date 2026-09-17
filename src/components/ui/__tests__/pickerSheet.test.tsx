import { useRef, useState, type ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// For its side effect only: the time field's trigger and dialog are found by
// their translated names, which are the raw keys until i18n has booted.
import '@/i18n';
import { COARSE_POINTER_QUERY } from '@/hooks/useCoarsePointer';
import { DateField } from '../DateField';
import { TimeField } from '../TimeField';
import { MAX_PANEL_HEIGHT, PickerPopover, SHEET_MAX_PANEL_HEIGHT } from '../pickerPopover';

// The time panel reads the viewer's 12h/24h clock through React Query, which
// this file gives it no provider for — and the clock is irrelevant to a sheet's
// height. Injected exactly as `pickerPopover.test.tsx` does.
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

/**
 * THE SHEET PRESENTATION, DRIVEN THROUGH THE SHELL ITSELF.
 *
 * Deliberately NOT through `DateField`/`TimeField`: this file has to be able to
 * prove the sheet works BEFORE the fields stop gating the popover off on touch,
 * so that the tree is never in a state where a touch user would be handed the
 * anchored panel that covers 65% of the modal it hangs in. `PickerPopover` is
 * the whole of the presentation decision (see its header), so mounting it with
 * two plain buttons inside is the smallest thing that can answer the question.
 *
 * WHAT IS NOT HERE: anything about pixels. jsdom has no layout engine —
 * `getBoundingClientRect` is all zeros and `offsetParent` is null — so "the
 * sheet sits on the viewport floor" and "the calendar shows four week rows at
 * 390x360" are Playwright's job (`e2e/picker-geometry.spec.ts`, sheet mode).
 * What jsdom can answer, and answers here, is STRUCTURE: which box the panel
 * is, whether the shell wrote anchoring coordinates at all, and the focus,
 * Escape, Tab and scroll-lock contract the sheet has to keep.
 */

/**
 * A pointer class the test controls, wired the way `useCoarsePointer` reads it.
 *
 * ONE list object for every call, for the reason `pickerCoarsePointer.test.tsx`
 * spells out: the hook's change handler reads `matches` off the object it
 * subscribed to while its lazy initialiser calls `matchMedia` afresh, so a stub
 * that minted a new object per call would let the two disagree.
 */
function stubPointerClass(initial: boolean): { set: (next: boolean) => void } {
  const listeners = new Set<() => void>();
  const list = {
    media: COARSE_POINTER_QUERY,
    matches: initial,
    addEventListener: (_type: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => void listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => list);
  return {
    set: (next: boolean) => {
      list.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}

const restores: Array<() => void> = [];

/** Redefine a DOM property for one test; undone in `afterEach`. */
function stubProperty(target: object, key: string, descriptor: PropertyDescriptor): void {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  restores.push(() => {
    if (previous) Object.defineProperty(target, key, previous);
    else delete (target as Record<string, unknown>)[key];
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  restores.splice(0).forEach((restore) => restore());
});

// Reset the page lock BEFORE each test rather than after: Testing Library's own
// auto-cleanup unmounts on `afterEach` too, and its unmount is what runs the
// sheet's restore — so a reset registered here would be undone by a teardown
// that has not happened yet, and the next test would inherit a locked page.
beforeEach(() => {
  document.body.style.overflow = '';
});

function Host(): ReactElement {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <div ref={anchorRef}>
        <button ref={triggerRef} type="button" onClick={() => setOpen((was) => !was)}>
          Open picker
        </button>
      </div>
      <button type="button">Behind the sheet</button>
      {open ? (
        <PickerPopover
          id="popover"
          label="Picker"
          anchorRef={anchorRef}
          panelRef={panelRef}
          triggerRef={triggerRef}
          onDismiss={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          minHeight={72}
        >
          <button type="button">Inside one</button>
          <button type="button">Inside two</button>
        </PickerPopover>
      ) : null}
    </>
  );
}

async function openSheet(): Promise<HTMLElement> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open picker' }));
  return screen.getByRole('dialog', { name: 'Picker' });
}

describe('picker presentation on a coarse pointer', () => {
  it('presents as a bottom sheet rather than a box anchored to the field', async () => {
    stubPointerClass(true);
    render(<Host />);
    const panel = await openSheet();

    // THE DECISIVE PAIR. A sheet is pinned to the viewport's bottom edge across
    // its full width; the anchored panel is placed by `reposition`, which is
    // the only thing in this shell that ever writes `top`/`left`. Asserting
    // BOTH is what separates "it looks like a sheet" from "it is one": a panel
    // that grew sheet classes while still being positioned would sit wherever
    // the anchor put it, with a rounded top edge somewhere mid-screen.
    expect(panel.className).toContain('bottom-0');
    expect(panel.className).toContain('inset-x-0');
    expect(panel.style.top).toBe('');
    expect(panel.style.left).toBe('');
  });

  it('puts a scrim behind the sheet, and none behind the anchored panel', async () => {
    stubPointerClass(true);
    const { unmount } = render(<Host />);
    await openSheet();
    // The scrim is what makes the sheet MODAL — the field, the dialog's Close
    // button and the form rows underneath are all behind it, so the taps the
    // anchored panel used to intercept (Close, event type, name, dosage) now
    // land on a surface whose only job is to dismiss.
    expect(document.querySelector('[data-picker-scrim]')).toBeInTheDocument();
    unmount();

    stubPointerClass(false);
    render(<Host />);
    await openSheet();
    // A dropdown hanging off a field on a desktop is not modal and must not
    // grey the form out.
    expect(document.querySelector('[data-picker-scrim]')).not.toBeInTheDocument();
  });

  /**
   * THE CEILING IS THE TIME PANEL'S TO PASS, so it is tested through the time
   * panel. `Host` mounts the shell bare, where the default ceiling is the
   * ANCHORED one — a sheet test on it cannot tell the two apart. And jsdom's
   * natural height is 0, which makes `min(natural, any cap)` 0 under every cap
   * there is; so the panel's natural height and the viewport are stubbed here,
   * which is all the sheet branch of `reposition` reads.
   */
  function stubSheetLayout({
    innerHeight,
    panelHeight,
  }: {
    innerHeight: number;
    panelHeight: number;
  }): void {
    stubProperty(window, 'innerHeight', { get: () => innerHeight });
    stubProperty(HTMLElement.prototype, 'offsetHeight', {
      get(this: HTMLElement) {
        if (this.getAttribute('role') !== 'dialog') return 0;
        // A real box reports its capped height once it has one.
        const cap = parseFloat(this.style.maxHeight);
        return Number.isNaN(cap) ? panelHeight : Math.min(panelHeight, cap);
      },
    });
  }

  async function openTimeSheet(): Promise<HTMLElement> {
    render(<TimeField id="at" label="Time" value="08:30" onChange={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a time' }));
    return screen.findByRole('dialog', { name: 'Time picker' });
  }

  it('caps the sheet at its own ceiling rather than the anchored one', async () => {
    stubPointerClass(true);
    // A tall phone: 85% of 900 is 765, so the viewport is not what binds.
    stubSheetLayout({ innerHeight: 900, panelHeight: 2000 });
    const panel = await openTimeSheet();

    expect(panel.className).toContain('bottom-0');
    expect(panel.style.maxHeight).toBe(`${SHEET_MAX_PANEL_HEIGHT}px`);
    // Named, because it is the specific wrong answer: seven 36px rows' worth of
    // box, which shows six and a sliver of the sheet's 44px rows.
    expect(panel.style.maxHeight).not.toBe(`${MAX_PANEL_HEIGHT}px`);
  });

  it('gives way to 85% of a short viewport rather than running off its top', async () => {
    stubPointerClass(true);
    // 390x360, the keyboard-up case: 85% is 306, under the 359 ceiling.
    stubSheetLayout({ innerHeight: 360, panelHeight: 2000 });
    const panel = await openTimeSheet();

    expect(panel.style.maxHeight).toBe(`${360 * 0.85}px`);
  });

  /**
   * `minHeight` IS NOT A FLOOR FOR THE SHEET — `reposition` says so in as many
   * words: a sheet taller than the window it is pinned to has no scroll that
   * can reach its bottom rows. The 360px case above cannot hold it to that,
   * because its 306px cap is far above any panel's minimum, so a
   * `Math.max(cap, minHeight)` floor changes nothing there.
   *
   * These viewports are short enough that 85% of them is BELOW the panel's own
   * `minHeight` — the time sheet's is 80 (one 44px row plus its chrome), the
   * calendar's 164 — which is the only place such a floor would show.
   */
  it("keeps 85% of the viewport even where that is under the time panel's minimum", async () => {
    stubPointerClass(true);
    // 85% of 80 is 68, under the time sheet's 80px minimum.
    stubSheetLayout({ innerHeight: 80, panelHeight: 2000 });
    const panel = await openTimeSheet();

    expect(panel.style.maxHeight).toBe(`${80 * 0.85}px`);
  });

  it("keeps 85% of the viewport even where that is under the calendar's minimum", async () => {
    stubPointerClass(true);
    // 85% of 180 is 153, under the calendar's 164px minimum.
    stubSheetLayout({ innerHeight: 180, panelHeight: 2000 });
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a date' }));
    const panel = await screen.findByRole('dialog', { name: 'Date picker' });

    expect(panel.className).toContain('bottom-0');
    expect(panel.style.maxHeight).toBe(`${180 * 0.85}px`);
  });

  it('leaves a sheet shorter than both caps at its natural height', async () => {
    stubPointerClass(true);
    // A cap, never a height: a two-column 24-hour picker stays its own size.
    stubSheetLayout({ innerHeight: 900, panelHeight: 200 });
    const panel = await openTimeSheet();

    expect(panel.style.maxHeight).toBe('200px');
  });

  /**
   * THE SHEET PAYS FOR ITS OWN PADDING, and does not inherit the anchored
   * panel's.
   *
   * `p-1` is 4px. On a box hanging off a field that is a hairline ring holding
   * a bordered card off its own content; on a surface that is AS WIDE AS THE
   * PHONE it is the weekday header and the month grid running into both screen
   * edges, and the Clear/Today row sitting on the home indicator. The two
   * presentations are the same component and NOT the same box, which is the
   * whole reason this assertion is a pair: the sheet gains its padding and the
   * anchored panel must be able to prove it lost nothing.
   *
   * ── WHY THE VERTICAL HALF IS GATED ON HAVING ROOM ────────────────────────
   *
   * The side gutters are free — a sheet is as wide as the viewport whatever it
   * costs, and what they buy back is width the seven day columns divide. The
   * TOP and BOTTOM are not free: the sheet's height is capped at 85% of the
   * viewport, and every pixel of padding comes out of the scrolling grid in
   * the middle. Measured, at the 390x360 keyboard-up viewport the cap is 306px
   * and the chrome that is not padding (one border, the 48px month header, the
   * 49px action row) is 98 of it — so four 44px week rows plus the 22px
   * weekday strip leave exactly TEN pixels for vertical padding, against the
   * eight it already had. 16px top and bottom is not a tight fit there; it is
   * a week row, and `e2e/picker-geometry.spec.ts` pins that row because
   * showing a real fraction of the month is the entire reason the sheet
   * presentation exists.
   *
   * So the comfortable padding is gated behind a viewport tall enough to spend
   * it, and the keyboard-up case keeps the old 4px. That is the same trade the
   * sheet's own geometry spec already makes out loud where it explains why the
   * day cells were NOT shrunk to fit: at a viewport this short, content wins
   * over margin.
   *
   * CLASSES, NOT PIXELS, and deliberately so — jsdom has no layout engine, so a
   * unit test that claimed "the grid clears the screen edge" would be reading
   * back a rect of zeros, and it cannot evaluate a media query either. What the
   * rendered padding actually does to the day cells' width (WCAG 2.2 §2.5.8,
   * and the number that would break first) and to the week-row count at both
   * viewport heights is measured in Playwright, against a real browser.
   */
  it('gives the sheet its own padding without touching the anchored panel', async () => {
    stubPointerClass(true);
    const { unmount } = render(<Host />);
    const sheet = await openSheet();

    // Comfortable side gutters, unconditionally — they cost no height.
    expect(sheet.className).toContain('px-4');
    // The floor, for the keyboard-up viewport that cannot afford more.
    expect(sheet.className).toContain('pt-1');
    expect(sheet.className).toContain('pb-[max(0.25rem,env(safe-area-inset-bottom))]');
    // And the comfortable pair, wherever there is height to spend on it. Both
    // halves asserted: a gate that lost its tall branch silently ships the
    // cramped sheet everywhere, which is the bug this change is fixing.
    expect(sheet.className).toContain('[@media(min-height:500px)]:pt-3');
    expect(sheet.className).toContain(
      '[@media(min-height:500px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]'
    );
    // The hairline ring is GONE from this box, not merely overridden by a
    // later utility: `p-1` and `px-4` in one class list is a race decided by
    // stylesheet order rather than by intent, and Tailwind's is not ours to
    // rely on.
    //
    // TOKENS, not a substring: `not.toContain('p-1 ')` leaned on a trailing
    // space, so a `p-1` appended at the END of the class string sailed past it.
    // Any all-sides padding shorthand at all (`p-1`, `p-2`, a variant of one)
    // is the same race, so the whole shape is banned.
    const sheetTokens = sheet.className.split(/\s+/);
    expect(sheetTokens.filter((token) => /(^|:)p-/.test(token))).toEqual([]);
    unmount();

    stubPointerClass(false);
    render(<Host />);
    const anchored = await openSheet();
    // UNCHANGED, in both directions. The anchored panel keeps the ring…
    expect(anchored).toHaveClass('p-1');
    // …and gains none of the sheet's room, which on a 328px card hung off a
    // field would cost 32px of the seven columns the calendar divides.
    expect(anchored.className).not.toContain('px-4');
    expect(anchored.className).not.toContain('pt-3');
    expect(anchored.className).not.toContain('safe-area-inset-bottom');
    expect(anchored.className).not.toContain('min-height:500px');
  });

  it('switches presentation when the device changes class under an open picker', async () => {
    const pointer = stubPointerClass(false);
    render(<Host />);
    const panel = await openSheet();
    expect(panel.style.top).not.toBe('');

    // A 2-in-1 undocking. The popover used to be TORN DOWN here, because there
    // was no touch presentation to move it to; now there is, so the user keeps
    // the picker they opened and it re-presents underneath them.
    await waitFor(() => pointer.set(true));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Picker' }).className).toContain('bottom-0');
    });
    expect(screen.getByRole('dialog', { name: 'Picker' }).style.top).toBe('');
  });
});

/**
 * THE SHEET IS A NEW PRESENTATION AND MUST NOT COST ANY OF THE A11Y THE
 * ANCHORED PANEL PASSES ON.
 *
 * The desktop build clears WCAG 2.1 AA and 2.2 AA, and three of the things it
 * clears them WITH are shared code that a second presentation could quietly
 * bypass: the Tab cycle (§2.4.11 Focus Not Obscured passes by CONTAINMENT, not
 * by placement — read the handler's own comment before touching it), Escape as
 * the way out, and the dismissal putting focus back where it came from. The
 * fourth is new and belongs only to the sheet: a modal surface has to stop the
 * page behind it moving, or dismissing it returns the user to a form that has
 * scrolled out from under them.
 */
describe('sheet accessibility', () => {
  it('closes on Escape and hands focus back to the trigger', async () => {
    stubPointerClass(true);
    const user = userEvent.setup();
    render(<Host />);
    const panel = await openSheet();
    panel.focus();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Picker' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Open picker' })).toHaveFocus();
  });

  it('never lets Tab or Shift+Tab out of the open sheet (WCAG 2.2 §2.4.11)', async () => {
    stubPointerClass(true);
    const user = userEvent.setup();
    render(<Host />);
    const panel = await openSheet();
    screen.getByRole('button', { name: 'Inside one' }).focus();

    // The same loop the anchored panel is held to, deliberately — a behavioural
    // cycle rather than an assertion about the handler's shape, so it survives
    // any refactor that keeps the promise. "Behind the sheet" is the button
    // this must never reach.
    for (let press = 0; press < 12; press += 1) {
      await user.keyboard('{Tab}');
      expect(panel.contains(document.activeElement)).toBe(true);
    }
    for (let press = 0; press < 12; press += 1) {
      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(panel.contains(document.activeElement)).toBe(true);
    }
  });

  it('dismisses when the scrim is pressed', async () => {
    stubPointerClass(true);
    const user = userEvent.setup();
    render(<Host />);
    await openSheet();

    await user.click(document.querySelector('[data-picker-scrim]') as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Picker' })).not.toBeInTheDocument();
    });
  });

  it('locks the page behind the sheet, and restores what it found', async () => {
    stubPointerClass(true);
    // The state a `Modal` leaves behind — every call site of these fields is
    // inside one, so this is the realistic starting point, and clearing rather
    // than restoring it would unlock a page under a dialog that is still open.
    document.body.style.overflow = 'hidden';
    const user = userEvent.setup();
    render(<Host />);
    const panel = await openSheet();
    expect(document.body.style.overflow).toBe('hidden');

    panel.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Picker' })).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('leaves the page scrollable behind the anchored panel', async () => {
    stubPointerClass(false);
    render(<Host />);
    await openSheet();

    // A dropdown is not modal: the form behind it stays operable, and the
    // shell's `scroll` listener exists precisely so the panel FOLLOWS a page
    // that is still moving.
    expect(document.body.style.overflow).toBe('');
  });
});
