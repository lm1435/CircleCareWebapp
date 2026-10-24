import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { HelpHomeCard } from '@/components/help/HelpHomeCard';
import { HELP_FIXTURE } from '@/help/__tests__/fixture';
import { useAuthStore } from '@/store/authStore';

vi.mock('@/help/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/help/content')>()),
  getBundledHelpContent: () => HELP_FIXTURE,
}));

const presence = vi.hoisted(() => ({ value: { isSuccess: true, data: null as unknown } }));
vi.mock('@/hooks/useCalendarEvents', () => ({
  useEventsPresence: () => presence.value,
}));

function setPresence(data: { medication: boolean; appointment: boolean; task: boolean } | null): void {
  presence.value = { isSuccess: data !== null, data };
}

const card = (
  <MemoryRouter>
    <HelpHomeCard circleId="c1" timezone="America/Denver" />
  </MemoryRouter>
);

describe('HelpHomeCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.localStorage.clear();
    useAuthStore.setState({ user: { id: 'user-1' } } as never);
  });

  it('shows for a circle with no activity and links to help home', () => {
    setPresence({ medication: false, appointment: false, task: false });
    render(card);
    expect(screen.getByRole('region', { name: 'New here? Watch how it works' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open help' })).toHaveAttribute('href', '/help');
  });

  it.each(['medication', 'appointment', 'task'] as const)('is hidden once there is a %s', (kind) => {
    setPresence({ medication: false, appointment: false, task: false, [kind]: true });
    render(card);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows nothing while the read is unanswered', () => {
    setPresence(null);
    render(card);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('dismisses, remembers per user, and is back for another user', async () => {
    setPresence({ medication: false, appointment: false, task: false });
    const user = userEvent.setup();
    const first = render(card);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(window.localStorage.getItem('help_home_card_dismissed:user-1')).toBe('true');
    first.unmount();

    const again = render(card);
    expect(again.container).toBeEmptyDOMElement();
    again.unmount();

    useAuthStore.setState({ user: { id: 'user-2' } } as never);
    render(card);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('still dismisses for the page view when localStorage throws', async () => {
    setPresence({ medication: false, appointment: false, task: false });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(card);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region')).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
