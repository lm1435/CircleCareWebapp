import { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Eyebrow,
  Skeleton,
  Text,
  useToast,
} from '@/components/ui';
import { usePendingInvites, useAcceptInvite, useDeclineInvite } from '@/hooks/useInvites';
import { readDeclineError, type DeclineErrorReading } from '@/lib/inviteDecline';
import { blockOfflineWrite } from '@/lib/offlineWrite';
import { useOpenJoinedCircle } from '@/hooks/useOpenJoinedCircle';
import type { PendingInvite } from '@/api/invites';
import { formatInviteExpiryDate } from '@/lib/inviteExpiry';
import { Analytics } from '@/lib/analytics';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';
import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';

// Task 5.5 — list the current user's pending invites with Accept.
//
// MIRRORS mobile/src/screens/invite/PendingInvitesScreen.tsx: Accept, and (1.4.3)
// Decline through POST /invites/:id/decline with an in-page confirm dialog
// (docs/plans/invite-decline-1-4-3.md).
//
// Built on Stage 0 primitives (Card, Button, Badge, EmptyState, Skeleton) +
// design tokens. Owner gating is not relevant here — these are invites
// addressed TO the current user.

function inviterName(invite: PendingInvite): string {
  const { first_name, last_name, email } = invite.invited_by;
  // TRIM BEFORE `filter(Boolean)` — ' ' is truthy, so an untrimmed filter keeps
  // it and joins to a blank (or space-padded) name that renders as no name.
  const name = [first_name, last_name]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  return name || email;
}

function InviteRowSkeleton(): ReactElement {
  return (
    <Card as="li" variant="outlined" padding="lg" className="flex flex-col gap-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-11 w-28 rounded-full" />
    </Card>
  );
}

