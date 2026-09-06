import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { searchDrugs, type DrugSearchResult } from '@/api/drugs';
import { DrugAutocomplete } from '../DrugAutocomplete';

vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn() };
});

const search = vi.mocked(searchDrugs);

const METFORMIN: DrugSearchResult = { rxcui: '6809', name: 'Metformin', strength: null, dosageForm: null };
const METHOTREXATE: DrugSearchResult = { rxcui: '6851', name: 'Methotrexate', strength: null, dosageForm: null };

/** A controlled host, the way both callers drive it. */
function Host({ onSelectDrug }: { onSelectDrug: (drug: DrugSearchResult | null) => void }) {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<DrugSearchResult | null>(null);
  return (
    <DrugAutocomplete
      id="med"
      label="Medication name"
      value={value}
      onChange={setValue}
      selectedDrug={selected}
      onSelectDrug={(drug) => {
        setSelected(drug);
        onSelectDrug(drug);
      }}
    />
  );
}

describe('DrugAutocomplete', () => {
  beforeEach(() => {
    search.mockReset();
    search.mockResolvedValue([METFORMIN, METHOTREXATE]);
  });

  it('searches after two characters and lists the matches as options', async () => {
    const user = userEvent.setup();
    render(<Host onSelectDrug={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'm');
    expect(search).not.toHaveBeenCalled();

    await user.type(input, 'e');
    expect(await screen.findByRole('option', { name: 'Metformin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Methotrexate' })).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    // One request for the settled text, not one per keystroke.
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toBe('me');
  });

  it('picks with the keyboard: the name fills in and the drug is reported', async () => {
    const user = userEvent.setup();
    const onSelectDrug = vi.fn();
    render(<Host onSelectDrug={onSelectDrug} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'me');
    await screen.findByRole('option', { name: 'Metformin' });

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(input).toHaveValue('Methotrexate');
    expect(onSelectDrug).toHaveBeenCalledWith(METHOTREXATE);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picks with the mouse', async () => {
    const user = userEvent.setup();
    const onSelectDrug = vi.fn();
    render(<Host onSelectDrug={onSelectDrug} />);

    await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'me');
    await user.click(await screen.findByRole('option', { name: 'Metformin' }));

    expect(screen.getByRole('combobox', { name: /Medication name/ })).toHaveValue('Metformin');
    expect(onSelectDrug).toHaveBeenCalledWith(METFORMIN);
  });

  it('drops the pick the moment the name is hand-edited', async () => {
    const user = userEvent.setup();
    const onSelectDrug = vi.fn();
    render(<Host onSelectDrug={onSelectDrug} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'me');
    await user.click(await screen.findByRole('option', { name: 'Metformin' }));
    expect(onSelectDrug).toHaveBeenLastCalledWith(METFORMIN);

    await user.type(input, ' XR');
    expect(onSelectDrug).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue('Metformin XR');
  });

  it('Escape closes the list without clearing the text, and does not reach the dialog', async () => {
    const user = userEvent.setup();
    const onDialogKey = vi.fn();
    render(
      <div onKeyDown={onDialogKey}>
        <Host onSelectDrug={vi.fn()} />
      </div>
    );

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'me');
    await screen.findByRole('option', { name: 'Metformin' });
    onDialogKey.mockClear();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveValue('me');
    expect(onDialogKey).not.toHaveBeenCalled();
  });

  it('the clear control empties the field and the pick', async () => {
    const user = userEvent.setup();
    const onSelectDrug = vi.fn();
    render(<Host onSelectDrug={onSelectDrug} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'me');
    await user.click(await screen.findByRole('option', { name: 'Metformin' }));
    await user.click(screen.getByRole('button', { name: 'Clear name' }));

    expect(input).toHaveValue('');
    expect(onSelectDrug).toHaveBeenLastCalledWith(null);
  });

  it('a failed lookup leaves a working text field', async () => {
    search.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<Host onSelectDrug={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'metformin');
    await waitFor(() => expect(search).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Searching medications')).toBeNull());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveValue('metformin');
  });
});
