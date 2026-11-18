import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Eyebrow, Icon, TEXT_CLASS, Text, TextField } from '@/components/ui';
import { prefersReducedMotion } from '@/components/ui/motion';
import type { FirstRunSavedItem } from '@/components/calendar/AddEventModal';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { formatEventTimeForDisplay, getDateInTimezone } from '@/utils/timezone';
import { addDays } from '@/components/calendar/dateMath';
import { startsWhen } from '@/utils/firstMedSaved';
import type { HourCycle } from '@/utils/hourCycle';
import { CircleEmblem } from './CircleEmblem';
import { FlowProgress, WEB_FIRST_RUN_STEPS } from './FlowProgress';

/**
 * First run v2, screen 7 "All set" (docs/mocks-144/first-run-v2/11-all-set.png), WEB variant.
 *
 * The closed circle, ALL SET, the title (per type), then three rows: the circle, the first item, and
 * reminders. WEB HAS NO PUSH, so the third row does not claim reminders are on: it says they arrive
 * on the phone, in the CircleCare app, with an info icon instead of a done-check. Then the invite in a
 * filled Card under an "Optional" eyebrow. The two buttons live in the host's footer.
 *
 * M5: the rows rise in, 120ms apart; nothing pulses afterwards. Reduced motion: all in place at once.
 * The seat fills (and row 1's detail says "Invite link shared. Waiting for them to join.") once a
 * link was shared or copied, never "joined".
 */
export interface AllSetStepProps {
  recipientName: string;
  isSelfCare: boolean;
  ownerFirstName?: string;
  item: FirstRunSavedItem;
  hourCycle: HourCycle;
  seatFilled: boolean;
  /** The invite link once created, shown so it can be copied by hand when the clipboard is refused. */
  inviteUrl: string | null;
  headingRef?: RefObject<HTMLHeadingElement>;
}

