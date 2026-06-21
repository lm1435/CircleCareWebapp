import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createCircleSchema, type CreateCircleRequest } from '@/api/circles';
import { useCreateCircle } from '@/hooks/useCircleAdmin';
import { useAuth } from '@/hooks/useAuth';
import { Analytics } from '@/lib/analytics';
import { Button, DateField, Modal, TextField, Toggle, useToast, useZodForm } from '@/components/ui';

// Plan Stage 8, Task 8.6c — circle create modal.
//
// PORT of mobile/src/screens/circle/CreateCircleScreen.tsx (the create form +
// is_self_care toggle), reduced to the parity-relevant fields. The mobile
// relationship-chip / quick-win flow is mobile-onboarding chrome, not part of
// the create contract — web keeps the plain form the backend expects:
//   { recipient_name, recipient_dob?, recipient_conditions?, is_self_care }.
//
// Self-care: like mobile, the care recipient IS the current user, so the name
// field is hidden and we resolve the user's own name on submit (falling back to
// a localized label when the profile has no name yet). The backend then sets
// is_care_recipient on the owner membership.
//
// On success we close and navigate to the new circle's calendar. Freemium 402 /
// 403 CIRCLE_LIMIT_REACHED toasts are surfaced by useCreateCircle.

export interface CreateCircleModalProps {
  onClose: () => void;
}

export function CreateCircleModal({ onClose }: CreateCircleModalProps): ReactElement {
  const { t } = useTranslation('circles');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();

  const create = useCreateCircle();
  const form = useZodForm(createCircleSchema, ['recipient_name', 'recipient_dob']);

  const [recipientName, setRecipientName] = useState('');
  const [recipientDob, setRecipientDob] = useState('');
  const [isSelfCare, setIsSelfCare] = useState(false);

  // Opening the create modal is the start of the creation funnel.
  useEffect(() => {
    Analytics.circleCreationStarted();
  }, []);

  /** Resolve the care recipient's name — own name for self-care, else input. */
  const resolveName = (): string => {
    if (!isSelfCare) return recipientName.trim();
    const parts = [user?.first_name, user?.last_name].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(' ') : t('create.selfCareDefaultName');
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const payload: CreateCircleRequest = {
      recipient_name: resolveName(),
      is_self_care: isSelfCare,
      // Self-care has no separate DOB entry; omit when empty so it doesn't trip
      // the date refinement. Conditions are NOT collected at creation (parity
      // with mobile) — set later in Circle Settings / Emergency Info.
      ...(!isSelfCare && recipientDob ? { recipient_dob: recipientDob } : {}),
    };

    form.submit(payload, (data) => {
      create.mutate(data, {
        onSuccess: (circle) => {
          Analytics.circleCreated(isSelfCare);
          showToast(t('create.success'), 'success');
          onClose();
          // Land on the new circle's overview — the get-started checklist + helpers
          // live here, so a brand-new owner sees how to set things up.
          navigate(`/circles/${circle.id}`);
        },
        onError: (error: unknown) => {
          // PHI-safe: only the backend error CODE (or a generic fallback). The
          // hook itself surfaces the user-facing toast.
          const code = (error as { error?: { code?: string } } | null)?.error?.code;
          Analytics.circleCreationFailed(code ?? 'CIRCLE_CREATE_FAILED');
        },
      });
    });
  };

  return (
    <Modal title={t('create.title')} onClose={onClose} closeLabel={t('create.cancel')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink-3">{t('create.subtitle')}</p>

        <Toggle
          checked={isSelfCare}
          onChange={setIsSelfCare}
          label={t('create.selfCareToggle')}
          hint={t('create.selfCareHint')}
        />

        {!isSelfCare && (
          <>
            <TextField
              id="recipient_name"
              label={t('create.recipientName')}
              value={recipientName}
              maxLength={100}
              required
              autoFocus
              error={form.errors.recipient_name}
              placeholder={t('create.recipientNamePlaceholder')}
              onChange={(e) => {
                setRecipientName(e.target.value);
                form.clearError('recipient_name');
              }}
            />
            <DateField
              id="recipient_dob"
              label={t('create.recipientDob')}
              value={recipientDob}
              error={form.errors.recipient_dob}
              hint={t('create.recipientDobHint')}
              onChange={(e) => {
                setRecipientDob(e.target.value);
                form.clearError('recipient_dob');
              }}
            />
          </>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('create.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('create.creating') : t('create.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
