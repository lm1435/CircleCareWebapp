import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import { Eyebrow } from '@/components/ui';
import { buildSummaryLines, formatStillToDoItem } from '@/lib/dailyUpdateCopy';
import { useHourCycle } from '@/hooks/useHourCycle';
import { DAILY_UPDATE_HAIRLINE } from './surface';

export interface DailyUpdateSectionsProps {
  data: DailyUpdateData;
  /** A past day's dated view: "What happened" / "Not done that day". */
  past: boolean;
  /** Section heading level: h3 inside the Home card, h2 on the full page. */
  headingLevel: 'h2' | 'h3';
}

/** One plain-text row. 16/24 ink; never a control, never an icon. */
const ROW = 'text-md leading-normal text-ink';
/** The rest state ("Nothing else on the schedule today."). */
const REST = 'm-0 text-md leading-normal text-ink-2';

/**
 * The two sections of a daily update — THE LEDGER — shared by the Home card
 * and the full / dated view so their wording and order can never drift
 * (docs/plans/daily-update.md §2.1, §3.3, "Design (Fable)"):
 *
 *   1. "Today so far" (past day: "What happened") — count lines, zeros omitted.
 *   2. "Still to do" (past day: "Not done that day") — items, then "+N more",
 *      or "Nothing else on the schedule today." when there are none.
 *
 * Layout: the two sections stack on a phone with one moss hairline between
 * them, and sit side by side from `md` (768px) with a vertical hairline — a
 * ledger, not a list of cards. Section labels are tracked eyebrows (the
 * Profile section-label voice) that are real headings for the rotor. Every
 * row is plain text in ONE color: a skipped dose is a fact, never an alarm.
 */
export function DailyUpdateSections({
  data,
  past,
  headingLevel,
}: DailyUpdateSectionsProps): ReactElement {
  const { t, i18n } = useTranslation('dailyUpdate');
  const cycle = useHourCycle();
  const lines = buildSummaryLines(data, t, past);
  const items = data.still_to_do;
  const more = Math.max(0, data.still_to_do_more);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-0">
      <section className="md:pr-6">
        <Eyebrow as={headingLevel} color="ink-3">
          {past ? t('sections.happened') : t('sections.soFar')}
        </Eyebrow>
        {lines.length > 0 ? (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0" data-testid="daily-update-summary">
            {lines.map((line) => (
              <li key={line.id} data-line={line.id} className={ROW}>
                {line.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${REST} mt-2`}>{t('dated.empty')}</p>
        )}
      </section>

      <section
        className={`border-t ${DAILY_UPDATE_HAIRLINE} pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6`}
      >
        <Eyebrow as={headingLevel} color="ink-3">
          {past ? t('sections.notDone') : t('sections.stillToDo')}
        </Eyebrow>
        {items.length > 0 ? (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0" data-testid="daily-update-still-to-do">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}-${item.time ?? ''}`} className={ROW}>
                {formatStillToDoItem(item, t, {
                  timezone: data.timezone,
                  cycle,
                  past,
                  language: i18n.language,
                })}
              </li>
            ))}
            {more > 0 ? (
              <li className="text-md leading-normal text-ink-2">{t('item.more', { count: more })}</li>
            ) : null}
          </ul>
        ) : (
          <p className={`${REST} mt-2`}>{past ? t('nothingLeftPast') : t('nothingLeft')}</p>
        )}
      </section>
    </div>
  );
}
