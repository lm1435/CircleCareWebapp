import { render, screen } from '@testing-library/react';
import '@/i18n';
import { MemberRow } from '../MemberRow';
import type { CircleMember } from '@/api/circleMembers';
import { avatarGradientFor, avatarGradientForKey } from '@/components/ui/Avatar';

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

const gradient = (pair: readonly [string, string]): string =>
  `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;

describe('MemberRow avatar colour', () => {
  it('uses the member\'s chosen palette colour', () => {
    render(<ul><MemberRow member={member({ avatar_color: 'dusk' })} /></ul>);
    expect(screen.getByText('F').style.backgroundImage).toBe(gradient(avatarGradientForKey('dusk')));
  });

  it('keeps the name-derived gradient when no colour was chosen', () => {
    render(<ul><MemberRow member={member({ avatar_color: null })} /></ul>);
    expect(screen.getByText('F').style.backgroundImage).toBe(gradient(avatarGradientFor('Fay')));
  });

  it('ignores an unknown key a newer backend might send', () => {
    render(<ul><MemberRow member={member({ avatar_color: 'magenta' })} /></ul>);
    expect(screen.getByText('F').style.backgroundImage).toBe(gradient(avatarGradientFor('Fay')));
  });
});
