import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DateField,
  Modal,
  Select,
  TextArea,
  TextField,
  TimeField,
  useToast,
  validateWithZod,
  focusFirstError,
  type FieldErrors,
} from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useUnitPreferences } from '@/hooks/useUnitPreferences';
import { useCreateVital, useUpdateVital } from '@/hooks/useVitals';
import type { HealthVital, VitalType } from '@/api/vitals';
import {
  DEFAULT_UNIT_PREFERENCES,
  buildCreateVitalRequest,
  buildUpdateVitalRequest,
  fromCanonicalValue,
  getDisplayUnit,
  vitalFormSchema,
  type GlucoseUnit,
  type VitalFormValues,
  type WeightUnit,
} from '@/lib/vitals';
import { getTimezoneAbbreviation, getTimezoneLabel } from '@/utils/timezone';
import {
  recipientWallTimeToUtcISO,
  utcISOToRecipientWallTime,
} from './vitalDateTime';

// Task 6.4 — shared create/edit form modal for vitals, used by AddVitalModal
// (create) and EditVitalModal (edit). MIRRORS
// mobile/src/screens/vitals/VitalFormScreen.tsx:
//   - vital type selector (create only; locked to the reading's type when editing)
//   - value inputs (blood_pressure = systolic + diastolic; others single)
//   - UNIT-AWARE inputs honoring the user's unit_preferences (display ↔ canonical
//     via lib/vitals helpers; backend converts the submitted display unit on write)
//   - recorded-at date + time (recipient-TZ aware) + notes
//
// TIMEZONE (CRITICAL): recorded_at is a single UTC ISO timestamp. The DateField +
// TimeField the user edits hold the recipient's NAIVE LOCAL wall time. We convert
// recipient-local wall time → a UTC instant on write (recipientWallTimeToUtcISO,
// DST-correct) and convert the stored UTC instant → recipient-local wall time for
// prefill (utcISOToRecipientWallTime). NEVER new Date(`${d}T${t}`)/.getHours()/
// device-local .toISOString() from a wall-time string.

const VITAL_TYPES: VitalType[] = ['blood_pressure', 'heart_rate', 'glucose', 'weight'];

export interface VitalFormModalProps {
  circleId: string;
  /** Existing reading when editing; omit/undefined for create. */
  vital?: HealthVital | null;
  /** Pre-select the vital type in create mode. */
  initialType?: VitalType;
  onClose: () => void;
  /** Called after a successful create/update (parent typically closes). */
  onSaved?: () => void;
}

