import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Modal, Text, useToast } from '@/components/ui';
import { OtpInput, type OtpInputHandle } from '@/components/auth/OtpInput';
import { getApiError } from '@/api/auth';
import { useLookupInviteByCode, useAcceptInviteByCode } from '@/hooks/useJoinCircle';
import { extractJoinCode, isCompleteJoinCode } from '@/lib/joinCode';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';
import { Analytics } from '@/lib/analytics';
import type { InviteByCode } from '@/api/invites';

// Web port of mobile/src/components/JoinCircleModal.tsx — the two-step
// join-by-code flow for an already-authenticated user:
//   1. Enter an invite code (six-box OtpInput, alphanumeric) → look it up
//      (GET /invites/code/:code)
//   2. Preview the circle (name / caring for / invited by + joining-as role)
//      → confirm (POST /invites/code/:code/accept)
// On success the circle list is invalidated (by useAcceptInviteByCode) and the
// caller navigates to the joined circle via onJoined.
//
// PRIVACY: the invite code is user-entered and grants circle access — it is
// never logged or sent to analytics from here.
//
// R4-2 (docs/plans/condition-tags.md Round 4): the code field auto-uppercases
// and strips spaces/dashes on type AND paste (OtpInput's alphanumeric mode),
// submit enables at exactly 6 normalized chars, and — when the browser
// exposes navigator.clipboard.readText — a "Paste code" button reads the
// clipboard ON CLICK ONLY (never automatically) and fills the field when the
// clipboard holds exactly a 6-char alphanumeric code. Clipboard permission
// denials are swallowed silently (no toast, no error state).

export interface JoinCircleModalProps {
  onClose: () => void;
  /** Called after a successful join with the joined circle's id. */
  onJoined: (circleId: string) => void;
}

/** Display name for the inviter — full name when known, else the email. */
function inviterName(invite: InviteByCode): string {
  const { first_name, last_name, email } = invite.invited_by;
  // TRIM BEFORE THE TRUTHINESS TEST — ' ' is truthy, takes the name branch,
  // then `.trim()`s to '' and renders a blank inviter.
  const firstName = first_name?.trim();
  if (firstName) return `${firstName} ${last_name?.trim() ?? ''}`.trim();
  return email;
}

/**
 * Most circles are named after the person being cared for, so the circle name
 * and the recipient name are frequently identical. When they are, showing both
 * the "Circle" and "Caring for" rows is pure repetition — collapse to one.
 */
function circleNameIsDistinct(invite: InviteByCode): boolean {
  const name = invite.circle.name?.trim().toLowerCase() ?? '';
  const recipient = invite.circle.recipient_name?.trim().toLowerCase() ?? '';
  return name.length > 0 && name !== recipient;
}

/**
 * Backend error code → invite-modal copy.
 *
 * ONE switch for both steps (look-up and accept), mirroring
 * mobile/src/components/JoinCircleModal.tsx: a code that only one endpoint
 * raises today costs nothing here, and every code missing from it silently
 * becomes "we couldn't find that invite code" — a lie for the archived and
 * care-recipient cases, which sends the invitee hunting for a typo that does
 * not exist. Unrecognised codes fall through to the caller's own `fallback`.
 *
 * Every key is a LITERAL so the static translation-key audit
 * (src/i18n/__tests__) can resolve it; a `KEYS[code]` table would make all of
 * them unverifiable at once.
 */
function joinErrorMessage(
  t: (key: string) => string,
  code: string | undefined,
  fallback: string
): string {
  switch (code) {
    case 'INVITE_EXPIRED':
      return t('joinModal.expired');
    case 'INVITE_ALREADY_USED':
      return t('joinModal.alreadyUsed');
    case 'ALREADY_MEMBER':
      return t('joinModal.alreadyMember');
    // The circle was archived (deleted by its owner) AFTER the invite was sent.
    // Raised by the look-up, the preview and both accepts — the code is
    // perfectly valid, so "double-check it" is the wrong thing to say.
    case 'CIRCLE_ARCHIVED':
      return t('joinModal.circleArchived');
    // A second care-recipient invite into a circle that already has one. A
    // partial unique index backstops it, so it arrives as a 400 from accept.
    case 'CARE_RECIPIENT_EXISTS':
      return t('joinModal.careRecipientExists');
    default:
      return fallback;
  }
}

