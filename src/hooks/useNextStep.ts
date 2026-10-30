import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays } from '@/components/calendar/dateMath';
import { isPendingInviteExpired } from '@/api/circleMembers';
import { useCircle } from '@/hooks/useCircle';
import { useEventsPresence } from '@/hooks/useCalendarEvents';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { Analytics } from '@/lib/analytics';
import { groupOn, type NotificationPrefs } from '@/lib/notificationGroups';
import { isNextStepSnoozed, snoozeNextStep, type NextStepKey } from '@/lib/todayCoaching';
import { getDateInTimezone } from '@/utils/timezone';

// The Today next-step card's state (docs/plans/simple-ui-1-3-1.md "Next-step
// card"). Steps in order, each shown only while not done:
//   1 add the first medication   2 invite someone to help   3 turn on reminders
// "Not now" hides the CURRENT step for 3 days (the card, not the next step: a
// dismissal must never be answered by a second card; same rule as mobile's
// utils/nextStep.ts). The card is gone for good once all three are done.
//
// WEB divergence (reported): mobile's "reminders" step is the push permission,
// which a browser cannot grant on the user's behalf. On web the step is the
// account's medication-reminder setting: it is open only when the viewer has
// switched that group off, and its button opens Profile.

export const NEXT_STEP_ORDER: readonly NextStepKey[] = ['first_med', 'invite', 'reminders'];

export type NextStepState =
  | { status: 'unknown' }
  | { status: 'none' }
  | { status: 'step'; step: NextStepKey; position: number; total: number; snooze: () => void };

export function useNextStep(circleId: string, timezone: string | null): NextStepState {
  const { circle, canEdit, canManageMembers, members, isLoading } = useCircle(circleId);
  const userQuery = useQuery({ queryKey: queryKeys.currentUser, queryFn: getCurrentUser });
  const prefs: NotificationPrefs | undefined = userQuery.data?.notification_preferences as
    | NotificationPrefs
    | undefined;
  const today = timezone ? getDateInTimezone(timezone) : '';
  const presence = useEventsPresence(
    circleId,
    today ? addDays(today, -30) : '',
    today ? addDays(today, 180) : ''
  );
  // Bumped by "Not now" so the snooze read is re-evaluated.
  const [, setSnoozeTick] = useState(0);

  const blocked = !canEdit || circle?.view_only === true;
  const known = !isLoading && !!circle && presence.isSuccess && !userQuery.isPending;

  const liveInvites = (circle?.pending_invites ?? []).filter((i) => !isPendingInviteExpired(i)).length;
  const done: Record<NextStepKey, boolean> = {
    first_med: presence.data?.medication === true,
    invite: members.length > 1 || liveInvites > 0,
    // Unknown prefs (still loading / failed) count as done: never nag on a guess.
    reminders: prefs === undefined ? true : groupOn(prefs, 'medications'),
  };
  // Steps THIS viewer can perform: inviting needs the invite right.
  const applicable = NEXT_STEP_ORDER.filter((s) => (s === 'invite' ? canManageMembers : true));
  const open = applicable.filter((s) => !done[s]);

  // next_step_completed: a step that was open and became done while on screen.
  const wasOpen = useRef<Partial<Record<NextStepKey, boolean>>>({});
  useEffect(() => {
    if (!known || blocked) return;
    for (const s of applicable) {
      if (wasOpen.current[s] === true && done[s]) Analytics.nextStepCompleted(s);
      wasOpen.current[s] = !done[s];
    }
  });

  const snooze = useCallback(
    (step: NextStepKey) => {
      snoozeNextStep(circleId, step);
      setSnoozeTick((n) => n + 1);
    },
    [circleId]
  );

  if (!known) return { status: 'unknown' };
  if (blocked || open.length === 0) return { status: 'none' };
  const current = open[0];
  if (isNextStepSnoozed(circleId, current)) return { status: 'none' };
  return {
    status: 'step',
    step: current,
    position: applicable.indexOf(current) + 1,
    total: applicable.length,
    snooze: () => snooze(current),
  };
}
