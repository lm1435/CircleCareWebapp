import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, ChipSelect, Eyebrow, IconTile, Text, TextField, TimeField } from '@/components/ui';
import type { IconName } from '@/components/ui';
import {
  FIRST_RUN_PRESET_ORDER,
  FIRST_RUN_REPEAT_ORDER,
  type FirstRunPresetKey,
  type FirstRunRecurrence,
} from '@/utils/firstRunMedication';
import type { FirstRunAction } from './firstRunActionRoute';
import type { DrugSearchResult } from '@/api/drugs';
import { DrugAutocomplete } from '@/components/calendar/DrugAutocomplete';

/**
 * The four wizard screens, rebuilt in this repo's own idiom.
 *
 * The DECISION LOGIC is not here — it lives in `utils/firstRunMedication.ts`,
 * ported from mobile so both platforms write identical rows. These components
 * are presentation only: they own no timezone, no payload, and no analytics.
 *
 * NO React Native anything. Mobile's `ChipSelect` / `Button` / `AppDateTimePicker`
 * map onto this repo's `ChipSelect`, `Button` and a native `<input type="time">`
 * (`TimeField`); mobile's per-step CTA moves into the shared `Modal` footer,
 * which is where every other form on web puts it.
 */

/** Section heading shared by all four steps. */
function StepHeading({ eyebrow, title }: { eyebrow: string; title: string }): ReactElement {
  return (
    <header>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Text variant="h2" as="h3" className="mt-1.5">
        {title}
      </Text>
    </header>
  );
}

export interface FullDetailsLinkProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * "Add full details instead" — the escape hatch to AddEventModal, and the same
 * hand-off the constraint-4 gate takes from the save button.
 *
 * `disabled` is honoured because a save in flight must not open the full form
 * underneath it: on mobile, tapping this mid-save opened AddEvent and then the
 * save resolved and reset the stack out from under the form the user had just
 * opened, with the medication already created.
 */
export function FullDetailsLink({ onClick, disabled = false }: FullDetailsLinkProps): ReactElement {
  const { t } = useTranslation('circles');
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className="self-center"
    >
      {t('firstRun.fullDetails')}
    </Button>
  );
}

// ── ① Choose an action ──────────────────────────────────────────────────────

interface ActionOption {
  id: Exclude<FirstRunAction, 'skip'>;
  /** Ionicons glyph, drawn in an `IconTile` — no hand-drawn SVG (spec §4.4). */
  icon: IconName;
  title: string;
  description: string;
  recommended?: boolean;
}

export interface ChooseActionStepProps {
  recipientName: string;
  onSelect: (action: FirstRunAction) => void;
}

