import { render, screen } from '@testing-library/react';
import '@/i18n';
import { AdherenceCard, ADHERENCE_SHEET_PADDING } from '../AdherenceCard';
import { CareCardSkeleton } from '@/components/ui/Skeleton';
import { careCardShell } from '@/components/ui/careCard';
import { useWeeklyAdherence } from '@/hooks/useMedConfirmation';
import type { WeeklyAdherence } from '@/api/medicationConfirmations';

/**
 * HOME'S LOADING CARDS HAVE THE LOADED CARDS' INSET (owner report 2026-10-17,
 * mobile; web brought to parity). jsdom computes no Tailwind CSS, so this pins
 * the CLASS TOKENS; e2e/home-skeleton-inset.spec.ts measures the real pixels.
 */
vi.mock('@/hooks/useMedConfirmation', () => ({ useWeeklyAdherence: vi.fn() }));
const mockUseWeeklyAdherence = vi.mocked(useWeeklyAdherence);

function classes(el: HTMLElement): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

function setQuery(isLoading: boolean): void {
  mockUseWeeklyAdherence.mockReturnValue({
    data: isLoading
      ? undefined
      : ({
          taken: 12,
          scheduled: 14,
          adherence_rate: 86,
          start_date: '2026-08-30',
          end_date: '2026-09-05',
          daily_breakdown: [],
        } as WeeklyAdherence),
    isLoading,
    isError: false,
  } as unknown as ReturnType<typeof useWeeklyAdherence>);
}

describe('Home skeleton insets', () => {
  it('a care-card placeholder is drawn in the real care card shell (14px inset, 1.5px border)', () => {
    render(<CareCardSkeleton withAction />);
    const card = screen.getByTestId('care-card-skeleton');
    for (const token of careCardShell.split(' ')) expect(classes(card)).toContain(token);
    expect(classes(card)).toContain('p-3.5');
  });

  it('the adherence placeholder and the loaded adherence card share one inset', () => {
    setQuery(true);
    const { unmount } = render(<AdherenceCard circleId="c1" />);
    const skeleton = screen.getByTestId('adherence-skeleton');
    for (const token of ADHERENCE_SHEET_PADDING.split(' ')) expect(classes(skeleton)).toContain(token);
    unmount();

    setQuery(false);
    render(<AdherenceCard circleId="c1" />);
    const loaded = screen.getByTestId('adherence-card');
    for (const token of ADHERENCE_SHEET_PADDING.split(' ')) expect(classes(loaded)).toContain(token);
    expect(ADHERENCE_SHEET_PADDING).toBe('px-[22px] py-[22px]');
  });
});
