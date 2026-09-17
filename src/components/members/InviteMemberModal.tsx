import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { InviteMemberType } from '@/api/invites';
import { useCreateInvite } from '@/hooks/useInvites';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { Analytics } from '@/lib/analytics';
import { isWebBillingConfigured } from '@/lib/webBillingConfig';
import { getPendingInviteSeat, isSubscriptionRequiredError } from '@/lib/apiErrors';
import { withInviteLocale } from '@/utils/inviteShareUrl';
import {
  Button,
  Card,
  Icon,
  IconTile,
  Modal,
  RadioGroup,
  TextField,
  validateWithZod,
  fieldShell,
  focusFirstError,
  type FieldErrors,
  type RadioOption,
} from '@/components/ui';

// Owner-only "invite a member" form — EMAIL-required. The owner enters the
// invitee's email and role; the backend emails them a link to join this care
// circle.
//
// MIRRORS mobile/src/screens/circle/InviteMemberScreen.tsx. The free-tier
// caregiver cap returns 402 SUBSCRIPTION_REQUIRED — the hook already classifies
// it and toasts; we additionally surface a persistent in-modal note so the user
// understands why the invite did not send. The note reads the SAME
// `error.details.reason` the hook does, so a recoverable `pending_invite_seat`
// never leaves a paywall upsell sitting next to an "cancel that invite" toast.
//
// Build ONLY on Stage 0 primitives (Modal, TextField, RadioGroup, Button,
// validateWithZod) + design tokens. No off-palette Tailwind.

const emailSchema = z.string().trim().email();

/**
 * The persistent in-modal note shown after a 402. `cap` is the real paywall
 * (every caregiver seat is held by a member); `pendingSeat` is the recoverable
 * case where a still-pending invite to `email` is holding the last seat — the
 * note must NOT read as an upsell there, or it would contradict the toast.
 */
type CapNotice = { kind: 'cap' } | { kind: 'pendingSeat'; email: string | null };

export interface InviteMemberModalProps {
  circleId: string;
  /** Hide the care_recipient option — the owner is already the recipient. */
  isSelfCare: boolean;
  onClose: () => void;
  /** Called after a successful invite (parent typically refetches members). */
  onInvited?: () => void;
  /** Names for the share message. Optional — the message degrades gracefully. */
  circleName?: string;
  recipientName?: string;
}

