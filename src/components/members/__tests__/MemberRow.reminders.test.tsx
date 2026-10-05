import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
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

describe('MemberRow notifications-off badge', () => {
  it('renders only for push_reachable === false', () => {
    render(<ul><MemberRow member={member({ push_reachable: false })} /></ul>);
    expect(screen.getByText('Notifications off')).toBeInTheDocument();
  });

  it('renders nothing for push_reachable === true', () => {
    render(<ul><MemberRow member={member({ push_reachable: true })} /></ul>);
    expect(screen.queryByText('Notifications off')).not.toBeInTheDocument();
  });

  it('renders nothing when push_reachable is undefined', () => {
    render(<ul><MemberRow member={member({})} /></ul>);
    expect(screen.queryByText('Notifications off')).not.toBeInTheDocument();
  });
  const EXPLAIN =
    "Fay hasn't turned on notifications in the CircleCare app, so reminders won't reach their phone.";

  it('is a button named by the badge text, described by the tooltip, hidden until asked', () => {
    render(<ul><MemberRow member={member({ push_reachable: false })} /></ul>);
    const btn = screen.getByRole('button', { name: 'Notifications off' });
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(btn).toHaveAttribute('aria-describedby', tip.id);
    expect(tip).toHaveTextContent(EXPLAIN);
    expect(tip).not.toBeVisible();
  });

  it('shows on hover, on focus, and pins on click; Escape dismisses', async () => {
    const user = userEvent.setup();
    render(<ul><MemberRow member={member({ push_reachable: false })} /></ul>);
    const btn = screen.getByRole('button', { name: 'Notifications off' });
    const tip = screen.getByRole('tooltip', { hidden: true });
    await user.hover(btn);
    expect(tip).toBeVisible();
    await user.unhover(btn);
    expect(tip).not.toBeVisible();
    await user.tab();
    expect(btn).toHaveFocus();
    expect(tip).toBeVisible();
    await user.tab();
    expect(tip).not.toBeVisible();
    fireEvent.click(btn);
    expect(tip).toBeVisible();
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(tip).not.toBeVisible();
  });

  it('uses a neutral fallback when the first name is missing', () => {
    render(<ul><MemberRow member={member({ push_reachable: false, first_name: null })} /></ul>);
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
      "This member hasn't turned on notifications in the CircleCare app, so reminders won't reach their phone."
    );
  });

  it('renders ES label and explanation', async () => {
    await i18n.changeLanguage('es');
    try {
      render(<ul><MemberRow member={member({ push_reachable: false })} /></ul>);
      expect(screen.getByText('Notificaciones desactivadas')).toBeInTheDocument();
      expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
        'Fay no activó las notificaciones en la app de CircleCare, así que los recordatorios no llegarán a su teléfono.'
      );
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
