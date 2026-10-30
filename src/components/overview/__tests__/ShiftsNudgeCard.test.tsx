import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { ShiftsNudgeCard, pickShiftsNudgeMember, SHIFTS_NUDGE_WINDOW_DAYS } from '../ShiftsNudgeCard';
import { Analytics } from '@/lib/analytics';
import type { CircleMember } from '@/api/circleMembers';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const DAY = 86_400_000;
const member = (id: string, joinedDaysAgo: number, over: Partial<CircleMember> = {}): CircleMember =>
  ({
    id,
    email: `${id}@example.com`,
    first_name: id.toUpperCase(),
    last_name: null,
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: new Date(NOW - joinedDaysAgo * DAY).toISOString(),
    timezone: null,
    ...over,
  }) as CircleMember;

describe('pickShiftsNudgeMember', () => {
  it('names the most recent joiner other than the viewer, when there are 2+ caregivers', () => {
    const picked = pickShiftsNudgeMember([member('me', 90), member('ana', 1)], 'me', NOW);
    expect(picked?.id).toBe('ana');
  });

  it('a lone caregiver gets no nudge', () => {
    expect(pickShiftsNudgeMember([member('me', 90)], 'me', NOW)).toBeNull();
  });

  it('the care recipient does not count as a caregiver', () => {
    expect(
      pickShiftsNudgeMember([member('me', 90), member('mom', 1, { is_care_recipient: true })], 'me', NOW)
    ).toBeNull();
  });

  it('the viewer is never the one named', () => {
    expect(pickShiftsNudgeMember([member('me', 1), member('old', 90)], 'me', NOW)).toBeNull();
  });

  it('the NEWEST caregiver decides (mobile rule): when that is the viewer, an older recent joiner is not named', () => {
    // viewer joined 1 day ago, 'ana' 5 days ago (also inside the window): still no card.
    expect(
      pickShiftsNudgeMember([member('boss', 90), member('ana', 5), member('me', 1)], 'me', NOW)
    ).toBeNull();
  });

  it('a join dated in the future is not news', () => {
    expect(
      pickShiftsNudgeMember([member('me', 90), member('ana', -1)], 'me', NOW)
    ).toBeNull();
  });

  it('only a recent join is news', () => {
    expect(
      pickShiftsNudgeMember([member('me', 90), member('ana', SHIFTS_NUDGE_WINDOW_DAYS - 1)], 'me', NOW)?.id
    ).toBe('ana');
    expect(
      pickShiftsNudgeMember([member('me', 90), member('ana', SHIFTS_NUDGE_WINDOW_DAYS + 1)], 'me', NOW)
    ).toBeNull();
  });

  it('an unparsable joined_at is ignored, not crashed on', () => {
    expect(pickShiftsNudgeMember([member('me', 90), member('ana', 1, { joined_at: 'nope' })], 'me', NOW)).toBeNull();
  });
});

describe('ShiftsNudgeCard (hi-fi CoachShifts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Analytics, 'coachingHintShown').mockImplementation(() => {});
    vi.spyOn(Analytics, 'coachingHintActed').mockImplementation(() => {});
    vi.spyOn(Analytics, 'coachingHintDismissed').mockImplementation(() => {});
  });

  function renderCard() {
    const onSetUp = vi.fn();
    const onNotNow = vi.fn();
    render(
      <ShiftsNudgeCard member={member('ana', 1, { first_name: 'Ana' })} recipientName="Mom" isSelfCare={false} onSetUp={onSetUp} onNotNow={onNotNow} />
    );
    return { onSetUp, onNotNow };
  }

  it('says who joined, then offers shifts', () => {
    renderCard();
    expect(screen.getByText("Ana joined Mom's circle")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Share the care with shifts' })).toBeInTheDocument();
    expect(screen.getByText('Split nights and weekends so everyone knows who is on.')).toBeInTheDocument();
  });

  it('fires coaching_hint_shown(shifts_second_caregiver) on show', () => {
    renderCard();
    expect(Analytics.coachingHintShown).toHaveBeenCalledWith('shifts_second_caregiver', { upsell: false });
  });

  it('Set up shifts = acted, not dismissed', async () => {
    const user = userEvent.setup();
    const { onSetUp } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Set up shifts' }));
    expect(Analytics.coachingHintActed).toHaveBeenCalledWith('shifts_second_caregiver', { upsell: false });
    expect(Analytics.coachingHintDismissed).not.toHaveBeenCalled();
    expect(onSetUp).toHaveBeenCalled();
  });

  it('Not now = dismissed, not acted', async () => {
    const user = userEvent.setup();
    const { onNotNow, onSetUp } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(Analytics.coachingHintDismissed).toHaveBeenCalledWith('shifts_second_caregiver', { upsell: false });
    expect(Analytics.coachingHintActed).not.toHaveBeenCalled();
    expect(onNotNow).toHaveBeenCalled();
    expect(onSetUp).not.toHaveBeenCalled();
  });

  it('upsell variant tags all three events with upsell: true', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ShiftsNudgeCard member={member('ana', 1)} recipientName="Mom" isSelfCare={false} upsell onSetUp={vi.fn()} onNotNow={vi.fn()} />
    );
    expect(Analytics.coachingHintShown).toHaveBeenCalledWith('shifts_second_caregiver', { upsell: true });
    await user.click(screen.getByRole('button', { name: 'Set up shifts' }));
    expect(Analytics.coachingHintActed).toHaveBeenCalledWith('shifts_second_caregiver', { upsell: true });
    unmount();
    render(
      <ShiftsNudgeCard member={member('ana', 1)} recipientName="Mom" isSelfCare={false} upsell onSetUp={vi.fn()} onNotNow={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(Analytics.coachingHintDismissed).toHaveBeenCalledWith('shifts_second_caregiver', { upsell: true });
  });

  it('is a region, not a dialog', () => {
    renderCard();
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
