import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { COARSE_POINTER_QUERY } from '@/hooks/useCoarsePointer';
import { DateField } from '../DateField';
import { PICKER_INDICATOR_HIDDEN } from '../inputStyles';
import { TimeField } from '../TimeField';

// The time panel reads the viewer's 12h/24h clock through React Query, which
// this file gives it no provider for — and the clock is irrelevant to a gate
// that is about the POINTER. Inject it, exactly as `TimePicker.test.tsx` does.
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
}));

/**
 * THE TOUCH SIDE OF THE PICKER — WHICH IS NOW THE SAME PICKER.
 *
 * THIS FILE USED TO ASSERT THE OPPOSITE, and the inversion is the change. It
 * pinned a GATE: on a coarse pointer the fields rendered no trigger, no
 * popover and no panel chunk, restored the transparent native indicator and
 * left Alt+ArrowDown to the browser — i.e. they reverted, exactly, to what they
 * were before the popover existed. That gate was the honest answer to three
 * measured defects, and it is gone because all three were solved rather than
 * because the reasoning was wrong. Keep the reasoning in view:
 *
 *   1. `PICKER_INDICATOR_HIDDEN` suppresses NOTHING in WebKit (a bare
 *      `<input type="date">` is 97px -> 97px there, against 148 -> 128 in
 *      Chromium), because WebKit never lays out an indicator and opens its
 *      date/time UI from the FOCUSED INPUT. So a popover on touch used to be
 *      the second picker on the field. ANSWERED by `readOnly`, below: iOS does
 *      not summon its wheel for an input it cannot edit, and the tap that used
 *      to summon it now opens ours. The width measurement is still pinned in
 *      `e2e/coarse-pointer.spec.ts` and matters MORE than before, because it is
 *      the whole reason `readOnly` is not optional.
 *   2. The anchored panel covered 65% of the Add Medication modal at 390x664
 *      and intercepted taps on Close, the event type, the name and the dosage.
 *      ANSWERED by the sheet presentation in `pickerPopover.tsx`.
 *   3. A 36px row is a mouse target. ANSWERED by `TOUCH_ROW_HEIGHT`.
 *
 * What is NOT inverted, and must not be: the value contract (`HH:MM` /
 * `YYYY-MM-DD` through `emitNativeChange`), the label, and the fact that the
 * native `<input>` is still the control the form reads.
 *
 * These are the DOM-level guarantees. That they hold in a real engine — where
 * the native picker actually exists — is proved separately, in a browser, with
 * `devices['Pixel 5']` / `iPhone 13`.
 */
beforeEach(() => {
  // jsdom ships no `matchMedia`, so it has to be defined, not spied on.
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TimeField on a coarse pointer', () => {
  it('renders the trigger button — our popover is the picker here too', () => {
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Choose a time' })).toBeInTheDocument();
  });

  it('suppresses the native indicator rather than restoring it', () => {
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Time');
    // The overlay used to come back here to keep the native wheel CLICKABLE.
    // Nothing should reach that wheel any more — `readOnly` closes the focus
    // route WebKit uses, and this closes the indicator route Chromium uses.
    expect(input).toHaveClass(...PICKER_INDICATOR_HIDDEN.split(' '));
    expect(input.className).not.toContain('[&::-webkit-calendar-picker-indicator]:opacity-0');
  });

  it('makes the input readOnly, which is what stops iOS opening its own wheel', () => {
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Time') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    // Still the same control, still focusable, still `type="time"` — a field
    // that "stood down" by becoming `type="text"` would pass every other
    // assertion here and break the value contract outright.
    expect(input).toHaveAttribute('type', 'time');
    expect(input.disabled).toBe(false);
  });

  it('opens our popover when the input itself is tapped', async () => {
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Time'));
    // The tap that used to belong to the browser. `findBy`: the panel is a lazy
    // chunk behind `Suspense`.
    expect(await screen.findByRole('dialog', { name: 'Time picker' })).toBeInTheDocument();
  });

  it('routes Alt+ArrowDown to our popover instead of leaving it to the browser', async () => {
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    const user = userEvent.setup();
    screen.getByLabelText('Time').focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(await screen.findByRole('dialog', { name: 'Time picker' })).toBeInTheDocument();
  });

  it('still exposes the label and the HH:MM value the contract is written on', () => {
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Time')).toHaveValue('08:30');
  });
});

