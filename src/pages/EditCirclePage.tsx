import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { updateCircleSchema } from '@/api/circles';
import { useCircle } from '@/hooks/useCircle';
import { useUpdateCircle, useDeleteCircle } from '@/hooks/useCircleAdmin';
import { useAuthStore } from '@/store/authStore';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { PageMasthead } from '@/components/layout/PageMasthead';
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  DateField,
  EmptyState,
  Icon,
  IconTile,
  SectionHeader,
  SheetRowPressable,
  Skeleton,
  TextField,
  useToast,
  useZodForm,
} from '@/components/ui';

// Plan Stage 8, Task 8.3 — owner-only circle edit + delete page.
// Mobile-parity Task 22 (spec §6.7 "Settings"): PageMasthead + Card form +
// a settings-row-styled danger zone opening the existing type-to-confirm
// delete dialog.
//
// PORT of mobile/src/screens/circle/EditCircleScreen.tsx (recipient name + DOB).
//
// Conditions are deliberately NOT edited here. They have one input across the
// product — Edit Medical Info (emergency_info.medical_conditions) — after this
// form and that modal spent months writing two lists that drifted apart and
// rendered side by side on the emergency sheet. `splitCommaList` stays exported
// for EditMedicalInfoModal, which shares the comma-separated text ↔ string[]
// round-trip.
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

