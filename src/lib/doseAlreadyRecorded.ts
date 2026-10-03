import type { TFunction } from 'i18next';
import { clockInZone } from '@/utils/recipientEventDate';
import { formatTimeOfDay, getDeviceTimezone } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';

/**
 * 409 DOSE_ALREADY_RECORDED — another caregiver already answered this dose
 * (PK1, decided 2026-09-29: "I wouldn't overwrite. Just warn I guess user xyz
 * already marked it?"). The backend keeps THEIR record and sends:
 *
 *   { error: { code: 'DOSE_ALREADY_RECORDED', message,
 *              details: { status: 'taken' | 'skipped', recorded_by_name,
 *                         recorded_at, timezone } } }
 *
 * The web renders its own sentence from `details` (the viewer's 12/24-hour
 * clock, the app language) — the SAME wording mobile shows
 * (mobile/src/utils/doseAlreadyRecorded.ts). The apiClient rejects with the
 * unwrapped envelope, so the code is at `error.error.code`.
 */
export const DOSE_ALREADY_RECORDED = 'DOSE_ALREADY_RECORDED';

export interface DoseAlreadyRecorded {
  /** What the other caregiver recorded (`taken_late` arrives as `taken`). */
  status: 'taken' | 'skipped';
  recordedByName: string | null;
  recordedAt: string | null;
  /** The care recipient's IANA zone. */
  timezone: string | null;
}

/** The refusal's details, or null for any other error. Never throws. */
export function doseAlreadyRecorded(error: unknown): DoseAlreadyRecorded | null {
  try {
    const body = (error as { error?: { code?: unknown; details?: any } } | null | undefined)?.error;
    if (body?.code !== DOSE_ALREADY_RECORDED) return null;
    const d = body.details ?? {};
    const name = typeof d.recorded_by_name === 'string' ? d.recorded_by_name.trim() : '';
    return {
      status: d.status === 'skipped' ? 'skipped' : 'taken',
      recordedByName: name || null,
      recordedAt: typeof d.recorded_at === 'string' && d.recorded_at ? d.recorded_at : null,
      timezone: typeof d.timezone === 'string' && d.timezone ? d.timezone : null,
    };
  } catch {
    return null;
  }
}

/**
 * "Already marked taken by Ana at 8:02 AM." — the time in the CARE RECIPIENT's
 * zone on the viewer's clock. Keys live in the `meds` namespace. Never the word
 * "failed": the dose IS recorded, by someone else.
 */
export function doseAlreadyRecordedMessage(
  t: TFunction,
  details: DoseAlreadyRecorded,
  hourCycle: HourCycle
): string {
  let time = '';
  try {
    if (details.recordedAt) {
      const instant = new Date(details.recordedAt);
      if (!Number.isNaN(instant.getTime())) {
        const [h, m] = clockInZone(instant, details.timezone || getDeviceTimezone())
          .split(':')
          .map(Number);
        time = formatTimeOfDay(h, m, hourCycle);
      }
    }
  } catch {
    time = '';
  }
  if (!time) return t('meds:dialog.alreadyRecordedGeneric');
  const skipped = details.status === 'skipped';
  if (details.recordedByName) {
    return t(skipped ? 'meds:dialog.alreadyRecordedSkipped' : 'meds:dialog.alreadyRecordedTaken', {
      name: details.recordedByName,
      time,
    });
  }
  return t(
    skipped ? 'meds:dialog.alreadyRecordedSkippedNoName' : 'meds:dialog.alreadyRecordedTakenNoName',
    { time }
  );
}

/** What a rendered "Change <name>'s answer?" dialog needs. */
export interface ChangeAnswerCopy {
  title: string;
  message: string;
  /** The cancel button: "Keep Ana's answer". */
  keep: string;
  confirm: string;
}

/** The viewer-clock time of their answer, in the care recipient's zone ('' if unknown). */
function answerTime(details: DoseAlreadyRecorded, hourCycle: HourCycle): string {
  try {
    if (!details.recordedAt) return '';
    const instant = new Date(details.recordedAt);
    if (Number.isNaN(instant.getTime())) return '';
    const [h, m] = clockInZone(instant, details.timezone || getDeviceTimezone())
      .split(':')
      .map(Number);
    return formatTimeOfDay(h, m, hourCycle);
  } catch {
    return '';
  }
}

/**
 * Spanish 12-hour times end in a period ("8:02 a. m."), so a template that closes its
 * sentence right after `{{time}}` printed "a. m.. ¿Cambiarla ..." (B4 finding). One period
 * does both jobs: collapse "a. m.." / "p. m.." to a single "." (any space flavour ICU emits).
 */
function collapseMeridiemPeriod(text: string): string {
  return text.replace(/([ap]\.[\s\u00a0\u202f]?m\.)\./gi, '$1');
}

/**
 * PK29 "Change Ana's answer?": the confirm dialog behind the "Change answer"
 * action of the already-recorded notice. Same wording as mobile
 * (`calendar.alerts.changeAnswer*`; here under `meds:dialog.*`). `mine` is what
 * THIS caregiver tried to record. Returns null when the dialog cannot be
 * written truthfully — the time of their answer is unknown, or the two answers
 * match (nothing to change) — and the notice then offers no action. A
 * taken_late attempt counts as taken. Literal keys on purpose (the dead-key
 * audit reads them).
 */
export function changeAnswerCopy(
  t: TFunction,
  details: DoseAlreadyRecorded,
  mine: 'taken' | 'taken_late' | 'skipped',
  hourCycle: HourCycle
): ChangeAnswerCopy | null {
  const wantSkipped = mine === 'skipped';
  if (wantSkipped === (details.status === 'skipped')) return null;
  const time = answerTime(details, hourCycle);
  if (!time) return null;
  const name = details.recordedByName;
  const confirm = t('meds:dialog.changeAnswerAction');
  if (name) {
    return {
      title: t('meds:dialog.changeAnswerTitle', { name }),
      message: collapseMeridiemPeriod(
        wantSkipped ? t('meds:dialog.changeAnswerToSkipped', { name, time }) : t('meds:dialog.changeAnswerToTaken', { name, time })
      ),
      keep: t('meds:dialog.keepAnswer', { name }),
      confirm,
    };
  }
  return {
    title: t('meds:dialog.changeAnswerTitleNoName'),
    message: collapseMeridiemPeriod(
      wantSkipped ? t('meds:dialog.changeAnswerToSkippedNoName', { time }) : t('meds:dialog.changeAnswerToTakenNoName', { time })
    ),
    keep: t('meds:dialog.keepAnswerNoName'),
    confirm,
  };
}
