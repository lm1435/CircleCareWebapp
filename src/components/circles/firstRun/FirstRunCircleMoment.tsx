import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Circle } from '@/api/circles';
import { Button, Text } from '@/components/ui';
import { prefersReducedMotion } from '@/components/ui/motion';
import { useAuth } from '@/hooks/useAuth';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { Analytics } from '@/lib/analytics';
import { classifyFailureCode } from '@/lib/apiErrors';
import { createFirstCircleOnce } from '@/lib/firstRunCreate';
import { clearFirstRun, type FirstRunDraft } from '@/lib/firstRunDraft';
import { firstRunFunnel } from '@/lib/firstRunFunnel';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';
import {
  firstRunNavigationState,
  markOnboardingPaywallPending,
  shouldShowOnboardingPaywall,
} from '@/lib/onboardingPaywall';
import { queryKeys } from '@/lib/queryKeys';
import { CircleEmblem, type EmblemState } from './CircleEmblem';

/**
 * M2 (motion.md): the circle forms. Shown once the session exists and a "Who are you caring for?"
 * answer is in memory; it runs `POST /circles` ITSELF (no button) through `createFirstCircleOnce`
 * (one in-flight request + GET /circles first), then hands over to the first item (the wizard over
 * Today, via the same router state the Create circle form uses).
 *
 * Timing: the ring holds at 85% until the server answers; minimum 900ms on screen so it never
 * flashes; a 400ms hold after it closes; a click anywhere skips that hold once the circle exists.
 * After 8s, or on an error, the ring unwinds and the existing create-failed copy shows with Retry.
 * The draft is only deleted after a success (a failure keeps it for Retry).
 */
export const MIN_DISPLAY_MS = 900;
export const HOLD_MS = 400;
export const SLOW_MS = 8000;

export interface FirstRunCircleMomentProps {
  draft: FirstRunDraft;
}

function bucketFor(ms: number): 'fast' | 'normal' | 'slow' {
  if (ms < 1500) return 'fast';
  if (ms < 4000) return 'normal';
  return 'slow';
}

export function FirstRunCircleMoment({ draft }: FirstRunCircleMomentProps): ReactElement {
  const { t } = useTranslation(['circles', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: subscription } = useSubscriptionStatus();
  const [state, setState] = useState<EmblemState>('forming');
  const [circle, setCircle] = useState<Circle | null>(null);
  const startedAtRef = useRef(Date.now());
  const attemptsRef = useRef(0);
  const leftRef = useRef(false);
  const tierRef = useRef(subscription?.tier);
  tierRef.current = subscription?.tier;

  const ownerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  const recipientName = draft.isSelfCare
    ? ownerName || t('create.selfCareDefaultName')
    : (draft.recipientName ?? '');
  const initial = (recipientName.trim()[0] ?? '?').toLocaleUpperCase();
  const ownerInitial = (user?.first_name?.trim()[0] ?? '').toLocaleUpperCase() || undefined;

  const leave = useCallback(
    (created: Circle, skipped: boolean): void => {
      if (leftRef.current) return;
      leftRef.current = true;
      Analytics.firstRunCircleMoment({
        circleId: created.id,
        skipped,
        durationBucket: bucketFor(Date.now() - startedAtRef.current),
      });
      navigate(`/circles/${created.id}`, {
        replace: true,
        state: firstRunNavigationState(created.recipient_name ?? recipientName),
      });
    },
    [navigate, recipientName]
  );

  const run = useCallback((): void => {
    const retried = attemptsRef.current > 0;
    attemptsRef.current += 1;
    setState('forming');
    const started = Date.now();
    let settled = false;
    const slowTimer = window.setTimeout(() => {
      if (!settled) setState('failed');
    }, SLOW_MS);
    createFirstCircleOnce(
      { recipient_name: recipientName, is_self_care: draft.isSelfCare },
      draft.createKey
    )
      // `.then(success, failure)`, not `.then().catch()`: a throw AFTER the circle exists (an
      // analytics or storage hiccup) must never be shown as "couldn't create your circle".
      .then(
        ({ circle: created, existed }) => {
          settled = true;
          window.clearTimeout(slowTimer);
          // Read once and delete: the name is never needed again.
          clearFirstRun();
          void queryClient.invalidateQueries({ queryKey: queryKeys.circles });
          setCircle(created);
          setState('ready');
          const wait = Math.max(0, MIN_DISPLAY_MS - (Date.now() - started)) + HOLD_MS;
          window.setTimeout(() => leave(created, false), wait);
          try {
            Analytics.circleAutoCreated({
              circleId: created.id,
              isSelfCare: draft.isSelfCare,
              success: true,
              retried: retried || existed,
            });
            if (!existed) {
              Analytics.circleCreated(draft.isSelfCare);
              trackOnboardingCompleted('created');
              if (shouldShowOnboardingPaywall({ isFirstCircle: true, tier: tierRef.current })) {
                markOnboardingPaywallPending(created.id);
              }
            }
            firstRunFunnel.completed('circle_created', created.id);
          } catch {
            // Analytics / storage must never cost the person their circle.
          }
        },
        (error: unknown) => {
          settled = true;
          window.clearTimeout(slowTimer);
          Analytics.circleAutoCreated({
            isSelfCare: draft.isSelfCare,
            success: false,
            failureReason: classifyFailureCode(error),
            retried,
          });
          Analytics.firstRunCircleMoment({ skipped: false, durationBucket: 'failed' });
          setState('failed');
        }
      );
  }, [draft.createKey, draft.isSelfCare, leave, queryClient, recipientName]);

  useEffect(() => {
    firstRunFunnel.viewed('circle_created');
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount; the create itself is single-flight
  }, []);

  const title = draft.isSelfCare
    ? t('firstRun.ready.titleSelf')
    : t('firstRun.ready.title', { name: recipientName });

  return (
    // A click anywhere skips the hold, but only once the circle exists.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center"
      data-testid="first-run-circle-moment"
      data-state={state}
      onClick={() => {
        if (circle && state === 'ready') leave(circle, true);
      }}
    >
      {state === 'ready' ? null : <h1 className="sr-only">{t('create.creating')}</h1>}
      <CircleEmblem initial={initial} ownerInitial={ownerInitial} state={state} />
      {/* Always mounted: the title is announced once, when it arrives. */}
      <div role="status" aria-live="polite" className="min-h-[76px]">
        {state === 'ready' ? (
          <Text
            variant="pageTitle"
            as="h1"
            className={prefersReducedMotion() ? '' : 'cc-fr-rise'}
            data-testid="first-run-circle-ready"
          >
            {title}
          </Text>
        ) : null}
        {state === 'failed' ? (
          <div className="flex flex-col items-center gap-4">
            <Text variant="body" as="p" className="m-0" data-testid="first-run-circle-error">
              {t('create.failed')}
            </Text>
            <Button size="lg" onClick={run} data-testid="first-run-circle-retry">
              {t('common:retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
