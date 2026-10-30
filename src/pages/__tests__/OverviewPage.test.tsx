import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import OverviewPage from '@/pages/OverviewPage';
import { useCircle } from '@/hooks/useCircle';
import { useNextUp, type UseNextUpResult } from '@/hooks/useNextUp';
import { useNextStep, type NextStepState } from '@/hooks/useNextStep';
import { useAuthStore } from '@/store/authStore';
import { useEarnedUpsell } from '@/hooks/useEarnedUpsell';
import { Analytics } from '@/lib/analytics';
import { resetLargeTextReports } from '@/hooks/useLargeTextLayout';
import type { NextUpItem } from '@/components/overview/nextUpItems';
import { getDateInTimezone } from '@/utils/timezone';
import {
  hasSeenOnboardingPaywall,
  markOnboardingPaywallPending,
  markOnboardingPaywallSeen,
  peekDeferredFirstRun,
  peekOnboardingPaywallPending,
} from '@/lib/onboardingPaywall';

// OverviewPage is now TODAY: a COMPOSITION layer. Its job is the header, the
// ONE-coaching-element priority (next-step > shifts > dose hint), the
// today_viewed event, the first-run hand-off and the section order. Every
// block's own behaviour has its own suite, so the heavy children are stubbed.
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useEarnedUpsell', () => ({ useEarnedUpsell: vi.fn() }));
vi.mock('@/hooks/useNextUp', () => ({ useNextUp: vi.fn() }));
vi.mock('@/hooks/useNextStep', () => ({ useNextStep: vi.fn() }));

vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({
    initialType,
    entry,
    onClose,
  }: {
    initialType?: string;
    entry?: string;
    onClose: () => void;
  }) => (
    <div data-testid="add-event-modal" data-entry={entry}>
      {initialType}
      <button type="button" onClick={onClose}>
        close-modal
      </button>
    </div>
  ),
}));
vi.mock('@/components/overview/QuickAccess', () => ({
  QuickAccess: ({
    circleId,
    showShiftsLink,
    stacked,
  }: {
    circleId: string;
    showShiftsLink: boolean;
    stacked: boolean;
  }) => (
    <div
      data-testid="quick-access"
      data-circle-id={circleId}
      data-shifts-link={String(showShiftsLink)}
      data-stacked={String(stacked)}
    />
  ),
}));
vi.mock('@/components/overview/DailyUpdateCard', () => ({
  DailyUpdateCard: ({ circleId, timezone, isOwner, isRecipient }: Record<string, unknown>) => (
    <div
      data-testid="daily-update-card"
      data-circle-id={String(circleId)}
      data-timezone={String(timezone)}
      data-owner={String(isOwner)}
      data-recipient={String(isRecipient)}
    />
  ),
}));
// The stub shows the hint slot under the right row and exposes the Taken press.
vi.mock('@/components/overview/NextUp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/overview/NextUp')>();
  return {
    ...actual,
    NextUp: ({
      items,
      hint,
      hintAfterKey,
      onTakenPressed,
      stacked,
    }: {
      items: NextUpItem[];
      hint?: React.ReactNode;
      hintAfterKey?: string | null;
      onTakenPressed?: () => void;
      stacked: boolean;
    }) => (
      <div data-testid="next-up" data-count={items.length} data-stacked={String(stacked)}>
        {items.map((i) => (
          <div key={i.key}>
            <span>{i.title}</span>
            {hint && hintAfterKey === i.key ? <div data-testid="hint-slot">{hint}</div> : null}
          </div>
        ))}
        <button type="button" onClick={onTakenPressed}>
          stub-taken
        </button>
      </div>
    ),
  };
});
vi.mock('@/components/circles/firstRun/FirstRunWizardModal', () => ({
  FirstRunWizardModal: ({ circleName, onClose }: { circleName: string; onClose: () => void }) => (
    <div data-testid="first-run-wizard" data-circle-name={circleName}>
      <button type="button" onClick={onClose}>
        close-wizard
      </button>
    </div>
  ),
}));
// Onboarding 1.3.1: Today asks about the owed paywall (tier) and renders the Mark it row.
const subscription = vi.hoisted(() => ({ tier: 'free' as string | undefined }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({
    data: subscription.tier ? { tier: subscription.tier } : undefined,
  }),
}));
vi.mock('@/components/overview/FirstMedMarkIt', () => ({
  FirstMedMarkIt: ({ canEdit, today }: { canEdit: boolean; today: string }) => (
    <div data-testid="first-med-mark-it" data-can-edit={String(canEdit)} data-today={today} />
  ),
}));