export function ChooseActionStep({ recipientName, onSelect }: ChooseActionStepProps): ReactElement {
  const { t } = useTranslation('circles');

  // Copy comes from the EXISTING `quickWin.*` shape mobile uses — this is the
  // same four choices its QuickWinModal offered, unchanged.
  const options: ActionOption[] = [
    {
      id: 'medication',
      icon: 'medkit-outline',
      title: t('quickWin.medication.title'),
      description: t('quickWin.medication.description'),
      recommended: true,
    },
    {
      id: 'appointment',
      icon: 'calendar-outline',
      title: t('quickWin.appointment.title'),
      description: t('quickWin.appointment.description'),
    },
    {
      id: 'invite',
      icon: 'people-outline',
      title: t('quickWin.invite.title'),
      description: t('quickWin.invite.description'),
    },
    {
      id: 'emergency',
      icon: 'medical-outline',
      title: t('quickWin.emergency.title'),
      description: t('quickWin.emergency.description'),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        eyebrow={t('firstRun.steps.choose')}
        title={t('quickWin.subtitle', { name: recipientName })}
      />

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {options.map((option) => (
          <li key={option.id}>
            {/* The recommended option is the ONE accented surface (spec
                §6.3 / §4.5 `Card variant="accent"`); the rest are outlined.
                Both are real `Card`s, so neither draws its own shell. */}
            <Card
              variant={option.recommended ? 'accent' : 'outlined'}
              padding="sm"
              onPress={() => onSelect(option.id)}
              className="flex min-h-11 items-center gap-4"
            >
              <IconTile
                size={44}
                tone={option.recommended ? 'clay' : 'neutral'}
                name={option.icon}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-md font-medium text-ink">{option.title}</span>
                <span className="text-sm text-ink-2">{option.description}</span>
                {option.recommended ? (
                  <Eyebrow color="clay" className="mt-1">
                    {t('quickWin.recommended')}
                  </Eyebrow>
                ) : null}
              </span>
            </Card>
          </li>
        ))}
      </ul>

      <p className="m-0 border-t border-line-2 pt-4 text-sm text-ink-2">{t('quickWin.tip')}</p>
    </div>
  );
}

// ── ② Medication name ───────────────────────────────────────────────────────

export interface MedicationNameStepProps {
  recipientName: string;
  name: string;
  dosage: string;
  onChangeName: (next: string) => void;
  onChangeDosage: (next: string) => void;
  /** Set once the user has tried to advance with a blank name. */
  nameError?: string;
  /** The RxNorm row behind `name` — see `DrugAutocomplete`; both required. */
  selectedDrug: DrugSearchResult | null;
  onSelectDrug: (drug: DrugSearchResult | null) => void;
}

/**
 * Screen ② — the name, and optionally the dosage.
 *
 * An unnamed medication is the one field the payload builder cannot supply a
 * default for, so Continue is blocked on it and says why, rather than failing
 * at save after two more questions.
 */
export function MedicationNameStep({
  recipientName,
  name,
  dosage,
  onChangeName,
  onChangeDosage,
  nameError,
  selectedDrug,
  onSelectDrug,
}: MedicationNameStepProps): ReactElement {
  const { t } = useTranslation(['circles', 'calendar']);

  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        eyebrow={t('firstRun.steps.what')}
        title={t('firstRun.whatTitle', { name: recipientName })}
      />

      <DrugAutocomplete
        id="first-run-name"
        label={t('calendar:addEvent.fields.medicationName')}
        placeholder={t('calendar:addEvent.placeholders.medicationName')}
        value={name}
        maxLength={150}
        required
        autoFocus
        error={nameError}
        selectedDrug={selectedDrug}
        onSelectDrug={onSelectDrug}
        onChange={onChangeName}
      />

      <TextField
        id="first-run-dosage"
        label={t('firstRun.dosageLabel')}
        placeholder={t('firstRun.dosagePlaceholder')}
        value={dosage}
        maxLength={100}
        onChange={(e) => onChangeDosage(e.target.value)}
      />
    </div>
  );
}

// ── ③ When ──────────────────────────────────────────────────────────────────

export interface ScheduleSelection {
  presetKey: FirstRunPresetKey;
  /** `HH:MM`, non-null only for `presetKey === 'custom'`. */
  customTime: string | null;
}

export interface ScheduleStepProps {
  recipientName: string;
  presetKey: FirstRunPresetKey;
  customTime: string | null;
  onChange: (next: ScheduleSelection) => void;
}

/**
 * Screen ③ — when the dose is taken.
 *
 * The preset strip is NOT deselectable: one option is always chosen, so the
 * empty-schedule state that produces a `missing_time` save failure on the full
 * form is unreachable here.
 *
 * The custom time is a SEPARATE control, not a fifth chip. The four presets
 * SELECT A VALUE; custom OPENS A PICKER, and overloading one selection control
 * with both is a trap: clicking an already-selected chip is either a no-op
 * (`allowDeselect={false}`) or a clear, so a user who had set 2:00 PM could not
 * reopen the picker to change it. As its own field it is always editable, and
 * the strip keeps its "one chip is always selected" guarantee untouched.
 */
