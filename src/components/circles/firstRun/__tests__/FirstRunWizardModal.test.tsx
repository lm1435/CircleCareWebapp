import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { resetFirstRunFunnelForTests } from '@/lib/firstRunFunnel';
import {
  hasSeenOnboardingPaywall,
  markOnboardingPaywallPending,
  peekOnboardingPaywallPending,
} from '@/lib/onboardingPaywall';
import type { FirstRunSavedItem } from '@/components/calendar/AddEventModal';
import { FirstRunWizardModal } from '../FirstRunWizardModal';

// First run v2 (1.4.3): the wizard is the first item (the real form with its type switch; stubbed
// here, it has its own suites) and then All set. Positive and negative cases are named.

const CIRCLE_ID = 'circle-1';
// The viewer shares the recipient's zone (UTC), so times show bare (no dual-zone caption).
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const useCircleResult: { circle: Record<string, unknown> | undefined; canEdit: boolean } = {
  circle: { id: CIRCLE_ID, name: 'Rosa', recipient_name: 'Rosa', is_self_care: false },
  canEdit: true,
};
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({ circle: useCircleResult.circle, canEdit: useCircleResult.canEdit, isOwner: true }),
}));
const subscription = vi.hoisted(() => ({ tier: 'free' as string | undefined }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: subscription.tier ? { tier: subscription.tier } : undefined }),
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const invite = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/hooks/useInvites', () => ({ useCreateInvite: () => invite }));
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => toast };
});
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const ITEM = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: (props: {
    initialType?: string;
    firstRun?: boolean;
    firstRunTypeSwitch?: boolean;
    onFirstRunItemSaved?: (item: unknown) => void;
    onClose: () => void;
  }) => (
    <div
      data-testid="add-event-modal"
      data-type={props.initialType}
      data-first-run={String(!!props.firstRun)}
      data-type-switch={String(!!props.firstRunTypeSwitch)}
    >
      <button type="button" onClick={props.onClose}>
        stub-skip
      </button>
      <button
        type="button"
        onClick={() => {
          props.onFirstRunItemSaved?.(ITEM.value);
          props.onClose();
        }}
      >
        stub-save
      </button>
    </div>
  ),
}));

const MED: FirstRunSavedItem = {
  type: 'medication',
  title: 'Metformin',
  recipientTime: '08:00',
  scheduledDate: '2099-09-02',
  timezone: 'UTC',
  medication: {
    eventId: 'ev-1',
    name: 'Metformin',
    dosage: '500 mg',
    doses: [{ scheduledDate: '2099-09-02', scheduledTime: '08:00' }],
    timezone: 'UTC',
    recurrenceRule: 'daily',
    recurrenceDays: null,
    startsNextDose: false,
    startDate: '2099-09-02',
    today: '2099-09-02',
  },
};
const APPT: FirstRunSavedItem = {
  type: 'appointment',
  title: 'Doctor visit',
  recipientTime: '09:00',
  scheduledDate: '2099-09-02',
  timezone: 'UTC',
};
const TASK: FirstRunSavedItem = { ...APPT, type: 'task', title: 'Call pharmacy' };

let skipped: ReturnType<typeof vi.spyOn>;
let inviteAction: ReturnType<typeof vi.spyOn>;
let allSetViewed: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetFirstRunFunnelForTests();
  subscription.tier = 'free';
  useCircleResult.circle = { id: CIRCLE_ID, name: 'Rosa', recipient_name: 'Rosa', is_self_care: false };
  useCircleResult.canEdit = true;
  ITEM.value = MED;
  invite.mutateAsync.mockResolvedValue({ invite: { invite_code: 'ABCD2345', invite_url: 'https://my.circlecare.app/invite/ABCD2345' } });
  skipped = vi.spyOn(Analytics, 'firstRunSkipped').mockImplementation(() => {});
  inviteAction = vi.spyOn(Analytics, 'firstRunInviteAction').mockImplementation(() => {});
  allSetViewed = vi.spyOn(Analytics, 'firstRunAllSetViewed').mockImplementation(() => {});
  vi.spyOn(Analytics, 'firstRunStepViewed').mockImplementation(() => {});
  vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
  vi.spyOn(Analytics, 'inviteLinkCopied').mockImplementation(() => {});
  vi.spyOn(Analytics, 'inviteLinkShared').mockImplementation(() => {});
  // No share sheet by default (desktop): "Copy invite link".
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => vi.restoreAllMocks());

