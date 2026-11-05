import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { searchDrugs, type DrugSearchResult } from '@/api/drugs';
import { DrugAutocomplete } from '../DrugAutocomplete';

const { capture, searchCompleted } = vi.hoisted(() => ({ capture: vi.fn(), searchCompleted: vi.fn() }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    drugSuggestionUseAsTyped: (...a: unknown[]) => capture(...a),
    drugSearchCompleted: (...a: unknown[]) => searchCompleted(...a),
  },
}));

vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn() };
});

const search = vi.mocked(searchDrugs);

const METFORMIN: DrugSearchResult = { rxcui: '6809', name: 'Metformin', strength: null, dosageForm: null };
const METHOTREXATE: DrugSearchResult = { rxcui: '6851', name: 'Methotrexate', strength: null, dosageForm: null };

/** A controlled host, the way both callers drive it. */
function Host({
  onSelectDrug,
  onUseAsTyped,
}: {
  onSelectDrug: (drug: DrugSearchResult | null) => void;
  onUseAsTyped?: () => void;
}) {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<DrugSearchResult | null>(null);
  return (
    <DrugAutocomplete
      id="med"
      label="Medication name"
      value={value}
      onChange={setValue}
      selectedDrug={selected}
      onUseAsTyped={onUseAsTyped}
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

  it('while a newer search loads, rows that no longer match the typed text are hidden (Zy -> Ibuprofen)', async () => {
    const ZY: DrugSearchResult = { rxcui: '5', name: 'Zy-19489', strength: null, dosageForm: null };
    const ZYRTEC: DrugSearchResult = { rxcui: '6', name: 'Zyrtec', strength: null, dosageForm: null };
    const IBU: DrugSearchResult = { rxcui: '7', name: 'Ibuprofen 200 MG', strength: null, dosageForm: null };
    let resolveZyr: (rows: DrugSearchResult[]) => void = () => {};
    search
      .mockResolvedValueOnce([ZY, ZYRTEC])
      .mockImplementationOnce(() => new Promise((r) => (resolveZyr = r)))
      .mockResolvedValueOnce([IBU]);
    const user = userEvent.setup();
    render(<Host onSelectDrug={vi.fn()} />);

    const input = screen.getByRole('combobox', { name: /Medication name/ });
    await user.type(input, 'zy');
    expect(await screen.findByRole('option', { name: 'Zy-19489' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Zyrtec' })).toBeInTheDocument();

    await user.type(input, 'r'); // in flight: "Zyrtec" still matches, "Zy-19489" does not
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('option', { name: 'Zy-19489' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Zyrtec' })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'Ibuprofen'); // nothing old matches
    expect(screen.queryByRole('option', { name: 'Zyrtec' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Zy-19489' })).toBeNull();

    await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    resolveZyr([ZYRTEC]); // the superseded "zyr" answer lands late and is dropped
    expect(await screen.findByRole('option', { name: 'Ibuprofen 200 MG' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Zyrtec' })).toBeNull();
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
    // (Onboarding 1.3.1: the LAST option is now the "Use ... as typed" row.)
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByTestId('drug-use-as-typed').id);
    await user.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('{End}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByTestId('drug-use-as-typed').id);
  });

  describe('"Use \u201Cx\u201D as typed" row (onboarding 1.3.1)', () => {
    it('is the LAST row of the list, naming what was typed', async () => {
      const user = userEvent.setup();
      render(<Host onSelectDrug={vi.fn()} />);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'meh');
      const options = await screen.findAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual([
        'Metformin',
        'Methotrexate',
        'Use \u201Cmeh\u201D as typed',
      ]);
    });

    it('keeps the typed name with NO drug id and reports it', async () => {
      const user = userEvent.setup();
      const onSelectDrug = vi.fn();
      const onUseAsTyped = vi.fn();
      render(<Host onSelectDrug={onSelectDrug} onUseAsTyped={onUseAsTyped} />);
      const input = screen.getByRole('combobox', { name: /Medication name/ });
      await user.type(input, 'meh');
      await user.click(await screen.findByTestId('drug-use-as-typed'));

      expect(input).toHaveValue('meh');
      expect(onUseAsTyped).toHaveBeenCalledTimes(1);
      expect(onSelectDrug).not.toHaveBeenCalled();
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('reports use-as-typed with a bucket and no typed text', async () => {
      const user = userEvent.setup();
      capture.mockClear();
      render(<Host onSelectDrug={vi.fn()} />);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'meh');
      await user.click(await screen.findByTestId('drug-use-as-typed'));
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledWith(true, 3);
      expect(JSON.stringify(capture.mock.calls)).not.toContain('meh');
    });

    it('is reachable and pickable with the keyboard', async () => {
      const user = userEvent.setup();
      const onUseAsTyped = vi.fn();
      render(<Host onSelectDrug={vi.fn()} onUseAsTyped={onUseAsTyped} />);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'meh');
      await screen.findByTestId('drug-use-as-typed');
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
      expect(onUseAsTyped).toHaveBeenCalledTimes(1);
    });

    it('stands ALONE when the directory answers empty, so an unknown drug never blocks', async () => {
      search.mockResolvedValue([]);
      const user = userEvent.setup();
      render(<Host onSelectDrug={vi.fn()} />);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'Doliprane');
      const options = await screen.findAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('Use \u201CDoliprane\u201D as typed');
    });

    it('does not appear before the search has answered or below the minimum length', async () => {
      const user = userEvent.setup();
      render(<Host onSelectDrug={vi.fn()} />);
      await user.type(screen.getByRole('combobox', { name: /Medication name/ }), 'm');
      expect(screen.queryByTestId('drug-use-as-typed')).toBeNull();
    });
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

// TestFlight 1.4.0 (13) feedback, web parity: "Searching medications" showed on every keystroke.
describe('DrugAutocomplete lookup feedback (fake clock)', () => {
  const ZY: DrugSearchResult = { rxcui: '5', name: 'Zy-19489', strength: null, dosageForm: null };
  const ZYRTEC: DrugSearchResult = { rxcui: '6', name: 'Zyrtec', strength: null, dosageForm: null };

  beforeEach(() => {
    vi.useFakeTimers();
    search.mockReset();
    searchCompleted.mockReset();
    capture.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  /** A pending answer that, like axios, rejects with a cancel when its signal aborts. */
  function pendingSearch() {
    let resolve: (rows: DrugSearchResult[]) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const impl = (_q: string, signal?: AbortSignal) =>
      new Promise<DrugSearchResult[]>((res, rej) => {
        resolve = res;
        reject = rej;
        signal?.addEventListener('abort', () => rej(Object.assign(new Error('canceled'), { name: 'CanceledError' })));
      });
    return { impl, resolve: (rows: DrugSearchResult[]) => resolve(rows), reject: (e: unknown) => reject(e) };
  }
  const box = () => screen.getByRole('combobox', { name: /Medication name/ });
  const typeText = (text: string) => {
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: text } });
  };
  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  it('shows no "Searching medications" while typing or during the 300 ms debounce', async () => {
    const p = pendingSearch();
    search.mockImplementation(p.impl);
    render(<Host onSelectDrug={vi.fn()} />);
    for (const text of ['Ty', 'Tyl', 'Tylo', 'Tylon']) {
      typeText(text);
      expect(screen.queryByText('Searching medications')).toBeNull();
      await advance(100);
      expect(screen.queryByText('Searching medications')).toBeNull();
    }
    await advance(299);
    expect(screen.queryByText('Searching medications')).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toBe('Tylon');
  });

  it('an answer within 500 ms of being SENT never shows it', async () => {
    const p = pendingSearch();
    search.mockImplementation(p.impl);
    render(<Host onSelectDrug={vi.fn()} />);
    typeText('met');
    await advance(300 + 499);
    expect(screen.queryByText('Searching medications')).toBeNull();
    await act(async () => p.resolve([METFORMIN]));
    await advance(1000);
    expect(screen.queryByText('Searching medications')).toBeNull();
    expect(screen.getByRole('option', { name: 'Metformin' })).toBeInTheDocument();
  });

  it('a SLOW lookup shows it after 500 ms with the clear control still there; the answer removes it', async () => {
    const p = pendingSearch();
    search.mockImplementation(p.impl);
    render(<Host onSelectDrug={vi.fn()} />);
    typeText('met');
    await advance(300 + 500);
    expect(screen.getByText('Searching medications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear name' })).toBeInTheDocument();
    await act(async () => p.resolve([METFORMIN]));
    expect(screen.queryByText('Searching medications')).toBeNull();
  });

  it('a keystroke while a lookup is in flight keeps the rows that still match on screen (no close/reopen)', async () => {
    const p = pendingSearch();
    search.mockResolvedValueOnce([ZY, ZYRTEC]).mockImplementation(p.impl);
    render(<Host onSelectDrug={vi.fn()} />);
    typeText('zy');
    await advance(300);
    expect(screen.getByRole('option', { name: 'Zyrtec' })).toBeInTheDocument();
    typeText('zyr');
    await advance(300); // "zyr" sent, pending
    typeText('zyrt'); // aborts the "zyr" request
    await advance(0);
    expect(screen.getByRole('option', { name: 'Zyrtec' })).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(searchCompleted.mock.calls.map((c) => c[2])).toEqual(['matches', 'superseded']); // reported once, as replaced
  });

  it('no match: the "as typed" row stands alone and reports had_suggestions=false', async () => {
    search.mockResolvedValue([]);
    render(<Host onSelectDrug={vi.fn()} />);
    typeText('Tylon');
    await advance(300);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Use \u201CTylon\u201D as typed');
    fireEvent.mouseDown(options[0]);
    expect(capture).toHaveBeenCalledWith(false, 5);
  });

  it('a failed lookup (timeout) shows no row and no hint', async () => {
    search.mockRejectedValue({ success: false, error: { code: 'RXNORM_API_TIMEOUT' } });
    render(<Host onSelectDrug={vi.fn()} />);
    typeText('Tylon');
    await advance(300);
    await advance(1000);
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByText('Searching medications')).toBeNull();
  });

  describe('drug_search_completed', () => {
    it('duration runs from the LAST KEYSTROKE, request from SEND', async () => {
      const p = pendingSearch();
      search.mockImplementation(p.impl);
      render(<Host onSelectDrug={vi.fn()} />);
      typeText('met');
      await advance(300);
      await advance(1200);
      await act(async () => p.resolve([METFORMIN]));
      expect(searchCompleted).toHaveBeenCalledTimes(1);
      const [durationMs, requestMs, result] = searchCompleted.mock.calls[0];
      expect(result).toBe('matches');
      expect(durationMs).toBeGreaterThanOrEqual(1500);
      expect(durationMs).toBeLessThan(1600);
      expect(requestMs).toBeGreaterThanOrEqual(1200);
      expect(requestMs).toBeLessThan(1300);
    });

    it('a debounce that fires LATE shows in the duration, not in the request', async () => {
      const p = pendingSearch();
      search.mockImplementation(p.impl);
      render(<Host onSelectDrug={vi.fn()} />);
      typeText('met');
      vi.setSystemTime(Date.now() + 6000); // a busy main thread: the clock moves, the timer has not run
      await advance(300);
      await advance(100);
      await act(async () => p.resolve([METFORMIN]));
      const [durationMs, requestMs, result] = searchCompleted.mock.calls[0];
      expect(result).toBe('matches');
      expect(durationMs).toBeGreaterThan(6000);
      expect(requestMs).toBeLessThan(200);
    });

    it('a lookup replaced before it answers reports "superseded" once, never the query', async () => {
      const p = pendingSearch();
      search.mockImplementationOnce(p.impl).mockResolvedValueOnce([METFORMIN]);
      render(<Host onSelectDrug={vi.fn()} />);
      typeText('met');
      await advance(300);
      await advance(900);
      typeText('metf');
      await advance(300);
      expect(searchCompleted.mock.calls.map((c) => c[2])).toEqual(['superseded', 'matches']);
      const [durationMs, requestMs] = searchCompleted.mock.calls[0];
      expect(durationMs).toBeGreaterThanOrEqual(1200);
      expect(requestMs).toBeGreaterThanOrEqual(900);
      expect(requestMs).toBeLessThan(1000);
      expect(JSON.stringify(searchCompleted.mock.calls)).not.toMatch(/met/i);
    });

    it('a keystroke inside the debounce sent nothing, so nothing is reported for it', async () => {
      search.mockResolvedValue([METFORMIN]);
      render(<Host onSelectDrug={vi.fn()} />);
      typeText('met');
      await advance(100);
      typeText('metf');
      await advance(300);
      expect(search).toHaveBeenCalledTimes(1);
      expect(searchCompleted.mock.calls.map((c) => c[2])).toEqual(['matches']);
    });

    it('the clear (X) while a lookup runs is not "superseded", and the next keystroke does not report it', async () => {
      const p = pendingSearch();
      search.mockImplementation(p.impl);
      render(<Host onSelectDrug={vi.fn()} />);
      typeText('met');
      await advance(300);
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
      typeText('m');
      expect(searchCompleted).not.toHaveBeenCalled();
    });

    it('"no_match", "timeout" (backend deadline / axios), "error"; never the query', async () => {
      search
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce({ error: { code: 'RXNORM_API_TIMEOUT' } })
        .mockRejectedValueOnce({ code: 'ECONNABORTED' })
        .mockRejectedValueOnce({ error: { code: 'RATE_LIMIT' } });
      render(<Host onSelectDrug={vi.fn()} />);
      for (const text of ['xq', 'xqz', 'xqzz', 'xqzzz']) {
        typeText(text);
        await advance(300);
      }
      expect(searchCompleted.mock.calls.map((c) => c[2])).toEqual(['no_match', 'timeout', 'timeout', 'error']);
      expect(JSON.stringify(searchCompleted.mock.calls)).not.toContain('xq');
    });
  });
});
