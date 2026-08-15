import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Skeleton, useToast } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { previewInviteByCode, type InviteMemberType } from '@/api/invites';
import { useAuth } from '@/hooks/useAuth';
import { useAcceptInviteByCode } from '@/hooks/useJoinCircle';
import { consumePendingInviteCode, setPendingInviteCode } from '@/lib/pendingInviteCode';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';
import { Analytics } from '@/lib/analytics';

// ⚠️ NEXT STEPS to ship invite-link sharing:
//   1. Re-enable the Share/Copy buttons in the mobile app — they're commented out
//      in mobile/src/screens/circle/InviteMemberScreen.tsx (search "Share / Copy buttons").
//   2. (nice-to-have) Wire deferred deep-linking so a fresh installer auto-joins the
//      circle instead of having to type the invite code.
// Store listing URLs are live (see src/lib/storeLinks.ts).

const COPIED_FEEDBACK_MS = 2000;

const roleBadgeVariant: Record<InviteMemberType, 'moss' | 'terracotta'> = {
  caregiver: 'moss',
  care_recipient: 'terracotta',
};

/** CircleCare wordmark — brand mark only, NOT a heading (single h1 per state). */
function Wordmark(): ReactElement {
  return <p className="serif m-0 text-center text-lg text-ink">CircleCare</p>;
}

function DownloadButtons({ prompt }: { prompt: string }): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="eyebrow m-0 text-center">{prompt}</p>
      <StoreBadges layout="stack" className="w-full max-w-xs" />
    </div>
  );
}

/**
 * Public invite landing page at /invite/:code — no auth required.
 *
 * Calls the unauthenticated limited-preview endpoint on mount and renders
 * the invitation (inviter, care recipient, circle, role) with app download
 * CTAs, or a warm error state for invalid/expired codes.
 *
 * PRIVACY: the invite code grants circle access — it is shown to the visitor
 * (that is the point) but must NEVER be logged or sent to analytics/error
 * reporting from this page.
 */
