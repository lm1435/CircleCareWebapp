import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Eyebrow, Skeleton, Text, useToast } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { previewInviteByCode, type InviteMemberType } from '@/api/invites';
import { getApiError } from '@/api/auth';
import { formatInviteExpiryDate } from '@/lib/inviteExpiry';
import { useAuth } from '@/hooks/useAuth';
import { useAcceptInviteByCode } from '@/hooks/useJoinCircle';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { consumePendingInviteCode, setPendingInviteCode } from '@/lib/pendingInviteCode';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';
import { Analytics } from '@/lib/analytics';

// Invite-link sharing is SHIPPED: the mobile app's InviteMemberScreen shows
// Share/Copy actions on the inline success panel after an invite is created,
// and POST /circles/:id/invites returns `invite_url` pointing here. (An earlier
// version of this comment said those buttons were "commented out" in
// InviteMemberScreen.tsx — they had actually been deleted, and are now back.)
//
// ⚠️ STILL OPEN: deferred deep-linking, so a visitor who installs from this page
// auto-joins the circle instead of typing the code shown below. Until then the
// displayed code is the fallback for a fresh install.
// Store listing URLs are live (see src/lib/storeLinks.ts).

const COPIED_FEEDBACK_MS = 2000;

const roleBadgeVariant: Record<InviteMemberType, 'primary' | 'coral'> = {
  caregiver: 'primary',
  care_recipient: 'coral',
};

function DownloadButtons({ prompt }: { prompt: string }): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3">
      <Eyebrow as="p" className="text-center">
        {prompt}
      </Eyebrow>
      <StoreBadges layout="stack" className="w-full max-w-xs" />
    </div>
  );
}

/** Heading + body for the dead-end state, chosen by the preview's error CODE. */
interface PreviewErrorCopy {
  title: string;
  suggestion: string;
}

/**
 * Backend error code → landing-page dead-end copy.
 *
 * Mirrors the code table mobile keys off (JoinCircleModal /
 * authErrorMessages.ts). Every key is a LITERAL — a `t(\`${section}.title\`)`
 * template would be a dynamic key, which the static translation-key audit
 * cannot resolve (and whose skipped-key count it asserts).
 *
 * Unrecognised codes — INVALID_CODE, INVITE_EXPIRED, SERVER_ERROR, a network
 * failure — keep the original "expired or invalid" state untouched.
 */
function previewErrorCopy(t: (key: string) => string, code: string | undefined): PreviewErrorCopy {
  switch (code) {
    // The most common failure: the person tapped the link twice, or joined in
    // the app first. "Expired or invalid" would be plainly wrong.
    case 'INVITE_ALREADY_USED':
      return { title: t('errorUsed.title'), suggestion: t('errorUsed.suggestion') };
    // The owner deleted the circle after sending the invite. The code is
    // perfectly valid, so telling them to double-check it sends them hunting
    // for a typo that does not exist.
    case 'CIRCLE_ARCHIVED':
      return { title: t('errorArchived.title'), suggestion: t('errorArchived.suggestion') };
    // A second care-recipient invite into a circle that already has one.
    case 'CARE_RECIPIENT_EXISTS':
      return {
        title: t('errorRecipientExists.title'),
        suggestion: t('errorRecipientExists.suggestion'),
      };
    default:
      return { title: t('error.title'), suggestion: t('error.suggestion') };
  }
}

/**
 * Backend error code → copy for a failed ACCEPT (the visitor was signed in and
 * pressed "Accept invitation"). Same codes as the preview, different shape: a
 * single inline line under the button rather than a whole dead-end card.
 */
