import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import i18n from '@/i18n';
import { SosCard } from '../SosCard';
import { Analytics } from '@/lib/analytics';

// 1.4.3 mobile parity: EmergencyInfoScreen's SOS card ("Tap to call" / "Dial {{number}}").
describe('SosCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    void i18n.changeLanguage('en');
  });

  it('POSITIVE: the number is visible, large, selectable text (never only inside a link)', () => {
    render(<SosCard number="999" />);
    const number = screen.getByTestId('sos-number');
    expect(number).toHaveTextContent('Dial 999');
    expect(number.closest('a')).toBeNull();
    expect(number.className).toContain('select-text');
    expect(screen.getByText('Tap to call')).toBeInTheDocument();
  });

  it('POSITIVE: the call button is a tel: link named for the number, and fires the dial event', () => {
    const spy = vi.spyOn(Analytics, 'emergencySosDialTapped').mockImplementation(() => {});
    render(<SosCard number="112" />);
    const link = screen.getByRole('link', { name: 'Dial 112' });
    expect(link).toHaveAttribute('href', 'tel:112');
    fireEvent.click(link);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith();
  });

  it('POSITIVE: Spanish is mobile wording', async () => {
    await i18n.changeLanguage('es');
    render(<SosCard number="911" />);
    expect(screen.getByTestId('sos-number')).toHaveTextContent('Llamar al 911');
    expect(screen.getByText('Toca para llamar')).toBeInTheDocument();
  });

  it('NEGATIVE: no terracotta text; the card uses the invariant sos tokens', () => {
    render(<SosCard number="911" />);
    const card = screen.getByTestId('sos-card');
    expect(card.className).toContain('bg-sos');
    expect(card.outerHTML).not.toMatch(/text-terracotta/);
  });
});
