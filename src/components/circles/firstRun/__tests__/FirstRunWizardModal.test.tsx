import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { FirstRunWizardModal } from '../FirstRunWizardModal';
import type { SavedMedicationInfo } from '@/utils/firstMedSaved';
import { isNextStepSnoozed } from '@/lib/todayCoaching';
import {
  hasSeenOnboardingPaywall,
  markOnboardingPaywallPending,
  peekDeferredFirstRun,
  peekOnboardingPaywallPending,
} from '@/lib/onboardingPaywall';

/**
 * The first-run wizard after the onboarding 1.3.1 fold (docs/plans/onboarding-1-3-1.md
 * sections 1, 3, 7): Setup (1) -> the ONE simple medication form in first-run mode ->
 * the payoff -> the paywall (exactly once) or Today.
 *
 * The form itself is STUBBED (its own suite is AddEventModal.*.test.tsx): this file asks
 * "did the wizard open it in first-run mode, and what did it do with what came back?".
 */
// The payoff clock is a function of (viewer zone, recipient zone): both are pinned to UTC so
// the conversion contributes nothing and the test asserts the wizard's own logic (the old
// wizard suite pinned them for the same reason).
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const CIRCLE_ID = 'circle-1';

const useCircleResult: { circle: Record<string, unknown> | undefined; canEdit: boolean } = {
  circle: {
    id: CIRCLE_ID,
    name: 'Rosa',
    recipient_name: 'Rosa',
    is_self_care: false,
    care_recipient_timezone: 'UTC',
  },
  canEdit: true,
};
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: useCircleResult.circle,
    canEdit: useCircleResult.canEdit && !!useCircleResult.circle,
    isOwner: true,
  }),
}));

const subscription = vi.hoisted(() => ({ tier: 'free' as string | undefined }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: subscription.tier ? { tier: subscription.tier } : undefined }),
}));

const markHook = vi.hoisted(() => ({
  mark: vi.fn(),
  pending: false,
  done: false,
}));
vi.mock('@/hooks/useMarkFirstDose', () => ({ useMarkFirstDose: () => markHook }));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const SAVED: SavedMedicationInfo = {
  eventId: 'ev-1',
  name: 'Metformin',
  dosage: '500mg',
  doses: [{ scheduledDate: '2026-09-02', scheduledTime: '08:00:00' }],
  timezone: 'UTC',
  recurrenceRule: 'daily',
  recurrenceDays: null,
  startsNextDose: true,
  startDate: '2026-09-02',
  today: '2026-09-01',
};
const savedPayload = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: (props: {
    initialType?: string;
    firstRun?: boolean;
    entry?: string;
    onSaved?: (saved?: unknown) => void;
    onClose: () => void;
  }) => (
    <div
      data-testid="add-event-modal"
      data-type={props.initialType}
      data-first-run={String(!!props.firstRun)}
      data-entry={props.entry}
    >
      <button type="button" onClick={props.onClose}>
        stub-cancel
      </button>
      <button
        type="button"
        onClick={() => {
          props.onSaved?.(savedPayload.value);
          props.onClose();
        }}
      >
        stub-save
      </button>
    </div>
  ),
}));
vi.mock('@/components/members/InviteMemberModal', () => ({
  InviteMemberModal: (props: { onInvited?: () => void; onClose: () => void }) => (
    <div data-testid="invite-modal">
      <button type="button" onClick={props.onClose}>
        stub-cancel
      </button>
    </div>
  ),
}));

const hourCycleState = vi.hoisted(() => ({ value: '12h' as '12h' | '24h' }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => hourCycleState.value }));

const analytics = vi.hoisted(() => ({
  onboardingPayoffViewed: vi.fn(),
  firstRunStepViewed: vi.fn(),
  firstRunActionSelected: vi.fn(),
  firstRunSkipped: vi.fn(),
  medicationCreationStarted: vi.fn(),
  markItShown: vi.fn(),
  markItTapped: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: analytics, default: analytics }));

function renderWizard(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <FirstRunWizardModal circleId={CIRCLE_ID} circleName="Rosa" onClose={onClose} />
    </MemoryRouter>
  );
  return { onClose };
}

