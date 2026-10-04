import { render, screen } from '@testing-library/react';
import '@/i18n';
import { MemberRow } from '../MemberRow';
import type { CircleMember } from '@/api/circleMembers';

function member(overrides: Partial<CircleMember>): CircleMember {
  return {
    id: 'u1',
    email: 'fay@example.com',
    first_name: 'Fay',
    last_name: null,
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-01-01T00:00:00Z',
    timezone: null,
    ...overrides,
  };
}

describe('MemberRow not-receiving-reminders badge', () => {
  it('renders only for push_reachable === false', () => {
    render(<ul><MemberRow member={member({ push_reachable: false })} /></ul>);
    expect(screen.getByText('Not receiving reminders')).toBeInTheDocument();
  });

  it('renders nothing for push_reachable === true', () => {
    render(<ul><MemberRow member={member({ push_reachable: true })} /></ul>);
    expect(screen.queryByText('Not receiving reminders')).not.toBeInTheDocument();
  });

  it('renders nothing when push_reachable is undefined', () => {
    render(<ul><MemberRow member={member({})} /></ul>);
    expect(screen.queryByText('Not receiving reminders')).not.toBeInTheDocument();
  });
});
