import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Sheet, Text } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import type { CircleMember } from '@/api/circleMembers';

// The one-time shifts nudge (docs/plans/simple-ui-1-3-1.md "Coaching (d)";
// hi-fi CoachShifts): when a circle gets its 2nd caregiver, Today offers shifts
// once. Never a modal, never stacked with another coaching element.

/** A join older than this is history, not news. */
export const SHIFTS_NUDGE_WINDOW_DAYS = 14;

/**
 * Mobile's rule (utils/coaching + CircleDetailScreen): the NEWEST caregiver (care
 * recipient excluded), whoever they are, when the circle has at least 2 caregivers and
 * that join is under 14 days old (and not in the future). The card says "{{member}}
 * joined", so when the newest joiner IS the viewer there is no card (we do not fall
 * back to an older joiner). Pure, for tests.
 */
export function pickShiftsNudgeMember(
  members: readonly CircleMember[],
  viewerId: string | undefined,
  now: number = Date.now()
): CircleMember | null {
  const caregivers = members.filter((m) => !m.is_care_recipient);
  if (caregivers.length < 2) return null;
  const newest = [...caregivers].sort((a, b) =>
    (b.joined_at ?? '').localeCompare(a.joined_at ?? '')
  )[0];
  if (!newest || newest.id === viewerId) return null;
  const joined = Date.parse(newest.joined_at);
  if (!Number.isFinite(joined)) return null;
  const age = now - joined;
  return age >= 0 && age < SHIFTS_NUDGE_WINDOW_DAYS * 24 * 60 * 60 * 1000 ? newest : null;
}

export interface ShiftsNudgeCardProps {
  member: CircleMember;
  recipientName: string;
  isSelfCare: boolean;
  /** Free-circle OWNER variant: "Set up shifts" opens the shifts teaser (-> paywall). Analytics only. */
  upsell?: boolean;
  onSetUp: () => void;
  onNotNow: () => void;
}

export function ShiftsNudgeCard({
  member,
  recipientName,
  isSelfCare,
  upsell = false,
  onSetUp,
  onNotNow,
}: ShiftsNudgeCardProps): ReactElement {
  const { t } = useTranslation('overview');
  const name = member.first_name || member.email;

  useEffect(() => {
    Analytics.coachingHintShown('shifts_second_caregiver', { upsell });
    // Once per appearance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet
      role="region"
      aria-labelledby="shifts-nudge-title"
      padding="lg"
      className="rounded-2xl"
      data-testid="shifts-nudge-card"
    >
      <div className="mb-3 flex items-center gap-3">
        <Avatar size="sm" name={name} photoUrl={null} colorKey={member.avatar_color ?? null} />
        <p className="m-0 text-md text-ink-2">
          {isSelfCare || !recipientName
            ? t('today.shiftsNudge.joinedSelf', { member: name })
            : t('today.shiftsNudge.joined', { member: name, name: recipientName })}
        </p>
      </div>
      <Text variant="h2" as="h2" id="shifts-nudge-title">
        {t('today.shiftsNudge.title')}
      </Text>
      <Text variant="body" className="mt-1.5 max-w-xl text-ink-2">
        {t('today.shiftsNudge.body')}
      </Text>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            Analytics.coachingHintActed('shifts_second_caregiver', { upsell });
            onSetUp();
          }}
        >
          {t('today.shiftsNudge.cta')}
        </Button>
        <button
          type="button"
          onClick={() => {
            Analytics.coachingHintDismissed('shifts_second_caregiver', { upsell });
            onNotNow();
          }}
          className="inline-flex min-h-11 items-center px-3 text-md font-semibold text-moss-deep"
        >
          {t('today.notNow')}
        </button>
      </div>
    </Sheet>
  );
}

export default ShiftsNudgeCard;
