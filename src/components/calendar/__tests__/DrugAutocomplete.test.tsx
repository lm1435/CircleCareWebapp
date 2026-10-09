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

  it('wires the combobox to its listbox: controls, activedescendant, selected option', async () => {
    const user = userEvent.setup();
    render(<Host onSelectDrug={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');

    await user.type(input, 'me');
    const listbox = await screen.findByRole('listbox', { name: 'Medication suggestions' });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    const first = screen.getByRole('option', { name: 'Metformin' });
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Methotrexate' })).toHaveAttribute('aria-selected', 'false');
    // Focus never leaves the field.
    expect(input).toHaveFocus();

    // Up from the first wraps to the last; Home / End jump.
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Methotrexate' }).id);
    await user.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('{End}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Methotrexate' }).id);
  });

  it('Escape closes and clears the highlight; ArrowDown reopens the same suggestions', async () => {
    const user = userEvent.setup();
    render(<Host onSelectDrug={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'me');
    await screen.findByRole('option', { name: 'Metformin' });
    await user.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Metformin' }).id);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('closes on selection and stays closed (a picked name does not reopen it)', async () => {
    const user = userEvent.setup();
    render(<Host onSelectDrug={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'me');
    await screen.findByRole('option', { name: 'Metformin' });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{ArrowDown}');
    await user.tab();
    await user.click(input);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  // The e2e axe failure: name typed, focus moved to the next field, and the
  // debounced response landed afterwards and opened the list over a field no
  // one was in — it stayed open until the dialog closed.
  it('a response that lands after the field lost focus does not open the list', async () => {
    let resolve: (rows: DrugSearchResult[]) => void = () => {};
    search.mockImplementation(() => new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(
      <>
        <Host onSelectDrug={vi.fn()} />
        <input aria-label="Dosage" />
      </>
    );

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'me');
    await waitFor(() => expect(search).toHaveBeenCalled());
    await user.click(screen.getByLabelText('Dosage'));
    resolve([METFORMIN, METHOTREXATE]);
    await waitFor(() => expect(screen.queryByText('Searching medications')).toBeNull());

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');

    // Coming back to the field shows what was found, without a new request.
    await user.click(input);
    expect(await screen.findByRole('option', { name: 'Metformin' })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(1);
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

  // The list is portalled out of the host: an `absolute` list inside a Modal's
  // scrolling body was clipped under the footer (first-run wizard, K8), so the
  // suggestions could not be picked. Placement is confined to the dialog.
  describe('placement inside a dialog', () => {
    afterEach(() => vi.restoreAllMocks());

    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height, left: 20, right: 320, width: 300, x: 20, y: top, toJSON: () => ({}) }) as DOMRect;

    function renderInDialog(anchorTop: number, footerTop: number) {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.hasAttribute('data-modal-footer')) return rect(footerTop, 60);
        if (this.getAttribute('role') === 'dialog') return rect(50, 500);
        return rect(anchorTop, 44);
      });
      return render(
        <div role="dialog" aria-label="wizard">
          <Host onSelectDrug={vi.fn()} />
          <div data-modal-footer />
        </div>
      );
    }

    // Inside the dialog, not document.body: outside an aria-modal dialog the
    // options are inert to a screen reader and outside every landmark (axe
    // `region`). Fixed positioning is what escapes the scrolling body's clip.
    it('renders the list inside the dialog element itself, fixed, above the modal backdrop', async () => {
      const user = userEvent.setup();
      renderInDialog(150, 500);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'me');
      const listbox = await screen.findByRole('listbox');
      expect(listbox.parentElement).toBe(screen.getByRole('dialog', { name: 'wizard' }));
      expect(listbox.style.position).toBe('fixed');
      expect(listbox).toHaveClass('z-[60]');
    });

    it('falls back to document.body when the field is not in a dialog', async () => {
      const user = userEvent.setup();
      render(<Host onSelectDrug={vi.fn()} />);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'me');
      const listbox = await screen.findByRole('listbox');
      expect(listbox.parentElement).toBe(document.body);
    });

    it('opens BELOW the field when there is room above the footer', async () => {
      const user = userEvent.setup();
      renderInDialog(150, 500);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'me');
      const listbox = await screen.findByRole('listbox');
      expect(listbox.style.top).toBe('198px'); // anchor bottom 194 + 4
      expect(listbox.style.bottom).toBe('');
      expect(listbox.style.maxHeight).toBe('256px');
    });

    it('never runs under the footer: short room below flips the list above the field, capped to the dialog', async () => {
      const user = userEvent.setup();
      renderInDialog(400, 460);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'me');
      const listbox = await screen.findByRole('listbox');
      expect(listbox.style.top).toBe('');
      expect(listbox.style.bottom).toBe(`${window.innerHeight - 400 + 4}px`);
      // room above = anchor top 400 - dialog top 50 - 8 gutters
      expect(listbox.style.maxHeight).toBe('256px');
    });

    it('shrinks to the room left when neither side fits the full height', async () => {
      const user = userEvent.setup();
      renderInDialog(150, 300);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'me');
      const listbox = await screen.findByRole('listbox');
      // below: floor 300 - anchor bottom 194 - 8 = 98 (< 132), above: 150 - 50 - 8 = 92 -> below wins (98 >= 92)
      expect(listbox.style.top).toBe('198px');
      expect(listbox.style.maxHeight).toBe('98px');
    });
  });
});