describe('DateField on a coarse pointer', () => {
  it('renders the trigger button — our popover is the picker here too', () => {
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Choose a date' })).toBeInTheDocument();
  });

  it('suppresses the native indicator rather than restoring it', () => {
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Date');
    expect(input).toHaveClass(...PICKER_INDICATOR_HIDDEN.split(' '));
    expect(input.className).not.toContain('[&::-webkit-calendar-picker-indicator]:opacity-0');
  });

  it('makes the input readOnly, which is what stops iOS opening its own calendar', () => {
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input).toHaveAttribute('type', 'date');
    expect(input.disabled).toBe(false);
  });

  it('opens our popover when the input itself is tapped', async () => {
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Date'));
    expect(await screen.findByRole('dialog', { name: 'Date picker' })).toBeInTheDocument();
  });

  it('routes Alt+ArrowDown to our popover instead of leaving it to the browser', async () => {
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    const user = userEvent.setup();
    screen.getByLabelText('Date').focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(await screen.findByRole('dialog', { name: 'Date picker' })).toBeInTheDocument();
  });

  it('still exposes the label and the YYYY-MM-DD value the contract is written on', () => {
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-11');
  });
});

/**
 * THE VALUE CONTRACT SURVIVES `readOnly` — the one way this change could have
 * broken every call site at once.
 *
 * `emitNativeChange` writes through the `HTMLInputElement.prototype` value
 * setter and dispatches a native `input` event, which is what makes React see a
 * real `ChangeEvent` whose `target` is this input (all nine call sites read
 * `e.target.value`). `readonly` blocks USER editing and says nothing about
 * script, so this works — but "it should work" is exactly the register in which
 * a contract breaks silently, and the failure would be a picker that opens,
 * looks right, commits nothing, and reports no error.
 *
 * NOT A RED-FIRST BEHAVIOUR, and worth saying so: it passed the moment it was
 * written, because the mechanism was already correct. It is here as the guard
 * against the plausible "fix" — dropping the prototype setter for a plain
 * `input.value =`, or reaching for `defaultValue` — that a future reader might
 * try when something else about this field misbehaves.
 */