export function InviteMemberModal({
  circleId,
  isSelfCare,
  onClose,
  onInvited,
  circleName,
  recipientName,
}: InviteMemberModalProps): ReactElement {
  const { t, i18n } = useTranslation('members');
  const navigate = useNavigate();
  const createInvite = useCreateInvite(circleId);
  // POST /circles/:id/invites sits on `inviteRateLimit` (10/hour per IP) and
  // sends a real email. `disabled={createInvite.isPending}` on the footer
  // button is the VISUAL guard only — it lands a render late, and implicit
  // form submission (Enter in the email field) never consults it anyway (see
  // `useGuardedSubmit`). A double fire spends two of the ten hourly invites
  // and answers the second with a pending-seat error for the invite the first
  // one just created.
  const submitGuard = useSubmitGuard();

  const [email, setEmail] = useState('');
  const [memberType, setMemberType] = useState<InviteMemberType>('caregiver');
  const [errors, setErrors] = useState<FieldErrors>({});
  // A 402 is shown as a toast by the hook, but we also keep a persistent
  // in-modal note so the user understands the invite did not send.
  const [capNotice, setCapNotice] = useState<CapNotice | null>(null);

  // Opening the invite modal is the start of the invite funnel.
  useEffect(() => {
    Analytics.inviteStarted(circleId);
  }, [circleId]);

  const roleOptions = useMemo<RadioOption[]>(() => {
    const options: RadioOption[] = [
      { value: 'caregiver', label: t('roles.caregiver'), hint: t('invite.roleHints.caregiver') },
    ];
    if (!isSelfCare) {
      options.push({
        value: 'care_recipient',
        label: t('roles.careRecipient'),
        hint: t('invite.roleHints.careRecipient'),
      });
    }
    return options;
  }, [isSelfCare, t]);

  // The role the invite was actually sent as, named for the confirmation line.
  // Reuses the same `roles.*` strings the picker renders, so the two can never
  // describe the same invite differently.
  const roleLabel =
    memberType === 'care_recipient' ? t('roles.careRecipient') : t('roles.caregiver');

  const [sentInvite, setSentInvite] = useState<{ email: string; url: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * THE ONE URL. Everything that surfaces the link — the selectable text on
   * screen, the clipboard, the share sheet — reads this and only this.
   *
   * Link-preview crawlers do not run JS, so the card an invite previews as is
   * whatever og:* tags are baked into the served HTML — English, for everyone.
   * A Spanish-speaking sender therefore texts an English card into a Spanish
   * conversation. `withInviteLocale` stamps `?lang=es` when THIS user's app
   * language is Spanish, and .htaccess answers that with the prerendered
   * Spanish document (index.es.html). English links are returned untouched, so
   * every invite link already in the wild stays byte-identical.
   *
   * Derived once rather than at each call site on purpose: display and copy
   * diverging — the user reads one link and pastes another — is the exact bug
   * this shape prevents.
   */
  const shareUrl = useMemo(
    () => (sentInvite?.url ? withInviteLocale(sentInvite.url, i18n.language) : null),
    [sentInvite?.url, i18n.language]
  );

  /**
   * The Web Share API opens the real OS share sheet — but only where it exists,
   * which in practice is iOS Safari and Android Chrome. That is exactly where
   * this matters (forwarding to Messages or WhatsApp), and exactly where the
   * desktop has no equivalent. So unlike mobile, COPY is the primary action here
   * and share is the enhancement.
   */
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /**
   * THE CIRCLE NAME IS NOT A GROUP NAME. Circles are commonly named after the
   * person being cared for ("Dad"), so the old template rendered "Join Dad on
   * CircleCare to help coordinate care for Dad." — it reads as though Dad is
   * the thing you join, and says his name twice. The sender is the one doing
   * the inviting, so the message speaks as them.
   *
   * Three variants, because "help coordinate care for X" is wrong in two cases:
   * a self-care circle (X is the sender), and an invite addressed to the care
   * recipient themselves (X is the reader). Kept in lockstep with
   * InviteMemberScreen on mobile — same three keys, same selection order.
   */
  const shareMessage = (inviteUrl: string): string =>
    memberType === 'care_recipient'
      ? t('invite.shareMessageRecipient', { inviteUrl })
      : isSelfCare
        ? t('invite.shareMessageSelfCare', { inviteUrl })
        : t('invite.shareMessage', {
            recipientName: recipientName ?? circleName ?? t('invite.shareTitle'),
            inviteUrl,
          });

  const handleShare = async (): Promise<void> => {
    if (!shareUrl) return;
    try {
      // Message only, exactly as mobile's `Share.share({ message })`. Safari
      // and Android both PREPEND `title` to the shared text, so the old
      // `{ title, text }` landed in Messages as two lines — "Join our care
      // circle" stacked over the real sentence — instead of the one sentence
      // the recipient gets from the app.
      await navigator.share({ text: shareMessage(shareUrl) });
      // navigator.share resolves on completion and REJECTS on cancel, so this
      // counts an actual share rather than an intent — unlike the mobile SDK,
      // which resolves either way.
      Analytics.inviteLinkShared(circleId, memberType);
    } catch {
      // User dismissed the sheet, or the browser refused to present it.
      // Nothing to recover from and nothing worth interrupting them over.
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      Analytics.inviteLinkCopied(circleId, memberType);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied outright (permissions policy, insecure
      // context). The link is on screen either way, so the user can select it.
    }
  };

  const handleSendAnother = (): void => {
    setSentInvite(null);
    setCopied(false);
    setEmail('');
    setErrors({});
  };

  const handleSubmit = (formEvent: FormEvent): void => {
    formEvent.preventDefault();
    setCapNotice(null);
    const trimmed = email.trim();
    const result = validateWithZod(emailSchema, trimmed);
    if (!result.success) {
      const fieldErrors: FieldErrors = { 'invite-email': t('invite.errors.emailInvalid') };
      setErrors(fieldErrors);
      focusFirstError(fieldErrors, ['invite-email']);
      return;
    }
    setErrors({});
    if (createInvite.isPending || !submitGuard.claim()) return;

    createInvite.mutate(
      { email: result.data, member_type: memberType },
      {
        onSuccess: (created) => {
          // The modal no longer closes here. Closing on success is what made
          // email the ONLY way an invite could reach anyone: the inviter never
          // saw the link, so they could not text it. Measured acceptance was
          // 13% (71 sent / 9 accepted).
          //
          // A backend older than the release that added `invite_url` sends
          // nothing, so fall back to building it from the code. Same origin as
          // this app by construction — the link points at our own landing page
          // — which also keeps staging correct without a second env var.
          const code = created?.invite?.invite_code;
          const url =
            created?.invite?.invite_url ??
            (code ? `${window.location.origin}/invite/${encodeURIComponent(code)}` : null);
          setSentInvite({ email: result.data, url });
          onInvited?.();
        },
        onError: (error: unknown) => {
          // Mirror the hook's classification EXACTLY: a pending-invite seat is
          // not a cap, so it must not leave a generic upsell on screen.
          const pendingSeat = getPendingInviteSeat(error);
          if (pendingSeat !== null) {
            setCapNotice({ kind: 'pendingSeat', email: pendingSeat.email });
          } else if (isSubscriptionRequiredError(error)) {
            setCapNotice({ kind: 'cap' });
          }
        },
        // This modal stays mounted on both outcomes (success swaps it to the
        // "invite sent" panel), so the guard is always released here.
        onSettled: () => submitGuard.release(),
      }
    );
  };

  return (
    <Modal
      title={t('invite.title')}
      onClose={onClose}
      closeLabel={t('common:close')}
      footer={
        sentInvite ? (
          // No Done — the Modal's × already closes it and there is no
          // unsaved state left to protect once the invite has sent. Send
          // another is the only footer action, ghost (not filled).
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={handleSendAnother}>
              {t('invite.sendAnother')}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose} disabled={createInvite.isPending}>
              {t('common:cancel')}
            </Button>
            <Button
              type="submit"
              form="invite-member-form"
              loading={createInvite.isPending}
              disabled={createInvite.isPending || email.trim().length === 0}
            >
              {createInvite.isPending ? t('invite.sending') : t('invite.send')}
            </Button>
          </div>
        )
      }
    >
      {sentInvite ? (
        <div className="flex flex-col gap-5">
          {/* The confirmation reads as a moment, not a status line: a moss
              check tile beside the headline, the same treatment the rest of
              the app gives a completed step. */}
          <div className="flex items-start gap-3">
            <IconTile tone="moss" size={44} name="checkmark-circle" />
            <div className="min-w-0">
              <p className="m-0 text-base font-semibold text-ink">{t('invite.sentTitle')}</p>
              <p className="m-0 mt-1 text-sm text-ink-2">
                {shareUrl ? t('invite.success') : t('invite.emailNote', { email: sentInvite.email, role: roleLabel })}
              </p>
            </div>
          </div>

          {shareUrl ? (
            <>
              {/* The link is rendered as selectable text as well as being
                  copyable: clipboard access can be denied outright (permissions
                  policy, insecure context) and the user still needs a way to
                  get the link out. It sits in a field shell, with Copy as the
                  one filled action — the thing to do next — and Share as the
                  quiet alternative where the browser offers it.

                  This renders `shareUrl`, NOT `sentInvite.url`: what is on
                  screen must be exactly what Copy and Share hand over,
                  `?lang=es` included. A user who selects the displayed text by
                  hand — the fallback for a denied clipboard — would otherwise
                  send a link that previews in the wrong language. */}
              <div className="flex flex-col gap-3">
                <p className={`${fieldShell()} m-0 break-all px-4 py-3 font-mono text-sm text-ink`}>
                  {shareUrl}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={handleCopy}
                    leftIcon={copied ? <Icon name="checkmark" size="row" /> : undefined}
                  >
                    {copied ? t('invite.linkCopied') : t('invite.copyLink')}
                  </Button>
                  {canShare ? (
                    <Button
                      variant="ghost"
                      onClick={handleShare}
                      leftIcon={<Icon name="share-outline" size="row" />}
                    >
                      {t('invite.shareLink')}
                    </Button>
                  ) : null}
                </div>
              </div>
              {/* The email is the RECEIPT, not the headline. Under the buttons
                  so the link stays the primary action, but it still names the
                  address and role — the sender's only confirmation they typed
                  the right thing. */}
              <p className="m-0 text-sm text-ink-2">
                {t('invite.emailNote', { email: sentInvite.email, role: roleLabel })}
              </p>
            </>
          ) : null}
        </div>
      ) : (
      <form id="invite-member-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <p className="m-0 text-sm text-ink-2">{t('invite.subtitle')}</p>

        {/* Self-care circles only ever have caregivers — hide the role picker
            entirely when there is a single option to choose. */}
        {roleOptions.length > 1 ? (
          <RadioGroup
            name="invite-role"
            label={t('invite.roleLabel')}
            options={roleOptions}
            value={memberType}
            onChange={(value) => setMemberType(value as InviteMemberType)}
            error={errors['invite-role'] || undefined}
          />
        ) : null}

        <TextField
          id="invite-email"
          type="email"
          autoComplete="email"
          label={t('invite.emailLabel')}
          placeholder={t('invite.emailPlaceholder')}
          value={email}
          onChange={(changeEvent) => {
            setEmail(changeEvent.target.value);
            if (errors['invite-email']) setErrors((prev) => ({ ...prev, 'invite-email': '' }));
          }}
          error={errors['invite-email'] || undefined}
        />

        {capNotice ? (
          <Card variant="filled" role="alert" className="flex flex-col items-start gap-3 text-sm">
            <div className="flex items-start gap-2">
              <Icon
                name="alert-circle-outline"
                size="inline"
                className="mt-0.5 shrink-0 text-terracotta"
              />
              <p className="m-0 text-ink-2">
                {capNotice.kind === 'cap'
                  ? t('invite.capReached')
                  : capNotice.email
                    ? t('invite.pendingSeat', { email: capNotice.email })
                    : t('invite.pendingSeatUnknown')}
              </p>
            </div>
            {/* The seat cap is the CAPACITY context — see lib/paywallContext.ts.
                Without the state, this entry point's conversions pool into
                'general' and the seat-cap paywall becomes unmeasurable. */}
            {isWebBillingConfigured() ? (
              <Button
                size="sm"
                onClick={() => navigate('/upgrade', { state: { paywallContext: 'capacity' } })}
              >
                {t('common:upgradeGate.action')}
              </Button>
            ) : null}
          </Card>
        ) : null}
      </form>
      )}
    </Modal>
  );
}