export default function PendingInvitesPage(): ReactElement {
  const { t, i18n } = useTranslation('members');
  const openJoinedCircle = useOpenJoinedCircle();
  const { data: invites, isPending, isError, refetch } = usePendingInvites();
  const acceptInvite = useAcceptInvite();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const declineInvite = useDeclineInvite();
  const { showToast } = useToast();
  // The invite whose decline confirm is open.
  const [inviteToDecline, setInviteToDecline] = useState<PendingInvite | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);

  // Static keys (the translation-key audit cannot follow a template literal).
  const declineErrorCopy = (key: DeclineErrorReading['messageKey']): string => {
    switch (key) {
      case 'declineErrorUsed':
        return t('pending.declineErrorUsed');
      case 'declineErrorInactive':
        return t('pending.declineErrorInactive');
      case 'declineErrorExpired':
        return t('pending.declineErrorExpired');
      case 'declineErrorRateLimit':
        return t('pending.declineErrorRateLimit');
      default:
        return t('pending.declineErrorGeneric');
    }
  };

  const openDecline = (invite: PendingInvite): void => {
    if (blockOfflineWrite('change')) return;
    if (decliningId) return;
    Analytics.inviteDeclineTapped(invite.member_type === 'care_recipient' ? 'care_recipient' : 'caregiver');
    setInviteToDecline(invite);
  };

  const handleDecline = (): void => {
    const invite = inviteToDecline;
    // Guard in-handler: `disabled` lands a render later, so a double click would
    // otherwise send two declines.
    if (!invite || decliningId) return;
    const memberType = invite.member_type === 'care_recipient' ? 'care_recipient' : 'caregiver';
    setDecliningId(invite.id);
    declineInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: (result) => {
          Analytics.inviteDeclineConfirmed(memberType, result?.already_declined === true);
          showToast(t('pending.declineSuccess'), 'success');
          setDecliningId(null);
          setInviteToDecline(null);
        },
        onError: (error) => {
          const reading = readDeclineError(error);
          Analytics.inviteDeclineFailed(reading.code);
          showToast(declineErrorCopy(reading.messageKey), 'error');
          setDecliningId(null);
          setInviteToDecline(null);
        },
      }
    );
  };

  const handleAccept = (invite: PendingInvite): void => {
    setAcceptingId(invite.id);
    acceptInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: (result) => {
          // PHI-safe: only the circle_id (available here; the hook takes only an
          // inviteId, so the capture lives at the call site). WB4: explicit
          // source distinguishes this list from the join-by-code modal and the
          // public invite landing page.
          Analytics.inviteAccepted(invite.circle.id, 'in_app');
          // R4-5: joined their first circle here → onboarding complete. No-op
          // when this browser already saw the user with circles.
          trackOnboardingCompleted('joined');
          setAcceptingId(null);
          // Open the joined circle and name it — parity with mobile's
          // PendingInvitesScreen (navigates straight into the circle) and with
          // the invite link / join-by-code paths. The response names the circle
          // joined; the listed invite is the fallback for `circle: null`.
          openJoinedCircle(result.circle ?? invite.circle, {
            inviterName: invite.invited_by.first_name,
            recipientName: invite.circle.recipient_name,
            viewOnly: result.view_only,
            memberType: invite.member_type,
          });
        },
        onError: () => {
          // The hook's shared onError already toasts the failure.
          setAcceptingId(null);
        },
      }
    );
  };

  let content: ReactElement;
  if (isPending) {
    content = (
      <ul
        aria-busy="true"
        aria-label={t('common:loading')}
        className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2"
      >
        <InviteRowSkeleton />
        <InviteRowSkeleton />
      </ul>
    );
  } else if (isError) {
    content = (
      <Card role="alert" className="mt-6 max-w-lg p-8 text-center">
        <Text variant="h2" as="h2">
          {t('pending.errorTitle')}
        </Text>
        <p className="mt-2 text-ink-2">{t('pending.errorBody')}</p>
        <Button className="mt-6" onClick={() => void refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (!invites || invites.length === 0) {
    content = (
      <div className="mt-6">
        <EmptyState
          icon="mail-outline"
          title={t('pending.emptyTitle')}
          description={t('pending.emptyBody')}
          actions={<HowDoesThisWork slug="join-a-circle" />}
        />
      </div>
    );
  } else {
    // ONE ACCENT (owner 2026-11-08, mobile parity): only the first invite that can still be accepted
    // gets the filled Accept; later ones are the moss outline. An unparseable expiry counts as live.
    const nowMs = Date.now();
    const firstAcceptId = invites.find((invite) => {
      const at = invite.expires_at ? Date.parse(invite.expires_at) : NaN;
      return Number.isNaN(at) || at > nowMs;
    })?.id;
    content = (
      <ul className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {invites.map((invite) => {
          const expiresOn = formatInviteExpiryDate(invite.expires_at, i18n.language);
          return (
            <Card as="li" key={invite.id} variant="outlined" padding="lg" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="m-0 font-medium text-ink">
                  {invite.member_type === 'care_recipient'
                    ? t('pending.invitedYouRecipient', { inviter: inviterName(invite) })
                    : t('pending.invitedYou', {
                        inviter: inviterName(invite),
                        recipient: invite.circle.recipient_name,
                      })}
                </p>
                <p className="m-0 text-sm text-ink-3">
                  <Eyebrow>{t('invite.circleLabel')}</Eyebrow>{' '}
                  {invite.member_type === 'care_recipient'
                    ? t('pending.yourCareCircle')
                    : invite.circle.name}
                </p>
                <Badge variant={invite.member_type === 'caregiver' ? 'primary' : 'coral'}>
                  {t(`roles.${invite.member_type === 'caregiver' ? 'caregiver' : 'careRecipient'}`)}
                </Badge>
                {/* Deadline — parity with mobile's invite preview. `expires_at`
                    is a real instant, so the reader's own locale is the right
                    formatter. Omitted entirely when it is missing or
                    unparseable, never rendered as "Invalid Date". */}
                {expiresOn ? (
                  <p className="m-0 text-sm text-ink-3">
                    <Eyebrow>{t('pending.expiresLabel')}</Eyebrow> {expiresOn}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={invite.id === firstAcceptId ? 'primary' : 'outline'}
                  onClick={() => handleAccept(invite)}
                  offlineKind="change"
                  disabled={acceptInvite.isPending && acceptingId === invite.id}
                >
                  {acceptInvite.isPending && acceptingId === invite.id
                    ? t('pending.accepting')
                    : t('pending.accept')}
                </Button>
                {/* Quiet (ghost): one accent per page, and saying no must never
                    look like the suggested action. Mobile order differs only by
                    layout (side-by-side cells); the actions are the same. */}
                <Button
                  variant="ghost"
                  onClick={() => openDecline(invite)}
                  offlineKind="change"
                  disabled={decliningId === invite.id || (acceptInvite.isPending && acceptingId === invite.id)}
                  aria-label={t('pending.declineLabel', {
                    name:
                      invite.member_type === 'care_recipient'
                        ? t('pending.yourCareCircle')
                        : invite.circle.name,
                  })}
                >
                  {decliningId === invite.id ? t('pending.declining') : t('pending.decline')}
                </Button>
              </div>
            </Card>
          );
        })}
      </ul>
    );
  }

  const hasInvites = !isPending && !isError && invites != null && invites.length > 0;

  return (
    <section className="mx-auto w-full max-w-4xl p-8">
      <Text variant="pageTitle">
        {t('pending.heading')}
      </Text>
      <Text variant="pageSubtitle" className="mt-1">
        {t('pending.subheading')}
      </Text>
      {content}
      {hasInvites ? <p className="mt-6 text-sm text-ink-3">{t('pending.ignoreHint')}</p> : null}
      {inviteToDecline ? (
        <ConfirmDialog
          offlineKind="change"
          icon="mail-outline"
          title={t('pending.declineTitle')}
          message={t('pending.declineMessage', { inviter: inviterName(inviteToDecline) })}
          confirmLabel={t('pending.decline')}
          cancelLabel={t('pending.declineKeep')}
          destructive
          confirmDisabled={decliningId != null}
          onConfirm={handleDecline}
          onCancel={() => setInviteToDecline(null)}
        />
      ) : null}
    </section>
  );
}
