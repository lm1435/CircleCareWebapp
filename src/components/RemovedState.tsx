import { useEffect, useRef, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text } from '@/components/ui';
import { TerminalState } from '@/components/auth/TerminalState';
import { handOffFocusSoon } from '@/lib/focusHandoff';

export type RemovedReason = 'removed' | 'ended' | 'no_access';

export interface RemovedStateProps {
  reason: RemovedReason;
  /** The linked date (naive YYYY-MM-DD), when the URL had one. Shown in the user's locale. */
  date?: string | null;
  /** The link came from an email (`?src=`): adds the "From your email" context line. */
  fromEmail?: boolean;
  /**
   * `inline` (default): a card at the top of the page the link pointed at; the
   * button is "OK" and calls `onDismiss`. `page`: replaces the whole page (a
   * circle the user can no longer open); the button is "See your circles".
   * `no_access` is always a page.
   */
  layout?: 'inline' | 'page';
  onDismiss?: () => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' in the user's locale, never shifted by the browser's timezone. */
function formatLinkedDate(date: string, language: string): string | null {
  if (!DATE_RE.test(date)) return null;
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${date}T12:00:00Z`)
    );
  } catch {
    return null;
  }
}

/**
 * The ONE "this was removed" state for a link whose target is gone (deleted /
 * no longer scheduled, ended, or a circle the user can no longer open). Twin of
 * mobile's removed sheet: same title, reasons, context line and button wording.
 * Used by calendar (?eventId), meds (?medication), notes (?date), daily-update
 * and the circle layout (no access).
 *
 * a11y: the heading takes focus on mount (the link's target was replaced by this
 * state, so focus would otherwise stay on <body>); the action is a real button
 * or link. Dismissing the inline state hands focus to the page heading (or wherever the
 * host put it), never to <body>.
 */
export function RemovedState({
  reason,
  date,
  fromEmail = false,
  layout = 'inline',
  onDismiss,
}: RemovedStateProps): ReactElement {
  const { t, i18n } = useTranslation('common');
  const ref = useRef<HTMLDivElement>(null);
  const page = layout === 'page' || reason === 'no_access';

  useEffect(() => {
    const heading = ref.current?.querySelector('h1, h2');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    (heading as HTMLElement).focus({ preventScroll: false });
  }, []);

  const body =
    reason === 'no_access'
      ? t('removedState.noAccess')
      : reason === 'ended'
        ? t('removedState.ended')
        : t('removedState.removed');
  const linkedDate = date ? formatLinkedDate(date, i18n.language) : null;
  const context = fromEmail
    ? linkedDate
      ? t('removedState.fromEmailDate', { date: linkedDate })
      : t('removedState.fromEmail')
    : null;

  const action =
    reason === 'no_access' ? (
      <Button as={Link} to="/circles" variant="primary" size="lg" fullWidth>
        {t('removedState.seeCircles')}
      </Button>
    ) : (
      <Button
        variant="primary"
        size="lg"
        fullWidth={page}
        onClick={() => {
          onDismiss?.();
          // This button unmounts with the state: unless the host moved focus somewhere
          // deliberate, hand it to the page heading instead of letting it fall to <body>.
          handOffFocusSoon();
        }}
      >
        {t('removedState.ok')}
      </Button>
    );

  if (page) {
    return (
      <div
        ref={ref}
        className="mx-auto w-full max-w-md px-4 py-16"
        data-testid="removed-state"
        data-reason={reason}
      >
        <TerminalState
          icon={reason === 'no_access' ? 'lock-closed-outline' : 'alert-circle-outline'}
          title={t('removedState.title')}
          body={
            <>
              {body}
              {context ? (
                <span className="mt-2 block text-sm text-ink-3" data-testid="removed-state-context">
                  {context}
                </span>
              ) : null}
            </>
          }
        >
          {action}
        </TerminalState>
      </div>
    );
  }

  return (
    <div ref={ref} className="px-5 pt-2" data-testid="removed-state" data-reason={reason}>
      <Card variant="outlined" padding="md" role="status">
        <Text variant="h3" as="h2">
          {t('removedState.title')}
        </Text>
        <Text variant="body" className="mt-1 text-ink-2!">
          {body}
        </Text>
        {context ? (
          <Text variant="caption" className="mt-1 text-ink-3!" data-testid="removed-state-context">
            {context}
          </Text>
        ) : null}
        <div className="mt-4">{action}</div>
      </Card>
    </div>
  );
}
