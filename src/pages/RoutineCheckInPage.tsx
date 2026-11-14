import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { Button, Skeleton } from '@/components/ui';
import { useAnswerDoseAlerts, useDoseAlerts } from '@/hooks/useDoseAlerts';
import { useCircle } from '@/hooks/useCircle';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { Analytics, type RoutineCheckinAnswer, type RoutineCheckinSource } from '@/lib/analytics';
import { isPermissionDeniedError } from '@/lib/apiErrors';
import { useAuthStore } from '@/store/authStore';

const SOURCES: readonly RoutineCheckinSource[] = ['push', 'inbox', 'notice', 'link'];

/** How this page was reached: router state from the inbox / the notice, else a link. */
export function checkinSourceFromState(state: unknown): RoutineCheckinSource {
  const value = (state as { checkinSource?: unknown } | null | undefined)?.checkinSource;
  return SOURCES.includes(value as RoutineCheckinSource) ? (value as RoutineCheckinSource) : 'link';
}

/** "Paused since {{date}}": the pause instant as a short date in the CIRCLE's zone. */
export function formatPausedSince(iso: string, timezone: string | null, language: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(language, {
      month: 'short',
      day: 'numeric',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(at);
  } catch {
    return '';
  }
}

/**
 * The routine check-in (quiet-circle back-off, 1.4.2): `/circles/:circleId/routine-check-in`.
 * Reached from the `routine_checkin` inbox row (web has no push), from the paused notice's
 * "Has the routine changed?", or from a link.
 *
 *   paused + can_answer  -> three answers, each with its hint
 *   paused + !can_answer -> the question, no answers (view-only seats, read-only circles)
 *   not paused           -> "Alerts are on" and a way back to Today (no stale answers)
 *
 * still_giving -> Today ("Alerts are on"); routine_changed -> Meds; keep_paused -> Today.
 */
export default function RoutineCheckInPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['meds', 'common']);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { circle, members, isOwner, timezone } = useCircle(circleId);
  const doseAlerts = useDoseAlerts(circleId);
  const answerMutation = useAnswerDoseAlerts(circleId);
  const [source] = useState<RoutineCheckinSource>(() => checkinSourceFromState(location.state));
  const [failed, setFailed] = useState(false);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  const base = `/circles/${circleId}`;
  const recipientName = circle?.recipient_name ?? '';
  const isRecipient = members.some((m) => m.is_care_recipient && m.id === currentUserId);
  const self = circle?.is_self_care === true || isRecipient || !recipientName;

  // routine_checkin_opened: once per mount, when ownership is known.
  const openedFired = useRef(false);
  useEffect(() => {
    if (openedFired.current || !circle) return;
    openedFired.current = true;
    Analytics.routineCheckinOpened({ source, isOwner });
  }, [circle, source, isOwner]);

  const answer = useGuardedSubmit(async (choice: RoutineCheckinAnswer) => {
    setFailed(false);
    try {
      await answerMutation.mutateAsync({ answer: choice, source });
      Analytics.routineCheckinAnswered({ answer: choice, source, isOwner });
      if (choice === 'routine_changed') navigate(`${base}/meds`);
      else navigate(base);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        // VIEW_ONLY / read-only: the server is the authority; re-read so the page shows the
        // no-answer state instead of buttons that cannot work.
        doseAlerts.refetch();
        return;
      }
      setFailed(true);
      // Keep focus inside the page and announce the failure.
      window.setTimeout(() => errorRef.current?.focus(), 0);
    }
  });

  const state = doseAlerts.state;
  const title = self
    ? t('doseAlerts.checkin.titleSelf')
    : t('doseAlerts.checkin.title', { name: recipientName });

  let body: ReactElement;
  if (doseAlerts.isError) {
    // A failed read reads as "not paused" elsewhere; here the person asked for this page,
    // so say it did not load and offer a retry.
    body = (
      <div data-testid="routine-checkin-error">
        <p className="m-0 text-md text-ink">{t('doseAlerts.checkin.loadFailed')}</p>
        <Button variant="secondary" className="mt-4" onClick={doseAlerts.refetch}>
          {t('doseAlerts.checkin.retry')}
        </Button>
      </div>
    );
  } else if (!state || !circle) {
    body = (
      <div aria-busy="true" data-testid="routine-checkin-loading">
        <Skeleton className="h-5 w-3/4 max-w-96" />
        <Skeleton className="mt-3 h-12 w-full max-w-xl" />
        <Skeleton className="mt-3 h-12 w-full max-w-xl" />
      </div>
    );
  } else if (!state.paused) {
    body = (
      <div data-testid="routine-checkin-alerts-on">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('doseAlerts.checkin.alertsOnTitle')}</h2>
        <p className="m-0 mt-1.5 max-w-xl text-md text-ink-2">{t('doseAlerts.checkin.alertsOnBody')}</p>
        <Button variant="secondary" className="mt-5" onClick={() => navigate(base)}>
          {t('doseAlerts.checkin.backToToday')}
        </Button>
      </div>
    );
  } else {
    const since = state.paused_since
      ? formatPausedSince(state.paused_since, timezone, i18n.language)
      : '';
    const options: Array<{
      answer: RoutineCheckinAnswer;
      label: string;
      hint: string;
      variant: 'primary' | 'outline';
    }> = [
      {
        answer: 'still_giving',
        label: self ? t('doseAlerts.checkin.stillTaking') : t('doseAlerts.checkin.stillGiving'),
        hint: t('doseAlerts.checkin.stillHint'),
        variant: 'primary',
      },
      {
        answer: 'routine_changed',
        label: t('doseAlerts.checkin.changed'),
        hint: t('doseAlerts.checkin.changedHint'),
        variant: 'outline',
      },
      {
        answer: 'keep_paused',
        label: t('doseAlerts.checkin.keep'),
        hint: t('doseAlerts.checkin.keepHint'),
        variant: 'outline',
      },
    ];
    body = (
      <div data-testid="routine-checkin-paused">
        <p className="m-0 max-w-xl text-md text-ink-2">{t('doseAlerts.checkin.body')}</p>
        {since ? (
          <p className="m-0 mt-2 text-sm font-medium text-ink-2" data-testid="routine-checkin-since">
            {t('doseAlerts.notice.since', { date: since })}
          </p>
        ) : null}
        {state.can_answer ? (
          <ul className="m-0 mt-6 flex max-w-xl list-none flex-col gap-3 p-0" data-testid="routine-checkin-answers">
            {options.map((option) => (
              <li key={option.answer}>
                {/* The hint is part of the button's content, so its accessible name carries it
                    (no aria-label that would swallow it). */}
                <Button
                  variant={option.variant}
                  fullWidth
                  busy={answerMutation.isPending}
                  offlineKind="change"
                  className="whitespace-normal! flex-col! items-start! gap-0.5! text-left"
                  onClick={() => void answer(option.answer)}
                  data-testid={`routine-checkin-${option.answer}`}
                >
                  <span className="block">{option.label}</span>
                  <span className="block text-sm font-normal opacity-90">{option.hint}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-5 max-w-xl text-md text-ink" data-testid="routine-checkin-view-only">
            {t('doseAlerts.checkin.viewOnly')}
          </p>
        )}
        {failed ? (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="m-0 mt-3 text-sm font-medium text-ink outline-none"
          >
            {t('doseAlerts.checkin.answerFailed')}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-3xl pb-10" data-testid="routine-checkin-page">
      <PageMasthead
        section={t('doseAlerts.checkin.eyebrow')}
        tone="moss"
        title={circle ? title : ''}
        backTo={base}
      />
      <div className="px-5 pt-2">{body}</div>
    </section>
  );
}