/** The /upgrade route: exposes where Today sent the user. */
function UpgradeProbe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="upgrade-page" data-state={JSON.stringify(location.state)} />;
}

const mockUseCircle = vi.mocked(useCircle);
const mockUseNextUp = vi.mocked(useNextUp);
const mockUseNextStep = vi.mocked(useNextStep);

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

interface Options {
  ownerId?: string;
  recipientName?: string;
  isLoading?: boolean;
  circle?: null;
  selfCare?: boolean;
  isPremiumCircle?: boolean;
  hasShifts?: boolean;
  canEdit?: boolean;
  joinedAgoDays?: number;
}

function setCircle(opts: Options = {}): void {
  const owner = opts.ownerId ?? 'u1';
  mockUseCircle.mockReturnValue({
    circle:
      opts.circle === null
        ? undefined
        : {
            id: 'c1',
            owner_id: owner,
            recipient_name: opts.recipientName ?? 'Rose',
            is_self_care: opts.selfCare ?? false,
          },
    members:
      opts.circle === null
        ? []
        : [
            {
              id: 'u1',
              first_name: 'Pat',
              email: 'pat@example.com',
              is_care_recipient: false,
              joined_at: new Date(NOW - 60 * DAY).toISOString(),
            },
            {
              id: 'u2',
              first_name: 'Sam',
              email: 'sam@example.com',
              is_care_recipient: false,
              joined_at: new Date(NOW - (opts.joinedAgoDays ?? 1) * DAY).toISOString(),
            },
          ],
    timezone: 'America/New_York',
    isLoading: opts.isLoading ?? false,
    canEdit: opts.canEdit ?? true,
    viewOnly: false,
    isPremiumCircle: opts.isPremiumCircle ?? true,
    hasShifts: opts.hasShifts ?? false,
    isOwner: owner === 'u1',
  } as unknown as ReturnType<typeof useCircle>);
}

/** A dose due now: confirmable, so the first-dose hint can attach to it. */
function dose(id: string): NextUpItem {
  // Midnight of the recipient's today: always already due, whatever time the suite runs.
  const today = getDateInTimezone('America/New_York');
  return {
    key: `medication:${id}`,
    type: 'medication',
    id,
    title: `Med ${id}`,
    detail: '10mg',
    time: '00:00:00',
    date: today,
    late: false,
    lateHours: null,
    med: {
      id,
      event_type: 'medication',
      title: `Med ${id}`,
      scheduled_date: today,
      scheduled_time: '00:00:00',
    } as NextUpItem['med'],
  };
}

function setNextUp(items: NextUpItem[], over: Partial<UseNextUpResult> = {}): void {
  mockUseNextUp.mockReturnValue({
    items,
    settled: true,
    isError: false,
    today: '2026-10-28',
    refetch: vi.fn(),
    ...over,
  });
}

function setNextStep(state: NextStepState): void {
  mockUseNextStep.mockReturnValue(state);
}

