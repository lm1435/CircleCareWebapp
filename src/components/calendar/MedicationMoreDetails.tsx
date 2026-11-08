import { useId, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, TextField } from '@/components/ui';
import { INPUT_ERROR } from '@/components/ui/inputStyles';
import {
  MEDICATION_PHOTO_ACCEPT,
  medicationPhotoProblem,
  prepareMedicationPhoto,
} from '@/api/medicationPhoto';
import type { MedicationDetailsState } from '@/utils/medicationDetailsForm';

// The medication form's More details, the parts mobile has and the web lacked (owner 2026-11-08, parity):
// the photo, refill tracking and the prescription details. Same order, labels and hints as mobile's
// AddEventScreen `medPhotoRow` + `medAdditionalFields`; the state and the save live in AddEventModal.

export interface MedicationPhotoFieldProps {
  /** What to show: an object URL of a newly picked file, or the stored photo's signed URL. */
  previewUrl: string | null;
  onPick: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
}

/**
 * Add / change / remove the medication photo. The native file input stays in the DOM, labelled (the
 * thing browsers and Playwright drive), and the visible affordance is a Button that forwards its click
 * (the documents uploader's pattern). Type and size are checked here against the bucket's limits after
 * the image is shrunk like mobile's picker does; a refusal is said inline, never as a toast.
 */
