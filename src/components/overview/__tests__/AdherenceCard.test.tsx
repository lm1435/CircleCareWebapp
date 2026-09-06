import { render, screen } from '@testing-library/react';
import '@/i18n';
import { AdherenceCard, barHeight, barRates } from '../AdherenceCard';
import { useWeeklyAdherence } from '@/hooks/useMedConfirmation';
import type { WeeklyAdherence } from '@/api/medicationConfirmations';

vi.mock('@/hooks/useMedConfirmation', () => ({ useWeeklyAdherence: vi.fn() }));
const mockUseWeeklyAdherence = vi.mocked(useWeeklyAdherence);

function daily(rates: number[]): WeeklyAdherence['daily_breakdown'] {
  return rates.map((rate, i) => ({
    date: `2026-09-0${i + 1}`,
    taken: rate,
    scheduled: 100,
    adherence_rate: rate,
  }));
}

function setQuery(opts: {
  data?: Partial<WeeklyAdherence>;
  isLoading?: boolean;
  isError?: boolean;
}): void {
  mockUseWeeklyAdherence.mockReturnValue({
    data: opts.data
      ? ({
          taken: 12,
          scheduled: 14,
          adherence_rate: 86,
          start_date: '2026-08-30',
          end_date: '2026-09-05',
          daily_breakdown: [],
          ...opts.data,
        } as WeeklyAdherence)
      : undefined,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
  } as unknown as ReturnType<typeof useWeeklyAdherence>);
}

describe('AdherenceCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the rounded percentage and the label', () => {
    setQuery({ data: { adherence_rate: 85.6, daily_breakdown: daily([100, 100, 50, 0, 100, 100, 75]) } });
    render(<AdherenceCard circleId="c1" />);
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Past 7 days')).toBeInTheDocument();
    expect(screen.getByText('Medications on schedule')).toBeInTheDocument();
  });

  it('draws seven bars at max(3, 52 × rate) with only the last at full opacity', () => {
    setQuery({ data: { daily_breakdown: daily([100, 50, 0, 25, 75, 100, 40]) } });
    render(<AdherenceCard circleId="c1" />);

    const expected = [52, 26, 3, 13, 39, 52, 20.8];
    expected.forEach((height, i) => {
      const bar = screen.getByTestId(`adherence-bar-${i}`);
      expect(bar).toHaveStyle({ height: `${height}px` });
      expect(bar).toHaveStyle({ opacity: i === 6 ? '1' : '0.55' });
    });
  });

  it('left-pads a short week so the newest day stays the full-opacity bar', () => {
    setQuery({ data: { daily_breakdown: daily([80, 100]) } });
    render(<AdherenceCard circleId="c1" />);
    // Five padded zero-days first (3px floor), then the two real ones.
    expect(screen.getByTestId('adherence-bar-0')).toHaveStyle({ height: '3px' });
    expect(screen.getByTestId('adherence-bar-4')).toHaveStyle({ height: '3px' });
    expect(screen.getByTestId('adherence-bar-5')).toHaveStyle({ height: '41.6px' });
    expect(screen.getByTestId('adherence-bar-6')).toHaveStyle({ height: '52px', opacity: '1' });
  });

  it('states the seven daily rates as text for screen readers', () => {
    setQuery({ data: { daily_breakdown: daily([100, 50, 0, 25, 75, 100, 40]) } });
    render(<AdherenceCard circleId="c1" />);
    expect(
      screen.getByText('Daily adherence for the past 7 days: 100%, 50%, 0%, 25%, 75%, 100%, 40%')
    ).toBeInTheDocument();
    // The bars themselves carry no accessible content.
    expect(screen.getByTestId('adherence-chart')).toHaveAttribute('aria-hidden', 'true');
  });

  // A circle with nothing on the books must never be greeted with "0%".
  it('renders nothing when the circle has no scheduled doses', () => {
    setQuery({ data: { scheduled: 0, adherence_rate: 0 } });
    const { container } = render(<AdherenceCard circleId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the query errored', () => {
    setQuery({ isError: true });
    const { container } = render(<AdherenceCard circleId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading placeholder while the query is in flight', () => {
    setQuery({ isLoading: true });
    render(<AdherenceCard circleId="c1" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  describe('geometry helpers', () => {
    it('floors every bar at 3px so a 0% day is still visible', () => {
      expect(barHeight(0)).toBe(3);
      expect(barHeight(0.01)).toBe(3);
      expect(barHeight(1)).toBe(52);
    });

    it('keeps at most the last seven days', () => {
      expect(barRates(daily([10, 20, 30, 40, 50, 60, 70, 80, 90]))).toEqual([
        0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
      ]);
    });

    it('returns seven zeroes when there is no breakdown at all', () => {
      expect(barRates(undefined)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });
});