function renderToday(state?: unknown): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/circles/c1', state }]}>
      <Routes>
        <Route path="/circles/:circleId" element={<OverviewPage />} />
        <Route path="/circles/:circleId/members" element={<div data-testid="members-page" />} />
        <Route path="/circles/:circleId/calendar" element={<div data-testid="calendar-page" />} />
        <Route path="/profile" element={<div data-testid="profile-page" />} />
        <Route path="/upgrade" element={<UpgradeProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Today (OverviewPage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    subscription.tier = 'free';
    resetLargeTextReports();
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
    setCircle();
    setNextUp([]);
    setNextStep({ status: 'none' });
    vi.spyOn(Analytics, 'todayViewed').mockImplementation(() => {});
    vi.spyOn(Analytics, 'largeTextLayout').mockImplementation(() => {});
  });

  afterEach(() => {
    document.documentElement.style.fontSize = '';
  });

  it('titles the page "Today for {name}" with a date eyebrow', () => {
    renderToday();
    expect(screen.getByRole('heading', { level: 1, name: 'Today for Rose' })).toBeInTheDocument();
    const header = screen.getByTestId('overview-hero');
    // "Wednesday, October 28": a weekday, a month and a day, whatever today is.
    expect(header.textContent).toMatch(/[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}/);
  });

  it('a self-care circle is just "Today"', () => {
    setCircle({ selfCare: true });
    renderToday();
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
  });

  it('orders the blocks: header, daily update, Next up, Quick access', () => {
    renderToday();
    const ids = Array.from(document.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => ['overview-hero', 'daily-update-card', 'next-up', 'quick-access'].includes(id!));
    expect(ids).toEqual(['overview-hero', 'daily-update-card', 'next-up', 'quick-access']);
  });

  it('has none of the old Home blocks: no adherence, checklist, help card, care team, settings, meds/tasks cards', () => {
    renderToday();
    for (const id of [
      'adherence-card',
      'getting-started',
      'help-home-card',
      'care-team',
      'settings-rows',
      'todays-meds',
      'upcoming-appointments',
      'open-tasks-card',
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.queryByText('Cared for by')).not.toBeInTheDocument();
  });

  it('has no Say it / voice entry on web', () => {
    renderToday();
    expect(screen.queryByText(/say it/i)).not.toBeInTheDocument();
  });

  it('lays out two columns from xl, one column otherwise', () => {
    renderToday();
    const grid = screen.getByTestId('today-grid');
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).toHaveClass('xl:grid-cols-2');
    expect(screen.getByTestId('next-up')).toHaveAttribute('data-stacked', 'false');
  });

  describe('large text (measured, not guessed)', () => {
    it('goes one column and stacks rows at a large root font, and reports it once', () => {
      document.documentElement.style.fontSize = '32px';
      renderToday();
      const grid = screen.getByTestId('today-grid');
      expect(grid).not.toHaveClass('xl:grid-cols-2');
      expect(screen.getByTestId('next-up')).toHaveAttribute('data-stacked', 'true');
      expect(screen.getByTestId('quick-access')).toHaveAttribute('data-stacked', 'true');
      expect(Analytics.largeTextLayout).toHaveBeenCalledWith('today', true);
      expect(Analytics.largeTextLayout).toHaveBeenCalledTimes(1);
    });

    it('reports active=false at the default size', () => {
      renderToday();
      expect(Analytics.largeTextLayout).toHaveBeenCalledWith('today', false);
    });
  });

  describe('daily update card', () => {
    it("receives the recipient zone and the viewer's owner / recipient flags", () => {
      renderToday();
      const card = screen.getByTestId('daily-update-card');
      expect(card).toHaveAttribute('data-timezone', 'America/New_York');
      expect(card).toHaveAttribute('data-owner', 'true');
      expect(card).toHaveAttribute('data-recipient', 'false');
    });

    it('is not mounted until the recipient zone is known', () => {
      mockUseCircle.mockReturnValue({
        ...(mockUseCircle('c1') as object),
        timezone: null,
      } as unknown as ReturnType<typeof useCircle>);
      renderToday();
      expect(screen.queryByTestId('daily-update-card')).not.toBeInTheDocument();
      expect(screen.queryByTestId('next-up')).not.toBeInTheDocument();
    });
  });

  describe('quick access wiring', () => {
    it('offers the Shifts link where shifts exist for the viewer', () => {
      renderToday();
      expect(screen.getByTestId('quick-access')).toHaveAttribute('data-shifts-link', 'true');
    });

    it('hides the Shifts link for a free circle member (never sold a paywall)', () => {
      setCircle({ ownerId: 'someone-else', isPremiumCircle: false });
      renderToday();
      expect(screen.getByTestId('quick-access')).toHaveAttribute('data-shifts-link', 'false');
    });
  });

  describe('ONE coaching element at a time (next-step > shifts > dose hint)', () => {
    const step: NextStepState = {
      status: 'step',
      step: 'first_med',
      position: 1,
      total: 3,
      snooze: vi.fn(),
    };

    it('next-step beats the shifts nudge and the dose hint, even when all three qualify', () => {
      setNextStep(step);
      setNextUp([dose('m1')]);
      renderToday();
      expect(screen.getByTestId('next-step-card')).toBeInTheDocument();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dose-hint')).not.toBeInTheDocument();
      expect(Analytics.todayViewed).toHaveBeenCalledWith({
        has_items: true,
        next_up_count: 1,
        coaching: 'next_step',
      });
    });

    it('shifts nudge shows when no next step is due, and beats the dose hint', () => {
      setNextUp([dose('m1')]);
      renderToday();
      expect(screen.getByTestId('shifts-nudge-card')).toBeInTheDocument();
      expect(screen.queryByTestId('dose-hint')).not.toBeInTheDocument();
      expect(Analytics.todayViewed).toHaveBeenCalledWith(
        expect.objectContaining({ coaching: 'shifts' })
      );
    });

    it('the dose hint shows last, under the first dose row', () => {
      setCircle({ ownerId: 'someone-else', isPremiumCircle: false });
      setNextUp([dose('m1'), dose('m2')]);
      renderToday();
      expect(screen.getByTestId('hint-slot')).toContainElement(screen.getByTestId('dose-hint'));
      expect(screen.getByTestId('hint-slot').previousSibling).toHaveTextContent('Med m1');
      expect(Analytics.todayViewed).toHaveBeenCalledWith(
        expect.objectContaining({ coaching: 'dose_hint' })
      );
    });

    it('no coaching at all reports "none"', () => {
      setCircle({ ownerId: 'someone-else', isPremiumCircle: false });
      renderToday();
      expect(Analytics.todayViewed).toHaveBeenCalledWith({
        has_items: false,
        next_up_count: 0,
        coaching: 'none',
      });
    });

    it('never renders two coaching elements together, whatever the combination', () => {
      for (const withStep of [false, true]) {
        for (const shiftsEligible of [false, true]) {
          document.body.innerHTML = '';
          setCircle({ isPremiumCircle: shiftsEligible });
          setNextStep(withStep ? step : { status: 'none' });
          setNextUp([dose('m1')]);
          renderToday();
          const shown = ['next-step-card', 'shifts-nudge-card', 'dose-hint'].filter(
            (id) => screen.queryByTestId(id) !== null
          );
          expect(shown).toHaveLength(1);
        }
      }
    });
  });

  describe('today_viewed', () => {
    it('waits until the list and the next-step state have answered, then fires once', () => {
      setNextUp([], { settled: false });
      renderToday();
      expect(Analytics.todayViewed).not.toHaveBeenCalled();
    });

    it('waits while the next-step state is unknown', () => {
      setNextStep({ status: 'unknown' });
      renderToday();
      expect(Analytics.todayViewed).not.toHaveBeenCalled();
    });

    it('carries no circle id', () => {
      setNextUp([dose('m1')]);
      renderToday();
      const props = vi.mocked(Analytics.todayViewed).mock.calls[0][0];
      expect(Object.keys(props).sort()).toEqual(['coaching', 'has_items', 'next_up_count']);
    });
  });

  describe('next-step card actions', () => {
    const base = { status: 'step' as const, position: 1, total: 3, snooze: vi.fn() };

    it('first medication opens the medication form over Today and closes again', async () => {
      const user = userEvent.setup();
      setNextStep({ ...base, step: 'first_med' });
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Add medication' }));
      expect(screen.getByTestId('add-event-modal')).toHaveTextContent('medication');
      // entry_form_opened.entry for a form opened from the next-step card.
      expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-entry', 'next_step');
      await user.click(screen.getByRole('button', { name: 'close-modal' }));
      expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
    });

    it('invite goes to Members', async () => {
      const user = userEvent.setup();
      setNextStep({ ...base, step: 'invite', position: 2 });
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Invite' }));
      expect(screen.getByTestId('members-page')).toBeInTheDocument();
    });

    it('reminders goes to Profile', async () => {
      const user = userEvent.setup();
      setNextStep({ ...base, step: 'reminders', position: 3 });
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));
      expect(screen.getByTestId('profile-page')).toBeInTheDocument();
    });

    it('"Not now" snoozes the current step', async () => {
      const user = userEvent.setup();
      const snooze = vi.fn();
      setNextStep({ ...base, step: 'first_med', snooze });
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Not now' }));
      expect(snooze).toHaveBeenCalledTimes(1);
    });
  });

  describe('shifts nudge', () => {
    it('Set up shifts opens the Shifts view and never shows again', async () => {
      const user = userEvent.setup();
      renderToday();
      expect(screen.getByText('Sam joined Rose’s circle'.replace('’', "'"))).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Set up shifts' }));
      expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
      document.body.innerHTML = '';
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });

    it('Not now dismisses it for good (per user and circle)', async () => {
      const user = userEvent.setup();
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Not now' }));
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
      document.body.innerHTML = '';
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });

    it('is not shown when the 2nd caregiver joined long ago', () => {
      setCircle({ joinedAgoDays: 40 });
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });

    it('is not shown when the circle already has shifts', () => {
      setCircle({ hasShifts: true });
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });

    it('a free circle MEMBER never sees it (owner-aware gates: members are never sold a paywall)', () => {
      setCircle({ isPremiumCircle: false, ownerId: 'someone-else' });
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });

    it('a lapsed (read-only) circle does not get it', () => {
      setCircle({ isPremiumCircle: false, hasShifts: true });
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });

    describe('free-circle OWNER (upsell variant)', () => {
      beforeEach(() => {
        setCircle({ isPremiumCircle: false });
        vi.spyOn(Analytics, 'coachingHintShown').mockImplementation(() => {});
        vi.spyOn(Analytics, 'coachingHintActed').mockImplementation(() => {});
        vi.spyOn(Analytics, 'coachingHintDismissed').mockImplementation(() => {});
        vi.spyOn(Analytics, 'shiftsTeaserShown').mockImplementation(() => {});
      });

      it('sees the card; Set up shifts opens the existing teaser (not the schedule) and counts as acted with upsell', async () => {
        const user = userEvent.setup();
        renderToday();
        expect(screen.getByTestId('shifts-nudge-card')).toBeInTheDocument();
        expect(Analytics.coachingHintShown).toHaveBeenCalledWith('shifts_second_caregiver', {
          upsell: true,
        });
        await user.click(screen.getByRole('button', { name: 'Set up shifts' }));
        expect(Analytics.coachingHintActed).toHaveBeenCalledWith('shifts_second_caregiver', {
          upsell: true,
        });
        expect(Analytics.shiftsTeaserShown).toHaveBeenCalledWith({ source: 'shifts_nudge' });
        expect(screen.getByRole('button', { name: /See Premium/i })).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-page')).not.toBeInTheDocument();
        expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
      });

      it('Not now is dismissed with upsell, and never comes back', async () => {
        const user = userEvent.setup();
        renderToday();
        await user.click(screen.getByRole('button', { name: 'Not now' }));
        expect(Analytics.coachingHintDismissed).toHaveBeenCalledWith('shifts_second_caregiver', {
          upsell: true,
        });
        document.body.innerHTML = '';
        renderToday();
        expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
      });
    });

    it('premium circle is unchanged: upsell false, opens the Shifts view', async () => {
      const user = userEvent.setup();
      const shown = vi.spyOn(Analytics, 'coachingHintShown').mockImplementation(() => {});
      vi.spyOn(Analytics, 'coachingHintActed').mockImplementation(() => {});
      renderToday();
      expect(shown).toHaveBeenCalledWith('shifts_second_caregiver', { upsell: false });
      await user.click(screen.getByRole('button', { name: 'Set up shifts' }));
      expect(Analytics.coachingHintActed).toHaveBeenCalledWith('shifts_second_caregiver', {
        upsell: false,
      });
      expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
    });

    it('is not shown to the person who just joined', () => {
      useAuthStore.setState({
        user: { id: 'u2', email: 'sam@example.com', first_name: 'Sam', last_name: 'Lee' },
      } as never);
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });

    it('is not shown to a free circle member', () => {
      setCircle({ ownerId: 'someone-else', isPremiumCircle: false });
      renderToday();
      expect(screen.queryByTestId('shifts-nudge-card')).not.toBeInTheDocument();
    });
  });

  describe('first-dose hint', () => {
    beforeEach(() => {
      setCircle({ ownerId: 'someone-else', isPremiumCircle: false });
      setNextUp([dose('m1')]);
    });

    it('"Got it" hides it and it never shows twice (persisted per user)', async () => {
      const user = userEvent.setup();
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Got it' }));
      expect(screen.queryByTestId('dose-hint')).not.toBeInTheDocument();
      document.body.innerHTML = '';
      renderToday();
      expect(screen.queryByTestId('dose-hint')).not.toBeInTheDocument();
    });

    it('pressing Taken while it is up counts as acted and retires it', async () => {
      const user = userEvent.setup();
      const acted = vi.spyOn(Analytics, 'coachingHintActed').mockImplementation(() => {});
      renderToday();
      await user.click(screen.getByRole('button', { name: 'stub-taken' }));
      expect(acted).toHaveBeenCalledWith('first_dose');
      expect(screen.queryByTestId('dose-hint')).not.toBeInTheDocument();
    });

    it('a different user still sees it', async () => {
      const user = userEvent.setup();
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Got it' }));
      document.body.innerHTML = '';
      useAuthStore.setState({
        user: { id: 'u9', email: 'x@example.com', first_name: 'X', last_name: 'Y' },
        isAuthenticated: true,
      });
      renderToday();
      expect(screen.getByTestId('dose-hint')).toBeInTheDocument();
    });

    it('is not offered to a viewer who cannot answer doses', () => {
      setCircle({ ownerId: 'someone-else', isPremiumCircle: false, canEdit: false });
      renderToday();
      expect(screen.queryByTestId('dose-hint')).not.toBeInTheDocument();
    });
  });

  describe('first run', () => {
    it('opens the wizard from the creation navigation state', () => {
      renderToday({ firstRun: true, firstRunRecipientName: 'Rose' });
      expect(screen.getByTestId('first-run-wizard')).toHaveAttribute('data-circle-name', 'Rose');
    });

    it('stays shut on a plain visit', () => {
      renderToday();
      expect(screen.queryByTestId('first-run-wizard')).not.toBeInTheDocument();
    });

    it('prefers the loaded recipient name over the one carried on the navigation', () => {
      setCircle({ recipientName: 'Rose Meza' });
      renderToday({ firstRun: true, firstRunRecipientName: 'Rose' });
      expect(screen.getByTestId('first-run-wizard')).toHaveAttribute('data-circle-name', 'Rose Meza');
    });
  });

  describe('owed onboarding paywall (no first med path, spec section 7)', () => {
    beforeEach(() => {
      subscription.tier = 'free';
    });

    it('shows the paywall ONCE the next time Today is on screen, trigger onboarding', () => {
      markOnboardingPaywallPending('c1');
      renderToday();
      const page = screen.getByTestId('upgrade-page');
      expect(JSON.parse(page.getAttribute('data-state') ?? '{}')).toEqual({
        paywallContext: 'onboarding',
        paywallTrigger: 'onboarding',
      });
      // Seen flag written, owed record cleared, return target parked for the exits.
      expect(hasSeenOnboardingPaywall()).toBe(true);
      expect(peekOnboardingPaywallPending()).toBeNull();
      expect(peekDeferredFirstRun()).toMatchObject({ circleId: 'c1' });
    });

    it('is NOT shown when nothing is owed', () => {
      renderToday();
      expect(screen.queryByTestId('upgrade-page')).not.toBeInTheDocument();
    });

    it('is NOT shown for a different circle than the one owed', () => {
      markOnboardingPaywallPending('other-circle');
      renderToday();
      expect(screen.queryByTestId('upgrade-page')).not.toBeInTheDocument();
      expect(peekOnboardingPaywallPending()).toBe('other-circle');
    });

    it('waits while the wizard is open, then asks when it closes (Skip / close = no first med)', async () => {
      const user = userEvent.setup();
      markOnboardingPaywallPending('c1');
      renderToday({ firstRun: true, firstRunRecipientName: 'Rose' });
      expect(screen.queryByTestId('upgrade-page')).not.toBeInTheDocument();
      expect(hasSeenOnboardingPaywall()).toBe(false);

      await user.click(screen.getByRole('button', { name: 'close-wizard' }));
      expect(screen.getByTestId('upgrade-page')).toBeInTheDocument();
    });

    it('waits while the add-medication modal is open', async () => {
      const user = userEvent.setup();
      setNextStep({ status: 'step', step: 'first_med', position: 1, total: 3, snooze: vi.fn() });
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Add medication' }));
      markOnboardingPaywallPending('c1');
      // The owed record only appears now; closing the modal is what lets Today ask.
      await user.click(screen.getByRole('button', { name: 'close-modal' }));
      expect(screen.getByTestId('upgrade-page')).toBeInTheDocument();
    });

    it('never shows twice: already seen means no paywall and the owed record is released', () => {
      markOnboardingPaywallSeen();
      markOnboardingPaywallPending('c1');
      renderToday();
      expect(screen.queryByTestId('upgrade-page')).not.toBeInTheDocument();
      expect(peekOnboardingPaywallPending()).toBeNull();
    });

    it('a premium user is released without a paywall', () => {
      subscription.tier = 'premium';
      markOnboardingPaywallPending('c1');
      renderToday();
      expect(screen.queryByTestId('upgrade-page')).not.toBeInTheDocument();
      expect(peekOnboardingPaywallPending()).toBeNull();
      expect(hasSeenOnboardingPaywall()).toBe(false);
    });

    it('an unknown tier waits (fails closed) and keeps it owed', () => {
      subscription.tier = undefined;
      markOnboardingPaywallPending('c1');
      renderToday();
      expect(screen.queryByTestId('upgrade-page')).not.toBeInTheDocument();
      expect(peekOnboardingPaywallPending()).toBe('c1');
    });
  });

  describe('first med Mark it row', () => {
    it('is mounted with the recipient-zone today and the viewer edit right', () => {
      renderToday();
      const row = screen.getByTestId('first-med-mark-it');
      expect(row).toHaveAttribute('data-can-edit', 'true');
      expect(row).toHaveAttribute('data-today', '2026-10-28');
    });

    it('is told when the viewer cannot edit (view-only never sees the line)', () => {
      setCircle({ canEdit: false });
      renderToday();
      expect(screen.getByTestId('first-med-mark-it')).toHaveAttribute('data-can-edit', 'false');
    });
  });

  describe('earned upsell wiring (PK28(1))', () => {
    const enabled = () => vi.mocked(useEarnedUpsell).mock.calls.at(-1)?.[0];

    it('is enabled for the circle owner on a plain visit', () => {
      renderToday();
      expect(enabled()).toBe(true);
    });

    it('is never enabled for a member', () => {
      setCircle({ ownerId: 'someone-else' });
      renderToday();
      expect(enabled()).toBe(false);
    });

    it('is held off while the first-run wizard is open', () => {
      renderToday({ firstRun: true, firstRunRecipientName: 'Rose' });
      expect(enabled()).toBe(false);
    });

    it('is held off while the add-medication modal is open and returns when it closes', async () => {
      const user = userEvent.setup();
      setNextStep({ status: 'step', step: 'first_med', position: 1, total: 3, snooze: vi.fn() });
      renderToday();
      await user.click(screen.getByRole('button', { name: 'Add medication' }));
      expect(enabled()).toBe(false);
      await user.click(screen.getByRole('button', { name: 'close-modal' }));
      expect(enabled()).toBe(true);
    });
  });

  it('shows a header placeholder rather than an empty title while the circle loads', () => {
    setCircle({ circle: null, isLoading: true });
    renderToday();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
