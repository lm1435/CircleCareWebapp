import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCircles } from '@/hooks/useCircles';
import { trackCirclesLoaded } from '@/lib/onboardingAnalytics';
import { firstRunNavigationState, takeDeferredFirstRun } from '@/lib/onboardingPaywall';
import { useAuth } from '@/hooks/useAuth';
import { Button, Card, Text } from '@/components/ui';
import { CircleCard } from '@/components/circles/CircleCard';
import { CircleCardSkeleton } from '@/components/circles/CircleCardSkeleton';
import { EmptyCircles } from '@/components/circles/EmptyCircles';
import { PendingInvitesBanner } from '@/components/circles/PendingInvitesBanner';
import { CreateCircleModal } from '@/components/circles/CreateCircleModal';
import { JoinCircleModal } from '@/components/circles/JoinCircleModal';
import { NeedsCircleSelectionBanner } from '@/components/NeedsCircleSelectionBanner';

/** Time-of-day greeting key (mirrors mobile's getGreeting). */
function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

interface PickerLocationState {
  /** Set by the header's "All circles" switcher item — see the auto-skip
   *  effect below. */
  fromSwitcher?: boolean;
}

/**
 * Circle picker landing page (plan Tasks 15 + 39c, restyled to spec §6.2): a
 * warm greeting hero over a card grid of the user's circles from
 * `GET /circles`. Mirrors mobile's CircleListScreen header (time-of-day
 * greeting → editorial name → circle count).
 */
