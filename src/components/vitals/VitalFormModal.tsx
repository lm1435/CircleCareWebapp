import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DateField,
  Modal,
  Select,
  Text,
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
import {
  formatTimeOfDay,
  getDeviceTimezone,
  getTimezoneLabel,
  timezonesAreDifferent,
} from '@/utils/timezone';
import { clockInZone, dayInZone, viewerInstant } from '@/utils/recipientEventDate';
import { useHourCycle } from '@/hooks/useHourCycle';
import {
  utcISOToViewerWallTime,
  viewerWallTimeToUtcISO,
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
// TIMEZONE (CRITICAL): recorded_at is a single UTC ISO timestamp, and the
// DateField + TimeField hold the VIEWER's wall clock — the caregiver types the
// time they are reading off their own clock. Write converts viewer wall time →
// instant (viewerWallTimeToUtcISO); prefill converts back
// (utcISOToViewerWallTime). The two must always change together.
//
// This form used to read the typed digits as the CARE RECIPIENT's wall clock,
// which disagreed with mobile — whose picker is device-local and stores
// `recordedAt.toISOString()` — so the same action on the two platforms filed a
// reading at instants an offset apart. It also disagreed with this app's own
// calendar form after that moved to the viewer frame.
//
// DISPLAY is a separate question and is NOT changing: VitalsPage renders a
// stored reading in the RECIPIENT's zone, and mobile does the same
// (formatInstantInTimezone). Where the reading is shown, the recipient's clock
// is the useful frame; where it is typed, the viewer's is.

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
  const { circle, timezone, canEdit } = useCircle(circleId);
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
        ? utcISOToViewerWallTime(vital.recorded_at)
        : utcISOToViewerWallTime(new Date().toISOString()),
    // No `timezone` dep: the viewer-frame prefill does not consult it. That is
    // not an oversight — it is the point. The old recipient-frame prefill DID,
    // which is what made a mid-flight circle query able to prefill in one frame
    // and save in another. That whole failure mode is gone by construction.
    [vital]
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

  /**
   * Resync the prefill when the EVENT being edited changes identity.
   *
   * No longer a timezone concern. `initialWall` is now viewer-frame and does
   * not consult `timezone` at all, so the failure this guard was originally
   * written for — prefilling through the 'America/New_York' fallback while a
   * mid-flight circle query resolved, then saving with the real zone and
   * filing a reading at a time it was never taken — is gone by construction
   * rather than by vigilance.
   *
   * What remains is ordinary: a refetch can hand this component a new `vital`
   * object, and the untouched fields should follow it.
   *
   * Untouched fields only: a user who edited the date/time owns it.
   */
  const wallTouched = useRef(false);
  useEffect(() => {
    if (wallTouched.current) return;
    setDateStr(initialWall.date);
    setTimeStr(initialWall.time);
  }, [initialWall]);

  const isBloodPressure = vitalType === 'blood_pressure';
  const displayUnit = getDisplayUnit(vitalType, weightUnit, glucoseUnit);
  // ── Dual-timezone disclosure (same shape as AddEventModal) ────────────────
  //
  // The fields hold the VIEWER's clock, so the old
  // "Times shown in <recipient zone>" hint is now simply false. Replaced with
  // the live conversion, gated on the OFFSET rather than the zone names so an
  // ICU alias (Asia/Kolkata -> Asia/Calcutta) is not mistaken for a second zone.
  const deviceTimezone = getDeviceTimezone();
  const hourCycle = useHourCycle();
  const showDualTimezone = useMemo(
    () =>
      timezonesAreDifferent(
        deviceTimezone,
        timezone,
        dateStr && timeStr ? viewerInstant(dateStr, timeStr) : undefined
      ),
    [deviceTimezone, timezone, dateStr, timeStr]
  );
  // The recipient's zone by NAME — its city, localised for the reader. Bare
  // rather than parenthesised: the hint copy brings its own brackets and the
  // conversion line ends in a parenthetical day indicator.
  const recipientZone = getTimezoneLabel(timezone);
  const recipientName = circle?.recipient_name;

  /** "8:00 PM Denver = 9:00 PM Chicago (+1 day)", live as the user types. */
  const conversionText = useMemo(() => {
    if (!showDualTimezone || !dateStr || !timeStr) return null;
    try {
      const instant = viewerInstant(dateStr, timeStr);
      const render = (clock: string): string => {
        const [hh, mm] = clock.split(':').map(Number);
        return formatTimeOfDay(hh, mm, hourCycle);
      };
      const viewerTime = render(clockInZone(instant, deviceTimezone));
      const recipientTime = render(clockInZone(instant, timezone));
      const viewerDay = dayInZone(instant, deviceTimezone);
      const recipientDay = dayInZone(instant, timezone);
      const dayIndicator =
        viewerDay === recipientDay
          ? ''
          : ` (${t(recipientDay > viewerDay ? 'fields.dayOffsetNext' : 'fields.dayOffsetPrevious')})`;
      // A zone with no city in it yields no name, and a dangling space is worse
      // than no label.
      const withZone = (time: string, zone: string): string => (zone ? `${time} ${zone}` : time);
      return `${withZone(viewerTime, getTimezoneLabel(deviceTimezone))} = ${withZone(
        recipientTime,
        recipientZone
      )}${dayIndicator}`;
    } catch {
      return null;
    }
  }, [showDualTimezone, dateStr, timeStr, deviceTimezone, timezone, hourCycle, recipientZone, t]);

  const dualTimezoneLabel = recipientName
    ? t('fields.dualTimezoneHint', { name: recipientName, timezone: recipientZone })
    : t('fields.dualTimezoneHintGeneric', { timezone: recipientZone });

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

    // recorded_at: combine the VIEWER's wall time into a UTC ISO instant.
    if (!dateStr) fieldErrors.recorded_at = messageFor('dateRequired');
    if (!timeStr) fieldErrors.recorded_at = messageFor('timeRequired');

    let recordedAtISO = '';
    if (dateStr && timeStr) {
      recordedAtISO = viewerWallTimeToUtcISO(dateStr, timeStr);
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
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {t('common:cancel')}
          </Button>
          {/* `loading` swaps the label for a Spinner and sets aria-busy, so the
              old "Saving…" label (and its i18n key) is gone. */}
          <Button type="submit" form="vital-form" loading={isPending}>
            {isEditing ? t('edit.save') : t('add.save')}
          </Button>
        </div>
      }
    >
      <form id="vital-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {/* Type selector — create only; locked (its own type) when editing. */}
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <Text variant="label">{t('add.typeLabel')}</Text>
            <Text variant="bodyDense">{t(`types.${vitalType}`)}</Text>
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
            hint={showDualTimezone ? dualTimezoneLabel : undefined}
            onChange={(e) => {
              wallTouched.current = true;
              setDateStr(e.target.value);
              clearError('recorded_at');
            }}
          />
          <TimeField
            id="recorded_time"
            label={t('fields.time')}
            value={timeStr}
            // The live conversion sits on the TIME field, where the digits are.
            hint={conversionText ?? undefined}
            onChange={(e) => {
              wallTouched.current = true;
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
