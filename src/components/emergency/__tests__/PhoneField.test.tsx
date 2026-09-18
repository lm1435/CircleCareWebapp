import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import i18n from '@/i18n';
import { PhoneField } from '@/components/emergency/PhoneField';

function country(): HTMLSelectElement {
  return screen.getByLabelText('Country code') as HTMLSelectElement;
}
function phone(): HTMLInputElement {
  return screen.getByLabelText('Phone') as HTMLInputElement;
}

function field(
  value: string,
  countryCode: string | null | undefined,
  onChange = vi.fn()
): ReactElement {
  return (
    <PhoneField
      id="p"
      label="Phone"
      value={value}
      countryCode={countryCode}
      onChange={onChange}
    />
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('PhoneField', () => {
  it('offers all 23 countries in mobile order, labelled, with calling codes', () => {
    render(field('', null));
    const options = Array.from(country().options);
    expect(options).toHaveLength(23);
    expect(options[0]).toHaveTextContent('United States (+1)');
    expect(options[2]).toHaveTextContent('Mexico (+52)');
    expect(options[22]).toHaveTextContent('Cuba (+53)');
    expect(country().value).toBe('US');
  });

  it('localizes country names in Spanish', async () => {
    await i18n.changeLanguage('es');
    render(
      <PhoneField id="p" label="Teléfono" value="" countryCode="+52" onChange={vi.fn()} />
    );
    const select = screen.getByLabelText('Código de país') as HTMLSelectElement;
    expect(select.selectedOptions[0]).toHaveTextContent('México (+52)');
  });

  it('formats typed digits live and emits (national, callingCode)', () => {
    const onChange = vi.fn();
    render(field('', null, onChange));
    fireEvent.change(phone(), { target: { value: '3035551234' } });
    expect(phone().value).toBe('(303) 555-1234');
    expect(onChange).toHaveBeenLastCalledWith('(303) 555-1234', '+1');
  });

  it('switching country reformats the same digits and emits the new calling code', () => {
    const onChange = vi.fn();
    render(field('', null, onChange));
    fireEvent.change(phone(), { target: { value: '5512345678' } });
    fireEvent.change(country(), { target: { value: 'MX' } });
    expect(phone().value).toBe('55 1234 5678');
    expect(onChange).toHaveBeenLastCalledWith('55 1234 5678', '+52');
  });

  it('backspace past a just-closed "(555)" group makes progress', () => {
    render(field('', null));
    fireEvent.change(phone(), { target: { value: '555' } });
    expect(phone().value).toBe('(555)');
    fireEvent.change(phone(), { target: { value: '(555' } });
    expect(phone().value).toBe('55');
  });

  it('a pasted "+52 …" number switches the country', () => {
    const onChange = vi.fn();
    render(field('', null, onChange));
    fireEvent.change(phone(), { target: { value: '+52 55 1234 5678' } });
    expect(country().value).toBe('MX');
    expect(onChange).toHaveBeenLastCalledWith('55 1234 5678', '+52');
  });

  it('shows the invalid hint only after blur, and never blocks', () => {
    render(field('', null));
    fireEvent.change(phone(), { target: { value: '12' } });
    expect(screen.queryByText('Enter a valid phone number')).toBeNull();
    fireEvent.blur(phone());
    expect(screen.getByText('Enter a valid phone number')).toBeInTheDocument();
    expect(phone()).toHaveAttribute('aria-invalid', 'true');
  });

  describe('the format hint (length check, never isValid)', () => {
    const HINT = 'Enter a valid phone number';

    it('is NOT shown for an untouched pre-filled fictional 555 number, even after blur', () => {
      render(field('(555) 111-2222', '+1'));
      expect(phone().value).toBe('(555) 111-2222');
      fireEvent.focus(phone());
      fireEvent.blur(phone());
      expect(screen.queryByText(HINT)).toBeNull();
      expect(phone()).not.toHaveAttribute('aria-invalid');
    });

    it('is NOT shown for an untouched pre-filled SHORT number either (only user edits count)', () => {
      render(field('555-1234', '+1'));
      fireEvent.blur(phone());
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('IS shown after the user edits to too few digits and blurs', () => {
      render(field('(555) 111-2222', '+1'));
      fireEvent.change(phone(), { target: { value: '(555) 111-222' } });
      expect(screen.queryByText(HINT)).toBeNull();
      fireEvent.blur(phone());
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });

    it('is NOT shown when the user edits and then restores the exact seeded value', () => {
      render(field('(555) 111-2222', '+1'));
      fireEvent.change(phone(), { target: { value: '(555) 111-222' } });
      fireEvent.blur(phone());
      expect(screen.getByText(HINT)).toBeInTheDocument();
      fireEvent.change(phone(), { target: { value: '(555) 111-2222' } });
      fireEvent.blur(phone());
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('edit-then-restore of a seeded value that is itself too short shows nothing', () => {
      render(field('555-1234', '+1'));
      fireEvent.change(phone(), { target: { value: '55512345' } });
      fireEvent.change(phone(), { target: { value: '5551234' } });
      fireEvent.blur(phone());
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('focus + blur on an untouched SHORT seeded value (+52, 8 digits) shows nothing', () => {
      render(field('5512 3456', '+52'));
      fireEvent.focus(phone());
      fireEvent.blur(phone());
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('changing ONLY the country counts as a change (seeded US number → Mexico, wrong length)', () => {
      render(field('(555) 111-222', '+1'));
      fireEvent.blur(phone());
      expect(screen.queryByText(HINT)).toBeNull();
      fireEvent.change(country(), { target: { value: 'MX' } });
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });

    it('is NOT shown for a typed possible-length number that is not an assigned area code', () => {
      render(field('', null));
      fireEvent.change(phone(), { target: { value: '5551112222' } });
      fireEvent.blur(phone());
      expect(phone().value).toBe('(555) 111-2222');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('clears while the user is typing again, and returns on the next blur', () => {
      render(field('', null));
      fireEvent.change(phone(), { target: { value: '12' } });
      fireEvent.blur(phone());
      expect(screen.getByText(HINT)).toBeInTheDocument();
      fireEvent.change(phone(), { target: { value: '123' } });
      expect(screen.queryByText(HINT)).toBeNull();
      fireEvent.blur(phone());
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });
  });

  it('caps the stored phone at the backend max (20)', () => {
    const onChange = vi.fn();
    render(field('', null, onChange));
    fireEvent.change(phone(), { target: { value: '1234567890123456789012345' } });
    const [stored] = onChange.mock.calls.at(-1) as [string, string];
    expect(stored.length).toBeLessThanOrEqual(20);
  });

  describe('seeding from the stored record', () => {
    it.each([
      ['4165551234', '+1', 'CA', '(416) 555-1234'],
      ['7875551234', '+1', 'PR', '(787) 555-1234'],
      ['+52 55 1234 5678', undefined, 'MX', '55 1234 5678'],
      ['(303) 555-1234', null, 'US', '(303) 555-1234'],
    ])('%s (cc %s) seeds %s', (value, cc, iso2, display) => {
      const onChange = vi.fn();
      render(field(value, cc, onChange));
      expect(country().value).toBe(iso2);
      expect(phone().value).toBe(display);
      // Seeding never writes back.
      expect(onChange).not.toHaveBeenCalled();
    });

    it('a UK "+44…" record falls back to the default country, unchanged digits', () => {
      const onChange = vi.fn();
      render(field('+44 20 7946 0958', null, onChange));
      expect(country().value).toBe('US');
      expect(phone().value.replace(/\D/g, '')).toBe('442079460958');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('a record arriving AFTER mount (value "" first) still seeds', () => {
      const { rerender } = render(field('', undefined));
      expect(phone().value).toBe('');
      rerender(field('+52 55 1234 5678', undefined));
      expect(country().value).toBe('MX');
      expect(phone().value).toBe('55 1234 5678');
    });

    it('a late prop never overwrites what the user typed', () => {
      const { rerender } = render(field('', undefined));
      fireEvent.change(phone(), { target: { value: '3' } });
      fireEvent.change(phone(), { target: { value: '' } });
      rerender(field('5512345678', '+52'));
      expect(phone().value).toBe('');
      expect(country().value).toBe('US');
    });

    it('a parent echoing its own onChange back does not fight typing', () => {
      function Host(): ReactElement {
        const [v, setV] = useState({ phone: '', cc: '' });
        return (
          <PhoneField
            id="p"
            label="Phone"
            value={v.phone}
            countryCode={v.cc}
            onChange={(p, cc) => setV({ phone: p, cc })}
          />
        );
      }
      render(<Host />);
      fireEvent.change(phone(), { target: { value: '303' } });
      fireEvent.change(phone(), { target: { value: '(303) 5' } });
      expect(phone().value).toBe('(303) 5');
    });
  });
});
