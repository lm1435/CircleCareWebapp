import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Skeleton } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { previewInviteByCode, type InviteMemberType } from '@/api/invites';

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
  // Backend normalizes too; normalize here so the displayed fallback code
  // matches what the app expects users to type.
  const displayCode = code.trim().toUpperCase();

  const { data: invite, isPending, isError } = useQuery({
    queryKey: ['invitePreview', code],
    queryFn: () => previewInviteByCode(code),
    enabled: code.length > 0,
    retry: false, // 404/400 are definitive; endpoint is rate-limited
    staleTime: Infinity,
  });

  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    },
    []
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — the code is
      // visible on screen, so the user can still copy it manually.
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
              <h1 className="serif m-0 text-xl text-ink text-balance">{t('error.title')}</h1>
              <p className="m-0 text-sm text-ink-2 text-balance">{t('error.suggestion')}</p>
            </div>
            <DownloadButtons prompt={t('downloadPrompt')} />
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

            <DownloadButtons prompt={t('downloadPrompt')} />

            <div className="flex flex-col items-center gap-2 border-t border-line-2 pt-4">
              <p className="m-0 text-sm text-ink-2">
                {t('codeLabel')} <span className="font-mono font-semibold text-ink">{displayCode}</span>
              </p>
              <Button variant="ghost" onClick={() => void handleCopy()}>
                {copied ? t('copied') : t('copyCode')}
              </Button>
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
