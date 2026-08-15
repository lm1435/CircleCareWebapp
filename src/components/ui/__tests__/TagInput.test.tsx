import { useState, type ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { TagInput, type TagInputProps } from '../TagInput';

const SUGGESTIONS = ['Penicillin', 'Sulfa drugs', 'Aspirin'];

function renderTagInput(overrides: Partial<TagInputProps> = {}) {
  const onChange = vi.fn();
  const props: TagInputProps = {
    id: 'conditions',
    label: 'Medical conditions',
    values: [],
    onChange,
    suggestions: SUGGESTIONS,
    placeholder: 'Search or add a condition…',
    ...overrides,
  };
  const view = render(<TagInput {...props} />);
  return { onChange, view, props };
}

/** Stateful harness so add→announce→re-render flows behave like real usage. */
function Harness({
  initial = [],
  ...overrides
}: Partial<TagInputProps> & { initial?: string[] }): ReactElement {
  const [values, setValues] = useState<string[]>(initial);
  return (
    <TagInput
      id="conditions"
      label="Medical conditions"
      values={values}
      onChange={setValues}
      suggestions={SUGGESTIONS}
      placeholder="Search or add a condition…"
      {...overrides}
    />
  );
}

describe('TagInput — selection basics', () => {
  it('renders selected values as removable pills named "Remove «tag»"', () => {
    renderTagInput({ values: ['Hypertension', 'Asthma'] });
    expect(screen.getByRole('button', { name: 'Remove Hypertension' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Asthma' })).toBeInTheDocument();
  });

  it('adds a tag when a suggestion chip is clicked and clears the input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/^Medical conditions/, { selector: 'input' });
    await user.type(input, 'peni');
    await user.click(screen.getByRole('button', { name: 'Penicillin' }));
    expect(screen.getByRole('button', { name: 'Remove Penicillin' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Medical conditions/, { selector: 'input' })).toHaveValue('');
    // Selected suggestion disappears from the chip list.
    expect(screen.queryByRole('button', { name: 'Penicillin' })).not.toBeInTheDocument();
  });

  it('removes a tag when its pill is clicked', () => {
    const { onChange } = renderTagInput({ values: ['Hypertension', 'Asthma'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hypertension' }));
    expect(onChange).toHaveBeenCalledWith(['Asthma']);
  });

  // WB6 REGRESSION — legacy records can carry duplicate tag values (this
  // component's dedup-on-add guard postdates some saved data). Removal used
  // to be by VALUE, so clicking one "Remove Gout" pill dropped BOTH — and
  // React logged a duplicate-key warning from the value-keyed list.
  it('removes only the clicked occurrence when duplicate values are present', () => {
    const { onChange } = renderTagInput({ values: ['Gout', 'Gout', 'Asthma'] });
    const removeButtons = screen.getAllByRole('button', { name: 'Remove Gout' });
    expect(removeButtons).toHaveLength(2);

    fireEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith(['Gout', 'Asthma']);
  });
});

describe('TagInput — custom (free-text) adds', () => {
  it('shows Add "«text»" when no suggestion matches and adds it on click', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTagInput();
    await user.type(screen.getByLabelText(/^Medical conditions/, { selector: 'input' }), 'Gout');
    const addButton = screen.getByRole('button', { name: 'Add "Gout"' });
    await user.click(addButton);
    expect(onChange).toHaveBeenCalledWith(['Gout']);
  });

  it('adds the custom tag on Enter with commas stripped', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTagInput();
    const input = screen.getByLabelText(/^Medical conditions/, { selector: 'input' });
    await user.type(input, 'Gout,, flare');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Gout flare']);
  });

  // WB6 REGRESSION — a SUBSTRING match used to be silently promoted to the
  // full suggestion on Enter: typing "Sulfa" (intending the allergy CLASS,
  // distinct from "Sulfa drugs") added "Sulfa drugs" instead — a data-accuracy
  // bug for allergy records. Enter must now add the typed text verbatim
  // whenever it isn't an EXACT match for a suggestion.
  it('Enter adds the typed text verbatim when it only SUBSTRING-matches a suggestion (does not silently swap in the suggestion)', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTagInput();
    await user.type(screen.getByLabelText(/^Medical conditions/, { selector: 'input' }), 'sulfa');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(['sulfa']);
    expect(onChange).not.toHaveBeenCalledWith(['Sulfa drugs']);
  });

  // The "Add «text»" custom chip must be offered ALONGSIDE the substring
  // suggestion, not suppressed by it — the user needs an explicit way to add
  // the shorter, distinct term.
  it('offers "Add «text»" alongside a substring-matched suggestion (WB6)', async () => {
    const user = userEvent.setup();
    renderTagInput();
    await user.type(screen.getByLabelText(/^Medical conditions/, { selector: 'input' }), 'Sulfa');
    expect(screen.getByRole('button', { name: 'Add "Sulfa"' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sulfa drugs' })).toBeInTheDocument();
  });

  // An EXACT (case-insensitive) match is the one case where Enter should
  // still prefer the suggestion — it adds the suggestion's canonical casing
  // and does NOT offer a redundant "Add «text»" chip.
  it('Enter adds the canonical suggestion on an EXACT (case-insensitive) match', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTagInput();
    const input = screen.getByLabelText(/^Medical conditions/, { selector: 'input' });
    await user.type(input, 'sulfa drugs');
    expect(screen.queryByRole('button', { name: 'Add "sulfa drugs"' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(['Sulfa drugs']);
  });

  it('does not submit an enclosing form on Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>
    );
    await user.type(screen.getByLabelText(/^Medical conditions/, { selector: 'input' }), 'Gout');
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('duplicate adds are no-ops (case-insensitive)', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTagInput({ values: ['Gout'] });
    const input = screen.getByLabelText(/^Medical conditions/, { selector: 'input' });
    await user.type(input, 'gout');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    // No Add "gout" chip is offered for a duplicate either.
    expect(screen.queryByRole('button', { name: 'Add "gout"' })).not.toBeInTheDocument();
  });

  it('truncates custom tags to maxTagLength', async () => {
    const user = userEvent.setup();
    const { onChange } = renderTagInput({ maxTagLength: 5 });
    const input = screen.getByLabelText(/^Medical conditions/, { selector: 'input' });
    await user.type(input, 'abcdefgh');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(['abcde']);
  });
});

describe('TagInput — filtering and show more', () => {
  it('typing filters suggestions (case/diacritic-insensitive)', async () => {
    const user = userEvent.setup();
    renderTagInput({ suggestions: ['Hipertensión', 'Asma'] });
    await user.type(screen.getByLabelText(/^Medical conditions/, { selector: 'input' }), 'hipertension');
    expect(screen.getByRole('button', { name: 'Hipertensión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Asma' })).not.toBeInTheDocument();
  });

  it('already-selected suggestions are excluded from the chip list', () => {
    renderTagInput({ values: ['penicillin'] }); // case-insensitive match
    expect(screen.queryByRole('button', { name: 'Penicillin' })).not.toBeInTheDocument();
  });

  it('collapses to 8 chips with a "Show more (N)" toggle', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, i) => `Condition ${i + 1}`);
    renderTagInput({ suggestions: many });
    const group = screen.getByRole('group', { name: 'Medical conditions' });
    expect(group.querySelectorAll('[aria-pressed]')).toHaveLength(8);

    await user.click(screen.getByRole('button', { name: 'Show more (4)' }));
    expect(group.querySelectorAll('[aria-pressed]')).toHaveLength(12);

    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(group.querySelectorAll('[aria-pressed]')).toHaveLength(8);
  });
});

describe('TagInput — limits', () => {
  it('hides the input and shows a limit hint at the tag cap', () => {
    renderTagInput({ values: ['A', 'B', 'C'], maxTags: 3 });
    expect(screen.queryByLabelText(/^Medical conditions/, { selector: 'input' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Limit reached — remove an entry to add another.')
    ).toBeInTheDocument();
    // Pills remain removable at cap.
    expect(screen.getByRole('button', { name: 'Remove A' })).toBeInTheDocument();
  });

  it('restores the input once a tag is removed at cap', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['A', 'B']} maxTags={2} />);
    expect(screen.queryByLabelText(/^Medical conditions/, { selector: 'input' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove B' }));
    expect(screen.getByLabelText(/^Medical conditions/, { selector: 'input' })).toBeInTheDocument();
  });
});

describe('TagInput — accessibility', () => {
  it('exposes suggestions as aria-pressed buttons inside a group named by the label', () => {
    renderTagInput();
    const group = screen.getByRole('group', { name: 'Medical conditions' });
    const chip = screen.getByRole('button', { name: 'Penicillin' });
    expect(group).toContainElement(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).toHaveAttribute('type', 'button');
  });

  it('announces adds and removals through the polite live region', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe('');

    await user.click(screen.getByRole('button', { name: 'Aspirin' }));
    expect(live).toHaveTextContent('Aspirin added');

    await user.click(screen.getByRole('button', { name: 'Remove Aspirin' }));
    expect(live).toHaveTextContent('Aspirin removed');
  });

  it('shows a labeled clear button while typing that empties the input', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    const input = screen.getByLabelText(/^Medical conditions/, { selector: 'input' });
    await user.type(input, 'dia');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('supports the full keyboard flow: tab to a suggestion, Enter adds it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['Hypertension']} />);
    // Natural tab order: pills → input → suggestions.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Remove Hypertension' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText(/^Medical conditions/, { selector: 'input' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Penicillin' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Remove Penicillin' })).toBeInTheDocument();
  });
});
