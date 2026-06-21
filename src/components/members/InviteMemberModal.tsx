import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { InviteMemberType } from '@/api/invites';
import { useCreateInvite } from '@/hooks/useInvites';
import { Analytics } from '@/lib/analytics';
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

// Task 5.3 — owner-only "invite a member" form.
//
// MIRRORS mobile/src/screens/circle/InviteMemberScreen.tsx:
//   - email (required, validated) + member_type (caregiver default; the
//     care_recipient option is HIDDEN for self-care circles, where the owner IS
//     the recipient).
//   - POST /circles/:cid/invites via useCreateInvite. The free-tier caregiver
//     cap (≥2 caregivers) returns 402 SUBSCRIPTION_REQUIRED — the hook already
//     classifies it and shows the "open the app to upgrade" toast (web cannot
//     transact). We additionally surface a persistent in-modal note so the user
//     understands why the invite did not send.
//
// Build ONLY on Stage 0 primitives (Modal, TextField, RadioGroup, Button,
// useZodForm/validateWithZod) + design tokens. No off-palette Tailwind.

/** Mirror the backend email constraint (z.string().email()). */
const inviteFormSchema = z.object({
  email: z.string().trim().min(1).email(),
  member_type: z.enum(['caregiver', 'care_recipient']),
});

export interface InviteMemberModalProps {
  circleId: string;
  /** Hide the care_recipient option — the owner is already the recipient. */
  isSelfCare: boolean;
  onClose: () => void;
  /** Called after a successful invite (parent typically closes + toasts). */
  onInvited?: () => void;
}

/** Build the field-error map keyed by field id (Zod path → message). */
function toFieldErrors(t: (k: string) => string, errors: FieldErrors): FieldErrors {
  const mapped: FieldErrors = {};
  if (errors.email) mapped['invite-email'] = t('invite.errors.emailInvalid');
  if (errors.member_type) mapped['invite-role'] = t('invite.errors.roleRequired');
  return mapped;
}

export function InviteMemberModal({
  circleId,
  isSelfCare,
  onClose,
  onInvited,
}: InviteMemberModalProps): ReactElement {
  const { t } = useTranslation('members');
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
    const result = validateWithZod(inviteFormSchema, {
      email: email.trim(),
      member_type: memberType,
    });
    if (!result.success) {
      const fieldErrors = toFieldErrors(t, result.errors);
      setErrors(fieldErrors);
      focusFirstError(fieldErrors, ['invite-email', 'invite-role']);
      return;
    }
    setErrors({});

    createInvite.mutate(result.data, {
      onSuccess: () => {
        showToast(t('invite.success', { email: result.data.email }), 'success');
        onInvited?.();
        onClose();
      },
      onError: (error: unknown) => {
        // The hook's shared onError already toasts (402 → upgrade, 403 →
        // permission, else → generic). Surface a persistent in-modal note for
        // the free-tier cap so the modal stays open and explains itself.
        const code = (error as { error?: { code?: string } } | null)?.error?.code;
        if (code === 'SUBSCRIPTION_REQUIRED' || code === 'PAYMENT_REQUIRED') {
          setCapReached(true);
        }
      },
    });
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
          <Button type="submit" form="invite-member-form" disabled={createInvite.isPending}>
            {createInvite.isPending ? t('invite.sending') : t('invite.send')}
          </Button>
        </div>
      }
    >
      <form
        id="invite-member-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <p className="m-0 text-sm text-ink-2">{t('invite.subtitle')}</p>

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

        {capReached ? (
          <p
            role="alert"
            className="m-0 rounded-xl border border-line bg-bg-2 px-4 py-3 text-sm text-ink-2"
          >
            {t('invite.capReached')}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