export function ScheduleStep({
  recipientName,
  presetKey,
  customTime,
  onChange,
}: ScheduleStepProps): ReactElement {
  const { t } = useTranslation(['circles', 'calendar']);

  // Literal `t()` arguments, not a computed lookup off FIRST_RUN_PRESET_ORDER —
  // key-coverage tooling only resolves literals, and a computed argument becomes
  // an unverified dynamic call site.
  const presetLabels: Record<Exclude<FirstRunPresetKey, 'custom'>, string> = {
    everyMorning: t('calendar:addEvent.schedulePresets.everyMorning'),
    everyEvening: t('calendar:addEvent.schedulePresets.everyEvening'),
    twiceDaily: t('calendar:addEvent.schedulePresets.twiceDaily'),
    threeTimesDaily: t('calendar:addEvent.schedulePresets.threeTimesDaily'),
  };

  const customSelected = presetKey === 'custom';

  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        eyebrow={t('firstRun.steps.when')}
        title={t('firstRun.whenTitle', { name: recipientName })}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">
          {t('calendar:addEvent.schedulePresets.label')}
        </span>
        <ChipSelect
          label={t('calendar:addEvent.schedulePresets.label')}
          options={FIRST_RUN_PRESET_ORDER.map((key) => ({
            value: key,
            label: presetLabels[key],
          }))}
          // null while a custom time is in force: no preset is selected then,
          // and the time field below carries the selected state instead.
          value={customSelected ? null : presetKey}
          allowDeselect={false}
          onChange={(next) => {
            // A null (or any unrecognised value) simply fails to match a preset,
            // so a schedule-CLEARING change is not a value this component can
            // emit. The invariant is structural, not merely defended.
            const key = FIRST_RUN_PRESET_ORDER.find((k) => k === next);
            if (key) onChange({ presetKey: key, customTime: null });
          }}
        />
      </div>

      <TimeField
        id="first-run-custom-time"
        label={t('firstRun.customTimeLabel')}
        hint={t('firstRun.customTimeHint')}
        value={customTime ?? ''}
        onChange={(e) => {
          const next = e.target.value;
          // Clearing the field returns to the preset strip rather than leaving
          // the wizard with `custom` and no time — a state the payload builder
          // throws on, and which no user gesture should be able to reach.
          onChange(
            next
              ? { presetKey: 'custom', customTime: next }
              : { presetKey: 'everyMorning', customTime: null }
          );
        }}
      />
    </div>
  );
}

// ── ④ Repeat ────────────────────────────────────────────────────────────────

export interface RepeatStepProps {
  recurrence: FirstRunRecurrence;
  onChange: (next: FirstRunRecurrence) => void;
}

/**
 * Screen ④ — how often the dose repeats.
 *
 * A DELIBERATE SUBSET of the rules the full form offers: monthly, yearly and
 * cycle are absent on purpose. `requiresFullForm()` hands a multi-dose preset on
 * a non-daily rule to AddEventModal, and widening this list widens the set of
 * combinations the wizard claims to handle. Not deselectable either — "no
 * repeat" is the explicit `none` chip, not the absence of a selection.
 */
export function RepeatStep({ recurrence, onChange }: RepeatStepProps): ReactElement {
  const { t } = useTranslation(['circles', 'calendar']);

  const labels: Record<FirstRunRecurrence, string> = {
    daily: t('calendar:addEvent.recurrence.daily'),
    every_other_day: t('calendar:addEvent.recurrence.everyOtherDay'),
    weekly: t('calendar:addEvent.recurrence.weekly'),
    none: t('calendar:addEvent.recurrence.never'),
  };

  return (
    <div className="flex flex-col gap-4">
      <StepHeading eyebrow={t('firstRun.steps.repeat')} title={t('firstRun.repeatTitle')} />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">
          {t('calendar:addEvent.fields.repeat')}
        </span>
        <ChipSelect
          label={t('calendar:addEvent.fields.repeat')}
          options={FIRST_RUN_REPEAT_ORDER.map((key) => ({ value: key, label: labels[key] }))}
          value={recurrence}
          allowDeselect={false}
          onChange={(next) => {
            const key = FIRST_RUN_REPEAT_ORDER.find((k) => k === next);
            if (key) onChange(key);
          }}
        />
      </div>
    </div>
  );
}