/** A number parsed from a free-text field, or null when blank / non-numeric. */
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function VitalFormModal({
  circleId,
  vital,
  initialType,
  onClose,
  onSaved,
}: VitalFormModalProps): ReactElement | null {
  const { t } = useTranslation(['vitals', 'common']);
  const { showToast } = useToast();
  const { timezone, canEdit } = useCircle(circleId);
  const { data: unitPrefs } = useUnitPreferences();

  const weightUnit: WeightUnit = unitPrefs?.weight_unit ?? DEFAULT_UNIT_PREFERENCES.weight_unit;
  const glucoseUnit: GlucoseUnit =
    unitPrefs?.glucose_unit ?? DEFAULT_UNIT_PREFERENCES.glucose_unit;

  const isEditing = !!vital;
  const createVital = useCreateVital(circleId);
  const updateVital = useUpdateVital(circleId);
  const isPending = createVital.isPending || updateVital.isPending;

  // ── Vital type ── locked to the reading's type when editing.
  const [vitalType, setVitalType] = useState<VitalType>(
    vital?.vital_type ?? initialType ?? 'blood_pressure'
  );

  // ── Initial display values (edit) — canonical → display unit. ──
  const initialValue1 = useMemo(() => {
    if (!vital) return '';
    const display = fromCanonicalValue(vital.vital_type, vital.value1, weightUnit, glucoseUnit);
    if (vital.vital_type === 'blood_pressure' || vital.vital_type === 'heart_rate') {
      return String(Math.round(display));
    }
    return String(Number(display.toFixed(1)));
  }, [vital, weightUnit, glucoseUnit]);

  const initialValue2 = useMemo(() => {
    if (!vital || vital.value2 == null) return '';
    // value2 (BP diastolic) is always mmHg — no conversion.
    return String(Math.round(vital.value2));
  }, [vital]);

  const initialWall = useMemo(
    () =>
      vital
        ? utcISOToRecipientWallTime(vital.recorded_at, timezone)
        : utcISOToRecipientWallTime(new Date().toISOString(), timezone),
    [vital, timezone]
  );

  // ── Form state ──
  const [value1, setValue1] = useState(
    vital && vital.vital_type !== 'blood_pressure' ? initialValue1 : ''
  );
  const [systolic, setSystolic] = useState(
    vital && vital.vital_type === 'blood_pressure' ? initialValue1 : ''
  );
  const [diastolic, setDiastolic] = useState(
    vital && vital.vital_type === 'blood_pressure' ? initialValue2 : ''
  );
  const [dateStr, setDateStr] = useState(initialWall.date);
  const [timeStr, setTimeStr] = useState(initialWall.time);
  const [notes, setNotes] = useState(vital?.notes ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const isBloodPressure = vitalType === 'blood_pressure';
  const displayUnit = getDisplayUnit(vitalType, weightUnit, glucoseUnit);
  const tzLabel = `${getTimezoneLabel(timezone)} (${getTimezoneAbbreviation(timezone)})`;

  function clearError(field: string): void {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handleTypeChange(next: VitalType): void {
    setVitalType(next);
    setValue1('');
    setSystolic('');
    setDiastolic('');
    setErrors({});
  }

  /** Map a vital-form translation key (Zod message) to a localized string. */
  function messageFor(key: string): string {
    return t(`validation.${key}`, { defaultValue: t('validation.invalid') });
  }

  function buildFormValues():
    | { ok: true; values: VitalFormValues }
    | { ok: false; errors: FieldErrors } {
    const fieldErrors: FieldErrors = {};

    // recorded_at: combine recipient-local wall time into a UTC ISO instant.
    if (!dateStr) fieldErrors.recorded_at = messageFor('dateRequired');
    if (!timeStr) fieldErrors.recorded_at = messageFor('timeRequired');

    let recordedAtISO = '';
    if (dateStr && timeStr) {
      recordedAtISO = recipientWallTimeToUtcISO(dateStr, timeStr, timezone);
    }

    const numericValue1 = isBloodPressure ? parseNumber(systolic) : parseNumber(value1);
    const numericValue2 = isBloodPressure ? parseNumber(diastolic) : undefined;

    if (numericValue1 == null) {
      fieldErrors.value1 = messageFor('valueRequired');
    }
    if (isBloodPressure && numericValue2 == null) {
      fieldErrors.value2 = messageFor('valueRequired');
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { ok: false, errors: fieldErrors };
    }

    const candidate: VitalFormValues = {
      vital_type: vitalType,
      value1: numericValue1 as number,
      value2: isBloodPressure ? (numericValue2 as number) : undefined,
      unit: displayUnit,
      recorded_at: recordedAtISO,
      notes: notes.trim() || undefined,
    };

    // Final guard: the shared web Zod schema (per-type ranges, unit, not-future).
    const result = validateWithZod(vitalFormSchema, candidate);
    if (!result.success) {
      const mapped: FieldErrors = {};
      for (const [field, msg] of Object.entries(result.errors)) {
        mapped[field] = messageFor(msg);
      }
      return { ok: false, errors: mapped };
    }
    return { ok: true, values: result.data };
  }

  async function handleSubmit(formEvent: FormEvent): Promise<void> {
    formEvent.preventDefault();
    if (!canEdit || isPending) return;

    const built = buildFormValues();
    if (!built.ok) {
      setErrors(built.errors);
      focusFirstError(built.errors, ['value1', 'value2', 'recorded_at', 'notes']);
      return;
    }
    setErrors({});

    try {
      if (isEditing && vital) {
        const { value1: v1, value2: v2, unit, recorded_at, notes: noteVal } = built.values;
        await updateVital.mutateAsync({
          id: vital.id,
          data: buildUpdateVitalRequest(vital.vital_type, {
            value1: v1,
            value2: v2,
            unit,
            recorded_at,
            notes: noteVal,
          }),
        });
        showToast(t('toast.updated'), 'success');
      } else {
        await createVital.mutateAsync(buildCreateVitalRequest(built.values));
        showToast(t('toast.added'), 'success');
      }
      onSaved?.();
      onClose();
    } catch {
      // Mutation hooks surface their own permission/subscription/save toasts.
    }
  }

  // Hidden entirely when the user can't edit (parent gates too).
  if (!canEdit) return null;

  const typeOptions = VITAL_TYPES.map((type) => ({
    value: type,
    label: t(`types.${type}`),
  }));

  // value1 placeholder hint per type/unit (mirrors mobile defaults).
  const value1Placeholder =
    vitalType === 'heart_rate'
      ? '72'
      : vitalType === 'glucose'
        ? glucoseUnit === 'mg/dL'
          ? '100'
          : '5.6'
        : weightUnit === 'lbs'
          ? '150'
          : '68';

  return (
    <Modal
      title={isEditing ? t('edit.title') : t('add.title')}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="md"
      closeOnBackdropClick={false}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" form="vital-form" disabled={isPending}>
            {isPending ? t('add.saving') : isEditing ? t('edit.save') : t('add.save')}
          </Button>
        </div>
      }
    >
      <form id="vital-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {/* Type selector — create only; locked (its own type) when editing. */}
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">{t('add.typeLabel')}</span>
            <p className="m-0 text-base text-ink">{t(`types.${vitalType}`)}</p>
          </div>
        ) : (
          <Select
            id="vital_type"
            label={t('add.typeLabel')}
            options={typeOptions}
            value={vitalType}
            onChange={(e) => handleTypeChange(e.target.value as VitalType)}
          />
        )}

        {/* Value inputs */}
        {isBloodPressure ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              id="value1"
              label={t('fields.systolic')}
              type="number"
              inputMode="numeric"
              value={systolic}
              placeholder="120"
              hint={t('fields.unitSuffix', { unit: 'mmHg' })}
              error={errors.value1}
              onChange={(e) => {
                setSystolic(e.target.value);
                clearError('value1');
              }}
            />
            <TextField
              id="value2"
              label={t('fields.diastolic')}
              type="number"
              inputMode="numeric"
              value={diastolic}
              placeholder="80"
              hint={t('fields.unitSuffix', { unit: 'mmHg' })}
              error={errors.value2}
              onChange={(e) => {
                setDiastolic(e.target.value);
                clearError('value2');
              }}
            />
          </div>
        ) : (
          <TextField
            id="value1"
            label={t(`types.${vitalType}`)}
            type="number"
            inputMode="decimal"
            value={value1}
            placeholder={value1Placeholder}
            hint={t('fields.unitSuffix', { unit: displayUnit })}
            error={errors.value1}
            onChange={(e) => {
              setValue1(e.target.value);
              clearError('value1');
            }}
          />
        )}

        {/* Recorded-at date + time (recipient TZ). */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DateField
            id="recorded_at"
            label={t('fields.date')}
            value={dateStr}
            error={errors.recorded_at}
            hint={t('fields.timesShownIn', { timezone: tzLabel })}
            onChange={(e) => {
              setDateStr(e.target.value);
              clearError('recorded_at');
            }}
          />
          <TimeField
            id="recorded_time"
            label={t('fields.time')}
            value={timeStr}
            onChange={(e) => {
              setTimeStr(e.target.value);
              clearError('recorded_at');
            }}
          />
        </div>

        <TextArea
          id="notes"
          label={t('fields.notes')}
          value={notes}
          rows={3}
          maxLength={500}
          placeholder={t('fields.notesPlaceholder')}
          error={errors.notes}
          onChange={(e) => {
            setNotes(e.target.value);
            clearError('notes');
          }}
        />
      </form>
    </Modal>
  );
}
