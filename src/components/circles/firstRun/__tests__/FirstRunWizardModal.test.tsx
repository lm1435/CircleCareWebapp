import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CreateEventRequest } from '@/api/calendarEvents';
import { FirstRunWizardModal } from '../FirstRunWizardModal';
import { onlineManager } from '@tanstack/react-query';
import { __resetOfflineWriteForTests, setOfflineWriteExplainer } from '@/lib/offlineWrite';

/**
 * The wizard's BEHAVIOUR: step transitions, the constraint-4 gate, the
 * timezone refusal, the past-time notice, and every skip/close path.
 *
 * WHAT IT DOES NOT TEST: the wire values. Those live in
 * `src/utils/__tests__/firstRunMedication.test.ts`, where a sibling dose that
 * crosses the recipient's midnight is reachable — a rendered test drives one
 * viewer/recipient pairing and cannot get near it.
 *
 * THE ZONES ARE PINNED, both of them, and to the SAME zone.
 *
 * This file asserts things like "the past-time notice appears", which is a
 * function of (runner zone, recipient zone, wall clock). Left to the runner,
 * `scripts/run-unit-timezones.sh` would not test the same behaviour ten times —
 * it would make the expectation wrong in most of them, and the flakiness would
 * be time-of-day dependent on top. So the runner zone is pinned to UTC, the
 * recipient is UTC, and the clock is frozen: the conversion then contributes
 * nothing and what is left is the wizard's own logic. AddEventModal.test.tsx
 * pins its zone for the same reason and records the same rationale.
 */
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const CIRCLE_ID = 'circle-1';
const RECIPIENT_TZ = 'UTC';
/** 06:00 UTC — BEFORE the 08:00 default, so the past-time notice stays away. */
const MORNING = new Date('2026-09-01T06:00:00Z');
/** 20:00 UTC — an evening signup, which is the path the notice exists for. */
const EVENING = new Date('2026-09-01T20:00:00Z');

// ── Hook mocks ──────────────────────────────────────────────────────────────
const mutateCreate = vi.fn();
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
}));

const useCircleResult: {
  circle: Record<string, unknown> | undefined;
  /**
   * MOCKED SEPARATELY FROM `circle`, because the real hook derives it
   * separately: `canEdit` is `circle?.can_edit ?? false`, so a RESOLVED circle
   * can still be `canEdit: false` (view-only membership, the freemium
   * caregiver cap, or `getCircleAccessLevel` failing closed). Folding the two
   * together here would make the "resolved but not writable" case unwritable as
   * a test, which is the case that blanked the screen.
   */
  canEdit: boolean;
} = {
  circle: {
    id: CIRCLE_ID,
    name: 'Rosa',
    recipient_name: 'Rosa',
    is_self_care: false,
    care_recipient_timezone: RECIPIENT_TZ,
  },
  canEdit: true,
};
/**
 * `canEdit` is ANDed with `circle`, so the mock cannot express a state the real
 * hook cannot reach.
 *
 * The real one derives `canEdit` from `circle?.can_edit ?? false`, which makes
 * "no circle yet, but writable" impossible. Left as two independent fields, a
 * test could set `circle: undefined` while `canEdit` stayed true from the
 * default — and then assert a cold-cache behaviour against a shape the product
 * never produces. The override direction that IS real (a resolved circle the
 * requester may not write to) still works, because false wins the AND.
 */
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    circle: useCircleResult.circle,
    canEdit: useCircleResult.canEdit && !!useCircleResult.circle,
  }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

/**
 * The hand-off destinations are STUBBED. This file asks "did the wizard hand
 * off, carrying which answers?" — rendering the real 1,300-line form would
 * answer a different question and drag its whole hook surface in with it.
 */
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: (props: {
    initialType?: string;
    initialTitle?: string;
    initialDosage?: string;
    initialTime?: string;
    initialRecurrence?: string | null;
    onSaved?: () => void;
    onClose: () => void;
  }) => (
    <div
      data-testid="add-event-modal"
      data-type={props.initialType}
      data-title={props.initialTitle}
      data-dosage={props.initialDosage}
      data-time={props.initialTime}
      data-recurrence={props.initialRecurrence ?? ''}
    >
      {/* The real form calls onSaved then onClose after a create, and only
          onClose on Cancel/×/Escape — the stub exposes both paths. */}
      <button type="button" onClick={props.onClose}>
        stub-cancel
      </button>
      <button
        type="button"
        onClick={() => {
          props.onSaved?.();
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
      <button
        type="button"
        onClick={() => {
          props.onInvited?.();
          props.onClose();
        }}
      >
        stub-save
      </button>
    </div>
  ),
}));

