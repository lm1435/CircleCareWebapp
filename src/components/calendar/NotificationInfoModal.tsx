import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Modal, Text } from '@/components/ui';
import type { IconName } from '@/components/ui';

export interface NotificationInfoModalProps {
  /** Medications are the only type with a missed-dose escalation chain. */
  isMedication: boolean;
  /**
   * On a self-care circle the owner IS the care recipient, so the escalation
   * line has to say "you" rather than "the care recipient". Mobile branches the
   * same way in AddEventScreen; this is the web side of that parity.
   */
  isSelfCare: boolean;
  onClose: () => void;
}

/** One titled section of the explainer — icon, heading, body. */
function InfoSection({
  icon,
  iconClass,
  title,
  body,
}: {
  icon: IconName;
  iconClass: string;
  title: string;
  body: string;
}): ReactElement {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Icon name={icon} size="row" className={iconClass} />
        <Text variant="label" as="h3">
          {title}
        </Text>
      </div>
      <Text variant="bodyDense" className="text-ink-2">
        {body}
      </Text>
    </section>
  );
}

/**
 * "How notifications work" — the explainer behind the ⓘ next to the Reminders
 * heading. Ported from mobile's notification info bottom sheet
 * (AddEventScreen.tsx), section for section, so the two surfaces explain the
 * same mechanic.
 *
 * TWO DELIBERATE DEPARTURES FROM MOBILE:
 *
 *  1. THE SCHEDULED-REMINDERS LINE IS REWORDED. Mobile says "You'll receive a
 *     notification at the scheduled time" — a promise the web app cannot keep,
 *     since it has no push at all and `webDelivery`, a few lines above this in
 *     the same section, already points at the phone. Web states the same
 *     mechanic without addressing the reader as the recipient: the alert is
 *     SENT, to the mobile app.
 *
 *  2. THE ESCALATION BODY REUSES `reminders.escalation` / `.escalationSelf`,
 *     the same strings as the inline summary, rather than mobile's separate
 *     `notificationInfoEscalationBody` pair. Mobile's split is exactly how its
 *     copy drifted: the now-dead `addEvent.escalationInfo` still describes the
 *     chain as 15 min / 1 hr / 2 hrs, which has not matched
 *     `process_tier{1,2,3}_*` (15 min / 30 min / 1 hr) for some time. One
 *     sentence, one place to keep true.
 */
export function NotificationInfoModal({
  isMedication,
  isSelfCare,
  onClose,
}: NotificationInfoModalProps): ReactElement {
  const { t } = useTranslation(['calendar', 'common']);

  return (
    <Modal
      title={t('addEvent.reminders.howItWorks.title')}
      closeLabel={t('addEvent.reminders.howItWorks.close')}
      onClose={onClose}
      size="sm"
    >
      <div className="flex flex-col gap-5">
        <InfoSection
          icon="notifications-outline"
          iconClass="text-moss"
          title={t('addEvent.reminders.howItWorks.scheduledTitle')}
          body={t('addEvent.reminders.howItWorks.scheduledBody')}
        />
        {isMedication && (
          <InfoSection
            icon="alert-circle-outline"
            iconClass="text-terracotta-deep"
            title={t('addEvent.reminders.howItWorks.escalationTitle')}
            body={t(
              isSelfCare
                ? 'addEvent.reminders.escalationSelf'
                : 'addEvent.reminders.escalation'
            )}
          />
        )}
        <InfoSection
          icon="time-outline"
          iconClass="text-moss"
          title={t('addEvent.reminders.howItWorks.earlyTitle')}
          body={t('addEvent.reminders.howItWorks.earlyBody')}
        />
      </div>
    </Modal>
  );
}