export function JoinCircleModal({ onClose, onJoined }: JoinCircleModalProps): ReactElement {
  const { t } = useTranslation('circles');
  const { showToast } = useToast();

  const [code, setCode] = useState('');
  const [invite, setInvite] = useState<InviteByCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "We didn't find a code" hint after a Paste-code click with non-code content.
  const [pasteMiss, setPasteMiss] = useState(false);

  // OtpInput's own `autoFocus` (below) is dead inside Modal — the shell always
  // claims initial focus for its close button. `initialFocusRef` on the Modal
  // (further down) is how the first code box wins that race instead.
  const codeFieldRef = useRef<OtpInputHandle>(null);

  const lookup = useLookupInviteByCode();
  const accept = useAcceptInviteByCode();

  // Clipboard read is feature-detected: no readText → no button at all.
  const clipboardAvailable =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  const handlePasteFromClipboard = async (): Promise<void> => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Permission denied / unavailable — ignore silently (no error toast).
      return;
    }
    const extracted = extractJoinCode(text);
    if (extracted) {
      setCode(extracted);
      setError(null);
      setPasteMiss(false);
    } else {
      setPasteMiss(true);
    }
  };

  const handleLookup = (event: FormEvent): void => {
    event.preventDefault();
    if (!isCompleteJoinCode(code)) return;
    setError(null);
    lookup.mutate(code, {
      onSuccess: (found) => setInvite(found),
      onError: (err) => {
        setError(joinErrorMessage(t, getApiError(err)?.code, t('joinModal.invalidCode')));
      },
    });
  };

  const handleAccept = (): void => {
    if (!invite) return;
    setError(null);
    accept.mutate(code, {
      onSuccess: () => {
        // WB4: the code-entry join path fired no invite_accepted event —
        // the join-by-link path already does (InviteLandingPage). PHI-safe:
        // only the circle_id + a source enum, never the code itself.
        Analytics.inviteAccepted(invite.circle.id, 'code_entry');
        // R4-5: joined their first circle here → onboarding complete. No-op
        // when this browser already saw the user with circles. Carries no code.
        trackOnboardingCompleted('joined');
        showToast(t('joinModal.youveJoined', { circleName: invite.circle.name }), 'success');
        onClose();
        onJoined(invite.circle.id);
      },
      onError: (err) => {
        setError(joinErrorMessage(t, getApiError(err)?.code, t('joinModal.joinFailed')));
      },
    });
  };

  const handleReset = (): void => {
    setInvite(null);
    setError(null);
  };

  return (
    <Modal
      title={t('joinModal.title')}
      onClose={onClose}
      closeLabel={t('joinModal.close')}
      initialFocusRef={codeFieldRef}
      size="sm"
      footer={
        !invite ? (
          <div className="flex flex-col gap-2">
            <Button type="button" variant="secondary" size="lg" className="w-full" onClick={onClose}>
              {t('joinModal.cancel')}
            </Button>
            <Button
              type="submit"
              form="join-circle-code-form"
              size="lg"
              className="w-full"
              loading={lookup.isPending}
              disabled={!isCompleteJoinCode(code)}
            >
              {lookup.isPending ? t('joinModal.lookingUp') : t('joinModal.lookUpCode')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={handleReset}
              disabled={accept.isPending}
            >
              {t('joinModal.enterDifferentCode')}
            </Button>
            <Button size="lg" className="w-full" loading={accept.isPending} onClick={handleAccept}>
              {accept.isPending ? t('joinModal.joining') : t('joinModal.joinCircle')}
            </Button>
          </div>
        )
      }
    >
      {!invite ? (
        <>
          <Text variant="label" as="p">{t('joinModal.codeLabel')}</Text>
          <p className="m-0 text-sm text-ink-3">{t('joinModal.subtitle')}</p>

          {error ? (
            <p
              role="alert"
              className="m-0 rounded-xl bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
            >
              {error}
            </p>
          ) : null}

          <form
            id="join-circle-code-form"
            onSubmit={handleLookup}
            className="flex flex-col gap-4"
          >
            <OtpInput
              ref={codeFieldRef}
              alphanumeric
              value={code}
              onChange={(next) => {
                setCode(next);
                setError(null);
                setPasteMiss(false);
              }}
              label={t('joinModal.codeLabel')}
            />
            {clipboardAvailable && (
              <div className="flex flex-col items-start gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handlePasteFromClipboard()}
                >
                  {t('joinModal.pasteCode')}
                </Button>
                {/* Polite inline miss hint — never a toast, never an error state. */}
                <p role="status" aria-live="polite" className="m-0 text-sm text-ink-3">
                  {pasteMiss ? t('joinModal.pasteNoCode') : ''}
                </p>
              </div>
            )}
          </form>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          {error ? (
            <p
              role="alert"
              className="m-0 rounded-xl bg-terracotta/10 px-4 py-3 text-sm text-terracotta-deep"
            >
              {error}
            </p>
          ) : null}
          <Card variant="filled" className="flex flex-col gap-3 p-4">
            {circleNameIsDistinct(invite) ? (
              <div>
                <Text variant="label" as="p">{t('joinModal.circle')}</Text>
                <Text variant="h2" as="p">
                  {invite.circle.name}
                </Text>
              </div>
            ) : null}
            <div
              className={circleNameIsDistinct(invite) ? 'border-t border-line-2 pt-3' : undefined}
            >
              <Text variant="label" as="p">{t('joinModal.caringFor')}</Text>
              <p className="m-0 font-medium text-ink">{invite.circle.recipient_name}</p>
            </div>
            <div className="border-t border-line-2 pt-3">
              <Text variant="label" as="p">{t('joinModal.invitedBy')}</Text>
              <p className="m-0 font-medium text-ink">{inviterName(invite)}</p>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line-2 pt-3">
              <Text variant="label" as="p">{t('joinModal.yourRole')}</Text>
              <Badge variant={invite.member_type === 'care_recipient' ? 'coral' : 'default'}>
                {invite.member_type === 'care_recipient'
                  ? t('joinModal.roleCareRecipient')
                  : t('joinModal.roleCaregiver')}
              </Badge>
            </div>
          </Card>
        </div>
      )}
    </Modal>
  );
}
