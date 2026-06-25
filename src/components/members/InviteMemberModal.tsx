import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { InviteMemberType } from '@/api/invites';
import { useCreateInvite } from '@/hooks/useInvites';
import { Analytics } from '@/lib/analytics';
import { isWebBillingConfigured } from '@/lib/purchases';
import {
  Button,
  Modal,
  RadioGroup,
  TextField,
  useToast,
  validateWithZod,
  focusFirstError,
  type FieldErrors,
  type RadioOption,
} from '@/components/ui';

// Owner-only "invite a member" form — EMAIL-required. The owner enters the
// invitee's email and role; the backend emails them a link to join this care
// circle.
//
// MIRRORS mobile/src/screens/circle/InviteMemberScreen.tsx. The free-tier
// caregiver cap (≥2 caregivers) returns 402 SUBSCRIPTION_REQUIRED — the hook
// already classifies it and toasts; we additionally surface a persistent in-modal
// note so the user understands why the invite did not send.
//
// Build ONLY on Stage 0 primitives (Modal, TextField, RadioGroup, Button,
// validateWithZod) + design tokens. No off-palette Tailwind.

const emailSchema = z.string().trim().email();

export interface InviteMemberModalProps {
  circleId: string;
  /** Hide the care_recipient option — the owner is already the recipient. */
  isSelfCare: boolean;
  onClose: () => void;
  /** Called after a successful invite (parent typically refetches members). */
  onInvited?: () => void;
}

export function InviteMemberModal({
  circleId,
  isSelfCare,
  onClose,
  onInvited,
}: InviteMemberModalProps): ReactElement {
  const { t } = useTranslation('members');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createInvite = useCreateInvite(circleId);

  const [email, setEmail] = useState('');
  const [memberType, setMemberType] = useState<InviteMemberType>('caregiver');
  const [errors, setErrors] = useState<FieldErrors>({});
  // A 402 is shown as a toast by the hook, but we also keep a persistent
  // in-modal note so the user understands the invite did not send.
  const [capReached, setCapReached] = useState(false);

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

  const handleSubmit = (formEvent: FormEvent): void => {
    formEvent.preventDefault();
    setCapReached(false);
    const trimmed = email.trim();
    const result = validateWithZod(emailSchema, trimmed);
    if (!result.success) {
      const fieldErrors: FieldErrors = { 'invite-email': t('invite.errors.emailInvalid') };
      setErrors(fieldErrors);
      focusFirstError(fieldErrors, ['invite-email']);
      return;
    }
    setErrors({});

    createInvite.mutate(
      { email: result.data, member_type: memberType },
      {
        onSuccess: () => {
          showToast(t('invite.success', { email: result.data }), 'success');
          onInvited?.();
          onClose();
        },
        onError: (error: unknown) => {
          const code = (error as { error?: { code?: string } } | null)?.error?.code;
          if (code === 'SUBSCRIPTION_REQUIRED' || code === 'PAYMENT_REQUIRED') {
            setCapReached(true);
          }
        },
      }
    );
  };

  return (
    <Modal
      title={t('invite.title')}
      onClose={onClose}
      closeLabel={t('common:close')}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={createInvite.isPending}>
            {t('common:cancel')}
          </Button>
          <Button
            type="submit"
            form="invite-member-form"
            disabled={createInvite.isPending || email.trim().length === 0}
          >
            {createInvite.isPending ? t('invite.sending') : t('invite.send')}
          </Button>
        </div>
      }
    >
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

        {capReached ? (
          <div
            role="alert"
            className="m-0 flex flex-col items-start gap-3 rounded-xl border border-line bg-bg-2 px-4 py-3 text-sm text-ink-2"
          >
            <p className="m-0">{t('invite.capReached')}</p>
            {isWebBillingConfigured() ? (
              <Button size="sm" onClick={() => navigate('/upgrade')}>
                {t('common:upgradeGate.action')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