const hourCycleState = vi.hoisted(() => ({ value: '12h' as '12h' | '24h' }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => hourCycleState.value }));

const analytics = vi.hoisted(() => ({
  firstRunMoreOptionsToggled: vi.fn(),
  firstRunInvitePromptAction: vi.fn(),
  firstRunStepViewed: vi.fn(),
  firstRunActionSelected: vi.fn(),
  firstRunSkipped: vi.fn(),
  firstRunMedicationSaved: vi.fn(),
  medicationCreationStarted: vi.fn(),
  medicationCreated: vi.fn(),
  entryFieldEntered: vi.fn(),
  entryScheduleSet: vi.fn(),
  entrySaveTapped: vi.fn(),
  entrySaveFailed: vi.fn(),
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

/** ① → ② → ③ → ④, filling the name on the way. */
async function walkToRepeat(user: ReturnType<typeof userEvent.setup>, name = 'Metformin') {
  await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
  await user.type(screen.getByLabelText(/Medication name/i), name);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

/** Opens step ①'s "See what else" card. */
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /See what else/i }));
}

const PAYOFF_8AM = "Rosa's 8:00 AM reminder is set.";

beforeEach(() => {
  vi.clearAllMocks();
  hourCycleState.value = '12h';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MORNING);
  mutateCreate.mockResolvedValue({ id: 'evt-primary' });
  useCircleResult.circle = {
    id: CIRCLE_ID,
    name: 'Rosa',
    recipient_name: 'Rosa',
    is_self_care: false,
    care_recipient_timezone: RECIPIENT_TZ,
  };
  useCircleResult.canEdit = true;
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Screen ①: one primary, three quiet rows ─────────────────────────────────

describe('choose step: circle is ready, one button', () => {
  const isFilled = (button: HTMLElement): boolean =>
    button.className.split(/\s+/).includes('bg-primary-fill');

  it('opens closed: title, lede, ONE filled button, a collapsed toggle, no rows', () => {
    renderWizard();
    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: "Rosa's circle is ready." })).toBeInTheDocument();
    const lede = "Add Rosa's first medication. That's the reminder everyone in the circle will share.";
    expect(screen.getByText(lede)).toBeInTheDocument();
    const filled = within(dialog).getAllByRole('button').filter(isFilled);
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent('Add the first medication');
    expect(filled[0]).toHaveAccessibleDescription(lede);
    const toggle = screen.getByRole('button', { name: 'No medications to track? See what else' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('first-run-start-with-appointment')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close setup' })).toBeInTheDocument();
  });

  it('the toggle reveals three rows ABOVE the primary, then hides them', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await openMore(user);

    const toggle = screen.getByTestId('first-run-more-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Hide');
    const list = document.getElementById(toggle.getAttribute('aria-controls') as string) as HTMLElement;
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Add an appointmentDoctor visits on one calendar the family sees.',
      "Invite someone to helpShare the load, so it isn't all on you.",
      'Add emergency infoAllergies and doctors, ready when it matters.',
    ]);
    expect(rows.filter(isFilled)).toHaveLength(0);
    const primary = screen.getByTestId('first-run-primary');
    expect(list.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('first-run-start-with-appointment')).not.toBeInTheDocument();
  });

  it('records every toggle tap with the new state, and nothing else', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByTestId('first-run-more-toggle'));
    await user.click(screen.getByTestId('first-run-more-toggle'));
    expect(analytics.firstRunMoreOptionsToggled.mock.calls).toEqual([
      [true],
      [false],
    ]);
    expect(analytics.firstRunActionSelected).not.toHaveBeenCalled();
    expect(analytics.firstRunSkipped).not.toHaveBeenCalled();
  });

  it('each row records the same action as before', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await openMore(user);
    await user.click(screen.getByTestId('first-run-start-with-emergency'));
    expect(analytics.firstRunActionSelected).toHaveBeenCalledWith(CIRCLE_ID, 'emergency');
  });

  it('self-care reads you-copy on the lede and the primary', () => {
    useCircleResult.circle = { ...useCircleResult.circle, is_self_care: true };
    renderWizard();
    expect(
      screen.getByText("Add your first medication. That's the reminder everyone in your circle will share.")
    ).toBeInTheDocument();
    expect(screen.getByTestId('first-run-primary')).toHaveTextContent('Add your first medication');
  });
});

// ── After the save: the invite offer ────────────────────────────────────────

