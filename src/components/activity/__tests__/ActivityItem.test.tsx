import { render, screen } from '@testing-library/react';
import '@/i18n';
import { ActivityItem } from '@/components/activity/ActivityItem';
import { getActivityIconName } from '@/components/activity/ActivityIcon';
import type { ActivityFeedItem } from '@/api/activityFeed';

// Task 26 — single activity entry: type icon, member name, localized action
// text, viewer-local relative timestamp, late-confirmation note.

// A parameterized activity row carries a RAW 'HH:MM:SS', so the row renders the
// time through the VIEWER's resolved 12h/24h clock rather than a server-baked
// one. Pin useHourCycle so the test is deterministic instead of following
// navigator.language (same pattern as NoteRow.test.tsx / TodaysMeds).
const mockUseHourCycle = vi.fn(() => '12h');
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

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

function renderItem(activity: ActivityFeedItem, timezone = 'America/New_York') {
  return render(
    <ul>
      <ActivityItem activity={activity} timezone={timezone} />
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

  it('renders an actor avatar dot with the actor initial', () => {
    renderItem(makeActivity());

    // Initial-only avatar (mobile parity: ONE initial, no actor photo in the
    // payload). "Pat Rivera" → "P". The avatar is decorative (aria-hidden);
    // the actor name beside it names the member.
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('renders an aria-hidden icon matching the activity type', () => {
    const { container } = renderItem(makeActivity({ action_type: 'emergency_info_updated' }));

    const icon = container.querySelector('[data-activity-icon="emergency"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  // Task 17 (web mobile-parity wave, spec §6.5): a 1px timeline rail runs
  // behind every row's icon tile so a flat `<ul>` of `<li>`s still reads as
  // one continuous thread (mobile `timelineRail`).
  it('renders a timeline rail behind the row', () => {
    const { container } = renderItem(makeActivity());

    const rail = container.querySelector('li > span[aria-hidden="true"].absolute');
    expect(rail).not.toBeNull();
    expect(rail?.className).toContain('left-[42px]');
    expect(rail?.className).toContain('bg-line-2');
  });

  // Row icon tile classes per type (spec §6.5: "28×28 r8 icon tile, 2px border
  // in the type color, type-soft fill"). `generic` is the one literal
  // exception, spelled out in the spec rather than derived from a tone.
  it.each([
    ['medication_confirmed', 'medication', 'border-clay', 'bg-clay-soft', 'text-clay-deep'],
    ['appointment_created', 'appointment', 'border-dusk', 'bg-dusk-soft', 'text-dusk-deep'],
    ['task_completed', 'task', 'border-moss', 'bg-moss-soft', 'text-moss-deep'],
    ['emergency_info_updated', 'emergency', 'border-terracotta', 'bg-terracotta-soft', 'text-terracotta-deep'],
    ['circle_created', 'circle', 'border-moss', 'bg-moss-soft', 'text-moss-deep'],
    ['care_note_added', 'note', 'border-dusk', 'bg-dusk-soft', 'text-dusk-deep'],
    ['something_unknown', 'generic', 'border-line', 'bg-bg-2', 'text-ink-2'],
  ])('gives the %s tile its %s/%s/%s classes', (actionType, name, borderClass, bgClass, textClass) => {
    const { container } = renderItem(makeActivity({ action_type: actionType }));

    const tile = container.querySelector(`[data-activity-icon="${name}"]`);
    expect(tile).not.toBeNull();
    expect(tile?.className).toContain(borderClass);
    expect(tile?.className).toContain(bgClass);
    expect(tile?.className).toContain(textClass);
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
    expect(getActivityIconName('care_note_added')).toBe('note');
    expect(getActivityIconName('note_added')).toBe('note');
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

  // Wiring test: the renderer unit tests take an hourCycle as an argument, so
  // only a rendered component can prove the value actually travels from
  // useHourCycle into the sentence. A row that ignored the hook would render
  // identically for both viewers and pass every unit test.
  describe('parameterized rows follow the viewer clock', () => {
    const rescheduled = makeActivity({
      action_type: 'medication_updated',
      // Byte-identical to what the backend still writes, and deliberately in
      // the OTHER format from what a 12h viewer must see -- so a component that
      // fell back to `description` would fail this test rather than pass it.
      description: 'Rescheduled Medication: Atorvastatin to 14:30',
      description_key: 'entries.medicationRescheduled',
      description_params: { title: 'Atorvastatin', scheduledTime: '14:30:00' },
    });

    it('renders a 12-hour time for a 12h viewer', () => {
      mockUseHourCycle.mockReturnValue('12h');
      renderItem(rescheduled);
      expect(
        screen.getByText('Rescheduled Medication: Atorvastatin to 2:30 PM')
      ).toBeInTheDocument();
    });

    it('renders a 24-hour time for a 24h viewer', () => {
      mockUseHourCycle.mockReturnValue('24h');
      renderItem(rescheduled);
      expect(
        screen.getByText('Rescheduled Medication: Atorvastatin to 14:30')
      ).toBeInTheDocument();
    });

    it('still renders an unrecognised key from `description`', () => {
      mockUseHourCycle.mockReturnValue('12h');
      renderItem(
        makeActivity({
          description: 'Confirmed Medication: Aspirin 100mg (taken)',
          description_key: 'entries.aKeyThisBuildDoesNotKnow',
          description_params: { title: 'Aspirin' },
        })
      );
      expect(
        screen.getByText('Confirmed Medication: Aspirin 100mg (taken)')
      ).toBeInTheDocument();
      expect(screen.queryByText(/entries\./)).not.toBeInTheDocument();
    });
  });
});
