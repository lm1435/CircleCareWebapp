import { render, screen } from '@testing-library/react';
import { ChoiceTileButton } from '../ChoiceTileButton';
import { ChipSelect } from '../ChipSelect';
import { CHOICE_TILE_LABEL } from '../inputStyles';

// Owner 2026-11-07: choice-tile LABELS are weight 500 (the date row and name field are 500), so the options
// stop competing with the 600 section headings. Mobile twin: StackedChoice.test.tsx. Selection stays carried by
// the dark fill (bg-ink / text-cream), never by weight.
describe('choice tile label weight', () => {
  it('the shared tile label class is font-medium (500), not font-semibold', () => {
    expect(CHOICE_TILE_LABEL).toContain('font-medium');
    expect(CHOICE_TILE_LABEL).not.toContain('font-semibold');
  });

  it('ChoiceTileButton label (Starts / Ends) is font-medium, selected or not', () => {
    render(
      <>
        <ChoiceTileButton label="Starts" sub="8:00 AM" onClick={vi.fn()} />
        <ChoiceTileButton label="Ends" sub="2:00 PM" onClick={vi.fn()} selected />
      </>
    );
    for (const name of ['Starts', 'Ends']) {
      const label = screen.getByText(name);
      expect(label).toHaveClass('font-medium');
      expect(label).not.toHaveClass('font-semibold');
    }
    expect(screen.getByRole('button', { name: 'Ends, 2:00 PM' })).toHaveClass('bg-ink', 'text-cream');
  });

  it('ChipSelect tile labels (How often?) are font-medium', () => {
    render(
      <ChipSelect
        label="How often?"
        variant="tile"
        options={['Once', 'Every day']}
        value="Once"
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText('Once')).toHaveClass('font-medium');
    expect(screen.getByText('Every day')).toHaveClass('font-medium');
  });
});