function acceptErrorMessage(t: (key: string) => string, code: string | undefined): string {
  switch (code) {
    // Two of the codes the API documents for accept that this switch used to
    // drop on the floor. (ALREADY_MEMBER is deliberately NOT here: it is
    // intercepted in `onError` above and navigates to /circles, because being
    // already in the circle is a success from the visitor's point of view.) `acceptFailed` is "something went wrong, try again", which is
    // actively misleading for an expired or spent invite: retrying cannot help,
    // and the visitor needs to know to ask for a new link. JoinCircleModal has
    // handled all three since it shipped — this path had simply drifted.
    case 'INVITE_EXPIRED':
      return t('acceptExpired');
    case 'INVITE_ALREADY_USED':
      return t('acceptAlreadyUsed');
    case 'CIRCLE_ARCHIVED':
      return t('acceptArchived');
    case 'CARE_RECIPIENT_EXISTS':
      return t('acceptRecipientExists');
    default:
      return t('acceptFailed');
  }
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
  const acceptGuard = useSubmitGuard();
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

  // The api client unwraps errors — the code lives at err.error.code, which is
  // exactly what `getApiError` reads (never err.response.data.error.code).
  const errorCopy = previewErrorCopy(t, getApiError(error)?.code);

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
  //
  // `disabled={accept.isPending}` on the button is the VISUAL guard and lands a
  // render too late to stop a second press in the same tick (see
  // `useGuardedSubmit`); POST /invites/code/:code/accept is rate-limited twice
  // over (`inviteGuessRateLimit` per IP + `inviteRedeemRateLimit` per user) and
  // the second call resolves to ALREADY_MEMBER, which this handler treats as a
  // redirect — so a double press could bounce the visitor to /circles out from
  // under the success toast.
  //
  // ONE HANDLER FOR BOTH ENTRY POINTS, SETTLED ON THE PROMISE — NOT ON
  // `mutate(code, { onSuccess })`. The sign-in handoff below calls this from a
  // MOUNT effect, and per-call mutate callbacks are delivered through the
  // component's MutationObserver only while it is still attached to the
  // mutation. StrictMode's mount double-invoke (and any real unmount/remount)
  // unsubscribes the observer between `mutate` and the response, and
  // `MutationObserver.onUnsubscribe` detaches it from the in-flight mutation for
  // good — so the accept landed (200, membership written, the hook-level circle
  // invalidation ran) but the toast and the navigation never did, leaving the
  // joiner on the invite card. `mutateAsync`'s promise is the mutation's own
  // and settles regardless of observers. Pending state is local for the same
  // reason: a detached observer's `isPending` never flips back.
  const [accepting, setAccepting] = useState(false);
  const acceptAsync = accept.mutateAsync;
  const handleAccept = useCallback(async (): Promise<void> => {
    if (!acceptGuard.claim()) return;
    setAcceptError(null);
    setAccepting(true);
    try {
      await acceptAsync(displayCode);
    } catch (err) {
      const errorCode = getApiError(err)?.code;
      if (errorCode === 'ALREADY_MEMBER') {
        navigate('/circles');
        return;
      }
      setAcceptError(acceptErrorMessage(t, errorCode));
      return;
    } finally {
      // Releases on every path. The success path navigates away just below,
      // where the release is harmless.
      setAccepting(false);
      acceptGuard.release();
    }
    // Success — outside the try, so a throw here can never be misreported as
    // a failed accept for a join that landed.
    //
    // R4-5: joined their first circle here → onboarding complete. No-op when
    // this browser already saw the user with circles ('existing' fired).
    // ALREADY_MEMBER rejects, so it never fires 'joined'. Carries only the path
    // enum — never the invite code.
    trackOnboardingCompleted('joined');
    // The accept funnel was previously unmeasured on BOTH platforms — 122
    // invites sent since January produced zero invite_accepted events, so there
    // was no way to tell a working join from a silently broken one.
    Analytics.inviteAccepted(undefined, 'invite_link');
    // Confirm the join — the circle picker we land on gives no feedback.
    showToast(t('acceptSuccess'), 'success');
    navigate('/circles');
  }, [acceptAsync, acceptGuard, displayCode, navigate, showToast, t]);

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
      void handleAccept();
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
  // THE INVITER'S NAME MAY BE ABSENT, AND THE FALLBACK IS OURS TO RENDER.
  //
  // `invited_by_name` is `string | null`. The backend sends null whenever the
  // inviter has no first_name — which is EVERY Apple/Google OAuth signup, so
  // this is a common path, not an edge case. It deliberately does not
  // substitute anything itself: the preview endpoint is unauthenticated and
  // carries no Accept-Language, so it can emit neither an English word (copy
  // shipped as data) nor the inviter's email local-part (personal data, and
  // this component would put it in a public, crawler-cached og:title).
  //
  // Rendering the fallback HERE is what keeps it translated — i18n also
  // silently coerces a null interpolation to '', which would otherwise leave
  // "  invited you to CircleCare".
  const inviterName = invite?.invited_by_name ?? t('inviterFallback');

  // `expires_at` is a real instant, so the reader's own locale/zone is the right
  // formatter — same call mobile's invite preview makes on the same field.
  const expiresOn = formatInviteExpiryDate(invite?.expires_at, i18n.language);

  const ogTitle = invite ? t('og.title', { inviterName }) : 'CircleCare';
  const ogDescription = invite
    ? t('og.description', {
        circleName: invite.circle.name,
        recipientName: invite.circle.recipient_name,
      })
    : t('appDescription');

  return (
    <AuthShell>
      <Helmet>
        <html lang={i18n.language} />
        <title>{ogTitle}</title>
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDescription} />
        <meta name="description" content={ogDescription} />
      </Helmet>

      <div className="flex flex-col gap-6">
        <AuthTopBar />

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
              {/* Each known failure gets its own words — "already used" (the
                  person tapped the link twice, or joined on the app first) and
                  "circle deleted" are both plainly NOT "expired or invalid",
                  and saying so sends the invitee hunting for a typo that does
                  not exist. See `previewErrorCopy`. */}
              <Text variant="h2" as="h1" className="text-balance">
                {errorCopy.title}
              </Text>
              <p className="m-0 text-sm text-ink-2 text-balance">{errorCopy.suggestion}</p>
            </div>
            <DownloadButtons prompt={t('downloadPromptError')} />
            <p className="m-0 text-center text-sm text-ink-3 text-balance">{t('appDescription')}</p>
          </>
        )}

        {invite && (
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              <Text variant="h2" as="h1" className="text-balance">
                {t('title', {
                  inviterName,
                  recipientName: invite.circle.recipient_name,
                })}
              </Text>
              <p className="m-0 text-sm text-ink-2">
                <Eyebrow as="span">{t('circleLabel')}</Eyebrow>{' '}
                <span className="block text-base text-ink">{invite.circle.name}</span>
              </p>
              <Badge variant={roleBadgeVariant[invite.member_type] ?? 'default'}>
                {t(`roles.${invite.member_type}`)}
              </Badge>
              {/* Deadline — parity with mobile's invite preview, which has shown
                  it since launch. Omitted entirely when the date is missing or
                  unparseable rather than rendering "Invalid Date" on an invite
                  that still works. */}
              {expiresOn ? (
                <p className="m-0 text-sm text-ink-3">
                  <Eyebrow as="span">{t('expiresLabel')}</Eyebrow> {expiresOn}
                </p>
              ) : null}
            </div>

            {!isBootstrapping && (
              <div className="flex flex-col items-center gap-3">
                {isAuthenticated ? (
                  <Button
                    className="w-full max-w-xs"
                    onClick={() => void handleAccept()}
                    disabled={accepting}
                  >
                    {accepting ? t('accepting') : t('accept')}
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
      </div>
    </AuthShell>
  );
}
