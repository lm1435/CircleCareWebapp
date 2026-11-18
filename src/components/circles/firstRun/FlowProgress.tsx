import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * M1 (motion.md): the first run's progress segments. ONE progressbar element ("Step 2 of 4"),
 * never a focusable control per segment. The segment for the step being entered fills left to right
 * (400ms `transform`); under prefers-reduced-motion it is simply filled (globals.css `.cc-fr-segment`).
 *
 * Web has four steps where mobile has five: who, account, first item, All set. There is no reminders
 * ask on web (no push), so that segment does not exist here.
 */
export const WEB_FIRST_RUN_STEPS = 4;

export interface FlowProgressProps {
  /** 1-based step being shown. */
  current: number;
  total?: number;
}

export function FlowProgress({ current, total = WEB_FIRST_RUN_STEPS }: FlowProgressProps): ReactElement {
  const { t } = useTranslation('circles');
  const label = t('firstRun.who.progress', { current, total });
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-valuetext={label}
      aria-label={label}
      className="flex items-center justify-center gap-1.5"
      data-testid="first-run-progress"
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} aria-hidden="true" className="h-1 w-7 overflow-hidden rounded-full bg-line-2">
          <span
            className="cc-fr-segment block h-full w-full bg-moss"
            style={{ transform: i < current ? 'scaleX(1)' : 'scaleX(0)' }}
            data-filled={i < current ? 'true' : 'false'}
          />
        </span>
      ))}
    </div>
  );
}