describe('picking a value on a coarse pointer still reaches the caller', () => {
  /**
   * READ THE VALUE IN THE HANDLER, NOT OFF THE SPY AFTERWARDS.
   *
   * `event.target` is the live `<input>`, and these fields are CONTROLLED: a
   * host whose `onChange` does not lift the value (which is what a bare
   * `vi.fn()` is) lets React re-render and put the old value straight back on
   * the node. Inspecting `mock.lastCall[0].target.value` after the fact
   * therefore reads `08:30` for a pick that genuinely emitted `08:45` — the
   * test fails while the code is right, which is the most expensive kind of
   * wrong. Capturing in the handler is the only reading taken at the moment the
   * caller actually sees it, and it is what all nine real call sites do.
   */
  it('TimeField emits HH:MM through the readOnly input', async () => {
    const emitted: string[] = [];
    render(
      <TimeField
        id="at"
        label="Time"
        value="08:30"
        onChange={(event) => emitted.push(event.target.value)}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Time'));
    await screen.findByRole('dialog', { name: 'Time picker' });

    const minutes = screen.getByRole('listbox', { name: 'Minute' });
    await user.click(within(minutes).getByRole('option', { name: '45' }));

    expect((screen.getByLabelText('Time') as HTMLInputElement).readOnly).toBe(true);
    expect(emitted).toContain('08:45');
  });

  it('DateField emits YYYY-MM-DD through the readOnly input', async () => {
    const emitted: string[] = [];
    render(
      <DateField
        id="on"
        label="Date"
        value="2026-09-11"
        onChange={(event) => emitted.push(event.target.value)}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Date'));
    await screen.findByRole('dialog', { name: 'Date picker' });

    await user.click(document.querySelector('[data-day="2026-09-24"]') as HTMLElement);

    expect((screen.getByLabelText('Date') as HTMLInputElement).readOnly).toBe(true);
    expect(emitted).toContain('2026-09-24');
  });
});

/**
 * A FINE POINTER KEEPS SEGMENTED TYPING, and that is the whole cost of
 * `readOnly` being scoped to touch.
 *
 * Typing `09`, `15`, `AM` into the three segments of an `<input type="time">`,
 * and arrow-key increment on the segment under the caret, are affordances the
 * native control gives away for free — and they are DESKTOP affordances.
 * Nobody types a date into a phone field; the OS wheel that has always been the
 * touch experience offers no typing either. So the field gives up nothing a
 * touch user had, and gives up nothing at all where it would be missed.
 */
describe('the fine pointer keeps the editable input', () => {
  function stubFine(): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  /**
   * TYPEABLE IS TWO CLAIMS, and `readOnly === false` is only the first.
   *
   * The second is that a mouse click on the input is the browser's — it puts a
   * caret in the segment under the pointer — and NOT a route to the popover.
   * The tap-to-open handler is coarse-only for exactly that reason; drop its
   * pointer check and a desktop user clicking into the month segment gets a
   * calendar thrown over the field instead, focus pulled into the panel, while
   * `readOnly` still reads false and the first assertion stays green.
   *
   * `aria-expanded` rather than the dialog's absence: the panel is a lazy chunk,
   * so "no dialog yet" is also what a click that DID open it looks like for a
   * tick. The menu state is synchronous with whatever opens it, so it cannot be
   * early.
   *
   * ── NOR LATER ─────────────────────────────────────────────────────────────
   *
   * An open DEFERRED off the click — `setTimeout(open, 30)`, or two animation
   * frames — is the same bug with a delay, and a fixed real wait can only ever
   * rule out delays shorter than itself (this used to wait 20ms, so a 30ms open
   * passed). So the clock is faked from before render, `requestAnimationFrame`
   * included, and drained deterministically — timers that schedule frames that
   * schedule timers, far past any plausible deferral — before anything is
   * asserted. No real time passes, so nothing depends on the runner's speed.
   */
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Dispatched by hand rather than through `userEvent`, because under vitest's
   * fake timers every `userEvent` call hangs: Testing Library's async wrapper
   * finishes on a `setTimeout(0)` that it only advances when it detects JEST's
   * fake timers. The sequence is what a mouse produces on an input — press,
   * focus, release, click — so the field's handlers see the same events.
   */
  function clickIntoInput(label: string): HTMLInputElement {
    const input = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.pointerDown(input);
    fireEvent.mouseDown(input);
    act(() => {
      input.focus();
    });
    fireEvent.pointerUp(input);
    fireEvent.mouseUp(input);
    fireEvent.click(input);
    return input;
  }

  /** Ten passes of a full second each, committing whatever each pass set. */
  async function drainDeferredWork(): Promise<void> {
    for (let pass = 0; pass < 10; pass += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
  }

  it('leaves TimeField typeable', async () => {
    stubFine();
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    expect((screen.getByLabelText('Time') as HTMLInputElement).readOnly).toBe(false);

    const input = clickIntoInput('Time');
    const trigger = screen.getByRole('button', { name: 'Choose a time' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await drainDeferredWork();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('leaves DateField typeable', async () => {
    stubFine();
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    expect((screen.getByLabelText('Date') as HTMLInputElement).readOnly).toBe(false);

    const input = clickIntoInput('Date');
    const trigger = screen.getByRole('button', { name: 'Choose a date' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await drainDeferredWork();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});

/**
 * `readonly` BARS AN INPUT FROM CONSTRAINT VALIDATION — HTML says so, and it is
 * the highest-risk consequence of the change.
 *
 * A `required` readOnly input reports `willValidate === false` and its form's
 * `checkValidity()` returns true however empty it is, so native submission is
 * NOT blocked. These tests pin what that means here, which is nothing, and pin
 * WHY, which is the part that could stop being true: validation in this app is
 * `useZodForm` — validate-on-submit against a schema, with `focusFirstError`
 * moving focus by field id — and the one form that passes `required` to a
 * picker field (`AddEventModal`: `scheduled_date`, `scheduled_time`, `endTime`)
 * carries `noValidate`, so the browser was never the thing enforcing it on
 * either pointer class. `src/__tests__/bans/pickerRequiredValidation.test.ts` is
 * what keeps that second half true as new forms are written.
 *
 * The ASSISTIVE contract is separate and is unaffected: `required` still draws
 * the `RequiredMarker` and still sets `aria-required`, which is what a screen
 * reader announces. `readonly` does not touch either.
 */
describe('required + readOnly on a coarse pointer', () => {
  it('keeps the assistive contract even though native validation stands down', () => {
    render(<TimeField id="at" label="Time" required value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText(/Time/) as HTMLInputElement;

    expect(input.readOnly).toBe(true);
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input.required).toBe(true);
    // The consequence, stated rather than assumed: a readOnly control is
    // barred from constraint validation, so nothing native will stop an empty
    // submit. Zod is what does, on every pointer class, in every one of these
    // forms.
    expect(input.willValidate).toBe(false);
  });

  it('does not silently block a form submit that Zod is supposed to own', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <DateField id="on" label="Date" required value="" onChange={vi.fn()} />
        <button type="submit">Save</button>
      </form>
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The submit REACHES the handler — which is the whole point. The failure
    // mode this rules out is the opposite one: a required readOnly field that
    // the browser refuses to submit and cannot be filled in, i.e. a form no
    // touch user can ever send.
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

/**
 * A pointer class that CHANGES WHILE THE POPOVER IS ALREADY OPEN.
 *
 * THIS BLOCK IS INVERTED TOO. It used to assert a TEARDOWN: the field unmounted
 * the popover when the device turned coarse under it, because there was no
 * touch presentation to move it to and an anchored panel on a phone was the
 * second picker on the field. There is one now, so the right answer flipped
 * from "stand down" to "re-present" — the user keeps the picker they opened,
 * in the shape the device they are now holding needs.
 *
 * What has NOT changed is why the hook is SUBSCRIBED rather than read once: a
 * 2-in-1 that docks or undocks flips the media query mid-interaction, and the
 * widget has to follow it. The consequence of ignoring it simply moved — it
 * used to be "an anchored panel survives onto a touch device", and it is now
 * "a 36px row survives onto a touch device".
 */
function stubPointerClass(initial: boolean): { set: (next: boolean) => void } {
  const listeners = new Set<() => void>();
  // ONE list object for every call: `useCoarsePointer`'s change handler reads
  // `list.matches` off the object it subscribed to, while its lazy initializer
  // calls `matchMedia` afresh. A stub that minted a new object per call would
  // let those two disagree and the flip would never be seen.
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

describe('the picker follows a LIVE change in pointer class', () => {
  it('TimeField re-presents the open popover as a sheet when the device turns coarse', async () => {
    const pointer = stubPointerClass(false);
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a time' }));
    const panel = await screen.findByRole('dialog', { name: 'Time picker' });
    expect(panel.className).not.toContain('bottom-0');

    act(() => pointer.set(true));

    // Still open — the user asked for a picker and is still owed one.
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Time picker' }).className).toContain('bottom-0');
    });
    // …and the field itself has changed hands too: the input can no longer be
    // typed into, so the device cannot summon a second picker from it.
    expect((screen.getByLabelText('Time') as HTMLInputElement).readOnly).toBe(true);
  });

  it('DateField re-presents the open popover as a sheet when the device turns coarse', async () => {
    const pointer = stubPointerClass(false);
    render(<DateField id="on" label="Date" value="2026-09-11" onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a date' }));
    const panel = await screen.findByRole('dialog', { name: 'Date picker' });
    expect(panel.className).not.toContain('bottom-0');

    act(() => pointer.set(true));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Date picker' }).className).toContain('bottom-0');
    });
    expect((screen.getByLabelText('Date') as HTMLInputElement).readOnly).toBe(true);
  });

  it('TimeField goes back to the anchored panel when the device turns fine again', async () => {
    const pointer = stubPointerClass(true);
    render(<TimeField id="at" label="Time" value="08:30" onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a time' }));
    await screen.findByRole('dialog', { name: 'Time picker' });

    act(() => pointer.set(false));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Time picker' }).className).not.toContain(
        'bottom-0'
      );
    });
    // The redock restores typing, which is the affordance `readOnly` was only
    // ever borrowing.
    expect((screen.getByLabelText('Time') as HTMLInputElement).readOnly).toBe(false);
  });
});