export default function EditCirclePage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('circles');
  const { showToast } = useToast();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { circle, isLoading, isError, refetch } = useCircle(circleId);
  const update = useUpdateCircle(circleId);
  const remove = useDeleteCircle(circleId);
  const form = useZodForm(updateCircleSchema, ['recipient_name', 'recipient_dob']);
  // See `handleSubmit`: `useZodForm.submit` is synchronous and knows nothing
  // about the request it triggers, so the in-flight guard belongs at the call
  // site that owns the mutation.
  const submitGuard = useSubmitGuard();

  // Local form state, seeded from the loaded circle on first render with data.
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [recipientDob, setRecipientDob] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const isOwner = !!circle && !!currentUserId && circle.owner_id === currentUserId;
  const backTo = `/circles/${circleId}`;

  /**
   * Deep link from Home's settings row (`/circles/:id/settings#danger`).
   * Scrolls the danger-zone Card into view and moves focus to its delete
   * row — but never opens the destructive confirm dialog itself; the hash
   * only gets the user TO the row, the click is still theirs to make.
   *
   * Keyed on `!isLoading` rather than `isOwner`/`circle` so it still fires
   * once the skeleton clears; a non-owner or a still-missing `#danger`
   * element (element not in the DOM) is a silent no-op via the `?.`s below.
   */
  useEffect(() => {
    if (isLoading) return;
    if (location.hash !== '#danger') return;
    const section = document.getElementById('danger');
    section?.scrollIntoView({ block: 'center' });
    section?.querySelector('button')?.focus();
  }, [location.hash, isLoading]);

  /**
   * Map a Zod issue KEY NAME (emitted by `updateCircleSchema`, never prose) to
   * a translated message. Same helper shape as VitalFormModal.messageFor —
   * unknown keys degrade to a generic localized line instead of leaking Zod's
   * English default ("String must contain at least 1 character(s)").
   */
  const messageFor = (key: string | undefined): string | undefined =>
    key ? t(`validation.${key}`, { defaultValue: t('validation.invalid') }) : undefined;

  // Seed the controlled inputs once the circle detail arrives (null = not yet
  // touched → fall back to the loaded value). DOB is sliced to the date-only
  // portion at the seed too — the same normalization the dirty-check below
  // applies — so both sides compare like-for-like by construction.
  const nameValue = recipientName ?? circle?.recipient_name ?? '';
  const dobValue = recipientDob ?? circle?.recipient_dob?.slice(0, 10) ?? '';

  if (isLoading) {
    return (
      <section className="mx-auto max-w-2xl pb-8">
        <PageMasthead section={t('common:nav.settings')} tone="moss" title={t('edit.title')} />
        <div role="status" aria-live="polite" className="mx-5">
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
      <section className="mx-auto max-w-2xl pb-8">
        <PageMasthead section={t('common:nav.settings')} tone="moss" title={t('edit.title')} />
        <Card className="mx-5 text-center">
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
      <section className="mx-auto max-w-2xl pb-8">
        <PageMasthead
          section={t('common:nav.settings')}
          tone="moss"
          title={t('edit.title')}
          backTo={backTo}
        />
        <Card className="mx-5 border-dashed p-8">
          <EmptyState
            icon="lock-closed-outline"
            tone="neutral"
            title={t('edit.ownerOnlyTitle')}
            description={t('edit.ownerOnlyMessage')}
          />
        </Card>
      </section>
    );
  }

  // Save stays disabled until something actually changed — compare the
  // trimmed working values against the seeded circle values.
  //
  // Clearing a previously-set DOB is deliberately NOT "dirty": the backend's
  // updateCircleSchema has recipient_dob as `.optional()`, not `.nullable()`,
  // so there is no way to SEND a clear — handleSubmit below already omits
  // recipient_dob from the payload when the field is empty, which means a
  // Save from a bare clear would silently no-op (still show a "saved" toast)
  // without touching the stored DOB. `dobCleared` is checked ON ITS OWN
  // (not folded into `dobChanged`) and gates Save independently of the name
  // field — otherwise clearing the DOB *and* editing the name would still
  // enable Save, submit a payload that omits recipient_dob, and show a
  // misleading "Saved" toast while the field renders blank. Clearing DOB is
  // unsupported until the backend adds nullability; an inline hint on the
  // field explains why instead of silently ignoring the clear.
  const seededDob = circle.recipient_dob?.slice(0, 10) ?? '';
  const dobCleared = dobValue.trim() === '' && seededDob !== '';
  const dobChanged = dobValue.trim() !== '' && dobValue.trim() !== seededDob;
  const isDirty = !dobCleared && (nameValue.trim() !== circle.recipient_name.trim() || dobChanged);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    form.submit(
      {
        recipient_name: nameValue.trim(),
        // Omit optional keys when empty so they don't fail the format regex.
        ...(dobValue ? { recipient_dob: dobValue } : {}),
      },
      (data) => {
        // THE SYNCHRONOUS DOUBLE-SUBMIT GUARD. This form had none: `useZodForm`
        // calls `onValid` synchronously every time it is handed valid values,
        // and `update.mutate(...)` returns immediately, so two submits in the
        // SAME tick both fire. The payload is recomputed from the same state,
        // so today's second PATCH is idempotent; what it costs is a wasted
        // write and a second "Saved" toast for one edit. "Idempotent" is a
        // property of this payload, not of the form. Released in `onSettled` —
        // `mutate` returns immediately, so there is no promise to hold it open.
        if (update.isPending || !submitGuard.claim()) return;
        update.mutate(data, {
          onSuccess: () => showToast(t('edit.savedToast'), 'success'),
          onSettled: submitGuard.release,
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

  /**
   * Cancel goes back to wherever the user came from — EXCEPT when this page
   * was the first entry in the session's history (e.g. opened via a direct
   * link/bookmark), where `navigate(-1)` would leave the app entirely. The
   * history entry's `idx` is 0 only for that first entry, so fall back to the
   * circle overview instead.
   */
  const handleCancel = (): void => {
    const historyState = window.history.state as { idx?: number } | null;
    if (historyState?.idx === 0) {
      navigate(backTo);
    } else {
      navigate(-1);
    }
  };

  return (
    <section className="mx-auto max-w-2xl pb-8">
      <PageMasthead
        section={t('common:nav.settings')}
        tone="moss"
        title={t('edit.title')}
        subtitle={t('edit.subtitle')}
        backTo={backTo}
      />

      <Card padding="lg" className="mx-5">
        <div className="flex justify-center pb-2">
          {/* ring-cream would be invisible here — the Card itself is cream —
              so the ring uses bg-2 for contrast against the card surface. */}
          <span className="inline-flex rounded-full ring-4 ring-bg-2">
            <Avatar size="xl" name={circle.recipient_name} photoUrl={circle.recipient_photo_url} />
          </span>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <TextField
            id="recipient_name"
            label={t('edit.recipientName')}
            value={nameValue}
            maxLength={100}
            required
            error={messageFor(form.errors.recipient_name)}
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
            error={dobCleared ? t('common:dobClearUnsupported') : messageFor(form.errors.recipient_dob)}
            hint={t('edit.recipientDobHint')}
            onChange={(e) => {
              setRecipientDob(e.target.value);
              form.clearError('recipient_dob');
            }}
          />
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={handleCancel}>
              {t('edit.cancel')}
            </Button>
            <Button
              type="submit"
              loading={update.isPending}
              disabled={update.isPending || !isDirty}
            >
              {update.isPending ? t('edit.saving') : t('edit.save')}
            </Button>
          </div>
        </form>
      </Card>

      {/* ── Danger zone (owner-only; type-to-confirm delete). Row styled like
          mobile's settings row (CircleDetailScreen ~L1618-1650): terracotta
          IconTile, terracotta-deep text, trailing chevron.
          `id="danger"` is the target of Home's settings-row deep link
          (`/circles/:id/settings#danger`) — see the scroll/focus effect above. ── */}
      <SectionHeader title={t('edit.dangerZone')} className="mx-5" />
      <p className="mx-5 -mt-1 mb-3 text-sm text-ink-3">{t('edit.deleteDescription')}</p>
      <Card id="danger" variant="outlined" padding="none" className="mx-5 border-terracotta-deep/30">
        <SheetRowPressable
          onClick={() => setConfirmDelete(true)}
          className="min-h-[52px] gap-3 px-[18px]"
        >
          <IconTile tone="terracotta" name="trash-outline" size={36} />
          <span className="flex-1 text-md font-medium text-terracotta-deep">
            {t('edit.deleteCircle')}
          </span>
          <Icon name="chevron-forward" size="inline" className="text-ink-3" />
        </SheetRowPressable>
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
