/**
 * 1.4.2 i18n audit C: the teaser's example shift times were hardcoded
 * "8:00 AM – 2:00 PM" in the strings. They are formatted at render time in the
 * viewer's clock. Mobile twin: mobile/src/__tests__/components/exampleTimesFollowClock.test.tsx.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { ShiftsTeaserDialog } from '../ShiftsTeaserDialog';

let mockHourCycle: '12h' | '24h' = '12h';
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => mockHourCycle }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { shiftsTeaserShown: vi.fn(), shiftsTeaserCtaTapped: vi.fn() },
}));

function renderTeaser(): string {
  render(
    <MemoryRouter>
      <ShiftsTeaserDialog source="toggle" onClose={() => {}} />
    </MemoryRouter>
  );
  return document.body.textContent ?? '';
}

beforeEach(() => {
  mockHourCycle = '12h';
});

describe('ShiftsTeaserDialog example times', () => {
  // POSITIVE
  it('12-hour viewer: 8:00 AM – 2:00 PM, 2:00 PM – 8:00 PM, 8:00 PM – 8:00 AM', () => {
    const text = renderTeaser();
    expect(text).toContain('8:00 AM – 2:00 PM');
    expect(text).toContain('2:00 PM – 8:00 PM');
    expect(text).toContain('8:00 PM – 8:00 AM');
  });

  it('24-hour viewer: 08:00 – 14:00, 14:00 – 20:00, 20:00 – 08:00', () => {
    mockHourCycle = '24h';
    const text = renderTeaser();
    expect(text).toContain('08:00 – 14:00');
    expect(text).toContain('14:00 – 20:00');
    expect(text).toContain('20:00 – 08:00');
  });

  // NEGATIVE
  it('24-hour viewer never sees AM/PM or a raw {{placeholder}}', () => {
    mockHourCycle = '24h';
    const text = renderTeaser();
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(text).not.toMatch(/\b[AP]M\b/);
    expect(text).not.toContain('{{');
  });
});