describe('invite offer after the first medication saves', () => {
  async function saveMedication(user: ReturnType<typeof userEvent.setup>) {
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await screen.findByRole('heading', { name: PAYOFF_8AM });
  }

  it('shows inviting as the one primary action, with a plain "Not now" and no way back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveMedication(user);

    // One dialog — the offer replaces the questions, it is not stacked on them.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText(/When someone taps Taken, everyone in the circle sees it/)).toBeInTheDocument();
    expect(screen.getByText("Who's usually there with Rosa?")).toBeInTheDocument();
    const primary = screen.getByRole('button', { name: 'Invite someone' });
    expect(primary.className.split(/\s+/)).toContain('bg-primary-fill');
    const notNow = screen.getByRole('button', { name: 'Not now' });
    expect(notNow.className.split(/\s+/)).not.toContain('bg-primary-fill');
    // The save button and Back are gone: a second copy cannot be created.
    expect(screen.queryByRole('button', { name: 'Add medication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('"Not now" closes the wizard without a discard prompt', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await saveMedication(user);
    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard this medication?')).not.toBeInTheDocument();
  });

  it('the close X closes it too, and is not counted as skipping the wizard', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await saveMedication(user);
    await user.click(screen.getByRole('button', { name: 'Close setup' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Discard this medication?')).not.toBeInTheDocument();
    expect(analytics.firstRunSkipped).not.toHaveBeenCalled();
  });

  it('the primary opens the invite form in place, and a sent invite closes the wizard', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await saveMedication(user);
    await user.click(screen.getByRole('button', { name: 'Invite someone' }));

    expect(screen.getByTestId('invite-modal')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: PAYOFF_8AM })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'stub-save' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutateCreate).toHaveBeenCalledTimes(1);
  });

  it('adds no funnel noise: no fifth step view, no second action selection', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveMedication(user);
    await user.click(screen.getByRole('button', { name: 'Invite someone' }));

    expect(analytics.firstRunStepViewed.mock.calls.map((c) => c[1])).toEqual([
      'choose',
      'what',
      'when',
      'repeat',
    ]);
    expect(analytics.firstRunActionSelected.mock.calls.map((c) => c[1])).toEqual(['medication']);
  });
});

describe('payoff and invite events', () => {
  async function saveWith(user: ReturnType<typeof userEvent.setup>, preset?: RegExp) {
    await user.click(screen.getByRole('button', { name: /Add the first medication|Add your first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    if (preset) await user.click(screen.getByRole('radio', { name: preset }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
  }

  it('single dose: names the time, the medication and the repeat in the card', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveWith(user);
    await screen.findByRole('heading', { name: "Rosa's 8:00 AM reminder is set." });
    const card = screen.getByTestId('first-run-payoff-card');
    expect(card).toHaveTextContent('Metformin');
    expect(card).toHaveTextContent('8:00 AM · Daily');
    expect(screen.getByRole('heading', { name: "Rosa's 8:00 AM reminder is set." })).toHaveFocus();
  });

  it('multi dose: plural title, every time listed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveWith(user, /Twice daily/i);
    await screen.findByRole('heading', { name: "Rosa's reminders are set." });
    expect(screen.getByTestId('first-run-payoff-card')).toHaveTextContent('8:00 AM, 8:00 PM · Daily');
  });

  it('self-care: you-copy for single and multi dose', async () => {
    useCircleResult.circle = { ...useCircleResult.circle, is_self_care: true };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveWith(user);
    await screen.findByRole('heading', { name: 'Your 8:00 AM reminder is set.' });
    expect(screen.getByText('When you tap Taken, anyone you invite sees it too.')).toBeInTheDocument();
    expect(screen.getByText('Who helps you out?')).toBeInTheDocument();
  });

  it('self-care multi dose reads "Your reminders are set."', async () => {
    useCircleResult.circle = { ...useCircleResult.circle, is_self_care: true };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveWith(user, /Three times daily/i);
    expect(await screen.findByRole('heading', { name: 'Your reminders are set.' })).toBeInTheDocument();
  });

  it('formats times with the viewer hour cycle (24h)', async () => {
    hourCycleState.value = '24h';
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveWith(user);
    expect(await screen.findByRole('heading', { name: "Rosa's 08:00 reminder is set." })).toBeInTheDocument();
  });

  it('records invite, not_now and close as first_run_invite_prompt_action', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = renderWizard();
    await saveWith(user);
    await screen.findByRole('heading', { name: PAYOFF_8AM });
    await user.click(screen.getByRole('button', { name: 'Invite someone' }));
    expect(analytics.firstRunInvitePromptAction).toHaveBeenLastCalledWith('invite');
    expect(first.onClose).not.toHaveBeenCalled();
  });

  it('records not_now', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveWith(user);
    await screen.findByRole('heading', { name: PAYOFF_8AM });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(analytics.firstRunInvitePromptAction.mock.calls).toEqual([['not_now']]);
  });

  it('records close', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await saveWith(user);
    await screen.findByRole('heading', { name: PAYOFF_8AM });
    await user.click(screen.getByRole('button', { name: 'Close setup' }));
    expect(analytics.firstRunInvitePromptAction.mock.calls).toEqual([['close']]);
  });
});

