import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipSelect } from '../ChipSelect';

describe('ChipSelect', () => {
  it('renders a labeled radiogroup of aria-checked radios', () => {
    render(
      <ChipSelect label="Blood type" options={['A+', 'O+']} value="O+" onChange={vi.fn()} />
    );

    const group = screen.getByRole('radiogroup', { name: 'Blood type' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'A+' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'O+' })).toHaveAttribute('aria-checked', 'true');
  });

  // One selection language — the selected chip uses ink, interactive state
  // (decision 2026-09-04), never the coral-deep treatment.
  it('uses the ink selection language for the selected chip, not bg-coral-deep', () => {
    render(<ChipSelect label="Blood type" options={['A+', 'O+']} value="O+" onChange={vi.fn()} />);
    const selected = screen.getByRole('radio', { name: 'O+' });
    expect(selected.className).toContain('bg-ink');
    expect(selected.className).not.toContain('bg-coral-deep');
    // The ink border REPLACES the hairline — two border-color utilities in one
    // class string are resolved by Tailwind's emit order, and `--color-line` is
    // declared after `--color-ink`, so the hairline would have won.
    expect(selected.className).toContain('border-ink');
    expect(selected.className).not.toContain('border-line');
  });

  // Spec §4.5: chips are 44 tall like every other control — the old 36px
  // "Round 7 slimming" is gone, and only this assertion keeps it gone.
  it('gives every chip a 44px target and the pill radius', () => {
    render(<ChipSelect label="Blood type" options={['A+', 'O+']} value="O+" onChange={vi.fn()} />);
    for (const name of ['A+', 'O+']) {
      const chip = screen.getByRole('radio', { name });
      expect(chip.className).toContain('min-h-[44px]');
      expect(chip.className).toContain('rounded-full');
      expect(chip.className).not.toContain('min-h-9');
    }
  });

  it('keeps the unselected chip on the hairline outline', () => {
    render(<ChipSelect label="Blood type" options={['A+', 'O+']} value="O+" onChange={vi.fn()} />);
    const unselected = screen.getByRole('radio', { name: 'A+' });
    expect(unselected.className).toContain('border-line');
    expect(unselected.className).toContain('text-ink');
    expect(unselected.className).not.toContain('bg-ink');
  });

  it('matches the value case-insensitively with trimming', () => {
    render(
      <ChipSelect label="Relationship" options={['Daughter']} value="  daughter " onChange={vi.fn()} />
    );
    expect(screen.getByRole('radio', { name: 'Daughter' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('reports the option value when an unselected chip is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipSelect label="Blood type" options={['A+', 'O+']} value={null} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'A+' }));
    expect(onChange).toHaveBeenCalledWith('A+');
  });

  it('clears the selection when the selected chip is clicked (allowDeselect default)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChipSelect label="Blood type" options={['O+']} value="O+" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'O+' }));
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

    await user.click(screen.getByRole('radio', { name: '08:00' }));
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

    await user.click(screen.getByRole('radio', { name: 'Morning (8:00 AM)' }));
    expect(onChange).toHaveBeenCalledWith('08:00');
  });

  // ── Roving tabindex + arrow-key navigation (mirrors SegmentedControl) ─────
  describe('keyboard navigation', () => {
    const OPTIONS = ['A+', 'B+', 'O+'];

    function Host({
      initial,
      onChangeSpy,
    }: {
      initial: string | null;
      onChangeSpy?: (v: string | null) => void;
    }) {
      const [value, setValue] = useState<string | null>(initial);
      return (
        <ChipSelect
          label="Blood type"
          options={OPTIONS}
          value={value}
          onChange={(next) => {
            onChangeSpy?.(next);
            setValue(next);
          }}
        />
      );
    }

    it('keeps only the checked chip (or the first, when none is checked) in the tab order', () => {
      render(<Host initial="B+" />);
      expect(screen.getByRole('radio', { name: 'A+' })).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('radio', { name: 'B+' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('radio', { name: 'O+' })).toHaveAttribute('tabindex', '-1');
    });

    it('falls back to the first chip for the tab stop when nothing is selected', () => {
      render(<Host initial={null} />);
      expect(screen.getByRole('radio', { name: 'A+' })).toHaveAttribute('tabindex', '0');
    });

    it('ArrowRight / ArrowLeft move the selection and the focus, wrapping at the ends', async () => {
      const user = userEvent.setup();
      render(<Host initial="A+" />);

      screen.getByRole('radio', { name: 'A+' }).focus();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('radio', { name: 'B+' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'B+' })).toHaveFocus();

      await user.keyboard('{ArrowLeft}');
      expect(screen.getByRole('radio', { name: 'A+' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'A+' })).toHaveFocus();

      // Wraps backwards off the first chip to the last.
      await user.keyboard('{ArrowLeft}');
      expect(screen.getByRole('radio', { name: 'O+' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'O+' })).toHaveFocus();
    });

    it('Home and End jump to the first and last chip', async () => {
      const user = userEvent.setup();
      render(<Host initial="B+" />);

      screen.getByRole('radio', { name: 'B+' }).focus();
      await user.keyboard('{End}');
      expect(screen.getByRole('radio', { name: 'O+' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'O+' })).toHaveFocus();

      await user.keyboard('{Home}');
      expect(screen.getByRole('radio', { name: 'A+' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'A+' })).toHaveFocus();
    });

    it('arrow keys never deselect — only a click on the selected chip does', async () => {
      const user = userEvent.setup();
      const onChangeSpy = vi.fn();
      render(<Host initial="A+" onChangeSpy={onChangeSpy} />);

      screen.getByRole('radio', { name: 'A+' }).focus();
      await user.keyboard('{ArrowRight}{ArrowLeft}');
      expect(onChangeSpy).not.toHaveBeenCalledWith(null);
    });
  });
});
