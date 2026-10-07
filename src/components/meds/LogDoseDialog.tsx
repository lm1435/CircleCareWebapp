import { baseLanguage } from '@/i18n/locales';
import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ChipSelect, Modal, TextField } from '@/components/ui';
import { formatInstantClock, newClientRequestId } from '@/lib/asNeeded';
import { useHourCycle } from '@/hooks/useHourCycle';
import { getTimezoneSuffix, type TimeLanguage } from '@/utils/timezone';

// "Log a dose of {name}?" — the dialog behind "Gave a dose" (mockup w1-web).
//
// "Given" is a set of PRESETS, the same seven mobile offers: Now, 15 min,
// 30 min, 1 h, 2 h, 4 h, 8 h ago — all inside the server's 48 h window and
// never in the future, so there is nothing to validate. The instant is
// computed at submit from the chosen offset.
//
// NO limits, no counters, no "last dose was N hours ago" here (owner decision
// 2026-10-05). The one thing that can interrupt a log is another MEMBER having
// just logged the same medication — that prompt lives upstream, and on the
// server.

/** Minutes before now, per preset. 0 = "Now" (the server stamps it). */
export const GIVEN_PRESET_MINUTES = [0, 15, 30, 60, 120, 240, 480] as const;

export interface LogDoseSubmit {
  /** ISO instant, or undefined for "now" (the server stamps it). */
  givenAt?: string;
  /** Trimmed note, or null. */
  note: string | null;
  /**
   * The idempotency key of THIS dose, minted when the dialog opened. Every send
   * of this dose — the deferred POST, a keepalive flush, a retry after a 409 —
   * carries it, so the server can recognise a replay instead of writing twice.
   */
  clientRequestId: string;
}

export interface LogDoseDialogProps {
  name: string;
  dosage?: string | null;
  timezone: string;
  /** The person logging IS the care recipient: address them as "you". */
  isSelf?: boolean;
  onCancel: () => void;
  onSubmit: (values: LogDoseSubmit) => void;
  /** Test seam: the clock. */
  now?: () => Date;
}

const NOTE_MAX = 500;

export function LogDoseDialog({
  name,
  dosage,
  timezone,
  isSelf = false,
  onCancel,
  onSubmit,
  now = () => new Date(),
}: LogDoseDialogProps): ReactElement {
  const { t, i18n } = useTranslation('meds');
  const hourCycle = useHourCycle();
  const language: TimeLanguage = baseLanguage(i18n.language);

  // Minted ONCE per open. A re-render must never mint a second key for the same
  // dose; a second OPEN is a different dose and gets its own.
  const requestId = useRef<string>(newClientRequestId());
  const [minutes, setMinutes] = useState<number>(0);
  const [note, setNote] = useState('');

  const options = GIVEN_PRESET_MINUTES.map((m) => ({
    value: String(m),
    label:
      m === 0
        ? t('asNeeded.log.chipNow')
        : m < 60
          ? t('asNeeded.log.chipMinutes', { count: m })
          : t('asNeeded.log.chipHours', { count: m / 60 }),
  }));

  // What the choice means on the recipient's clock, so "2 h ago" is concrete.
  const current = now();
  const chosen = new Date(current.getTime() - minutes * 60_000);
  const clock = `${formatInstantClock(chosen, timezone, hourCycle, language)}${getTimezoneSuffix(
    timezone,
    chosen,
    { language }
  )}`;

  function submit(e: FormEvent): void {
    e.preventDefault();
    const trimmed = note.trim();
    onSubmit({
      givenAt: minutes === 0 ? undefined : new Date(now().getTime() - minutes * 60_000).toISOString(),
      note: trimmed ? trimmed : null,
      clientRequestId: requestId.current,
    });
  }

  return (
    <Modal
      title={t(isSelf ? 'asNeeded.log.titleSelf' : 'asNeeded.log.title', { name })}
      onClose={onCancel}
      closeLabel={t('asNeeded.log.cancel')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('asNeeded.log.cancel')}
          </Button>
          <Button type="submit" form="log-dose-form" data-testid="log-dose-submit">
            {t(isSelf ? 'asNeeded.log.submitSelf' : 'asNeeded.log.submit')}
          </Button>
        </>
      }
    >
      <form id="log-dose-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="m-0 text-sm text-ink-2">
          {[dosage, t(isSelf ? 'asNeeded.log.subtitleSelf' : 'asNeeded.log.subtitle')].filter(Boolean).join(' · ')}
        </p>

        <ChipSelect
          id="log-dose-given"
          label={t('asNeeded.log.given')}
          options={options}
          value={String(minutes)}
          onChange={(next) => {
            // Deselecting is not a choice: "Now" is always the floor.
            setMinutes(next === null ? 0 : Number(next));
          }}
        />
        <p className="m-0 text-sm text-ink-3" data-testid="log-dose-when">
          {clock}
        </p>

        <TextField
          id="log-dose-note"
          label={t('asNeeded.log.noteLabel')}
          value={note}
          maxLength={NOTE_MAX}
          placeholder={t('asNeeded.log.notePlaceholder')}
          onChange={(ev) => setNote(ev.target.value)}
        />
      </form>
    </Modal>
  );
}
