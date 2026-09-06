import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup } from '../RadioGroup';

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

const OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly', hint: 'Every seven days' },
];

/** The clickable option ROW — the styled element, not the native radio. */
function rowOf(name: string): HTMLElement {
  const radio = screen.getByRole('radio', { name: new RegExp(name) });
  const row = radio.closest('label');
  if (!row) throw new Error('option has no row');
  return row;
}

describe('RadioGroup', () => {
  it('is a labelled radiogroup of native radios', () => {
    render(
      <RadioGroup label="Repeat" name="repeat" options={OPTIONS} value="daily" onChange={vi.fn()} />
    );
    expect(screen.getByRole('radiogroup', { name: 'Repeat' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Daily/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Weekly/ })).not.toBeChecked();
  });

  it('reports the clicked option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RadioGroup label="Repeat" name="repeat" options={OPTIONS} value="daily" onChange={onChange} />
    );
    await user.click(screen.getByRole('radio', { name: /Weekly/ }));
    expect(onChange).toHaveBeenCalledWith('weekly');
  });

  it('gives every row a 44px target and marks the selected one', () => {
    render(
      <RadioGroup label="Repeat" name="repeat" options={OPTIONS} value="daily" onChange={vi.fn()} />
    );
    const selected = rowOf('Daily');
    const unselected = rowOf('Weekly');
    expect(selected.className).toContain('min-h-[44px]');
    expect(unselected.className).toContain('min-h-[44px]');
    expect(selected.className).toContain('border-ink');
    expect(selected.className).toContain('bg-bg-2');
    // The ink border REPLACES the hairline rather than layering over it (see
    // the same note in ChipSelect.test.tsx).
    expect(selected.className).not.toContain('border-line');
    expect(unselected.className).toContain('border-line-2');
    expect(unselected.className).not.toContain('bg-bg-2');
  });

  it('paints the radio itself with the ink accent', () => {
    render(
      <RadioGroup label="Repeat" name="repeat" options={OPTIONS} value="daily" onChange={vi.fn()} />
    );
    expect(screen.getByRole('radio', { name: /Daily/ }).className).toContain('accent-ink');
  });

  it('wires the error to the group and shows the alert glyph', () => {
    render(
      <RadioGroup
        label="Repeat"
        name="repeat"
        options={OPTIONS}
        value=""
        error="Pick one"
        onChange={vi.fn()}
      />
    );
    const group = screen.getByRole('radiogroup', { name: 'Repeat' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group.getAttribute('aria-describedby')).toContain('repeat-error');
    expect(document.querySelector('[data-icon="alert-circle-outline"]')).toBeInTheDocument();
  });

  it('describes the group by its hint', () => {
    render(
      <RadioGroup
        label="Repeat"
        name="repeat"
        options={OPTIONS}
        value="daily"
        hint="Applies to every dose"
        onChange={vi.fn()}
      />
    );
    const group = screen.getByRole('radiogroup', { name: 'Repeat' });
    expect(group.getAttribute('aria-describedby')).toContain('repeat-hint');
  });

  it('dims disabled rows at 50% and disables their radios', () => {
    render(
      <RadioGroup
        label="Repeat"
        name="repeat"
        options={OPTIONS}
        value="daily"
        disabled
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole('radio', { name: /Daily/ })).toBeDisabled();
    const row = rowOf('Daily');
    expect(row.className).toContain('opacity-50');
    // The cursor is PICKED, not layered: Tailwind emits `.cursor-not-allowed`
    // before `.cursor-pointer`, so a row carrying both would still say "click me".
    expect(row.className).toContain('cursor-not-allowed');
    expect(row.className).not.toContain('cursor-pointer');
  });

  it('keeps the pointer cursor on an enabled row', () => {
    render(
      <RadioGroup label="Repeat" name="repeat" options={OPTIONS} value="daily" onChange={vi.fn()} />
    );
    const row = rowOf('Daily');
    expect(row.className).toContain('cursor-pointer');
    expect(row.className).not.toContain('cursor-not-allowed');
  });
});