export function AllSetStep({
  recipientName,
  isSelfCare,
  ownerFirstName,
  item,
  hourCycle,
  seatFilled,
  inviteUrl,
  headingRef: headingRefProp,
}: AllSetStepProps): ReactElement {
  const { t, i18n } = useTranslation(['circles', 'calendar', 'common']);
  const ownRef = useRef<HTMLHeadingElement>(null);
  const headingRef = headingRefProp ?? ownRef;
  const [still] = useState(prefersReducedMotion);
  useEffect(() => {
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  const med = item.type === 'medication' ? item.medication : undefined;
  const times =
    med?.doses.map((dose) =>
      formatEventTimeForDisplay(dose.scheduledTime, med.timezone, undefined, dose.scheduledDate, hourCycle)
    ) ??
    (item.recipientTime && item.scheduledDate
      ? [
          formatEventTimeForDisplay(
            item.recipientTime,
            item.timezone,
            undefined,
            item.scheduledDate,
            hourCycle
          ),
        ]
      : []);
  const time = times[0] ?? null;

  let title: string;
  if (item.type === 'appointment') {
    title = isSelfCare ? t('firstRun.allSet.titleApptSelf') : t('firstRun.allSet.titleAppt', { name: recipientName });
  } else if (item.type === 'task') {
    title = isSelfCare ? t('firstRun.allSet.titleTaskSelf') : t('firstRun.allSet.titleTask', { name: recipientName });
  } else if (times.length > 1) {
    title = isSelfCare ? t('firstRun.payoff.titleMultiSelf') : t('firstRun.payoff.titleMulti', { name: recipientName });
  } else {
    title = isSelfCare
      ? t('firstRun.payoff.titleSelf', { time: time ?? '' })
      : t('firstRun.payoff.title', { name: recipientName, time: time ?? '' });
  }

  // Row 2's detail, in the words the shipped payoff used.
  let itemDetail: string;
  if (med) {
    const weekdays = formatWeekdayList(med.recurrenceDays, i18n.language);
    const recurrence =
      med.recurrenceRule === 'weekly'
        ? weekdays
          ? t('calendar:recurrence.weeklyOn', { days: weekdays })
          : t('calendar:recurrence.weekly')
        : med.recurrenceRule === 'every_other_day'
          ? t('calendar:recurrence.everyOtherDay')
          : t('firstRun.payoff.everyDay');
    const when = startsWhen(med);
    const starts =
      when === 'today'
        ? t('firstRun.payoff.startsToday')
        : when === 'tomorrow'
          ? t('firstRun.payoff.startsTomorrow')
          : t('firstRun.payoff.startsOn', {
              date: formatDateForDisplay(
                med.startDate ?? med.doses[0].scheduledDate,
                { weekday: 'short', month: 'short', day: 'numeric' },
                i18n.language
              ),
            });
    itemDetail = [med.dosage.trim(), recurrence, starts].filter(Boolean).join(' · ');
  } else {
    const typeLabel =
      item.type === 'appointment' ? t('calendar:eventTypes.appointment') : t('calendar:eventTypes.task');
    const today = getDateInTimezone(item.timezone);
    const day = !item.scheduledDate
      ? null
      : item.scheduledDate === today
        ? t('common:today')
        : item.scheduledDate === addDays(today, 1)
          ? t('calendar:tomorrow')
          : formatDateForDisplay(item.scheduledDate, { weekday: 'short', month: 'short', day: 'numeric' }, i18n.language);
    itemDetail = [typeLabel, day].filter(Boolean).join(' · ');
  }

  const rows = [
    {
      id: 'circle',
      done: true,
      title: isSelfCare ? t('firstRun.allSet.circleSelf') : t('firstRun.allSet.circle', { name: recipientName }),
      detail: seatFilled ? t('firstRun.allSet.seatWaiting') : t('firstRun.allSet.circleSub'),
    },
    {
      id: 'item',
      done: true,
      title: time ? `${item.title} · ${times.join(', ')}` : item.title,
      detail: itemDetail,
    },
    {
      id: 'reminders',
      done: false,
      title: t('firstRun.allSet.remindersWebTitle'),
      detail: time
        ? t('firstRun.allSet.remindersWebSubTime', { time })
        : t('firstRun.allSet.remindersWebSub'),
    },
  ];

  const initial = (recipientName.trim()[0] ?? '?').toLocaleUpperCase();
  const ownerInitial = ownerFirstName?.trim()[0]?.toLocaleUpperCase();

  return (
    <div className="flex flex-col gap-4" data-testid="first-run-all-set" data-first-item-type={item.type}>
      <FlowProgress current={WEB_FIRST_RUN_STEPS} />
      <div className="flex flex-col items-center gap-2 text-center">
        <CircleEmblem initial={initial} ownerInitial={ownerInitial} state="ready" size={88} seatFilled={seatFilled} />
        <Eyebrow>{t('firstRun.payoff.eyebrow')}</Eyebrow>
        <h3 ref={headingRef} tabIndex={-1} className={`${TEXT_CLASS.h2} m-0 outline-none`} data-testid="first-run-all-set-title">
          {title}
        </h3>
      </div>

      <Card variant="elevated" padding="none">
        <ul className="m-0 list-none p-0" data-testid="first-run-all-set-rows">
          {rows.map((row, i) => (
            <li
              key={row.id}
              data-testid={`first-run-all-set-row-${row.id}`}
              className={`flex items-start gap-3 px-4 py-3 ${i > 0 ? 'border-t border-line-2' : ''} ${still ? '' : 'cc-fr-rise'}`}
              style={still ? undefined : { animationDelay: `${i * 120}ms` }}
            >
              <Icon
                name={row.done ? 'checkmark-circle' : 'notifications-outline'}
                size="row"
                className={`mt-0.5 flex-none ${row.done ? 'text-moss' : 'text-ink-3'} ${still || !row.done ? '' : 'cc-fr-pop'}`}
              />
              <span className="min-w-0">
                <span className="block break-words text-md font-semibold text-ink">{row.title}</span>
                <span className="block break-words text-sm text-ink-2" aria-live={row.id === 'circle' ? 'polite' : undefined}>
                  {row.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card variant="filled" padding="md" as="section" aria-labelledby="first-run-invite-heading">
        <Eyebrow color="ink-2">{t('firstRun.allSet.optional')}</Eyebrow>
        <Text variant="h3" as="h4" id="first-run-invite-heading" className="mt-1">
          {isSelfCare
            ? t('firstRun.payoff.inviteHeadingSelf')
            : t('firstRun.payoff.inviteHeading', { name: recipientName })}
        </Text>
        <Text variant="caption" as="p" className="m-0 mt-1">
          {t('firstRun.ready.inviteHelper')} {t('firstRun.allSet.inviteFree')}
        </Text>
        {inviteUrl ? (
          <div className="mt-3">
            <TextField
              id="first-run-invite-url"
              label={t('members:invite.copyLink')}
              value={inviteUrl}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
