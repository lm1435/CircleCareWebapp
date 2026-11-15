import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Sheet, Text } from '@/components/ui';
import { useAnswerDoseAlerts, useDoseAlerts } from '@/hooks/useDoseAlerts';
import { useCircle } from '@/hooks/useCircle';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { Analytics, shouldReportDoseAlertsNotice } from '@/lib/analytics';
import { routineCheckinPath } from '@/lib/notificationsInbox';
import { useDoseAlertsResumedStore } from '@/store/doseAlertsResumedStore';

export type DoseAlertsSurface = 'today' | 'meds';

export interface DoseAlertsNoticeProps {
  circleId: string;
  /** 'today': the ONE coaching card on Today. 'meds': a slim line at the top of Meds. */
  surface: DoseAlertsSurface;
  /** Today's one-filled-action rule: false when Next up already shows a filled Taken. Ignored on Meds. */
  primaryAllowed?: boolean;
}

/**
 * "Follow-up alerts are paused" (quiet-circle back-off, 1.4.2; contract
 * docs/plans/quiet-circle-backoff-1-4-2-backend-contract.md "Notice states").
 *
 *   paused false                 -> nothing (or "Alerts are on" right after a resume)
 *   paused, can_answer           -> title + body + "Turn alerts back on" + "Has the routine changed?"
 *   paused, answer keep_paused   -> the acknowledged body, same buttons
 *   paused, !can_answer          -> title + body only (view-only seats, read-only circles)
 *
 * A failed read is "not paused": nothing shows. There is no dose action here:
 * marking stays one dose at a time on Next up / Meds.
 */
export function DoseAlertsNotice({
  circleId,
  surface,
  primaryAllowed = true,
}: DoseAlertsNoticeProps): ReactElement | null {
  const { t } = useTranslation('meds');
  const navigate = useNavigate();
  const { state } = useDoseAlerts(circleId);
  const { isOwner } = useCircle(circleId);
  const answer = useAnswerDoseAlerts(circleId);
  const resumed = useDoseAlertsResumedStore((s) => s.resumed[circleId] === true);
  const [failed, setFailed] = useState(false);
  const resumedRef = useRef<HTMLParagraphElement | null>(null);
  const focusResumedLine = useRef(false);

  const paused = state?.paused === true;
  const canAnswer = paused && state?.can_answer === true;

  // Once per circle per surface per session.
  useEffect(() => {
    if (!paused || !state) return;
    if (!shouldReportDoseAlertsNotice(circleId, surface)) return;
    Analytics.doseAlertsNoticeShown({ surface, canAnswer: state.can_answer === true });
  }, [paused, state, circleId, surface]);

  // "Turn alerts back on" unmounts the button that had focus: land on the confirmation line,
  // never on <body> (WCAG 2.4.3).
  useEffect(() => {
    if (!paused && resumed && focusResumedLine.current) {
      focusResumedLine.current = false;
      resumedRef.current?.focus();
    }
  }, [paused, resumed]);

  // "Alerts are on" lasts for the visit of whichever surface hosts the notice (mobile clears on
  // blur): leaving Meds must not leave the flag armed, or the role=status line re-announces on every
  // later Meds visit. DEFERRED and cancelled by a re-run for the same circle, so StrictMode's
  // mount -> cleanup -> mount does not wipe a flag set just before this page mounted (same pattern
  // as Today, pages/OverviewPage.tsx).
  const clearResumed = useDoseAlertsResumedStore((s) => s.clear);
  const pendingClear = useRef<{ circleId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    const pending = pendingClear.current;
    if (pending && pending.circleId === circleId) {
      clearTimeout(pending.timer);
      pendingClear.current = null;
    }
    return () => {
      pendingClear.current = { circleId, timer: setTimeout(() => clearResumed(circleId), 0) };
    };
  }, [circleId, clearResumed]);

  const resume = useGuardedSubmit(async () => {
    setFailed(false);
    // Armed BEFORE the request: the mutation's onSuccess flips the notice to the confirmation
    // line (cache write + resumed flag) before `mutateAsync` resolves.
    focusResumedLine.current = true;
    try {
      await answer.mutateAsync({ answer: 'still_giving', source: 'notice' });
      Analytics.routineCheckinAnswered({ answer: 'still_giving', source: 'notice', isOwner });
    } catch {
      focusResumedLine.current = false;
      setFailed(true);
    }
  });

  if (!paused) {
    if (!resumed) return null;
    return (
      <p
        ref={resumedRef}
        tabIndex={-1}
        role="status"
        className="m-0 text-md font-medium text-ink outline-none"
        data-testid={`dose-alerts-resumed-${surface}`}
      >
        {t('doseAlerts.notice.resumed')}
      </p>
    );
  }

  const titleId = `dose-alerts-notice-title-${surface}`;
  const body =
    state?.answer === 'keep_paused' ? t('doseAlerts.notice.bodyKept') : t('doseAlerts.notice.body');
  const openCheckin = (): void =>
    navigate(routineCheckinPath(circleId), { state: { checkinSource: 'notice' } });

  const actions = canAnswer ? (
    <div className={`flex flex-wrap items-center gap-3 ${surface === 'today' ? 'mt-4' : 'mt-2'}`}>
      <Button
        // Today: the one-filled-action rule (outline when Next up already shows a filled Taken).
        // Meds: always the primary (mobile parity).
        variant={surface === 'meds' || primaryAllowed ? 'primary' : 'outline'}
        size={surface === 'today' ? 'md' : 'sm'}
        busy={answer.isPending}
        offlineKind="change"
        onClick={() => void resume()}
        data-testid={`dose-alerts-resume-${surface}`}
      >
        {t('doseAlerts.notice.resume')}
      </Button>
      <button
        type="button"
        onClick={openCheckin}
        className="inline-flex min-h-11 items-center px-3 text-md font-semibold text-moss-deep"
        data-testid={`dose-alerts-checkin-${surface}`}
      >
        {t('doseAlerts.notice.routineChanged')}
      </button>
    </div>
  ) : null;

  const error = failed ? (
    <p role="alert" className="m-0 mt-2 text-sm font-medium text-ink">
      {t('doseAlerts.notice.resumeFailed')}
    </p>
  ) : null;

  if (surface === 'meds') {
    return (
      <div
        role="region"
        aria-labelledby={titleId}
        className="border-l-2 border-line-strong pl-3"
        data-testid="dose-alerts-notice-meds"
        data-can-answer={canAnswer ? 'true' : 'false'}
      >
        <p id={titleId} className="m-0 text-md font-semibold text-ink">
          {t('doseAlerts.notice.title')}
        </p>
        <p className="m-0 mt-0.5 text-sm text-ink-2">{body}</p>
        {actions}
        {error}
      </div>
    );
  }

  return (
    <Sheet
      role="region"
      aria-labelledby={titleId}
      padding="lg"
      className="rounded-2xl"
      data-testid="dose-alerts-notice-today"
      data-can-answer={canAnswer ? 'true' : 'false'}
    >
      <Text variant="h2" as="h2" id={titleId}>
        {t('doseAlerts.notice.title')}
      </Text>
      <Text variant="body" className="mt-1.5 max-w-xl text-ink-2">
        {body}
      </Text>
      {actions}
      {error}
    </Sheet>
  );
}

export default DoseAlertsNotice;
