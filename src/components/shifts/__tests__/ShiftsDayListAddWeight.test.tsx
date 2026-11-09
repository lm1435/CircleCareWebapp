import { render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { ShiftsDayList } from '../ShiftsDayList';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// One add pattern (owner 2026-11-08, mobile parity): "Add shift" sits AFTER the day's shifts as an
// OUTLINE button; the empty day keeps the filled CTA as its one action.
const shift = {
  id: 's1',
  circle_id: 'c',
  event_type: 'shift',
  title: 'Night',
  scheduled_date: '2026-10-19',
  scheduled_time: '20:00:00',
  duration_minutes: 600,
  recurrence_rule: null,
  reminder_lead_minutes: null,
  assigned_to: null,
  created_at: '',
  updated_at: '',
} as CalendarEvent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-17T12:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

const base = { date: '2026-10-19', timezone: 'America/Chicago', members: [], viewerId: 'u9', onOpen: vi.fn() };

describe('ShiftsDayList "Add shift" weight', () => {
  it('with shifts: outline, after the last card', () => {
    render(<ShiftsDayList {...base} shifts={[shift]} onAdd={vi.fn()} />);
    const add = screen.getByTestId('shifts-add-shift');
    expect(add.className.split(/\s+/)).toContain('border-primary-outline');
    const card = screen.getByTestId('shift-card');
    expect(card.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an empty day: the filled CTA, no outline duplicate', () => {
    render(<ShiftsDayList {...base} shifts={[]} onAdd={vi.fn()} />);
    expect(screen.queryByTestId('shifts-add-shift')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add shift' }).className.split(/\s+/)).toContain('bg-primary-fill');
  });
});