describe('step ② lighter name', () => {
  async function toName(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
  }

  it('shows the lede, hides the dosage, and previews the default time', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await toName(user);
    expect(screen.getByText('Just the name is enough. Details can wait.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Dosage/i)).not.toBeInTheDocument();
    const preview = screen.getByTestId('first-run-next-preview');
    expect(preview).toHaveTextContent('Next');
    expect(preview).toHaveTextContent('Every morning at 8:00 AM. You can change it on the next screen.');
  });

  it('"+ Add dosage" reveals the field and focuses it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await toName(user);
    await user.click(screen.getByRole('button', { name: '+ Add dosage' }));
    const field = screen.getByLabelText(/Dosage/i);
    expect(field).toHaveFocus();
    expect(screen.queryByRole('button', { name: '+ Add dosage' })).not.toBeInTheDocument();
  });

  it('starts revealed when a dosage already exists (after Back)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await toName(user);
    await user.click(screen.getByRole('button', { name: '+ Add dosage' }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.type(screen.getByLabelText(/Dosage/i), '500mg');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Dosage/i)).toHaveValue('500mg');
    expect(screen.queryByRole('button', { name: '+ Add dosage' })).not.toBeInTheDocument();
  });

  it('previews the CURRENT first time of the schedule chosen on ③', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await toName(user);
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Evening/i }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('first-run-next-preview')).toHaveTextContent('Every evening at 8:00 PM.');
  });

  it('formats the preview with the 24h cycle', async () => {
    hourCycleState.value = '24h';
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await toName(user);
    expect(screen.getByTestId('first-run-next-preview')).toHaveTextContent('Every morning at 08:00.');
  });
});

// ── Step transitions ────────────────────────────────────────────────────────

describe('step transitions', () => {
  it('opens on the choose step, with no medication fields yet', () => {
    renderWizard();
    expect(screen.getByRole('button', { name: /Add the first medication/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Medication name/i)).not.toBeInTheDocument();
  });

  it('advances choose → what → when → repeat', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();

    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    expect(screen.getByLabelText(/Medication name/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('radiogroup', { name: /Common schedules/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Add medication' })).toBeInTheDocument();
  });

  it('blocks the name step while the name is blank', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    // Still on ②: the schedule strip has not appeared.
    expect(screen.queryByRole('group', { name: /Common schedules/i })).not.toBeInTheDocument();
  });

  it('walks Back through the steps in reverse', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('radiogroup', { name: /Common schedules/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Medication name/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /Add the first medication/i })).toBeInTheDocument();
  });

  it('keeps the answers when the user steps back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user, 'Lisinopril');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/Medication name/i)).toHaveValue('Lisinopril');
  });

  it('reports every step it shows to the funnel', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);

    expect(analytics.firstRunStepViewed.mock.calls.map((c) => c[1])).toEqual([
      'choose',
      'what',
      'when',
      'repeat',
    ]);
  });
});

// ── Modal footer convention (M4) ────────────────────────────────────────────

describe('modal footer convention', () => {
  it('labels the dialog via a hidden title, so the visible heading is the per-step one', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();

    // The dialog is still labelled (aria-labelledby resolves) even though the
    // modal-level title text is not the thing sighted users see — Modal's own
    // `hideTitle` keeps the h2 in the tree as sr-only.
    expect(screen.getByRole('dialog', { name: 'Circle created' })).toBeInTheDocument();
    expect(screen.getByText('Circle created')).toHaveClass('sr-only');

    // Advancing to a step with its own StepHeading — that h3 is the ONE
    // visible heading; the sr-only title above is not a second one.
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    expect(
      screen.getByRole('heading', { name: /What does Rosa take\?/i })
    ).toBeInTheDocument();
  });

  // DOCUMENTED EXCEPTION to "every footer keeps one filled primary": the
  // choose step's one filled primary ("Add the first medication") is in the
  // BODY, above the three quieter rows — each selects AND advances in one tap,
  // so a footer "Continue" would silently route the user to whichever action
  // it happened to call and double-fire that action's funnel analytics. The
  // footer here is ghost-only.
  it('has no filled button in the choose step FOOTER — only the ghost Skip', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();

    // This only inspects the FOOTER's own controls; the body's single filled
    // button has its own test under "choose step: one primary".
    const footer = screen.getByRole('button', { name: 'Skip for now' })
      .parentElement as HTMLElement;
    // Exact token match, not a substring regex: a ghost button's
    // `hover:bg-moss-soft` class would also satisfy a naive `/\bbg-moss\b/`
    // (the word boundary lands right before the trailing `-soft`), which
    // would misclassify the ghost Skip/Back buttons as filled.
    const FILLED_CLASSES = new Set(['bg-primary-fill', 'bg-terracotta-soft']);
    const isFilled = (button: HTMLElement): boolean =>
      button.className.split(/\s+/).some((cls) => FILLED_CLASSES.has(cls));
    const filledButtons = within(footer).getAllByRole('button').filter(isFilled);
    expect(filledButtons).toHaveLength(0);
    expect(within(footer).getAllByRole('button')).toHaveLength(1);

    // Prove `isFilled` actually CAN match, so the assertion above is a real
    // check and not vacuously true from a stale/renamed class. Advancing past
    // the choose step lands on a step whose footer keeps the documented "one
    // filled primary" (Continue), unlike the choose step's exception.
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    const nextFooter = screen.getByRole('button', { name: 'Back' }).parentElement as HTMLElement;
    const nextFilled = within(nextFooter).getAllByRole('button').filter(isFilled);
    expect(nextFilled).toHaveLength(1);
    expect(nextFilled[0]).toHaveTextContent('Continue');
  });
});

