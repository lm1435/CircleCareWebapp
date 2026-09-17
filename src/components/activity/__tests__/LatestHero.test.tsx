import { render, screen } from '@testing-library/react';
import '@/i18n';
import { LatestHero } from '@/components/activity/LatestHero';
import type { ActivityFeedItem } from '@/api/activityFeed';

// Task 17 (web mobile-parity wave): the hero now renders through the shared
// `Card` / `IconTile` / `Eyebrow` / `Badge` / `Avatar` primitives (spec §6.5)
// instead of a hand-rolled `<section>` + inline `<svg>` + arbitrary
// `text-[…]` sizes. These tests assert the NEW shape; the pre-parity
// assertions (a literal dead ".eyebrow" class, a hand-rolled "New" chip,
// `h-6!/w-6!` avatar override) are gone with the markup they described.

const mockUseHourCycle = vi.fn(() => '12h');
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

// Pin the "device" timezone — dev machine is America/Denver, tests must never
// depend on it.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

function makeActivity(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  return {
    id: 'activity-1',
    circle_id: 'circle-1',
    action_type: 'medication_confirmed',
    description: 'Confirmed Medication: Aspirin 100mg (taken)',
    created_at: new Date().toISOString(),
    actor: { id: 'user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
    ...overrides,
  };
}

describe('LatestHero', () => {
  it('renders as an accessible region named "Latest"', () => {
    render(<LatestHero activity={makeActivity()} timezone="America/New_York" />);

    expect(screen.getByRole('region', { name: 'Latest' })).toBeInTheDocument();
  });

  it('renders the "Latest" eyebrow in the medication type\'s deep color', () => {
    render(<LatestHero activity={makeActivity()} timezone="America/New_York" />);

    const eyebrow = screen.getByText('Latest');
    // The eyebrow is the shared `Text variant="eyebrow"` treatment (uppercase,
    // tracked) with the event-type deep color layered on top.
    expect(eyebrow.className).toContain('uppercase');
    expect(eyebrow.className).toContain('text-clay-deep!');
  });

  it('renders the "New" badge, never "Live" — the feed is fetched, not realtime', () => {
    render(<LatestHero activity={makeActivity()} timezone="America/New_York" />);

    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('shrinks the actor avatar to the row footer size (18px) with the important override', () => {
    render(<LatestHero activity={makeActivity()} timezone="America/New_York" />);

    // Initial-only avatar (mobile parity): "Pat Rivera" → "P".
    const avatar = screen.getByText('P').closest('span');
    expect(avatar?.className).toContain('h-[18px]!');
    expect(avatar?.className).toContain('w-[18px]!');
  });

  it('renders no accent rail down the leading edge', () => {
    const { container } = render(
      <LatestHero activity={makeActivity({ action_type: 'medication_confirmed' })} timezone="America/New_York" />
    );

    // ANCHORED FIRST. The selector below is right about what it looks for —
    // re-adding the span does fail it — but `querySelector(...)` returns null
    // just as readily for a component that rendered NOTHING, so on its own this
    // passes against `LatestHero` stubbed to `return null`. The named region is
    // the anchor (same pattern as `sidebarAssistant()` in
    // AppLayout.aiGate.test.tsx): a `getBy*` that THROWS when the hero is gone.
    expect(screen.getByRole('region', { name: 'Latest' })).toBeInTheDocument();
    // The event-type rail was removed with the card outline: the icon tile and
    // eyebrow carry the accent now. FALSIFY BY: re-adding the absolute span.
    expect(container.querySelector('span[aria-hidden="true"].absolute')).toBeNull();
  });
});
