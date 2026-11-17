import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Card, Eyebrow, Icon, Text, type IconName } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';

export interface EmptyCirclesProps {
  /** "Start a care circle": the moss primary. */
  action?: ReactNode;
  /** "I have an invite code": the outline button next to it. */
  joinAction?: ReactNode;
  /** The eyebrow over the title ("Good morning, Maria"). Omitted = no eyebrow. */
  greeting?: string;
  /** The signed-in person's first name, for the first avatar on the Example card. */
  firstName?: string;
}

interface ExampleRow {
  icon: IconName;
  /** Section colours (owner: colour gives the app life): clay = medication /
   *  emergency, moss = reminders, dusk = calendar. */
  tile: string;
  title: string;
  subtitle: string;
  done?: boolean;
}

/**
 * Circles first-time empty state, 1.4.3 "A2-complete" (docs/mocks-143/empty-state,
 * A2-complete-web.png). Mobile twin: CircleListScreen's empty branch.
 *
 * Words and buttons on the left, an "Example" card on the right; under ~900px the
 * columns stack into the phone layout. Every example row is a product fact:
 * reminders go to ONE person per circle chosen by the owner, so the row says
 * "You choose who gets reminders", never "go to you and Ana". The emergency row
 * drops mobile's "even offline": the web app has no offline emergency copy.
 * The quiet footer keeps today's web extras: invitations link, Learn more, and
 * the companion-app badges.
 */
export function EmptyCircles({ action, joinAction, greeting, firstName }: EmptyCirclesProps): ReactElement {
  const { t } = useTranslation('members');
  const rows: ExampleRow[] = [
    {
      icon: 'medical',
      tile: 'bg-clay-soft text-clay',
      title: t('picker.empty.exampleDose'),
      subtitle: t('picker.empty.exampleDoseSub'),
      done: true,
    },
    {
      icon: 'notifications',
      tile: 'bg-moss-soft text-moss',
      title: t('picker.empty.exampleReminders'),
      subtitle: t('picker.empty.exampleRemindersSub'),
    },
    {
      icon: 'calendar',
      tile: 'bg-dusk-soft text-dusk',
      title: t('picker.empty.exampleAppointment'),
      subtitle: t('picker.empty.exampleAppointmentSub'),
    },
    {
      icon: 'shield-checkmark',
      tile: 'bg-clay-soft text-clay',
      title: t('picker.empty.exampleEmergency'),
      subtitle: t('picker.empty.exampleEmergencySub'),
    },
  ];
  const exampleLabel = t('picker.empty.example');

  return (
    <div className="mx-auto w-full pt-4 md:pt-10" data-testid="empty-circles">
      <div className="flex flex-col gap-10 min-[900px]:flex-row min-[900px]:items-center min-[900px]:gap-16">
        {/* Words and the two doors */}
        <div className="min-w-0 flex-1">
          {greeting ? <Eyebrow as="p">{greeting}</Eyebrow> : null}
          <Text variant="pageTitle" as="h1" className="mt-3 max-w-[460px]">
            {t('picker.empty.a2Title')}
          </Text>
          <Text variant="body" as="p" className="mt-4 max-w-[470px] text-ink-2!">
            {t('picker.empty.a2Subtitle')}
          </Text>
          {action || joinAction ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {action}
              {joinAction}
            </div>
          ) : null}
          <p className="m-0 mt-5 text-sm leading-normal text-ink-2">{t('picker.empty.freeNote')}</p>
          <p className="m-0 mt-1.5 flex items-center gap-1 text-sm leading-normal text-ink-3">
            <Icon name="lock-closed" size="meta" />
            {t('picker.empty.secure')}
          </p>
        </div>

        {/* The Example card: a figure whose accessible name starts with
            "Example", so it is never read as the person's own data. */}
        <Card
          as="figure"
          variant="elevated"
          padding="none"
          className="m-0 w-full flex-none overflow-hidden border border-line min-[900px]:w-[480px]"
          aria-label={`${exampleLabel}: ${t('picker.empty.exampleTitle')}`}
          data-testid="empty-example-card"
        >
          <figcaption className="flex items-center gap-3 px-4 pb-3 pt-4">
            <span className="min-w-0 flex-1">
              <Eyebrow className="block">{exampleLabel}</Eyebrow>
              <span className="block text-base font-semibold leading-[26px] text-ink">
                {t('picker.empty.exampleTitle')}
              </span>
            </span>
            <span aria-hidden="true" className="flex">
              {firstName ? <Avatar name={firstName} size="xs" className="h-8 w-8" /> : null}
              <Avatar name="Ana" size="xs" className={firstName ? '-ml-1 h-8 w-8' : 'h-8 w-8'} />
            </span>
          </figcaption>
          <ul className="m-0 list-none border-t border-line-2 p-0">
            {rows.map((row, i) => (
              <li
                key={row.icon}
                className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-line-2' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${row.tile}`}
                >
                  <Icon name={row.icon} size="row" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-md font-semibold leading-[22px] text-ink">{row.title}</span>
                  <span className="block text-sm leading-5 text-ink-2">{row.subtitle}</span>
                </span>
                {row.done ? (
                  <Icon name="checkmark-circle" size="row" className="flex-none text-moss" />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Kept from the old page, on one quiet line: invitations, Learn more, the apps. */}
      <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-line-2 pt-6 text-sm leading-normal text-ink-3 md:mt-16">
        <p className="m-0">
          {t('picker.empty.invitedHintPrefix')}{' '}
          <Link to="/invites" className="font-semibold text-primary-outline underline-offset-4 hover:underline">
            {t('picker.empty.invitedHintLink')}
          </Link>
          <span aria-hidden="true" className="mx-2.5 text-line-strong">
            |
          </span>
          <Link to="/help" className="font-semibold text-primary-outline underline-offset-4 hover:underline">
            {t('picker.empty.learnMore')}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span>{t('picker.empty.companion')}</span>
          <StoreBadges layout="row" />
        </div>
      </div>
    </div>
  );
}
