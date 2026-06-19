import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpInput } from '@/components/auth/OtpInput';

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

const boxes = () => screen.getAllByRole('textbox');

describe('OtpInput', () => {
  it('renders six labeled boxes inside an accessible group', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: '6-digit code' })).toBeInTheDocument();
    expect(boxes()).toHaveLength(6);
    expect(screen.getByLabelText('Digit 1 of 6')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 6 of 6')).toBeInTheDocument();
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
});
