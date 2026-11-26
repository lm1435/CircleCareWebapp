import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Eyebrow } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { TEXT_CLASS } from '@/components/ui/Text';
import { useAuth } from '@/hooks/useAuth';
import { Analytics } from '@/lib/analytics';
import { firstRunFunnel, getFirstRunPath } from '@/lib/firstRunFunnel';
import {
  clearPendingInviteeWelcome,
  peekPendingInviteeWelcome,
  type InviteeWelcome,
} from '@/lib/inviteeWelcome';

interface WelcomeItem {
  key: string;
  heading: string;
  sub: string;
}

/**
 * Invitee welcome (onboarding 1.3.1, spec section 4; design ObWebWelcomeInvitee).
 *
 * `/circles/:circleId/welcome` — shown ONCE, right after a NEW member accepts an
 * invite (landing page after the OTP / OAuth hand-off, pending-invites list,
 * join-by-code). The accept paths park a pending welcome per user + circle
 * (lib/inviteeWelcome); this page consumes it on first view, so a reload, a
 * bookmark, an owner or an existing member just continue to Today.
 *
 * Editors get three rows; view-only members get only the "See" rows. Names come
 * from the invite (inviter's first name, the recipient's name) and are never a
 * relationship word; a missing inviter name has its own wording; a joiner who IS
 * the care recipient gets the self-care wording.
 */
export default function InviteeWelcomePage(): ReactElement {
  const { t } = useTranslation('invite');
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;

  // Read once at mount (render-safe peek); it is cleared in the effect below, so
  // StrictMode's double render never loses it and a reload finds nothing.
  const [welcome] = useState<InviteeWelcome | null>(() =>
    peekPendingInviteeWelcome(userId, circleId)
  );
  // First run funnel: this screen is the invited path's `invitee_welcome` step when this tab's run is
  // the invited one (or a run is open in memory). Someone joining a SECOND circle is not onboarding.
  const [inFirstRun] = useState(() => getFirstRunPath() === 'invited' || firstRunFunnel.isActive());
  const shownAt = useRef<number>(Date.now());
  const tracked = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const items: WelcomeItem[] = welcome ? buildItems(t, welcome) : [];

  useEffect(() => {
    if (!welcome || tracked.current) return;
    tracked.current = true;
    shownAt.current = Date.now();
    clearPendingInviteeWelcome(userId, circleId);
    Analytics.inviteeWelcomeViewed(welcome.role, items.length);
    Analytics.getAppPromptViewed('invitee_welcome');
    if (inFirstRun) firstRunFunnel.viewed('invitee_welcome');
    headingRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mount
  }, []);

  if (!welcome) {
    // Nothing pending (reload, owner, existing member, direct link): Today.
    return <Navigate to={`/circles/${circleId}`} replace />;
  }

  const name = welcome.recipient;
  const title = welcome.self
    ? welcome.inviter
      ? t('welcome.titleSelf', { inviter: welcome.inviter })
      : t('welcome.titleSelfNoInviter')
    : welcome.inviter
    ? t('welcome.title', { inviter: welcome.inviter, name })
    : t('welcome.titleNoInviter', { name });
  const lede = welcome.self ? t('welcome.ledeSelf') : t('welcome.lede', { name });

  const handleContinue = (): void => {
    const seconds = Math.max(0, Math.round((Date.now() - shownAt.current) / 1000));
    Analytics.inviteeWelcomeContinued(seconds);
    if (inFirstRun) {
      // "Go to Today" is the step's forward action (no server call); Today closes the run, exactly
      // as mobile's circle screen does for the invited path.
      firstRunFunnel.completed('invitee_welcome');
      firstRunFunnel.viewed('today');
    }
    navigate(`/circles/${circleId}`, { replace: true });
  };

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col px-4 py-8 sm:py-12">
      <Card variant="elevated" padding="none" className="flex flex-col gap-3.5 p-6 sm:px-9 sm:pb-7 sm:pt-8">
        <Eyebrow dot>
          {t('welcome.eyebrow')}
        </Eyebrow>
        {/* Plain h1 (the pageTitle style) so the ref + tabIndex reach the DOM node. */}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className={`${TEXT_CLASS.pageTitle} m-0 outline-none`}
        >
          {title}
        </h1>
        <p className="m-0 text-base text-ink-2">{lede}</p>
        <ul className="m-0 mt-1 flex list-none flex-col p-0" data-testid="invitee-welcome-items">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-0.5 border-t border-line-2 py-3.5 last:border-b">
              <span className="text-lg font-semibold text-ink">{item.heading}</span>
              <span className="text-sm text-ink-2">{item.sub}</span>
            </li>
          ))}
        </ul>
        <Button size="lg" className="mt-1.5 w-full" onClick={handleContinue}>
          {t('welcome.goToToday')}
        </Button>
        {/* The website cannot send push (prod 2026-11-26: 38 of 100 invites were accepted in a browser, and
            those members were never told). Said once, here, where the join is confirmed; never a blocker. */}
        <section
          aria-labelledby="invitee-get-app"
          data-testid="invitee-get-app"
          className="mt-2 flex flex-col gap-2.5 border-t border-line-2 pt-4"
        >
          <h2 id="invitee-get-app" className="m-0 text-lg font-semibold text-ink">
            {t('welcome.getAppTitle')}
          </h2>
          <p className="m-0 text-sm text-ink-2">{t('welcome.getAppBody')}</p>
          <StoreBadges
            layout="row"
            onStoreClick={(store) => Analytics.getAppPromptTapped('invitee_welcome', store)}
          />
        </section>
      </Card>
    </div>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Editors: three rows. View-only (and nothing else): the two "See" rows. */
function buildItems(t: Translate, welcome: InviteeWelcome): WelcomeItem[] {
  const name = welcome.recipient;
  if (welcome.role === 'view_only') {
    return [
      {
        key: 'seeMeds',
        heading: t('welcome.viewOnly.medsTitle'),
        sub: t('welcome.viewOnly.medsSub'),
      },
      {
        key: 'seeTasks',
        heading: t('welcome.viewOnly.tasksTitle'),
        sub: welcome.self
          ? t('welcome.viewOnly.tasksSubSelf')
          : t('welcome.viewOnly.tasksSub', { name }),
      },
    ];
  }
  return [
    {
      key: 'meds',
      heading: t('welcome.caregiver.medsTitle'),
      sub: t('welcome.caregiver.medsSub'),
    },
    {
      key: 'note',
      heading: t('welcome.caregiver.noteTitle'),
      sub: welcome.inviter
        ? t('welcome.caregiver.noteSub', { inviter: welcome.inviter })
        : t('welcome.caregiver.noteSubNoInviter'),
    },
    {
      key: 'tasks',
      heading: t('welcome.caregiver.tasksTitle'),
      sub: t('welcome.caregiver.tasksSub'),
    },
  ];
}
