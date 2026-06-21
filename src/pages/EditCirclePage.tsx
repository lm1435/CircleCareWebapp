import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { updateCircleSchema } from '@/api/circles';
import { useCircle } from '@/hooks/useCircle';
import { useUpdateCircle, useDeleteCircle } from '@/hooks/useCircleAdmin';
import { useAuthStore } from '@/store/authStore';
import {
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  Skeleton,
  TextArea,
  TextField,
  useToast,
  useZodForm,
} from '@/components/ui';

// Plan Stage 8, Task 8.3 — owner-only circle edit + delete page.
//
// PORT of mobile/src/screens/circle/EditCircleScreen.tsx (recipient name + DOB)
// extended with conditions, which mobile renders in the emergency recipient
// header. Conditions round-trip as comma-separated text ↔ string[] (the same
// pattern as EditMedicalInfoModal.splitCommaList) — recipient_conditions is a
// string[] on the backend (backend/src/routes/circles.ts updateCircleSchema).
//
// Recipient PHOTO upload is intentionally OUT OF SCOPE (signed-URL flow).
//
// Owner gating: every write is gated on circle.owner_id === current user id
// (the canonical owner check). Non-owners see a read-only notice; the form and
// danger zone are not rendered for them. The backend enforces owner-only
// regardless of UI state.

/** Split a comma-separated text field into a trimmed, non-empty string array. */
export function splitCommaList(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Padlock glyph for the owner-only empty state (decorative). */
function LockIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function EditCirclePage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('circles');
  const { showToast } = useToast();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { circle, isLoading, isError, refetch } = useCircle(circleId);
  const update = useUpdateCircle(circleId);
  const remove = useDeleteCircle(circleId);
  const form = useZodForm(updateCircleSchema, [
    'recipient_name',
    'recipient_dob',
    'recipient_conditions',
  ]);

  // Local form state, seeded from the loaded circle on first render with data.
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [recipientDob, setRecipientDob] = useState<string | null>(null);
  const [conditionsText, setConditionsText] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const isOwner = !!circle && !!currentUserId && circle.owner_id === currentUserId;

  // Seed the controlled inputs once the circle detail arrives (null = not yet
  // touched → fall back to the loaded value).
  const nameValue = recipientName ?? circle?.recipient_name ?? '';
  const dobValue = recipientDob ?? circle?.recipient_dob ?? '';
  const conditionsValue =
    conditionsText ?? (circle?.recipient_conditions ?? []).join(', ');

  if (isLoading) {
    return (
      <section className="mx-auto max-w-2xl p-6 md:p-8">
        <h1 className="serif m-0 text-xl text-ink">{t('edit.title')}</h1>
        <div role="status" aria-live="polite" className="mt-6">
          <span className="sr-only">{t('edit.loadingLabel')}</span>
          <Card>
            <Skeleton className="h-5 w-1/3 max-w-48" />
            <Skeleton className="mt-4 h-11 w-full" />
            <Skeleton className="mt-4 h-11 w-full" />
            <Skeleton className="mt-4 h-20 w-full" />
          </Card>
        </div>
      </section>
    );
  }

  if (isError || !circle) {
    return (
      <section className="mx-auto max-w-2xl p-6 md:p-8">
        <h1 className="serif m-0 text-xl text-ink">{t('edit.title')}</h1>
        <Card className="mt-6 text-center">
          <p className="m-0 font-medium text-ink">{t('edit.errorTitle')}</p>
          <Button variant="ghost" className="mt-4" onClick={() => refetch()}>
            {t('edit.retry')}
          </Button>
        </Card>
      </section>
    );
  }

  // Non-owners cannot edit/delete a circle — show a clear read-only notice.
  if (!isOwner) {
    return (
      <section className="mx-auto max-w-2xl p-6 md:p-8">
        <h1 className="serif m-0 text-xl text-ink">{t('edit.title')}</h1>
        <Card className="mt-6 border-dashed p-8">
          <EmptyState
            icon={<LockIcon />}
            title={t('edit.ownerOnlyTitle')}
            description={t('edit.ownerOnlyMessage')}
          />
        </Card>
      </section>
    );
  }

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    form.submit(
      {
        recipient_name: nameValue.trim(),
        // Omit optional keys when empty so they don't fail the format regex.
        ...(dobValue ? { recipient_dob: dobValue } : {}),
        recipient_conditions: splitCommaList(conditionsValue),
      },
      (data) => {
        update.mutate(data, {
          onSuccess: () => showToast(t('edit.savedToast'), 'success'),
        });
      }
    );
  };

  const handleDelete = (): void => {
    remove.mutate(undefined, {
      onSuccess: () => {
        showToast(t('edit.deletedToast'), 'success');
        navigate('/circles');
      },
    });
  };

  return (
    <section className="mx-auto max-w-2xl p-6 md:p-8">
      <header>
        <h1 className="serif m-0 text-xl text-ink">{t('edit.title')}</h1>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('edit.subtitle')}</p>
      </header>

      <Card className="mt-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <TextField
            id="recipient_name"
            label={t('edit.recipientName')}
            value={nameValue}
            maxLength={100}
            required
            error={form.errors.recipient_name}
            placeholder={t('edit.recipientNamePlaceholder')}
            onChange={(e) => {
              setRecipientName(e.target.value);
              form.clearError('recipient_name');
            }}
          />
          <DateField
            id="recipient_dob"
            label={t('edit.recipientDob')}
            value={dobValue}
            error={form.errors.recipient_dob}
            hint={t('edit.recipientDobHint')}
            onChange={(e) => {
              setRecipientDob(e.target.value);
              form.clearError('recipient_dob');
            }}
          />
          <TextArea
            id="recipient_conditions"
            label={t('edit.conditions')}
            value={conditionsValue}
            rows={2}
            hint={t('edit.conditionsHint')}
            error={form.errors.recipient_conditions}
            onChange={(e) => {
              setConditionsText(e.target.value);
              form.clearError('recipient_conditions');
            }}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('edit.saving') : t('edit.save')}
            </Button>
          </div>
        </form>
      </Card>

      {/* ── Danger zone (owner-only; type-to-confirm delete). ── */}
      <Card className="mt-8 border-terracotta-deep/30">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('edit.dangerZone')}</h2>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('edit.deleteDescription')}</p>
        <div className="mt-4">
          <Button variant="terracotta" onClick={() => setConfirmDelete(true)}>
            {t('edit.deleteCircle')}
          </Button>
        </div>
      </Card>

      {confirmDelete && (
        <ConfirmDialog
          title={t('edit.deleteConfirmTitle')}
          message={
            <span className="flex flex-col gap-3">
              <span>
                {t('edit.deleteConfirmMessage', { name: circle.recipient_name })}
              </span>
              <span className="text-sm text-ink-3">
                {t('edit.deleteConfirmWarning')}
              </span>
              <TextField
                id="delete-confirm-input"
                label={t('edit.deleteConfirmPrompt', { keyword: t('edit.deleteConfirmKeyword') })}
                value={confirmText}
                placeholder={t('edit.deleteConfirmKeyword')}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </span>
          }
          confirmLabel={remove.isPending ? t('edit.deleting') : t('edit.deleteCircle')}
          cancelLabel={t('edit.cancel')}
          destructive
          confirmDisabled={
            remove.isPending || confirmText.trim().toUpperCase() !== t('edit.deleteConfirmKeyword')
          }
          onConfirm={handleDelete}
          onCancel={() => {
            setConfirmDelete(false);
            setConfirmText('');
          }}
        />
      )}
    </section>
  );
}
