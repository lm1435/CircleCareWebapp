import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { ActivityItem } from '@/components/activity/ActivityItem';
import type { ActivityFeedItem } from '@/api/activityFeed';

// The "Scheduled for {date}" late note compares `metadata.scheduled_date` (a naive day in the CIRCLE's
// zone) with the day the dose was confirmed. That day must be read in the circle's zone, not the
// viewer's browser zone, and Today/Yesterday in the label is judged in the circle zone too.

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// The viewer's "device" zone is Denver; the circle zones are passed explicitly. (Intl spy, same
// pattern as ActivityItem.test.tsx, so the result does not depend on the machine zone.)
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Denver',
} as Intl.ResolvedDateTimeFormatOptions);

function makeActivity(created_at: string, scheduled_date: string): ActivityFeedItem {
  return {
    id: 'a1',
    circle_id: 'circle-1',
    action_type: 'medication_confirmed',
    description: 'Confirmed Medication: Aspirin 100mg (taken)',
    created_at,
    actor: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
    metadata: { scheduled_date },
  } as ActivityFeedItem;
}

function renderItem(activity: ActivityFeedItem, timezone: string | null) {
  return render(
    <MemoryRouter>
      <ul>
        <ActivityItem activity={activity} timezone={timezone} />
      </ul>
    </MemoryRouter>
  );
}

describe('ActivityItem late note is judged on the circle day', () => {
  afterEach(() => vi.useRealTimers());

  it('shows no note when confirmed on the scheduled circle day although the viewer is on the previous day', () => {
    // 09:05 Tokyo on Nov 11 = Nov 10 17:05 Denver.
    renderItem(makeActivity('2026-11-11T00:05:00Z', '2026-11-11'), 'Asia/Tokyo');
    expect(screen.queryByText(/Scheduled for/)).not.toBeInTheDocument();
  });

  it('shows no note when confirmed on the same circle day in the same zone', () => {
    renderItem(makeActivity('2026-11-10T20:00:00Z', '2026-11-10'), 'America/Denver');
    expect(screen.queryByText(/Scheduled for/)).not.toBeInTheDocument();
  });

  it('shows the note when confirmed on a later circle day', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') });
    renderItem(makeActivity('2026-11-11T00:05:00Z', '2026-11-09'), 'Asia/Tokyo');
    expect(screen.getByText('Scheduled for Nov 9')).toBeInTheDocument();
  });

  it('judges Today/Yesterday in the circle zone, not the viewer zone', () => {
    // Now = 2026-11-11T00:30Z: Nov 11 09:30 in Tokyo, Nov 10 17:30 in Denver.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-11T00:30:00Z') });
    // Confirmed a day after the scheduled Nov 10 (Tokyo): late note, and Nov 10 is "Yesterday" in Tokyo.
    renderItem(makeActivity('2026-11-11T00:05:00Z', '2026-11-10'), 'Asia/Tokyo');
    expect(screen.getByText('Scheduled for Yesterday')).toBeInTheDocument();
  });

  it('shows no note while the circle timezone is unknown', () => {
    renderItem(makeActivity('2026-11-11T00:05:00Z', '2026-11-09'), null);
    expect(screen.queryByText(/Scheduled for/)).not.toBeInTheDocument();
  });
});
