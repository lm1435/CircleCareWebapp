import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import i18n from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import { ReminderRoutingNotice } from '../ReminderRoutingNotice';

// The calendar's "who gets the medication reminders" line. With no care
// recipient and no medication-responsible member the backend sends the
// dose-time reminder AND the 15-minute alert to the OWNER (proven against the
// real DB in backend medicationResponsibleRouting.integration.test.ts), so the
// line must say so, to the owner only, and be dismissable. Mobile parity:
// CalendarScreen + CalendarReminderRoutingNotice.test.tsx.

const OWNER = { id: 'owner', is_care_recipient: false, is_medication_responsible: false };
const HELPER = { id: 'helper', is_care_recipient: false, is_medication_responsible: false };

let circleState: { circle: unknown; members: unknown[]; canEdit: boolean };
vi.mock('@/hooks/useCircle', () => ({ useCircle: () => circleState }));
vi.mock('@/lib/analytics', () => ({ Analytics: { reminderRoutingNoticeDismissed: vi.fn() } }));

const TITLE = 'Reminders go to you';
const BODY =
  'Medication reminders go to you (the circle owner) until you add a care recipient or choose a member to receive them.';

function setup(over: Partial<typeof circleState> = {}, me = 'owner', hasMedications = true) {
  circleState = { circle: { owner_id: 'owner' }, members: [OWNER, HELPER], canEdit: true, ...over };
  useAuthStore.setState({ user: { id: me } as never });
  return render(<ReminderRoutingNotice circleId="c1" hasMedications={hasMedications} />);
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('ReminderRoutingNotice', () => {
  it('owner, no care recipient, no responsible member: says reminders go to them (never "paused")', () => {
    setup();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
    expect(screen.getByTestId('reminder-routing-notice').textContent).not.toMatch(/paus/i);
  });

  it('renders the Spanish copy', async () => {
    await i18n.changeLanguage('es');
    setup();
    expect(screen.getByText('Los recordatorios te llegan a ti')).toBeInTheDocument();
  });

  it('is hidden from a member who is not the owner', () => {
    setup({}, 'helper');
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
  });

  it('is hidden once there is a care recipient', () => {
    setup({ members: [OWNER, { ...HELPER, is_care_recipient: true }] });
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
  });

  it('is hidden once a member is chosen to receive reminders', () => {
    setup({ members: [OWNER, { ...HELPER, is_medication_responsible: true }] });
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
  });

  it('is hidden with no medications, while loading (canEdit false), and on a frozen circle', () => {
    setup({}, 'owner', false);
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
    setup({ canEdit: false });
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
    setup({ members: [] });
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
  });

  it('Close hides it, persists per circle, and fires the dismiss event (no properties)', () => {
    const { unmount } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
    expect(localStorage.getItem('notif_banner_dismissed_c1')).toBe('true');
    expect(Analytics.reminderRoutingNoticeDismissed).toHaveBeenCalledTimes(1);
    expect(Analytics.reminderRoutingNoticeDismissed).toHaveBeenCalledWith();
    unmount();
    setup();
    expect(screen.queryByTestId('reminder-routing-notice')).toBeNull();
  });

  it('the Close control is a 44x44 named button', () => {
    setup();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toMatch(/\bh-11\b/);
    expect(close.className).toMatch(/\bw-11\b/);
  });
});