export function MedicationPhotoField({
  previewUrl,
  onPick,
  onRemove,
  disabled = false,
}: MedicationPhotoFieldProps): ReactElement {
  const { t } = useTranslation('calendar');
  const id = useId();
  const inputId = `${id}-photo`;
  const hintId = `${id}-photo-hint`;
  const errorId = `${id}-photo-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function handleChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const picked = event.target.files?.[0];
    // Reset so picking the same file again still fires a change.
    event.target.value = '';
    if (!picked) return;
    setPreparing(true);
    const file = await prepareMedicationPhoto(picked);
    setPreparing(false);
    const problem = medicationPhotoProblem(file);
    if (problem) {
      setError(problem === 'type' ? t('addEvent.photoTypeError') : t('addEvent.photoSizeError'));
      return;
    }
    setError(null);
    onPick(file);
  }

  const busy = disabled || preparing;
  return (
    <div className="flex flex-col gap-1.5" data-testid="medication-photo-field">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-2">
        {t('addEvent.medicationPhoto')}
      </label>
      <div className="flex items-center gap-3">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={t('addEvent.photoPreviewAlt')}
            data-testid="medication-photo-preview"
            className="h-14 w-14 shrink-0 rounded-xl border border-line-2 object-cover"
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            loading={preparing}
            aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(' ')}
            onClick={() => inputRef.current?.click()}
          >
            {previewUrl ? t('addEvent.changePhoto') : t('addEvent.photoRowTitle')}
          </Button>
          {previewUrl ? (
            <Button
              type="button"
              variant="ghost"
              tone="neutral"
              size="sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                onRemove();
              }}
            >
              {t('addEvent.removePhoto')}
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={MEDICATION_PHOTO_ACCEPT}
        disabled={busy}
        // The Button above is the keyboard / screen-reader control; this one is driven through it.
        tabIndex={-1}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hintId].filter(Boolean).join(' ')}
        onChange={(e) => void handleChange(e)}
        className="sr-only"
      />
      <p id={hintId} className="m-0 text-sm text-ink-2">
        {previewUrl ? t('addEvent.photoAdded') : t('addEvent.photoRowHint')}
      </p>
      {error ? (
        <p id={errorId} role="alert" className={INPUT_ERROR}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface MedicationRefillFieldsProps {
  state: MedicationDetailsState;
  onChange: (next: Partial<MedicationDetailsState>) => void;
  /** As needed (new or stored): no refill section (refills are off in v1), like mobile. */
  asNeeded: boolean;
  /** This dose shares a bottle owned by its main dose: a note instead of live controls. */
  refillsManagedElsewhere: boolean;
  /** Pills are countable (unknown form = yes): the per-dose box and the computed lines. */
  countable: boolean;
  isEditing: boolean;
  doseTimeCount: number;
  /** The day's consumption shown on CREATE, or null. */
  derivedPerDay: number | null;
  /** The rate the "~N days supply" line divides by, or null when unknown. */
  supplyRate: number | null;
  alertDaysError?: string;
  disabled?: boolean;
}

const digits = (value: string): string => value.replace(/\D/g, '');

/** Track refills, then Prescriber / Pharmacy / Pharmacy phone / Rx number (mobile's `medAdditionalFields`). */
export function MedicationRefillFields({
  state,
  onChange,
  asNeeded,
  refillsManagedElsewhere,
  countable,
  isEditing,
  doseTimeCount,
  derivedPerDay,
  supplyRate,
  alertDaysError,
  disabled = false,
}: MedicationRefillFieldsProps): ReactElement {
  const { t } = useTranslation('calendar');
  const quantityLabel = countable ? t('addEvent.fields.pillsRemaining') : t('addEvent.fields.quantityOnHand');
  const quantity = parseInt(state.quantityInBottle, 10);

  return (
    <>
      {asNeeded ? null : refillsManagedElsewhere ? (
        <p className="m-0 text-sm text-ink-2" data-testid="refills-managed-on-owner">
          {t('addEvent.refillsManagedOnOwner')}
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="refill-fields">
          <Checkbox
            id="track_refills"
            checked={state.trackRefills}
            onChange={(checked) => onChange({ trackRefills: checked })}
            label={t('addEvent.trackRefills')}
            hint={t('addEvent.trackRefillsHelp')}
            disabled={disabled}
          />
          {state.trackRefills && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  id="quantity_in_bottle"
                  label={quantityLabel}
                  value={state.quantityInBottle}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="30"
                  disabled={disabled}
                  onChange={(e) => onChange({ quantityInBottle: digits(e.target.value) })}
                />
                {countable && (
                  <TextField
                    id="pills_per_dose"
                    label={t('addEvent.fields.pillsPerDose')}
                    value={state.pillsPerDose}
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="1"
                    disabled={disabled}
                    onChange={(e) => onChange({ pillsPerDose: digits(e.target.value) })}
                  />
                )}
              </div>
              <p className="m-0 text-sm text-ink-2">{t('addEvent.fields.pillsPerDoseHelp')}</p>
              {!isEditing && countable && derivedPerDay !== null && (
                <p className="m-0 text-sm text-ink-2" data-testid="pills-per-day-derived">
                  {t('addEvent.fields.pillsPerDayDerived', {
                    perDose: state.pillsPerDose,
                    times: doseTimeCount,
                    perDay: derivedPerDay,
                  })}
                </p>
              )}
              <TextField
                id="alert_days_before"
                label={t('addEvent.fields.alertDaysBefore')}
                value={state.alertDaysBefore}
                inputMode="numeric"
                maxLength={3}
                placeholder="7"
                disabled={disabled}
                error={alertDaysError}
                onChange={(e) => onChange({ alertDaysBefore: digits(e.target.value) })}
              />
              {countable && quantity > 0 && supplyRate !== null && (
                <p className="m-0 text-sm font-medium text-ink" data-testid="refill-estimate">
                  {t('addEvent.refillEstimate', {
                    days: Math.floor(quantity / supplyRate),
                    alertDays: state.alertDaysBefore || '7',
                  })}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <TextField
        id="prescriber_name"
        label={t('addEvent.fields.prescriberName')}
        value={state.prescriberName}
        maxLength={100}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange({ prescriberName: e.target.value })}
      />
      <TextField
        id="pharmacy_name"
        label={t('addEvent.fields.pharmacyName')}
        value={state.pharmacyName}
        maxLength={100}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange({ pharmacyName: e.target.value })}
      />
      <TextField
        id="pharmacy_phone"
        label={t('addEvent.fields.pharmacyPhone')}
        value={state.pharmacyPhone}
        type="tel"
        inputMode="tel"
        maxLength={20}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange({ pharmacyPhone: e.target.value })}
      />
      <TextField
        id="rx_number"
        label={t('addEvent.fields.rxNumber')}
        value={state.rxNumber}
        maxLength={30}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange({ rxNumber: e.target.value })}
      />
    </>
  );
}
