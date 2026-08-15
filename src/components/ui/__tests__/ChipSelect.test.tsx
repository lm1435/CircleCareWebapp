import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipSelect } from '../ChipSelect';

describe('ChipSelect', () => {
  it('renders a labeled role="group" of aria-pressed buttons', () => {
    render(
      <ChipSelect label="Blood type" options={['A+', 'O+']} value="O+" onChange={vi.fn()} />
    );

    const group = screen.getByRole('group', { name: 'Blood type' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A+' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'O+' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('matches the value case-insensitively with trimming', () => {
    render(
      <ChipSelect label="Relationship" options={['Daughter']} value="  daughter " onChange={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Daughter' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('reports the option value when an unselected chip is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipSelect label="Blood type" options={['A+', 'O+']} value={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'A+' }));
    expect(onChange).toHaveBeenCalledWith('A+');
  });

  it('clears the selection when the selected chip is clicked (allowDeselect default)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipSelect label="Blood type" options={['O+']} value="O+" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'O+' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('ignores clicks on the selected chip when allowDeselect is false', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChipSelect
        label="Common times"
        options={['08:00']}
        value="08:00"
        onChange={onChange}
        allowDeselect={false}
      />
    );

    await user.click(screen.getByRole('button', { name: '08:00' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders object options with a display label but reports the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ChipSelect
        label="Common times"
        options={[{ value: '08:00', label: 'Morning (8:00 AM)' }]}
        value={null}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Morning (8:00 AM)' }));
    expect(onChange).toHaveBeenCalledWith('08:00');
  });
});
