import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Button,
  Card,
  ChipSelect,
  Eyebrow,
  Icon,
  TEXT_CLASS,
  Text,
  TextField,
  TimeField,
} from '@/components/ui';
import type { HourCycle } from '@/utils/hourCycle';
import {
  FIRST_RUN_PRESET_ORDER,
  FIRST_RUN_REPEAT_ORDER,
  firstRunAllTimes,
  formatFirstRunTime,
  type FirstRunPresetKey,
  type FirstRunRecurrence,
} from '@/utils/firstRunMedication';
import type { FirstRunAction } from './firstRunActionRoute';
import type { DrugSearchResult } from '@/api/drugs';
import { DrugAutocomplete } from '@/components/calendar/DrugAutocomplete';
import { useIsOffline } from '@/hooks/useIsOffline';
import { explainOfflineWrite } from '@/lib/offlineWrite';

/**
 * The wizard screens, rebuilt in this repo's own idiom.
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

// ── ① The circle is ready ───────────────────────────────────────────────────

export interface ChooseActionStepProps {
  recipientName: string;
  /** Self-care owner IS the recipient: address them as "you", not by name. */
  isSelfCare?: boolean;
  onSelect: (action: FirstRunAction) => void;
  /** Fired on every tap of the "see what else" toggle, with the NEW state. */
  onMoreOptionsToggled?: (open: boolean) => void;
}

/**
 * Screen ① — "{{name}}'s circle is ready." and ONE button: the first
 * medication. Everything else (appointment, invite, emergency info) sits behind
 * a quiet text toggle that reveals a card of rows ABOVE the primary. Each row
 * routes through the same `onSelect` as before, so routing and analytics are
 * unchanged. The toggle state lives here and starts closed; nothing animates,
 * so reduced motion is respected by construction.
 */
