import { act, render, screen, within } from '@testing-library/react';
import '@/i18n';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';

const ruleText = {
  minLength: 'At least 8 characters',
  uppercase: 'One uppercase letter',
  lowercase: 'One lowercase letter',
  number: 'One number',
  special: 'One special character',
};

function rowFor(text: string): HTMLElement {
  return screen.getByText(text).closest('li') as HTMLElement;
}

describe('PasswordRequirements', () => {
  it('renders all five rules unmet for an empty password', () => {
    render(<PasswordRequirements value="" />);
    Object.values(ruleText).forEach((text) => {
      const row = rowFor(text);
      expect(within(row).getByText('requirement not met yet')).toBeInTheDocument();
    });
  });

  it('marks only the satisfied rules as met as the password grows', () => {
    render(<PasswordRequirements value="abcdefgh" />);
    // length + lowercase satisfied; uppercase/number/special not.
    expect(within(rowFor(ruleText.minLength)).getByText('requirement met')).toBeInTheDocument();
    expect(within(rowFor(ruleText.lowercase)).getByText('requirement met')).toBeInTheDocument();
    expect(
      within(rowFor(ruleText.uppercase)).getByText('requirement not met yet')
    ).toBeInTheDocument();
    expect(
      within(rowFor(ruleText.number)).getByText('requirement not met yet')
    ).toBeInTheDocument();
    expect(
      within(rowFor(ruleText.special)).getByText('requirement not met yet')
    ).toBeInTheDocument();
  });

  it('marks every rule met for a fully compliant password', () => {
    render(<PasswordRequirements value="Secret#123" />);
    Object.values(ruleText).forEach((text) => {
      const row = rowFor(text);
      expect(within(row).getByText('requirement met')).toBeInTheDocument();
    });
  });

  // The visible list is no longer itself a live region — five items sharing
  // one `aria-live="polite"` re-announced all five, met and unmet, on every
  // keystroke.
  it('does not mark the visible list as a live region', () => {
    const { container } = render(<PasswordRequirements value="" />);
    expect(container.querySelector('ul[aria-live]')).not.toBeInTheDocument();
  });

  describe('the debounced met-count announcement', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function announcement(): HTMLElement {
      return screen.getByRole('status');
    }

    it('is a single sr-only polite live region', () => {
      render(<PasswordRequirements value="" />);
      const region = announcement();
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveClass('sr-only');
    });

    it('announces the initial count immediately on mount', () => {
      render(<PasswordRequirements value="abcdefgh" />);
      // length + lowercase satisfied — 2 of 5 — with no debounce delay needed
      // for the value the component mounted with.
      expect(announcement()).toHaveTextContent('2 of 5 requirements met');
    });

    it('waits for typing to pause before updating the announced count', () => {
      const { rerender } = render(<PasswordRequirements value="" />);
      expect(announcement()).toHaveTextContent('0 of 5 requirements met');

      rerender(<PasswordRequirements value="abcdefgh" />);
      // Not yet announced — still mid-debounce.
      expect(announcement()).toHaveTextContent('0 of 5 requirements met');

      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(announcement()).toHaveTextContent('0 of 5 requirements met');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(announcement()).toHaveTextContent('2 of 5 requirements met');
    });

    it('restarts the debounce on every change, so a rapid sequence only announces the final count', () => {
      const { rerender } = render(<PasswordRequirements value="" />);

      // Each intermediate value's met-count must differ from the last so the
      // effect's dependency actually changes and restarts the timer — two
      // renders in a row with the SAME count would otherwise skip resetting
      // it (React bails out when a `useEffect` dependency is unchanged),
      // which is fine in practice (nothing to re-announce) but would let this
      // test's own first timer fire on schedule and look like a false pass.
      rerender(<PasswordRequirements value="a" />); // lowercase only — 1 of 5
      act(() => {
        vi.advanceTimersByTime(300);
      });
      rerender(<PasswordRequirements value="aB" />); // + uppercase — 2 of 5
      act(() => {
        vi.advanceTimersByTime(300);
      });
      rerender(<PasswordRequirements value="Secret#123" />); // all five

      // None of the earlier values ever got 500ms of quiet to announce.
      expect(announcement()).toHaveTextContent('0 of 5 requirements met');

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(announcement()).toHaveTextContent('5 of 5 requirements met');
    });
  });
});