// ── Action dispatch ─────────────────────────────────────────────────────────

describe('choose-step actions', () => {
  it('hands appointment to the event form, pre-typed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Add an appointment/i }));

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-type', 'appointment');
    expect(analytics.firstRunActionSelected).toHaveBeenCalledWith(CIRCLE_ID, 'appointment');
  });

  it('hands invite to the invite modal', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Invite someone to help/i }));

    expect(screen.getByTestId('invite-modal')).toBeInTheDocument();
    expect(analytics.firstRunActionSelected).toHaveBeenCalledWith(CIRCLE_ID, 'invite');
  });

  it('returns to the chooser when the appointment form is cancelled unsaved', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Add an appointment/i }));
    await user.click(screen.getByRole('button', { name: 'stub-cancel' }));

    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('first-run-more-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the wizard once the appointment form has saved', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Add an appointment/i }));
    await user.click(screen.getByRole('button', { name: 'stub-save' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns to the chooser when the invite modal is dismissed without sending', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Invite someone to help/i }));
    await user.click(screen.getByRole('button', { name: 'stub-cancel' }));

    expect(screen.queryByTestId('invite-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('first-run-more-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the wizard once an invite has been sent', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Invite someone to help/i }));
    await user.click(screen.getByRole('button', { name: 'stub-save' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates to emergency info, which is a page rather than a modal', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Add emergency info/i }));

    expect(navigate).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/emergency`);
    expect(onClose).toHaveBeenCalled();
  });

  it('starts the medication funnel exactly once', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));

    // Re-arming would inflate the DENOMINATOR and push the completion rate down
    // — the same metric broken in the other direction.
    expect(analytics.medicationCreationStarted).toHaveBeenCalledTimes(1);
    expect(analytics.medicationCreationStarted).toHaveBeenCalledWith(CIRCLE_ID, 'wizard');
  });
});

// ── Skip and close ──────────────────────────────────────────────────────────

describe('skip and close', () => {
  it('closes on "Skip for now" and records it as the skip button', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(onClose).toHaveBeenCalled();
    expect(analytics.firstRunSkipped).toHaveBeenCalledWith(CIRCLE_ID, 'skip_button');
    // `skip` is NOT an action-selected value — it maps to its own event.
    expect(analytics.firstRunActionSelected).not.toHaveBeenCalled();
  });

  // OFFLINE = READ-ONLY (owner decision 2026-10-14): every step ① choice is a
  // write and is blocked offline (ChooseActionStep.offline.test.tsx), but Skip
  // only closes the wizard — it stays live and explains nothing.
  it('"Skip for now" still closes offline, with no offline explanation', async () => {
    const explained = vi.fn();
    __resetOfflineWriteForTests();
    setOfflineWriteExplainer(explained);
    try {
      const { onClose } = renderWizard();
      act(() => onlineManager.setOnline(false));
      expect(screen.getByTestId('first-run-primary')).toHaveAttribute('aria-disabled', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

      expect(onClose).toHaveBeenCalled();
      expect(analytics.firstRunSkipped).toHaveBeenCalledWith(CIRCLE_ID, 'skip_button');
      expect(explained).not.toHaveBeenCalled();
    } finally {
      setOfflineWriteExplainer(null);
      act(() => onlineManager.setOnline(true));
    }
  });

  it('closes straight away from step ①, where nothing has been answered', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await user.click(screen.getByRole('button', { name: 'Close setup' }));

    expect(onClose).toHaveBeenCalled();
    expect(analytics.firstRunSkipped).toHaveBeenCalledWith(CIRCLE_ID, 'close');
    expect(screen.queryByText('Discard this medication?')).not.toBeInTheDocument();
  });

  it('closes straight away from step ② while the name is still blank', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.click(screen.getByRole('button', { name: 'Close setup' }));

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText('Discard this medication?')).not.toBeInTheDocument();
  });

  it('asks before discarding answers the user has actually given', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Close setup' }));

    expect(screen.getByText('Discard this medication?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the wizard open when the discard prompt is cancelled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Close setup' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Medication name/i)).toHaveValue('Metformin');
  });

  // M1 regression: the wizard's Modal is mounted UNCONTROLLED (no `open`
  // prop — FirstRunWizardModal.tsx's own render). Escape routes through
  // Modal's `requestClose`, which must call `onClose` (here, `handleClose`)
  // and nothing else. `handleClose` declines to close — it shows the discard
  // ConfirmDialog instead — so the Modal shell must not race ahead and retire
  // itself on a timer regardless: doing so previously unmounted the whole
  // wizard body out from under "Keep editing", leaving the caregiver with a
  // confirm dialog and nothing behind it to return to.
  it('keeps the wizard mounted after Escape → discard prompt → "Cancel" (keep editing), even once the old fallback timer would have fired', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();

    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.getByText('Discard this medication?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Longer than Modal's EXIT_FALLBACK_MS (200ms) — a stray fallback timer
    // armed by the Escape gesture must not retire the shell late. `Date` is
    // the only faked timer in this file (see the module doc comment), so
    // `setTimeout` is real here — actually wait for it rather than trying to
    // advance a mock that isn't in effect.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Medication name/i)).toHaveValue('Metformin');
  });
});

// ── Saving ──────────────────────────────────────────────────────────────────

describe('saving', () => {
  it('creates one medication for a single-time preset', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onClose } = renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    // The save lands on the invite offer, in the same dialog; it does not close.
    expect(await screen.findByRole('heading', { name: PAYOFF_8AM })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mutateCreate).toHaveBeenCalledTimes(1);
    const payload = mutateCreate.mock.calls[0][0] as CreateEventRequest;
    expect(payload.medication_name).toBe('Metformin');
    expect(payload.recurrence_rule).toBe('daily');
  });

  it('creates SIBLING rows for a twice-daily preset, all on one bottle', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Twice daily/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    const [primary, sibling] = mutateCreate.mock.calls.map((c) => c[0] as CreateEventRequest);
    expect(primary.refill_group_id).toBeUndefined();
    // The sibling points at the primary's id, so both dose times decrement ONE
    // counter — otherwise a 60-tablet bottle becomes two 60-tablet counters.
    expect(sibling.refill_group_id).toBe('evt-primary');
    expect(sibling.track_refills).toBe(false);
    expect(sibling.scheduled_time).not.toBe(primary.scheduled_time);
  });

  it('reports the dose count the caregiver asked for', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Three times daily/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await waitFor(() => expect(analytics.firstRunMedicationSaved).toHaveBeenCalled());
    expect(analytics.firstRunMedicationSaved).toHaveBeenCalledWith({
      circleId: CIRCLE_ID,
      preset: 'threeTimesDaily',
      recurrence: 'daily',
      dosageFilled: false,
      doseCount: 3,
    });
  });

  it('sends no medication name or dosage to analytics', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: '+ Add dosage' }));
    await user.type(screen.getByLabelText(/Dosage/i), '500mg');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await waitFor(() => expect(analytics.firstRunMedicationSaved).toHaveBeenCalled());
    const everyProperty = JSON.stringify([
      analytics.firstRunMedicationSaved.mock.calls,
      analytics.medicationCreated.mock.calls,
      analytics.entrySaveTapped.mock.calls,
      analytics.entryFieldEntered.mock.calls,
    ]);
    expect(everyProperty).not.toContain('Metformin');
    expect(everyProperty).not.toContain('500mg');
    // The presence FLAG is what carries the dosage question, not the value.
    expect(analytics.firstRunMedicationSaved.mock.calls[0][0].dosageFilled).toBe(true);
  });

  it('stays on the wizard with the answers intact when the create fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mutateCreate.mockRejectedValueOnce(new Error('offline'));
    const { onClose } = renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await waitFor(() =>
      expect(analytics.entrySaveFailed).toHaveBeenCalledWith(
        CIRCLE_ID,
        'medication',
        'create_failed'
      )
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add medication' })).toBeEnabled();
  });

  it('counts every save attempt, including the ones a gate turns back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await waitFor(() =>
      expect(analytics.entrySaveTapped).toHaveBeenCalledWith(CIRCLE_ID, 'medication', 'wizard')
    );
  });
});

// ── Constraint 4: the full-form gate ───────────────────────────────────────

describe('constraint 4 — multi-dose on a non-daily rule', () => {
  async function chooseTwiceDailyWeekly(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: '+ Add dosage' }));
    await user.type(screen.getByLabelText(/Dosage/i), '500mg');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Twice daily/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: 'Weekly' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
  }

  it('hands off to the full form instead of guessing, creating nothing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await chooseTwiceDailyWeekly(user);

    expect(screen.getByTestId('add-event-modal')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it('carries every answer into the full form', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await chooseTwiceDailyWeekly(user);

    const form = screen.getByTestId('add-event-modal');
    expect(form).toHaveAttribute('data-type', 'medication');
    expect(form).toHaveAttribute('data-title', 'Metformin');
    expect(form).toHaveAttribute('data-dosage', '500mg');
    expect(form).toHaveAttribute('data-time', '08:00');
    expect(form).toHaveAttribute('data-recurrence', 'weekly');
  });

  it('attributes the hand-off as its own kind of start', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await chooseTwiceDailyWeekly(user);

    // 'wizard_handoff', never 'form': one attempt produces two starts, and the
    // wizard segment can never reach `medication_created` from here.
    expect(analytics.medicationCreationStarted).toHaveBeenCalledWith(CIRCLE_ID, 'wizard_handoff');
  });

  it('does NOT gate a multi-dose preset on the daily rule', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Twice daily/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it('reaches the full form from the escape-hatch link too', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Aspirin');
    await user.click(screen.getByRole('button', { name: 'Add full details instead' }));

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-title', 'Aspirin');
  });
});

// ── Constraint 8: the timezone gate ────────────────────────────────────────

describe('constraint 8 — an unresolved circle timezone refuses the save', () => {
  it('creates nothing and says so, rather than falling back to the device zone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useCircleResult.circle = undefined;
    const { onClose } = renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    expect(mutateCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('time zone'), 'error');
  });

  it('records its own reason, not a generic failure', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useCircleResult.circle = undefined;
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    expect(analytics.entrySaveFailed).toHaveBeenCalledWith(
      CIRCLE_ID,
      'medication',
      'timezone_unresolved'
    );
  });

  /**
   * The SAME unresolved circle, on the hand-off paths rather than the save.
   *
   * `AddEventModal` returns null while `canEdit` is false — and `canEdit` is
   * `circle?.can_edit ?? false`, so it is false for the entire time the circle
   * detail query is in flight, which is when this wizard mounts. Returning it
   * as the wizard's whole render therefore left the page with NO dialog at
   * all: no ×, no Escape target, and no route back if that query never
   * resolves. Screen ① is where it bites, because "Add an appointment" is
   * offered before anything has had time to load.
   *
   * Asserting the WIZARD is still on screen, not that the stub is absent: the
   * stub here always renders, so only the wizard's own presence distinguishes
   * "handed off" from "blanked".
   */
  it('keeps the wizard on screen when appointment is picked before the circle lands', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useCircleResult.circle = undefined;
    renderWizard();

    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Add an appointment/i }));

    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add the first medication/i })).toBeInTheDocument();
  });

  it('keeps the wizard on screen when full details is picked before the circle lands', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useCircleResult.circle = undefined;
    renderWizard();

    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Aspirin');
    await user.click(screen.getByRole('button', { name: 'Add full details instead' }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Medication name/i)).toHaveValue('Aspirin');
  });

  /**
   * THE CIRCLE RESOLVED, AND STILL CANNOT BE WRITTEN TO.
   *
   * The guard above reads `circle`, but the thing `AddEventModal` refuses on is
   * `canEdit` — and the two are not the same predicate. `canEdit` is
   * `circle?.can_edit ?? false`: false while the query is in flight (which
   * `circle` does cover) AND false on a resolved circle the requester cannot
   * write to. `getCircleAccessLevel` fails CLOSED — a membership lookup error,
   * a missing admin client, or its catch all return `canEdit: false` — and the
   * membership row is written in a separate statement from `POST /circles`, so
   * a detail fetch that races it comes back "not a member".
   *
   * On that path the guard passes, `AddEventModal` returns null, and the
   * wizard's entire render is null: no dialog, no ×, no Escape target, no route
   * back. Reload only.
   */
  it('keeps the wizard on screen when the circle resolves without edit access', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useCircleResult.canEdit = false;
    renderWizard();

    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Add an appointment/i }));

    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add the first medication/i })).toBeInTheDocument();
  });

  /**
   * THE LATCH. A hand-off that falls through is not cancelled, it is DEFERRED —
   * `handoff` stays set, and the branch fires on whatever render happens next.
   *
   * That render is usually caused by the user, doing something else: they click
   * "Add an appointment", see nothing happen, and go start a medication
   * instead. The moment the circle lands, the stale appointment hand-off wins
   * the return and replaces the wizard — taking the half-entered medication
   * with it. Every answer typed since the ignored click is gone.
   */
  it('does not fire a fallen-through hand-off after the user picks something else', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useCircleResult.circle = undefined;
    useCircleResult.canEdit = false;
    renderWizard();

    // Ignored: nothing is writable yet, so this falls through to the wizard.
    await openMore(user);
    await user.click(screen.getByRole('button', { name: /^Add an appointment/i }));

    // The user moves on. The circle lands while they are answering.
    useCircleResult.circle = {
      id: CIRCLE_ID,
      name: 'Rosa',
      recipient_name: 'Rosa',
      is_self_care: false,
      care_recipient_timezone: RECIPIENT_TZ,
    };
    useCircleResult.canEdit = true;
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));

    // Still the wizard, on the step the user actually asked for.
    expect(screen.getByLabelText(/Medication name/i)).toBeInTheDocument();
    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
  });

  it('leaves the save button live so a resolved zone can retry', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    useCircleResult.circle = undefined;
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    expect(screen.getByRole('button', { name: 'Add medication' })).toBeEnabled();
  });
});

// ── Constraint 7: the past-time guard ──────────────────────────────────────

describe('constraint 7 — the 08:00 default saved in the evening', () => {
  it('warns before saving a dose that has already passed today', async () => {
    vi.setSystemTime(EVENING);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    expect(screen.getByText('Starts with the next dose')).toBeInTheDocument();
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it('saves once the notice is confirmed', async () => {
    vi.setSystemTime(EVENING);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  });

  it('records the cancel and creates nothing', async () => {
    vi.setSystemTime(EVENING);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mutateCreate).not.toHaveBeenCalled();
    expect(analytics.entrySaveFailed).toHaveBeenCalledWith(
      CIRCLE_ID,
      'medication',
      'past_time_cancelled'
    );
  });

  it('re-arms the save after a cancel, rather than dead-ending', async () => {
    vi.setSystemTime(EVENING);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    expect(screen.getByText('Starts with the next dose')).toBeInTheDocument();
  });

  it('does not warn in the morning, when the dose is still ahead', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    await walkToRepeat(user);
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Starts with the next dose')).not.toBeInTheDocument();
  });
});

describe('RxNorm lookup on step ② (mobile parity)', () => {
  it('carries a picked drug\'s rxcui into the saved medication', async () => {
    const { searchDrugs } = await import('@/api/drugs');
    vi.mocked(searchDrugs).mockResolvedValue([
      { rxcui: '6809', name: 'Metformin', strength: null, dosageForm: null },
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();

    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByRole('combobox', { name: /Medication name/i }), 'metf');
    await user.click(await screen.findByRole('option', { name: 'Metformin' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Add medication' }));

    await screen.findByRole('heading', { name: PAYOFF_8AM });
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ medication_name: 'Metformin', rxcui: '6809' });
  });
});

// A SELF-CARE owner IS the care recipient: never ask them "What does <their own
// name> take?". Everyone else keeps the name. Mobile twin: firstRunWizardFlow
// "recipient wording".
describe('recipient wording', () => {
  async function walk(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Add the first medication/i }));
    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
  }

  it('self-care owner reads you-copy on all three steps', async () => {
    useCircleResult.circle = { ...useCircleResult.circle, is_self_care: true };
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    expect(screen.getByText('Your circle is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add your first medication/i })).toBeInTheDocument();
    expect(screen.queryByText(/Rosa's circle/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add your first medication/i }));
    expect(screen.getByText('What do you take?')).toBeInTheDocument();
    expect(screen.queryByText(/What does Rosa take/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Medication name/i), 'Metformin');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('When do you take it?')).toBeInTheDocument();
    expect(screen.queryByText(/When does Rosa take it/)).not.toBeInTheDocument();
  });

  it('caregiver owner of someone else keeps the name on all three steps', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWizard();
    expect(screen.getByText("Rosa's circle is ready.")).toBeInTheDocument();
    await walk(user);
    expect(screen.getByText('When does Rosa take it?')).toBeInTheDocument();
    expect(screen.queryByText('When do you take it?')).not.toBeInTheDocument();
  });

  it('is Spanish (tú) for a self-care owner', async () => {
    const i18n = (await import('@/i18n')).default;
    await i18n.changeLanguage('es');
    try {
      useCircleResult.circle = { ...useCircleResult.circle, is_self_care: true };
      renderWizard();
      expect(screen.getByText('Tu círculo está listo.')).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