async function saveFirstMed(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('first-run-primary'));
  await user.click(screen.getByRole('button', { name: 'stub-save' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useCircleResult.circle = {
    id: CIRCLE_ID,
    name: 'Rosa',
    recipient_name: 'Rosa',
    is_self_care: false,
    care_recipient_timezone: 'UTC',
  };
  useCircleResult.canEdit = true;
  subscription.tier = 'free';
  markHook.pending = false;
  markHook.done = false;
  savedPayload.value = SAVED;
});

describe('Setup (1)', () => {
  it('shows the circle-ready copy, ONE primary, the quiet rows and Skip for now', () => {
    renderWizard();
    expect(screen.getByText("ROSA'S CIRCLE")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Rosa's circle is ready." })).toBeInTheDocument();
    expect(screen.getByText("Start with the thing you'll check most.")).toBeInTheDocument();
    expect(screen.getByTestId('first-run-primary')).toHaveTextContent("Add Rosa's first med");
    expect(
      screen.getByText("About a minute. Everyone helping sees it, with a reminder when it's time.")
    ).toBeInTheDocument();
    expect(screen.getByText('OR START WITH')).toBeInTheDocument();
    expect(screen.getByTestId('first-run-start-with-appointment')).toHaveTextContent('An appointment');
    expect(screen.getByTestId('first-run-start-with-invite')).toHaveTextContent('Someone to help');
    expect(screen.getByTestId('first-run-start-with-emergency')).toHaveTextContent('Emergency info');
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    // The old three questions and the see-what-else toggle are gone.
    expect(screen.queryByTestId('first-run-more-toggle')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('a11y: opening focuses the step heading (not the x)', () => {
    renderWizard();
    expect(screen.getByRole('heading', { name: "Rosa's circle is ready." })).toHaveFocus();
  });

  it('self-care: "Your circle is ready." and "Add your first med"', () => {
    useCircleResult.circle = { ...useCircleResult.circle, is_self_care: true };
    renderWizard();
    expect(screen.getByText('YOUR CIRCLE')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your circle is ready.' })).toBeInTheDocument();
    expect(screen.getByTestId('first-run-primary')).toHaveTextContent('Add your first med');
  });

  it('the primary opens the ONE simple form in first-run mode and reports tier primary', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('first-run-primary'));

    const form = screen.getByTestId('add-event-modal');
    expect(form).toHaveAttribute('data-type', 'medication');
    expect(form).toHaveAttribute('data-first-run', 'true');
    expect(form).toHaveAttribute('data-entry', 'first_run');
    expect(analytics.firstRunActionSelected).toHaveBeenCalledWith(CIRCLE_ID, 'medication', 'primary');
    expect(analytics.medicationCreationStarted).toHaveBeenCalledWith(CIRCLE_ID, 'wizard');
    expect(analytics.firstRunStepViewed).toHaveBeenCalledWith(CIRCLE_ID, 'first_med');
  });

  it('a quiet row reports tier secondary and hands off in place', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('first-run-start-with-appointment'));
    expect(analytics.firstRunActionSelected).toHaveBeenCalledWith(CIRCLE_ID, 'appointment', 'secondary');
    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-first-run', 'false');
  });

  it('someone to help hands off to the invite modal; cancelling returns to Setup', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('first-run-start-with-invite'));
    expect(analytics.firstRunActionSelected).toHaveBeenCalledWith(CIRCLE_ID, 'invite', 'secondary');
    expect(screen.getByTestId('invite-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'stub-cancel' }));
    expect(screen.getByTestId('first-run-primary')).toBeInTheDocument();
  });

  it('emergency info navigates to the page without closing (Today must not ask the paywall first)', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await user.click(screen.getByTestId('first-run-start-with-emergency'));
    expect(analytics.firstRunActionSelected).toHaveBeenCalledWith(CIRCLE_ID, 'emergency', 'secondary');
    expect(onClose).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/emergency`);
  });

  it('Skip for now records first_run_skipped skip_button and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(analytics.firstRunSkipped).toHaveBeenCalledWith(CIRCLE_ID, 'skip_button');
    expect(analytics.firstRunActionSelected).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the x on Setup is a skip with via close', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await user.click(screen.getByRole('button', { name: 'Close setup' }));
    expect(analytics.firstRunSkipped).toHaveBeenCalledWith(CIRCLE_ID, 'close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not swap Setup for an empty form while the circle cannot be written yet', async () => {
    useCircleResult.canEdit = false;
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByTestId('first-run-primary'));
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('first-run-primary')).toBeInTheDocument();
  });
});

describe('leaving the first-run form unsaved', () => {
  it('returns to Today (onClose) as a skip and leaves the paywall OWED', async () => {
    markOnboardingPaywallPending(CIRCLE_ID);
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await user.click(screen.getByTestId('first-run-primary'));
    await user.click(screen.getByRole('button', { name: 'stub-cancel' }));

    expect(analytics.firstRunSkipped).toHaveBeenCalledWith(CIRCLE_ID, 'close');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(peekOnboardingPaywallPending()).toBe(CIRCLE_ID);
    expect(hasSeenOnboardingPaywall()).toBe(false);
  });
});

describe('payoff', () => {
  it('after the save shows ALL SET, the reminder sentence and the saved-dose card', async () => {
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);

    expect(analytics.onboardingPayoffViewed).toHaveBeenCalledTimes(1);
    expect(screen.getByText('ALL SET')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Rosa's 8:00 AM reminder is set." })).toBeInTheDocument();
    const card = screen.getByTestId('first-run-payoff-card');
    expect(within(card).getByText('Metformin')).toBeInTheDocument();
    expect(within(card).getByText('500mg · every day · starts tomorrow')).toBeInTheDocument();
    expect(within(card).getByText('8:00 AM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('says "starts today" when the start did not roll', async () => {
    savedPayload.value = { ...SAVED, startsNextDose: false, startDate: '2026-09-01' };
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    expect(screen.getByText('500mg · every day · starts today')).toBeInTheDocument();
    expect(screen.queryByTestId('mark-it-line')).not.toBeInTheDocument();
    expect(analytics.markItShown).not.toHaveBeenCalled();
  });

  it('asks NO invite question and writes the invite next-step snooze', async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(isNextStepSnoozed(CIRCLE_ID, 'invite')).toBe(false);
    await saveFirstMed(user);

    expect(screen.queryByText(/who's usually there/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite someone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
    expect(isNextStepSnoozed(CIRCLE_ID, 'invite')).toBe(true);
  });

  it('offers Mark it when the start rolled and reports mark_it_shown payoff', async () => {
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    const line = screen.getByTestId('mark-it-line');
    expect(line).toHaveTextContent('Already given today? Mark it');
    expect(analytics.markItShown).toHaveBeenCalledTimes(1);
    expect(analytics.markItShown).toHaveBeenCalledWith('payoff');
  });

  it('Mark it sends the PRIMARY root id and its first dose time', async () => {
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    await user.click(screen.getByTestId('mark-it-button'));
    expect(markHook.mark).toHaveBeenCalledTimes(1);
    expect(markHook.mark).toHaveBeenCalledWith({ eventId: 'ev-1', time: '08:00:00' });
  });

  it('after a successful mark the line is replaced by the done state', async () => {
    markHook.done = true;
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    expect(screen.queryByTestId('mark-it-button')).not.toBeInTheDocument();
    expect(screen.getByText('Marked as taken.')).toBeInTheDocument();
    expect(screen.getByTestId('mark-it-announcer')).toHaveTextContent('Marked as taken.');
  });

  it('a11y: when the mark lands, the text fills the polite region and focus moves on to Continue', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const ui = () => (
      <MemoryRouter>
        <FirstRunWizardModal circleId={CIRCLE_ID} circleName="Rosa" onClose={onClose} />
      </MemoryRouter>
    );
    const { rerender } = render(ui());
    await saveFirstMed(user);
    await user.click(screen.getByTestId('mark-it-button'));
    expect(screen.getByTestId('mark-it-announcer')).toHaveTextContent('');
    // The hook now reports done (the real one flips its state after the server answers).
    markHook.done = true;
    rerender(ui());
    expect(screen.getByTestId('mark-it-announcer')).toHaveTextContent('Marked as taken.');
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
  });

  it('a11y: the payoff heading takes focus; the live region is mounted empty before Mark it', async () => {
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    expect(screen.getByRole('heading', { name: "Rosa's 8:00 AM reminder is set." })).toHaveFocus();
    expect(screen.getByTestId('mark-it-announcer')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('mark-it-announcer')).toHaveTextContent('');
  });

  it('multi-dose saves read "reminders are set"', async () => {
    savedPayload.value = {
      ...SAVED,
      doses: [
        { scheduledDate: '2026-09-02', scheduledTime: '08:00:00' },
        { scheduledDate: '2026-09-01', scheduledTime: '20:00:00' },
      ],
    };
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    expect(screen.getByRole('heading', { name: "Rosa's reminders are set." })).toBeInTheDocument();
  });
});

describe('payoff -> paywall (exactly once)', () => {
  it('Continue with the paywall OWED goes to /upgrade (after_first_med), seen flag written first', async () => {
    markOnboardingPaywallPending(CIRCLE_ID);
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await saveFirstMed(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(hasSeenOnboardingPaywall()).toBe(true);
    expect(peekOnboardingPaywallPending()).toBeNull();
    expect(peekDeferredFirstRun()).toEqual({ circleId: CIRCLE_ID, recipientName: 'Rosa' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'onboarding', paywallTrigger: 'after_first_med' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the x on the payoff is the same as Continue', async () => {
    markOnboardingPaywallPending(CIRCLE_ID);
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    await user.click(screen.getByRole('button', { name: 'Close setup' }));
    expect(navigate).toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'onboarding', paywallTrigger: 'after_first_med' },
    });
  });

  it('Continue with nothing owed (not a first circle / already seen) just closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await saveFirstMed(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a premium user is never sent to the paywall', async () => {
    subscription.tier = 'premium';
    markOnboardingPaywallPending(CIRCLE_ID);
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await saveFirstMed(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(hasSeenOnboardingPaywall()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an unknown tier fails closed and keeps the paywall owed for Today', async () => {
    subscription.tier = undefined;
    markOnboardingPaywallPending(CIRCLE_ID);
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(peekOnboardingPaywallPending()).toBe(CIRCLE_ID);
  });

  it('exactly once: a second Continue after the seen flag is set does not navigate again', async () => {
    markOnboardingPaywallPending(CIRCLE_ID);
    const user = userEvent.setup();
    renderWizard();
    await saveFirstMed(user);
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    await act(async () => {
      continueButton.click();
      continueButton.click();
    });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('an as-needed first med (no card) goes straight to the exit path', async () => {
    savedPayload.value = undefined;
    markOnboardingPaywallPending(CIRCLE_ID);
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await saveFirstMed(user);
    expect(analytics.onboardingPayoffViewed).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'onboarding', paywallTrigger: 'after_first_med' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
