import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnderlineTabs } from '../UnderlineTabs';

const OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

describe('UnderlineTabs', () => {
  it('is a labelled tablist with the selected tab in the tab order only', () => {
    render(<UnderlineTabs label="View" value="week" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByTestId('underline-tab-indicator')).toHaveLength(1);
  });

  it('click selects; arrow keys, Home and End move selection and focus (wrapping)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UnderlineTabs label="View" value="week" onChange={onChange} options={OPTIONS} />);
    await user.click(screen.getByRole('tab', { name: 'Month' }));
    expect(onChange).toHaveBeenLastCalledWith('month', { viaKeyboard: false });

    screen.getByRole('tab', { name: 'Week' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('month', { viaKeyboard: true });
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('day', { viaKeyboard: true });
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('month', { viaKeyboard: true });
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('day', { viaKeyboard: true });
  });

  it('an unknown value falls back to the first tab', () => {
    render(<UnderlineTabs label="View" value="nope" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
  });
});