export function ChooseActionStep({
  recipientName,
  isSelfCare,
  onSelect,
  onMoreOptionsToggled,
}: ChooseActionStepProps): ReactElement {
  const { t } = useTranslation('circles');
  const [open, setOpen] = useState(false);
  // Offline (owner decision 2026-10-14): every choice here starts a create, so each
  // explains with the 'change' sentence and goes nowhere — mobile FirstRunWizardScreen's
  // `handleAction` gate. "Skip for now" (the modal footer) is a close and stays live.
  const offline = useIsOffline();

  const rows: {
    id: Exclude<FirstRunAction, 'skip' | 'medication'>;
    title: string;
    helper: string;
  }[] = [
    {
      id: 'appointment',
      title: t('firstRun.ready.appointmentTitle'),
      helper: t('firstRun.ready.appointmentHelper'),
    },
    {
      id: 'invite',
      title: t('firstRun.ready.inviteTitle'),
      helper: t('firstRun.ready.inviteHelper'),
    },
    {
      id: 'emergency',
      title: t('firstRun.ready.emergencyTitle'),
      helper: t('firstRun.ready.emergencyHelper'),
    },
  ];

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    onMoreOptionsToggled?.(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Avatar name={recipientName} size="lg" />
        <Text variant="h2" as="h3">
          {isSelfCare ? t('firstRun.ready.titleSelf') : t('firstRun.ready.title', { name: recipientName })}
        </Text>
        <Text variant="caption" id="first-run-ready-lede">
          {isSelfCare ? t('firstRun.ready.ledeSelf') : t('firstRun.ready.lede', { name: recipientName })}
        </Text>
      </header>

      {open && (
        <Card
          as="ul"
          variant="outlined"
          padding="none"
          id="first-run-more-options"
          className="m-0 flex list-none flex-col"
        >
          {rows.map((row) => (
            <li key={row.id} className="border-t border-line-2 first:border-t-0">
              <button
                type="button"
                aria-disabled={offline || undefined}
                onClick={() => (offline ? explainOfflineWrite('change') : onSelect(row.id))}
                data-testid={`first-run-start-with-${row.id}`}
                className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-left transition-colors duration-fast hover:bg-bg-2${offline ? ' cursor-not-allowed opacity-50' : ''}`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-md font-semibold text-ink">{row.title}</span>
                  <span className="text-sm text-ink-2">{row.helper}</span>
                </span>
                <Icon name="chevron-forward" size="inline" className="flex-none text-ink-3" />
              </button>
            </li>
          ))}
        </Card>
      )}

      <div className="flex flex-col gap-1">
        <Button
          type="button"
          fullWidth
          offlineKind="change"
          onClick={() => onSelect('medication')}
          data-testid="first-run-primary"
          aria-describedby="first-run-ready-lede"
        >
          {isSelfCare ? t('firstRun.choose.primarySelf') : t('firstRun.choose.primary')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="first-run-more-options"
          data-testid="first-run-more-toggle"
          className="self-center"
        >
          {open ? t('firstRun.ready.toggleHide') : t('firstRun.ready.toggleShow')}
        </Button>
      </div>
    </div>
  );
}

// ── ⑤ Payoff, then the invite offer, after the medication saved ─────────────

/** What the wizard just saved — the payoff card is built from it. */
export interface SavedMedicationSummary {
  name: string;
  /** Every dose time, `HH:MM`, the same ones step ③ showed. */
  times: string[];
  recurrence: FirstRunRecurrence;
}

export interface InviteAfterSaveStepProps {
  recipientName: string;
  /** Self-care owner IS the recipient: address them as "you", not by name. */
  isSelfCare?: boolean;
  saved: SavedMedicationSummary;
  hourCycle: HourCycle;
}

/**
 * Shown once the first medication has saved: the payoff ("your reminder is
 * set", with the card as the circle will see it), then ONE invite question.
 * The footer carries the Invite / Not now buttons. Presentation only.
 */
export function InviteAfterSaveStep({
  recipientName,
  isSelfCare,
  saved,
  hourCycle,
}: InviteAfterSaveStepProps): ReactElement {
  const { t } = useTranslation(['circles', 'calendar']);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Focus follows the step change (the heading names what just happened).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const times = saved.times.map((time) => formatFirstRunTime(time, hourCycle));
  const multi = times.length > 1;
  const recurrenceLabels: Record<FirstRunRecurrence, string> = {
    daily: t('calendar:addEvent.recurrence.daily'),
    every_other_day: t('calendar:addEvent.recurrence.everyOtherDay'),
    weekly: t('calendar:addEvent.recurrence.weekly'),
    none: t('calendar:addEvent.recurrence.never'),
  };
  const title = isSelfCare
    ? multi
      ? t('firstRun.payoff.titleMultiSelf')
      : t('firstRun.payoff.titleSelf', { time: times[0] })
    : multi
      ? t('firstRun.payoff.titleMulti', { name: recipientName })
      : t('firstRun.payoff.title', { name: recipientName, time: times[0] });

  return (
    <div className="flex flex-col gap-4" data-testid="first-run-invite-step">
      <h3 ref={headingRef} tabIndex={-1} className={`${TEXT_CLASS.h2} m-0 outline-none`}>
        {title}
      </h3>

      <Card
        variant="outlined"
        padding="sm"
        className="flex items-center gap-3"
        data-testid="first-run-payoff-card"
      >
        <span
          aria-hidden="true"
          className="h-6 w-6 flex-none rounded-full border-2 border-clay"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-md font-semibold text-ink">{saved.name}</span>
          <span className="text-sm text-ink-2">
            {times.join(', ')} · {recurrenceLabels[saved.recurrence]}
          </span>
        </div>
      </Card>

      <Text variant="caption">
        {isSelfCare ? t('firstRun.payoff.lineSelf') : t('firstRun.payoff.line')}
      </Text>

      <div className="flex flex-col gap-1 border-t border-line-2 pt-4">
        <Text variant="h4" as="p">
          {isSelfCare
            ? t('firstRun.payoff.inviteHeadingSelf')
            : t('firstRun.payoff.inviteHeading', { name: recipientName })}
        </Text>
      </div>
    </div>
  );
}

// ── ② Medication name ───────────────────────────────────────────────────────

export interface MedicationNameStepProps {
  recipientName: string;
  /** Self-care owner IS the recipient: address them as "you", not by name. */
  isSelfCare?: boolean;
  name: string;
  dosage: string;
  onChangeName: (next: string) => void;
  onChangeDosage: (next: string) => void;
  /** Set once the user has tried to advance with a blank name. */
  nameError?: string;
  /** The RxNorm row behind `name` — see `DrugAutocomplete`; both required. */
  selectedDrug: DrugSearchResult | null;
  onSelectDrug: (drug: DrugSearchResult | null) => void;
  /** The CURRENT schedule answer — the "Next" preview shows what ③ will show. */
  presetKey: FirstRunPresetKey;
  customTime: string | null;
  hourCycle: HourCycle;
}

/**
 * Screen ② — the name; the dosage hides behind "+ Add dosage".
 *
 * An unnamed medication is the one field the payload builder cannot supply a
 * default for, so Continue is blocked on it and says why, rather than failing
 * at save after two more questions.
 */
export function MedicationNameStep({
  recipientName,
  isSelfCare,
  name,
  dosage,
  onChangeName,
  onChangeDosage,
  nameError,
  selectedDrug,
  onSelectDrug,
  presetKey,
  customTime,
  hourCycle,
}: MedicationNameStepProps): ReactElement {
  const { t } = useTranslation(['circles', 'calendar']);
  // Starts revealed when there is already a dosage (Back from ③).
  const [dosageShown, setDosageShown] = useState(dosage.trim().length > 0);
  const dosageRef = useRef<HTMLInputElement>(null);
  const focusDosageRef = useRef(false);
  useEffect(() => {
    if (dosageShown && focusDosageRef.current) {
      focusDosageRef.current = false;
      dosageRef.current?.focus();
    }
  }, [dosageShown]);

  const firstTime = firstRunAllTimes(presetKey, customTime)[0];
  // One literal t() per preset (key-coverage tooling resolves literals only).
  const previewTime = firstTime ? formatFirstRunTime(firstTime, hourCycle) : null;
  const preview =
    previewTime === null
      ? null
      : presetKey === 'everyMorning'
        ? t('firstRun.nextPreview.everyMorning', { time: previewTime })
        : presetKey === 'everyEvening'
          ? t('firstRun.nextPreview.everyEvening', { time: previewTime })
          : presetKey === 'twiceDaily'
            ? t('firstRun.nextPreview.twiceDaily', { time: previewTime })
            : presetKey === 'threeTimesDaily'
              ? t('firstRun.nextPreview.threeTimesDaily', { time: previewTime })
              : t('firstRun.nextPreview.custom', { time: previewTime });

  return (
    <div className="flex flex-col gap-4">
      <StepHeading
        eyebrow={t('firstRun.steps.what')}
        title={
          isSelfCare ? t('firstRun.whatTitleSelf') : t('firstRun.whatTitle', { name: recipientName })
        }
      />

      <Text variant="caption" className="-mt-2">
        {t('firstRun.whatLede')}
      </Text>

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

      {dosageShown ? (
        <TextField
          ref={dosageRef}
          id="first-run-dosage"
          label={t('firstRun.dosageLabel')}
          placeholder={t('firstRun.dosagePlaceholder')}
          value={dosage}
          maxLength={100}
          onChange={(e) => onChangeDosage(e.target.value)}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          data-testid="first-run-add-dosage"
          onClick={() => {
            focusDosageRef.current = true;
            setDosageShown(true);
          }}
        >
          {t('firstRun.addDosage')}
        </Button>
      )}

      {preview && (
        <div
          className="flex flex-col gap-1 rounded-xl border border-line-2 bg-moss-soft p-4"
          data-testid="first-run-next-preview"
        >
          <Eyebrow>{t('firstRun.nextEyebrow')}</Eyebrow>
          <p className="m-0 text-md text-ink">{preview}</p>
        </div>
      )}
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
  /** Self-care owner IS the recipient: address them as "you", not by name. */
  isSelfCare?: boolean;
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
  isSelfCare,
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
        title={
          isSelfCare ? t('firstRun.whenTitleSelf') : t('firstRun.whenTitle', { name: recipientName })
        }
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