function renderWizard() {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <FirstRunWizardModal circleId={CIRCLE_ID} circleName="Rosa" onClose={onClose} />
    </MemoryRouter>
  );
  return { onClose };
}

async function saveFirstItem() {
  // fireEvent, not userEvent: userEvent.setup() installs its own clipboard over navigator.clipboard.
  fireEvent.click(screen.getByRole('button', { name: 'stub-save' }));
  return screen.findByTestId('first-run-all-set');
}

describe('FirstRunWizardModal v2: first item', () => {
  it('POSITIVE: opens straight on the real form in first-run mode with the type switch, on Medication', () => {
    renderWizard();
    const form = screen.getByTestId('add-event-modal');
    expect(form).toHaveAttribute('data-type', 'medication');
    expect(form).toHaveAttribute('data-first-run', 'true');
    expect(form).toHaveAttribute('data-type-switch', 'true');
    // No v1 chooser.
    expect(screen.queryByText(/circle is ready/)).not.toBeInTheDocument();
  });

  it('NEGATIVE: renders nothing while the circle cannot be written yet (no empty form)', () => {
    useCircleResult.canEdit = false;
    renderWizard();
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it('NEGATIVE: Skip for now closes to Today, records the skip, never shows All set, leaves the paywall owed', async () => {
    markOnboardingPaywallPending(CIRCLE_ID);
    const { onClose } = renderWizard();
    await userEvent.setup().click(screen.getByRole('button', { name: 'stub-skip' }));
    expect(skipped).toHaveBeenCalledWith(CIRCLE_ID, 'close');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('first-run-all-set')).not.toBeInTheDocument();
    expect(peekOnboardingPaywallPending()).toBe(CIRCLE_ID);
    expect(allSetViewed).not.toHaveBeenCalled();
  });
});

describe('FirstRunWizardModal v2: All set', () => {
  it('POSITIVE: after a medication: the 8:00 AM title, three rows, the Optional invite block', async () => {
    renderWizard();
    await saveFirstItem();
    expect(screen.getByTestId('first-run-all-set-title')).toHaveTextContent("Rosa's 8:00 AM reminder is set.");
    expect(screen.getByTestId('first-run-all-set-row-circle')).toHaveTextContent("Rosa's circle");
    expect(screen.getByTestId('first-run-all-set-row-circle')).toHaveTextContent('Just you so far');
    expect(screen.getByTestId('first-run-all-set-row-item')).toHaveTextContent('Metformin · 8:00 AM');
    expect(screen.getByTestId('first-run-all-set-row-item')).toHaveTextContent('500 mg · every day');
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByText("Who's usually there with Rosa?")).toBeInTheDocument();
    expect(allSetViewed).toHaveBeenCalledWith({
      circleId: CIRCLE_ID,
      path: 'owner',
      remindersOn: false,
      firstItemType: 'medication',
    });
  });

  it('NEGATIVE (web): the reminders row never claims reminders are on here; it says they arrive on the phone', async () => {
    renderWizard();
    await saveFirstItem();
    const row = screen.getByTestId('first-run-all-set-row-reminders');
    expect(row).toHaveTextContent('Reminders arrive on your phone');
    expect(row).toHaveTextContent('In the CircleCare app, at 8:00 AM');
    expect(row).not.toHaveTextContent(/On, at/);
  });

  it('POSITIVE: an appointment first has its own title (no reminder time in it)', async () => {
    ITEM.value = APPT;
    renderWizard();
    await saveFirstItem();
    expect(screen.getByTestId('first-run-all-set-title')).toHaveTextContent("Rosa's appointment is saved.");
    expect(screen.getByTestId('first-run-all-set-row-item')).toHaveTextContent('Doctor visit · 9:00 AM');
    expect(screen.getByTestId('first-run-all-set-row-item')).toHaveTextContent('Appointment');
  });

  it('POSITIVE: a task first, self-care wording', async () => {
    ITEM.value = TASK;
    useCircleResult.circle = { id: CIRCLE_ID, name: 'Maria', recipient_name: 'Maria', is_self_care: true };
    renderWizard();
    await saveFirstItem();
    expect(screen.getByTestId('first-run-all-set-title')).toHaveTextContent('Your task is saved.');
    expect(screen.getByTestId('first-run-all-set-row-circle')).toHaveTextContent('Your circle');
    expect(screen.getByText('Who helps you out?')).toBeInTheDocument();
  });

  it('NEGATIVE: an item switched to Any time shows no time anywhere', async () => {
    ITEM.value = { ...APPT, recipientTime: null };
    renderWizard();
    await saveFirstItem();
    expect(screen.getByTestId('first-run-all-set-row-item')).not.toHaveTextContent('AM');
    expect(screen.getByTestId('first-run-all-set-row-reminders')).toHaveTextContent(/^Reminders arrive on your phoneIn the CircleCare app$/);
  });

  it('POSITIVE: Copy invite link (no share sheet) creates ONE link invite, copies it and fills the seat', async () => {
    renderWizard();
    await saveFirstItem();
    const button = screen.getByTestId('first-run-invite-link');
    expect(button).toHaveTextContent('Copy invite link');
    // fireEvent, not userEvent: userEvent installs its own clipboard over navigator.clipboard.
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId('first-run-all-set-row-circle')).toHaveTextContent(
        'Invite link shared. Waiting for them to join.'
      )
    );
    expect(invite.mutateAsync).toHaveBeenCalledWith({ member_type: 'caregiver' });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/invite/ABCD2345')
    );
    expect(screen.getByTestId('circle-emblem-seat')).toHaveAttribute('data-filled', 'true');
    expect(inviteAction).toHaveBeenCalledWith({ circleId: CIRCLE_ID, method: 'share_link', completed: true });
  });

  it('NEGATIVE: two presses create ONE link invite (one seat held)', async () => {
    let resolve!: (v: unknown) => void;
    invite.mutateAsync.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWizard();
    await saveFirstItem();
    const button = screen.getByTestId('first-run-invite-link');
    act(() => {
      button.click();
      button.click();
    });
    await act(async () => {
      resolve({ invite: { invite_code: 'ABCD2345' } });
    });
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    // A third press after it exists reuses it.
    fireEvent.click(button);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
    expect(invite.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: the link is NOT created when All set opens, only on the press', async () => {
    renderWizard();
    await saveFirstItem();
    expect(invite.mutateAsync).not.toHaveBeenCalled();
  });

  it('POSITIVE: Share invite link uses the browser share sheet where there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    renderWizard();
    await saveFirstItem();
    const button = screen.getByTestId('first-run-invite-link');
    expect(button).toHaveTextContent('Share invite link');
    await userEvent.setup().click(button);
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].text).toContain('Join me on CircleCare to help coordinate care for Rosa.');
    await waitFor(() =>
      expect(screen.getByTestId('circle-emblem-seat')).toHaveAttribute('data-filled', 'true')
    );
  });

  it('NEGATIVE: a dismissed share sheet never fills the seat', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError')),
    });
    renderWizard();
    await saveFirstItem();
    await userEvent.setup().click(screen.getByTestId('first-run-invite-link'));
    await waitFor(() =>
      expect(inviteAction).toHaveBeenCalledWith({ circleId: CIRCLE_ID, method: 'share_link', completed: false })
    );
    expect(screen.getByTestId('circle-emblem-seat')).toHaveAttribute('data-filled', 'false');
    expect(screen.getByTestId('first-run-all-set-row-circle')).toHaveTextContent('Just you so far');
  });

  it('POSITIVE: Go to Today with the paywall owed (first circle, free) shows it once, seen flag first', async () => {
    markOnboardingPaywallPending(CIRCLE_ID);
    const { onClose } = renderWizard();
    await saveFirstItem();
    await userEvent.setup().click(screen.getByTestId('first-run-go-to-today'));
    expect(hasSeenOnboardingPaywall()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/upgrade', expect.anything());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(inviteAction).toHaveBeenCalledWith({ circleId: CIRCLE_ID, method: 'later', completed: false });
  });

  it('NEGATIVE: Go to Today for a premium owner never goes to the paywall', async () => {
    subscription.tier = 'premium';
    markOnboardingPaywallPending(CIRCLE_ID);
    const { onClose } = renderWizard();
    await saveFirstItem();
    await userEvent.setup().click(screen.getByTestId('first-run-go-to-today'));
    expect(navigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a11y: the All set heading takes focus', async () => {
    renderWizard();
    await saveFirstItem();
    await waitFor(() => expect(screen.getByTestId('first-run-all-set-title')).toHaveFocus());
  });
});