export default function CirclePickerPage(): ReactElement {
  const { t } = useTranslation(['members', 'circles']);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: circles, isPending, isError, refetch } = useCircles();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const firstName = user?.first_name?.trim();
  const circleCount = circles?.length ?? 0;

  // R4-5 onboarding funnel: this page is the post-auth landing, so a resolved
  // circle list is the earliest reliable "zero circles → onboarding_started" /
  // ">= 1 circle → onboarding_flow_completed('existing')" signal. The module
  // guards (session/localStorage) make repeat renders and revisits no-ops.
  useEffect(() => {
    if (circles) trackCirclesLoaded(circles.length);
  }, [circles]);

  // Set by the deferred-first-run effect below when it redirects, so the
  // auto-skip effect (same mount) never fires a SECOND, wizard-less navigate
  // to the very same circle and clobbers the wizard's location.state. Both
  // effects can be live together: a brand-new owner who backed out of the
  // onboarding paywall lands back here with exactly one circle AND a parked
  // wizard.
  const deferredHandledRef = useRef(false);
  // Mirrors mobile's `hasAutoNavigated` ref (CircleListScreen.tsx) — fires
  // exactly once per mount, not on every circles refetch.
  const autoSkippedRef = useRef(false);

  /**
   * THE BROWSER-BACK ESCAPE HATCH for the onboarding paywall.
   *
   * `CreateCircleModal` navigates a first-circle free-tier user to `/upgrade`
   * and parks the first-run wizard in sessionStorage. Every control on that
   * page delivers it — but the browser's Back button does not go through any
   * of them, and it lands HERE, because `/circles` is the entry this page
   * pushed `/upgrade` from. This is the same shape as mobile, where backing
   * out of the paywall returns to CreateCircleScreen and ITS focus listener
   * replays the deferred wizard (CreateCircleScreen.tsx:167-176).
   *
   * `takeDeferredFirstRun` consumes, so a record can only ever be delivered
   * once no matter which exit wins the race, and `replace` keeps Back walking
   * out of the app rather than back into the paywall.
   *
   * Mount-only: a record written later in this page's life belongs to the
   * navigation that wrote it, not to this effect.
   */
  useEffect(() => {
    const pending = takeDeferredFirstRun();
    if (!pending) return;
    deferredHandledRef.current = true;
    navigate(`/circles/${pending.circleId}`, {
      replace: true,
      state: firstRunNavigationState(pending.recipientName),
    });
    // Deps are deliberately empty — `navigate` is stable for the life of the
    // router, and this must run exactly once per landing.
  }, []);

  /**
   * AUTO-SKIP (mobile `CircleListScreen`'s single-circle behavior, spec §6.2):
   * with exactly one circle, this picker is a wasted extra tap — jump straight
   * into it. `fromSwitcher` is the header's "All circles" item's escape
   * hatch: it means the user deliberately asked to see the picker even though
   * they only have one circle, so this effect must not immediately bounce
   * them back out.
   */
  useEffect(() => {
    if (autoSkippedRef.current || deferredHandledRef.current) return;
    if (isPending || isError) return;
    if (!circles || circles.length !== 1) return;
    if ((location.state as PickerLocationState | null)?.fromSwitcher) return;
    autoSkippedRef.current = true;
    navigate(`/circles/${circles[0].id}`, { replace: true });
  }, [circles, isPending, isError, location.state, navigate]);

  let content: ReactElement;
  if (isPending) {
    content = (
      <ul
        aria-busy="true"
        aria-label={t('common:loading')}
        className="m-0 mt-8 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2"
      >
        <CircleCardSkeleton />
        <CircleCardSkeleton />
        <CircleCardSkeleton />
      </ul>
    );
  } else if (isError) {
    content = (
      <Card variant="elevated" role="alert" className="mx-auto mt-8 max-w-lg p-8 text-center">
        <Text variant="h2" as="h2">
          {t('picker.errorTitle')}
        </Text>
        <p className="mt-2 text-ink-2">{t('picker.errorBody')}</p>
        <Button className="mt-6" onClick={() => void refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (!circles || circles.length === 0) {
    content = (
      <EmptyCircles
        action={
          <Button onClick={() => setShowCreate(true)}>{t('circles:create.create')}</Button>
        }
        joinAction={
          <div className="flex flex-col items-center gap-2">
            <p className="m-0 text-sm text-ink-3">{t('circles:join.invitedPrompt')}</p>
            <Button variant="secondary" onClick={() => setShowJoin(true)}>
              {t('circles:join.withCode')}
            </Button>
          </div>
        }
      />
    );
  } else {
    content = (
      <ul className="m-0 mt-8 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
        {circles.map((circle) => (
          <CircleCard key={circle.id} circle={circle} />
        ))}
      </ul>
    );
  }

  // The header actions are shown once the list has loaded with at least one
  // circle (the empty state has its own CTAs, and loading/error states have
  // nothing to add alongside).
  const showHeaderActions = !isPending && !isError && circleCount > 0;

  return (
    <section className="mx-auto w-full max-w-[900px] p-6 md:p-8">
      <NeedsCircleSelectionBanner />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {firstName && (
            <p className="mb-1 text-md font-medium text-ink-3">
              {t(`picker.greeting.${greetingKey()}`)}
            </p>
          )}
          <Text variant="editorialTitle">{firstName ?? t('picker.heading')}</Text>
          {showHeaderActions && (
            <p className="mt-2 text-sm font-medium text-ink-3">
              {t('picker.careCircleCount', { count: circleCount })}
            </p>
          )}
        </div>
        {showHeaderActions && (
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setShowJoin(true)}>
              {t('circles:join.button')}
            </Button>
            <Button onClick={() => setShowCreate(true)}>{t('circles:create.create')}</Button>
          </div>
        )}
      </header>
      {/* Mirrors mobile's CircleListScreen invite banner — without it a web user
          who already has a circle has no route to /invites at all. */}
      <PendingInvitesBanner />
      {content}

      {showCreate && <CreateCircleModal onClose={() => setShowCreate(false)} />}
      {showJoin && (
        <JoinCircleModal
          onClose={() => setShowJoin(false)}
          onJoined={(circleId) => navigate(`/circles/${circleId}`)}
        />
      )}
    </section>
  );
}
