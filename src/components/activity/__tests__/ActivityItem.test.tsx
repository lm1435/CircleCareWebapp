import { render, screen } from '@testing-library/react';
import '@/i18n';
import { ActivityItem } from '@/components/activity/ActivityItem';
import { getActivityIconName } from '@/components/activity/ActivityIcon';
import type { ActivityFeedItem } from '@/api/activityFeed';

// Task 26 — single activity entry: type icon, member name, localized action
// text, viewer-local relative timestamp, late-confirmation note.

// Pin the "device" timezone (dev machine is America/Denver — tests must never
// depend on it). Same Intl spy pattern as src/utils/__tests__/timezone.test.ts.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function makeActivity(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  return {
    id: 'activity-1',
    circle_id: 'circle-1',
    action_type: 'medication_confirmed',
    description: 'Confirmed Medication: Aspirin 100mg (taken)',
    created_at: new Date(Date.now() - 3 * HOUR_MS).toISOString(),
    actor: { id: 'user-1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Rivera' },
    ...overrides,
  };
}

function renderItem(activity: ActivityFeedItem) {
  return render(
    <ul>
      <ActivityItem activity={activity} />
    </ul>
  );
}

function dateKeyInNY(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

describe('ActivityItem', () => {
  it('renders action text, actor name, and a relative viewer-local timestamp', () => {
    renderItem(makeActivity());

    expect(screen.getByText('Confirmed Medication: Aspirin 100mg (taken)')).toBeInTheDocument();
    expect(screen.getByText('Pat Rivera')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('renders an actor avatar dot with the actor initials', () => {
    renderItem(makeActivity());

    // Initials-only avatar (no actor photo in the payload). "Pat Rivera" → "PR".
    // The avatar is decorative (aria-hidden); the actor name beside it names the
    // member.
    expect(screen.getByText('PR')).toBeInTheDocument();
  });

  it('renders an aria-hidden icon matching the activity type', () => {
    const { container } = renderItem(makeActivity({ action_type: 'emergency_info_updated' }));

    const icon = container.querySelector('[data-activity-icon="emergency"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('maps every mobile action type to its icon family', () => {
    expect(getActivityIconName('medication_confirmed')).toBe('medication');
    expect(getActivityIconName('medication_completed')).toBe('medication');
    expect(getActivityIconName('appointment_created')).toBe('appointment');
    expect(getActivityIconName('events_imported')).toBe('appointment');
    expect(getActivityIconName('task_completed')).toBe('task');
    expect(getActivityIconName('event_updated')).toBe('task');
    expect(getActivityIconName('emergency_info_updated')).toBe('emergency');
    expect(getActivityIconName('circle_created')).toBe('circle');
    expect(getActivityIconName('member_joined')).toBe('circle');
    expect(getActivityIconName('something_unknown')).toBe('generic');
  });

  it('falls back to the email prefix, then "System", for actor display', () => {
    renderItem(
      makeActivity({
        id: 'a-email',
        actor: { id: 'user-2', email: 'sam@example.com', first_name: null, last_name: null },
      })
    );
    expect(screen.getByText('sam')).toBeInTheDocument();

    renderItem(makeActivity({ id: 'a-system', actor: null }));
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('shows the "Scheduled for" note when a med was confirmed on a later day', () => {
    const now = new Date();
    const yesterdayKey = dateKeyInNY(new Date(now.getTime() - DAY_MS));

    renderItem(
      makeActivity({
        created_at: now.toISOString(),
        metadata: { scheduled_date: yesterdayKey },
      })
    );

    expect(screen.getByText('Scheduled for Yesterday')).toBeInTheDocument();
  });

  it('omits the "Scheduled for" note when confirmed on the scheduled day', () => {
    const now = new Date();

    renderItem(
      makeActivity({
        created_at: now.toISOString(),
        metadata: { scheduled_date: dateKeyInNY(now) },
      })
    );

    expect(screen.queryByText(/Scheduled for/)).not.toBeInTheDocument();
  });
});
