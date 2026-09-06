import { type ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, EmptyState, Eyebrow, Skeleton, Text, useToast } from '@/components/ui';
import { usePendingInvites, useAcceptInvite } from '@/hooks/useInvites';
import type { PendingInvite } from '@/api/invites';
import { formatInviteExpiryDate } from '@/lib/inviteExpiry';
import { Analytics } from '@/lib/analytics';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';

// Task 5.5 — list the current user's pending invites with Accept.
//
// MIRRORS mobile/src/screens/invite/PendingInvitesScreen.tsx. NOTE: there is NO
// decline endpoint (mobile's "Decline" is a client-only dismiss), so this page
// offers Accept only — no decline UI.
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
  const { showToast } = useToast();
  const { data: invites, isPending, isError, refetch } = usePendingInvites();
  const acceptInvite = useAcceptInvite();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  // The most recently joined circle — gives the user a forward path ("Open
  // circle") instead of leaving them stranded on this page after accepting.
  const [joined, setJoined] = useState<{ id: string; name: string } | null>(null);

  const handleAccept = (invite: PendingInvite): void => {
    setAcceptingId(invite.id);
    acceptInvite.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          // PHI-safe: only the circle_id (available here; the hook takes only an
          // inviteId, so the capture lives at the call site). WB4: explicit
          // source distinguishes this list from the join-by-code modal and the
          // public invite landing page.
          Analytics.inviteAccepted(invite.circle.id, 'in_app');
          // R4-5: joined their first circle here → onboarding complete. No-op
          // when this browser already saw the user with circles.
          trackOnboardingCompleted('joined');
          showToast(t('pending.accepted', { circle: invite.circle.name }), 'success');
          setJoined({ id: invite.circle.id, name: invite.circle.name });
          setAcceptingId(null);
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
        />
      </div>
    );
  } else {
    content = (
      <ul className="m-0 mt-6 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {invites.map((invite) => {
          const expiresOn = formatInviteExpiryDate(invite.expires_at, i18n.language);
          return (
            <Card as="li" key={invite.id} variant="outlined" padding="lg" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="m-0 font-medium text-ink">
                  {t('pending.invitedYou', {
                    inviter: inviterName(invite),
                    recipient: invite.circle.recipient_name,
                  })}
                </p>
                <p className="m-0 text-sm text-ink-3">
                  <Eyebrow>{t('invite.circleLabel')}</Eyebrow> {invite.circle.name}
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
              <div>
                <Button
                  onClick={() => handleAccept(invite)}
                  disabled={acceptInvite.isPending && acceptingId === invite.id}
                >
                  {acceptInvite.isPending && acceptingId === invite.id
                    ? t('pending.accepting')
                    : t('pending.accept')}
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
      <Text variant="h1">
        {t('pending.heading')}
      </Text>
      <p className="mt-2 text-ink-3">{t('pending.subheading')}</p>
      {joined ? (
        <Card
          role="status"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 p-6"
        >
          <p className="m-0 font-medium text-ink">
            {t('pending.accepted', { circle: joined.name })}
          </p>
          <Link
            to={`/circles/${joined.id}`}
            className="shrink-0 font-medium text-coral-deep underline-offset-4 hover:underline"
          >
            {t('pending.openCircle')}
          </Link>
        </Card>
      ) : null}
      {content}
      {hasInvites ? <p className="mt-6 text-sm text-ink-3">{t('pending.ignoreHint')}</p> : null}
    </section>
  );
}
