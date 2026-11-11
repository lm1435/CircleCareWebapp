import { useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import { fieldShell } from '@/components/ui/inputStyles';
import {
  reminderSummaryLabel,
  reminderSummaryText,
  type ReminderSummary,
} from '@/lib/reminderSummary';

/**
 * The simple forms' "Reminders" row (owner 2026-11-10, approved design "Summary line outside"),
 * rendered directly ABOVE More details and visible whether that is open or closed. Reminders are
 * the setting people misread (all boxes off, follow-ups still firing), so the row states what WILL
 * happen, live, from the same state the Reminders card edits. Mobile parity:
 * mobile RemindersSummaryRow + utils/reminderSummary.
 *
 * Two looks:
 *  - `summary`: "Reminders" / the summary line, and a moss "Change >" (the one moss accent). The
 *    whole row is one button named by the full sentence, so truncation never loses meaning. It is an
 *    ACCORDION (owner 2026-11-10, second pass): the button expands the full Reminders card (`children`)
 *    inline, directly under it, and folds it again; it never routes the user down the page. The panel
 *    stays MOUNTED while folded (`hidden`), so `aria-controls` always points at a real element and the
 *    card's state and ids are stable. Expanded, the header shows a chevron-up instead of "Change >".
 *  - `pickTime`: a task / appointment with no time yet (reminders need one). Muted, no "Change";
 *    the parent sends the tap to the form's time choice instead of More details.
 */

export type RemindersSummaryRowProps =
  | {
      variant: 'summary';
      summary: ReminderSummary;
      expanded: boolean;
      /** The panel's id (the button's aria-controls). */
      panelId: string;
      onPress: () => void;
      /** The Reminders card, shown in the panel while expanded. */
      children: ReactNode;
    }
  | { variant: 'pickTime'; onPress: () => void };

export function RemindersSummaryRow(props: RemindersSummaryRowProps): ReactElement {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const locale = i18n.language || 'en';
  const hintId = useId();
  const isPickTime = props.variant === 'pickTime';
  const value = isPickTime
    ? t('addEvent.reminders.summary.pickTime')
    : reminderSummaryText(t, props.summary, locale);
  const label = isPickTime
    ? t('addEvent.reminders.summary.pickTimeLabel')
    : reminderSummaryLabel(t, props.summary, locale);
  const expanded = props.variant === 'summary' && props.expanded;
  const button = (
    <button
      type="button"
      data-testid="reminders-summary-row"
      data-variant={props.variant}
      aria-label={label}
      aria-expanded={props.variant === 'summary' ? props.expanded : undefined}
      aria-controls={props.variant === 'summary' ? props.panelId : undefined}
      // Mobile's accessibilityHint ("Shows the reminder settings."); the pick-time label already says
      // where it goes.
      aria-describedby={isPickTime ? undefined : hintId}
      onClick={props.onPress}
      // The form's own field shell (cream, line-strong border, rounded-md, px-3.5, 44px min) and its
      // moss focus edge, so the row reads as one of the form's fields.
      className={fieldShell({ extra: 'w-full cursor-pointer py-2 text-left outline-none' })}
    >
      <span className={`shrink-0 ${isPickTime ? 'text-ink-3' : 'text-ink-2'}`}>
        <Icon name="notifications-outline" size="inline" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`text-sm font-medium ${isPickTime ? 'text-ink-2' : 'text-ink'}`}>
          {t('addEvent.reminders.section')}
        </span>
        <span
          data-testid="reminders-summary-value"
          className={`truncate text-sm ${isPickTime ? 'text-ink-3' : 'text-ink-2'}`}
        >
          {value}
        </span>
      </span>
      {!isPickTime && (
        <span id={hintId} hidden>
          {t('addEvent.reminders.summary.hint')}
        </span>
      )}
      {!isPickTime && !expanded && (
        <span
          data-testid="reminders-summary-change"
          className="flex shrink-0 items-center gap-1 text-sm font-semibold text-moss-deep"
        >
          {t('addEvent.reminders.summary.change')}
          <Icon name="chevron-forward" size="inline" />
        </span>
      )}
      {expanded && (
        // chevron-up: the down chevron turned over (no separate icon; the registry needs mobile precedent).
        <span data-testid="reminders-summary-collapse" className="flex shrink-0 text-moss-deep">
          <Icon name="chevron-down" size="inline" className="rotate-180" />
        </span>
      )}
    </button>
  );
  if (props.variant === 'pickTime') return button;
  return (
    <div className="flex flex-col gap-3" data-testid="reminders-summary">
      {button}
      {/* Full width under the row, no extra indent. */}
      <div id={props.panelId} data-testid="reminders-summary-panel" hidden={!props.expanded}>
        {props.children}
      </div>
    </div>
  );
}