export default function InviteLandingPage(): ReactElement {
  const { t, i18n } = useTranslation('invite');
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isBootstrapping } = useAuth();
  const accept = useAcceptInviteByCode();
  const { showToast } = useToast();
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Backend normalizes too; normalize here so the displayed fallback code
  // matches what the app expects users to type.
  const displayCode = code.trim().toUpperCase();

  const { data: invite, isPending, isError, error } = useQuery({
    queryKey: ['invitePreview', displayCode],
    queryFn: () => previewInviteByCode(displayCode),
    enabled: displayCode.length > 0,
    retry: false, // 404/400 are definitive; endpoint is rate-limited
    staleTime: Infinity,
  });

  // The api client unwraps errors — the code lives at err.error.code.
  const isAlreadyUsed =
    (error as { error?: { code?: string } } | null)?.error?.code === 'INVITE_ALREADY_USED';

  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    },
    []
  );

  // Accept the invite when the visitor is already signed in. The preview
  // endpoint doesn't expose the circle id, so on success we land on the circle
  // picker (now showing the just-joined circle). An already-member result is a
  // success from the user's point of view — send them to the picker too.
  const handleAccept = useCallback(() => {
    setAcceptError(null);
    accept.mutate(displayCode, {
      onSuccess: () => {
        // R4-5: joined their first circle here → onboarding complete. No-op
        // when this browser already saw the user with circles ('existing'
        // fired). ALREADY_MEMBER lands in onError, so it never fires 'joined'.
        // Carries only the path enum — never the invite code.
        trackOnboardingCompleted('joined');
        // The accept funnel was previously unmeasured on BOTH platforms — 122
        // invites sent since January produced zero invite_accepted events, so
        // there was no way to tell a working join from a silently broken one.
        Analytics.inviteAccepted(undefined, 'invite_link');
        // Confirm the join — the circle picker we land on gives no feedback.
        showToast(t('acceptSuccess'), 'success');
        navigate('/circles');
      },
      onError: (err) => {
        const errorCode = (err as { error?: { code?: string } } | null)?.error?.code;
        if (errorCode === 'ALREADY_MEMBER') {
          navigate('/circles');
          return;
        }
        setAcceptError(t('acceptFailed'));
      },
    });
  }, [accept, displayCode, navigate, showToast, t]);

  // Returning from the sign-in handoff: finish the job the visitor started.
  //
  // A code parked in sessionStorage means they pressed "Sign in to accept" on
  // THIS page — intent to join is already expressed, so accept on their behalf
  // rather than re-rendering the same card with a second, differently labelled
  // button they have to notice and press again. Every other authenticated
  // arrival just drops the parked code so a stale one can't hijack this landing.
  //
  // `consumePendingInviteCode` is get-and-clear and the ref guards StrictMode's
  // double-invoke, so accept fires at most once per handoff. Declared after
  // handleAccept: naming it in the dep array before its initializer runs would
  // throw (temporal dead zone) on every render of this page.
  const autoAccepted = useRef(false);
  useEffect(() => {
    if (isBootstrapping || !isAuthenticated) return;
    const parked = consumePendingInviteCode();
    if (parked === displayCode && !autoAccepted.current) {
      autoAccepted.current = true;
      handleAccept();
    }
  }, [isBootstrapping, isAuthenticated, displayCode, handleAccept]);

  // Not signed in: route to signup, preserving this invite page as the return
  // destination. SignUpPage always hands off to /verify-email, which has no
  // router state to honor — the sessionStorage code is what brings the invitee
  // back here (VerifyEmailPage / AuthCallbackPage both peek it).
  //
  // Create-account is the PRIMARY action: an invitee is by definition someone
  // who was just told about CircleCare, so the common case is no account yet.
  // Sending them to /login first cost us every web invitee through 2026-08-13
  // (17 invite opens, 0 accepts) — one of them typed credentials for an account
  // that did not exist, got "Invalid email or password", and never came back.
  const handleCreateAccount = useCallback(() => {
    setPendingInviteCode(displayCode);
    navigate('/signup', { state: { from: { pathname: `/invite/${displayCode}` } } });
  }, [navigate, displayCode]);

  // Secondary path for an invitee who already has an account (e.g. an existing
  // mobile user). Preserves the return destination twice over — router state
  // for the email/password path (LoginPage honors location.state.from.pathname)
  // AND sessionStorage for the paths where router state cannot survive (OAuth
  // full-page redirect, login → signup → verify-email).
  const handleSignIn = useCallback(() => {
    setPendingInviteCode(displayCode);
    navigate('/login', { state: { from: { pathname: `/invite/${displayCode}` } } });
  }, [navigate, displayCode]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopyFailed(false);
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — point the user
      // at the visible code instead of failing silently.
      setCopied(false);
      setCopyFailed(true);
    }
  }, [displayCode]);

  // SPA NOTE: react-helmet-async updates these tags at runtime, which link
  // crawlers (iMessage, WhatsApp, Facebook...) do NOT execute. The deployment
  // config must add a prerender rule for /invite/* so per-invite OG tags are
  // served to crawlers (deployment task). index.html carries the static
  // defaults for every other route.
  const ogTitle = invite
    ? t('og.title', { inviterName: invite.invited_by_name })
    : 'CircleCare';
  const ogDescription = invite
    ? t('og.description', {
        circleName: invite.circle.name,
        recipientName: invite.circle.recipient_name,
      })
    : t('appDescription');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-10">
      <Helmet>
        <html lang={i18n.language} />
        <title>{ogTitle}</title>
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDescription} />
        <meta name="description" content={ogDescription} />
      </Helmet>

      <Card className="flex w-full max-w-[480px] flex-col gap-6">
        <header>
          <Wordmark />
        </header>

        {isPending && (
          <div aria-busy="true" className="flex flex-col gap-4">
            <p className="sr-only" role="status">
              {t('loading')}
            </p>
            <Skeleton className="mx-auto h-7 w-3/4" />
            <Skeleton className="mx-auto h-5 w-1/2" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="mx-auto h-5 w-2/3" />
          </div>
        )}

        {isError && (
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              {/* "Already used" is a distinct, common case — most often the person
                  tapped the link twice, or joined on the app first. Telling them
                  the invite expired or is invalid would be plainly wrong.
                  Mirrors the mobile PendingInvitesScreen link banners. */}
              <h1 className="serif m-0 text-xl text-ink text-balance">
                {isAlreadyUsed ? t('errorUsed.title') : t('error.title')}
              </h1>
              <p className="m-0 text-sm text-ink-2 text-balance">
                {isAlreadyUsed ? t('errorUsed.suggestion') : t('error.suggestion')}
              </p>
            </div>
            <DownloadButtons prompt={t('downloadPromptError')} />
            <p className="m-0 text-center text-sm text-ink-3 text-balance">{t('appDescription')}</p>
          </>
        )}

        {invite && (
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              <h1 className="serif m-0 text-xl text-ink text-balance">
                {t('title', {
                  inviterName: invite.invited_by_name,
                  recipientName: invite.circle.recipient_name,
                })}
              </h1>
              <p className="m-0 text-sm text-ink-2">
                <span className="eyebrow">{t('circleLabel')}</span>{' '}
                <span className="block text-base text-ink">{invite.circle.name}</span>
              </p>
              <Badge variant={roleBadgeVariant[invite.member_type] ?? 'neutral'}>
                {t(`roles.${invite.member_type}`)}
              </Badge>
            </div>

            {!isBootstrapping && (
              <div className="flex flex-col items-center gap-3">
                {isAuthenticated ? (
                  <Button
                    className="w-full max-w-xs"
                    onClick={handleAccept}
                    disabled={accept.isPending}
                  >
                    {accept.isPending ? t('accepting') : t('accept')}
                  </Button>
                ) : (
                  <>
                    <Button className="w-full max-w-xs" onClick={handleCreateAccount}>
                      {t('createAccountToAccept')}
                    </Button>
                    <Button variant="ghost" className="w-full max-w-xs" onClick={handleSignIn}>
                      {t('signInInstead')}
                    </Button>
                  </>
                )}
                {acceptError ? (
                  <p role="alert" className="m-0 text-sm text-terracotta-deep text-balance">
                    {acceptError}
                  </p>
                ) : null}
              </div>
            )}

            <DownloadButtons prompt={t('downloadPromptValid')} />

            <div className="flex flex-col items-center gap-2 border-t border-line-2 pt-4">
              <p className="m-0 text-sm text-ink-2">
                {t('codeLabel')} <span className="font-mono font-semibold text-ink">{displayCode}</span>
              </p>
              <Button variant="ghost" onClick={() => void handleCopy()}>
                {copied ? t('copied') : t('copyCode')}
              </Button>
              {copyFailed ? (
                <p role="status" className="m-0 text-sm text-ink-3 text-balance">
                  {t('copyFailed')}
                </p>
              ) : null}
              {/* Announce copy success to screen readers */}
              <span aria-live="polite" className="sr-only">
                {copied ? t('codeCopied') : ''}
              </span>
            </div>

            <p className="m-0 text-center text-sm text-ink-3 text-balance">{t('appDescription')}</p>
          </>
        )}
      </Card>
    </main>
  );
}
