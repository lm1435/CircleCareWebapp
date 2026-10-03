import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { OtpInput, type OtpInputHandle } from '@/components/auth/OtpInput';

// Controlled wrapper so the component behaves like it does in the pages.
function Harness({ error }: { error?: string }) {
  const [code, setCode] = useState('');
  return (
    <>
      <OtpInput value={code} onChange={setCode} label="6-digit code" error={error} />
      <output data-testid="value">{code}</output>
    </>
  );
}

// Alphanumeric variant, mirroring how JoinCircleModal will use it.
function AlphanumericHarness() {
  const [code, setCode] = useState('');
  return (
    <>
      <OtpInput value={code} onChange={setCode} label="Invite code" alphanumeric />
      <output data-testid="value">{code}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole('textbox');

// A pre-filled field that reports every `onChange` to a spy — what the pages do
// when a rejected code is still sitting in the boxes and the person fixes it.
function FilledHarness({
  initial,
  alphanumeric = false,
  onReport,
}: {
  initial: string;
  alphanumeric?: boolean;
  onReport?: (code: string) => void;
}) {
  const [code, setCode] = useState(initial);
  return (
    <>
      <OtpInput
        value={code}
        onChange={(next) => {
          onReport?.(next);
          setCode(next);
        }}
        label="Code"
        alphanumeric={alphanumeric}
      />
      <output data-testid="value">{code}</output>
    </>
  );
}

const shown = () => boxes().map((box) => (box as HTMLInputElement).value).join('');
const focusedBox = () => boxes().indexOf(document.activeElement as HTMLInputElement);

describe('OtpInput', () => {
  it('renders six labeled boxes inside an accessible group', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: '6-digit code' })).toBeInTheDocument();
    expect(boxes()).toHaveLength(6);
    expect(screen.getByLabelText('Digit 1 of 6')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 6 of 6')).toBeInTheDocument();
  });

  // The "field" here is six boxes, not one DOM node — callers that need to
  // move focus into it (Modal's initialFocusRef, an incomplete-code error)
  // get an imperative handle instead of a plain element ref.
  it('exposes an imperative focus() that focuses the first box', () => {
    function RefHarness() {
      const ref = useRef<OtpInputHandle>(null);
      const [code, setCode] = useState('');
      return (
        <>
          <OtpInput ref={ref} value={code} onChange={setCode} label="6-digit code" />
          <button type="button" onClick={() => ref.current?.focus()}>
            focus it
          </button>
        </>
      );
    }
    render(<RefHarness />);
    screen.getByRole('button', { name: 'focus it' }).click();
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus();
  });

  it('auto-advances focus as digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const inputs = boxes();
    inputs[0].focus();
    await user.keyboard('123');
    expect(screen.getByTestId('value')).toHaveTextContent('123');
    expect(inputs[3]).toHaveFocus();
  });

  it('ignores non-numeric input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    boxes()[0].focus();
    await user.keyboard('a1b2');
    expect(screen.getByTestId('value')).toHaveTextContent('12');
  });

  it('backspace clears the current digit, then moves back to the previous box', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const inputs = boxes();
    inputs[0].focus();
    await user.keyboard('12');
    // Focus is now on box 3 (index 2), which is empty.
    await user.keyboard('{Backspace}');
    expect(screen.getByTestId('value')).toHaveTextContent('1');
    expect(inputs[1]).toHaveFocus();
  });

  it('distributes a pasted full code across all boxes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const inputs = boxes();
    inputs[0].focus();
    await user.paste('654321');
    expect(screen.getByTestId('value')).toHaveTextContent('654321');
    expect(inputs[5]).toHaveValue('1');
  });

  it('only the active box advertises the one-time-code autofill target', () => {
    render(<Harness />);
    expect(boxes()[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(boxes()[1]).toHaveAttribute('autocomplete', 'off');
  });

  it('marks boxes invalid and wires the error to the group when in error state', () => {
    render(<Harness error="Invalid or expired verification code." />);
    expect(boxes()[0]).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('group', { name: '6-digit code' })).toHaveAttribute('aria-describedby');
  });

  // THE BUG: every box is maxLength=1 and selects its character on focus, so a
  // keystroke replaces it. When the typed character EQUALS the one already in the
  // box the DOM value does not change, React fires no onChange, focus never
  // advanced, the selection collapsed and maxLength swallowed the rest of the code.
  // The usual way in: a wrong code is rejected and the person re-types it with one
  // character fixed. (user-event models this faithfully: against the old component
  // 123456 -> 123457 left the field at 123456 with focus still on box 1.)
  describe('re-typing a code over the characters already in the boxes', () => {
    // [name, alphanumeric, the rejected code, the same code with its last character fixed,
    //  a code that differs from `old` only at position 2, `old` again to re-type over it]
    const MODES: [string, boolean, string, string, string, string][] = [
      ['digit boxes', false, '123456', '123457', '121456', '123456'],
      ['alphanumeric boxes', true, 'ABC234', 'ABC235', 'ABB234', 'ABC234'],
    ];

    describe.each(MODES)('%s', (_name, alphanumeric, old, fixed, same, mid) => {
      it('re-typing the SAME code advances through every box without re-reporting it', async () => {
        const user = userEvent.setup();
        const onReport = vi.fn();
        render(<FilledHarness initial={old} alphanumeric={alphanumeric} onReport={onReport} />);
        boxes()[0].focus();
        await user.keyboard(old);
        expect(shown()).toBe(old);
        expect(screen.getByTestId('value')).toHaveTextContent(old);
        // Focus walked all the way to the last box...
        expect(focusedBox()).toBe(5);
        // ...and nothing was reported: the code never changed (VerifyEmailPage
        // auto-submits on every report of a full code).
        expect(onReport).not.toHaveBeenCalled();
      });

      it('re-typing the code with ONLY the last character fixed ends on the fixed code', async () => {
        const user = userEvent.setup();
        const onReport = vi.fn();
        render(<FilledHarness initial={old} alphanumeric={alphanumeric} onReport={onReport} />);
        boxes()[0].focus();
        await user.keyboard(fixed);
        expect(shown()).toBe(fixed);
        expect(screen.getByTestId('value')).toHaveTextContent(fixed);
        expect(focusedBox()).toBe(5);
        expect(onReport).toHaveBeenCalledTimes(1);
        expect(onReport).toHaveBeenCalledWith(fixed);
      });

      it('a single keystroke equal to the box moves focus to the next box', async () => {
        const user = userEvent.setup();
        render(<FilledHarness initial={old} alphanumeric={alphanumeric} />);
        boxes()[2].focus();
        await user.keyboard(old[2]);
        expect(focusedBox()).toBe(3);
        expect(shown()).toBe(old);
      });

      it('re-typing over a code whose middle characters differ stops stalling at each equal one', async () => {
        const user = userEvent.setup();
        render(<FilledHarness initial={same} alphanumeric={alphanumeric} />);
        boxes()[0].focus();
        // Positions 0,1 and 3..5 equal, position 2 differs.
        await user.keyboard(mid);
        expect(shown()).toBe(mid);
        expect(focusedBox()).toBe(5);
      });

      it('replaces a box whose selection was collapsed by the click (Safari un-does select-on-focus)', async () => {
        const user = userEvent.setup();
        render(<FilledHarness initial={old} alphanumeric={alphanumeric} />);
        // Caret after the character, nothing selected: maxLength=1 would swallow the key.
        const first = boxes()[0] as HTMLInputElement;
        first.focus();
        first.setSelectionRange(1, 1);
        await user.keyboard(old[0]);
        expect(focusedBox()).toBe(1);
        // A DIFFERENT character in a collapsed box is not swallowed either.
        const second = boxes()[1] as HTMLInputElement;
        second.setSelectionRange(1, 1);
        await user.keyboard(alphanumeric ? 'Z' : '9');
        expect(second.value).toBe(alphanumeric ? 'Z' : '9');
        expect(focusedBox()).toBe(2);
      });

      it('typing over the last box keeps focus (and the selection) there, so it can be replaced again', async () => {
        const user = userEvent.setup();
        render(<FilledHarness initial={old} alphanumeric={alphanumeric} />);
        boxes()[5].focus();
        await user.keyboard(old[5]);
        expect(focusedBox()).toBe(5);
        await user.keyboard(fixed[5]);
        expect(shown()).toBe(fixed);
        expect(focusedBox()).toBe(5);
      });

      it('typing into the empty boxes after clicking the first one still works', async () => {
        const user = userEvent.setup();
        render(<FilledHarness initial="" alphanumeric={alphanumeric} />);
        await user.click(boxes()[0]);
        await user.keyboard(fixed);
        expect(shown()).toBe(fixed);
        expect(focusedBox()).toBe(5);
      });
    });

    it('alphanumeric: lower-case re-typing is upper-cased and still advances over an equal character', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="ABC234" alphanumeric />);
      boxes()[0].focus();
      await user.keyboard('abc235');
      expect(shown()).toBe('ABC235');
      expect(focusedBox()).toBe(5);
    });

    it('a character the mode does not accept leaves the box and the focus alone', async () => {
      const user = userEvent.setup();
      const onReport = vi.fn();
      render(<FilledHarness initial="123456" onReport={onReport} />);
      boxes()[1].focus();
      await user.keyboard('a- ');
      expect(shown()).toBe('123456');
      expect(focusedBox()).toBe(1);
      // The box is still selected: the next real digit replaces it.
      await user.keyboard('9');
      expect(shown()).toBe('193456');
      expect(focusedBox()).toBe(2);
      expect(onReport).toHaveBeenCalledTimes(1);
    });

    it('alphanumeric: a dash or space typed between groups is dropped, not typed into a box', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="" alphanumeric />);
      boxes()[0].focus();
      await user.keyboard('ab-c 234');
      expect(shown()).toBe('ABC234');
    });

    // Shortcuts and OS compositions belong to the browser: the key handler only
    // takes a PLAIN printable key.
    it('does not take over shortcuts, AltGr/Option compositions or IME keystrokes', () => {
      render(<FilledHarness initial="123456" />);
      const box = boxes()[0];
      // fireEvent returns false when a handler called preventDefault().
      expect(fireEvent.keyDown(box, { key: '5' })).toBe(false);
      expect(fireEvent.keyDown(box, { key: 'a', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(box, { key: 'v', metaKey: true })).toBe(true);
      expect(fireEvent.keyDown(box, { key: '5', altKey: true })).toBe(true);
      expect(fireEvent.keyDown(box, { key: '5', isComposing: true })).toBe(true);
      expect(fireEvent.keyDown(box, { key: 'Process', keyCode: 229 })).toBe(true);
      expect(fireEvent.keyDown(box, { key: 'Unidentified', keyCode: 229 })).toBe(true);
      expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
      expect(fireEvent.keyDown(box, { key: 'Tab' })).toBe(true);
    });

    // Soft keyboards (Android, dictation, assistive tech) give keydown no usable
    // key, so the browser replaces the selected character itself. Chromium and
    // WebKit still fire beforeinput + input with the same value; React fires no
    // onChange for it, so OtpInput advances from the input event.
    describe('a keyboard that reports no usable key (input event only)', () => {
      const softType = (box: HTMLInputElement, data: string) => {
        box.focus();
        const init = { inputType: 'insertText', data, bubbles: true };
        fireEvent(box, new InputEvent('beforeinput', { ...init, cancelable: true }));
        fireEvent(box, new InputEvent('input', init));
      };

      it('advances when the typed character equals the one in the box', () => {
        const onReport = vi.fn();
        render(<FilledHarness initial="123456" onReport={onReport} />);
        softType(boxes()[2] as HTMLInputElement, '3');
        expect(focusedBox()).toBe(3);
        expect(shown()).toBe('123456');
        expect(onReport).not.toHaveBeenCalled();
      });

      it('leaves a real change to onChange (no double advance)', () => {
        render(<FilledHarness initial="123456" />);
        const box = boxes()[2] as HTMLInputElement;
        box.focus();
        fireEvent.change(box, { target: { value: '9' } });
        expect(shown()).toBe('129456');
        expect(focusedBox()).toBe(3);
      });

      it('does nothing for a character the mode rejects, or for composition input', () => {
        render(<FilledHarness initial="123456" />);
        softType(boxes()[2] as HTMLInputElement, 'x');
        expect(focusedBox()).toBe(2);
        const box = boxes()[2] as HTMLInputElement;
        const composing = { inputType: 'insertCompositionText', data: '3', bubbles: true };
        fireEvent(box, new InputEvent('input', composing));
        expect(focusedBox()).toBe(2);
      });
    });
  });

  describe('paste, delete and arrow keys (unchanged)', () => {
    it('a partial paste fills from the box it lands in and focuses the one after', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="12" />);
      boxes()[2].focus();
      await user.paste('345');
      expect(shown()).toBe('12345');
      expect(focusedBox()).toBe(5);
    });

    it('a paste over a filled code replaces from the box it lands in', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="123456" />);
      boxes()[3].focus();
      await user.paste('99');
      expect(shown()).toBe('123996');
      expect(focusedBox()).toBe(5);
    });

    it('an over-long paste is cut at the sixth box', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="" />);
      boxes()[0].focus();
      await user.paste('1234567890');
      expect(shown()).toBe('123456');
      expect(focusedBox()).toBe(5);
    });

    it('Backspace on a filled box clears just that box and stays put', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="123456" />);
      boxes()[2].focus();
      await user.keyboard('{Backspace}');
      expect(screen.getByTestId('value')).toHaveTextContent('12456');
      expect(focusedBox()).toBe(2);
    });

    it('Backspace on the first, empty box does nothing', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="" />);
      boxes()[0].focus();
      await user.keyboard('{Backspace}');
      expect(shown()).toBe('');
      expect(focusedBox()).toBe(0);
    });

    it('arrow keys move between boxes without changing the code, and stop at the ends', async () => {
      const user = userEvent.setup();
      render(<FilledHarness initial="123456" />);
      boxes()[0].focus();
      await user.keyboard('{ArrowLeft}');
      expect(focusedBox()).toBe(0);
      await user.keyboard('{ArrowRight}{ArrowRight}');
      expect(focusedBox()).toBe(2);
      await user.keyboard('{ArrowLeft}');
      expect(focusedBox()).toBe(1);
      boxes()[5].focus();
      await user.keyboard('{ArrowRight}');
      expect(focusedBox()).toBe(5);
      expect(shown()).toBe('123456');
    });
  });

  describe('alphanumeric mode', () => {
    it('pastes mixed-case/punctuated text as uppercase letters and digits across all boxes', async () => {
      const user = userEvent.setup();
      render(<AlphanumericHarness />);
      const inputs = boxes();
      inputs[0].focus();
      await user.paste('ab-c 123');
      expect(screen.getByTestId('value')).toHaveTextContent('ABC123');
      expect(inputs.map((box) => (box as HTMLInputElement).value)).toEqual([
        'A',
        'B',
        'C',
        '1',
        '2',
        '3',
      ]);
    });

    it('uses a text keyboard, uppercase auto-capitalize, and never advertises one-time-code', () => {
      render(<AlphanumericHarness />);
      const inputs = boxes();
      expect(inputs[0]).toHaveAttribute('inputmode', 'text');
      expect(inputs[0]).toHaveAttribute('autocapitalize', 'characters');
      expect(inputs[0]).toHaveAttribute('autocomplete', 'off');
      expect(inputs[1]).toHaveAttribute('autocomplete', 'off');
    });

    it('still uses inputMode="numeric" and one-time-code on the digit path', () => {
      render(<Harness />);
      expect(boxes()[0]).toHaveAttribute('inputmode', 'numeric');
      expect(boxes()[0]).toHaveAttribute('autocomplete', 'one-time-code');
    });

    it('labels boxes "Character N of M" instead of "Digit N of M"', () => {
      render(<AlphanumericHarness />);
      expect(screen.getByLabelText('Character 1 of 6')).toBeInTheDocument();
      expect(screen.getByLabelText('Character 6 of 6')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Digit \d of 6/)).not.toBeInTheDocument();
    });

    it('leaves digit-mode boxes labelled "Digit N of M"', () => {
      render(<Harness />);
      expect(screen.getByLabelText('Digit 1 of 6')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Character \d of 6/)).not.toBeInTheDocument();
    });
  });
});
