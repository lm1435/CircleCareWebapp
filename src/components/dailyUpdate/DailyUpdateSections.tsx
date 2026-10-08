import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import { Text } from '@/components/ui';
import { buildSummaryLines, formatStillToDoItem } from '@/lib/dailyUpdateCopy';
import { useHourCycle } from '@/hooks/useHourCycle';

export interface DailyUpdateSectionsProps {
  data: DailyUpdateData;
  /** A past day's dated view: "What happened" / "Not done that day". */
  past: boolean;
  /** Section heading level: h3 inside the Home card, h2 on the full page. */
  headingLevel: 'h2' | 'h3';
}

/**
 * The two sections of a daily update, shared by the Home card and the full /
 * dated view so their wording and order can never drift
 * (docs/plans/daily-update.md §2.1, §3.3):
 *
 *   1. "Today so far" (past day: "What happened") — count lines, zeros omitted.
 *   2. "Still to do" (past day: "Not done that day") — items, then "+N more",
 *      or "Nothing else on the schedule today." when there are none.
 *
 * Every row is plain text (no per-row icons, no pressables), separated by
 * hairlines, as on mobile.
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
    <div className="flex flex-col">
      <section className="pt-4">
        <Text variant={headingLevel === 'h2' ? 'h3' : 'label'} as={headingLevel}>
          {past ? t('sections.happened') : t('sections.soFar')}
        </Text>
        {lines.length > 0 ? (
          <ul className="m-0 mt-2 list-none p-0" data-testid="daily-update-summary">
            {lines.map((line) => (
              <li
                key={line.id}
                data-line={line.id}
                className="border-t border-line-2 py-2 text-md text-ink first:border-t-0"
              >
                {line.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-2 text-md text-ink-2">{t('dated.empty')}</p>
        )}
      </section>

      <section className="mt-3 border-t border-line-2 pt-4">
        <Text variant={headingLevel === 'h2' ? 'h3' : 'label'} as={headingLevel}>
          {past ? t('sections.notDone') : t('sections.stillToDo')}
        </Text>
        {items.length > 0 ? (
          <ul className="m-0 mt-2 list-none p-0" data-testid="daily-update-still-to-do">
            {items.map((item) => (
              <li
                key={`${item.kind}-${item.id}-${item.time ?? ''}`}
                className="border-t border-line-2 py-2 text-md text-ink first:border-t-0"
              >
                {formatStillToDoItem(item, t, {
                  timezone: data.timezone,
                  cycle,
                  past,
                  language: i18n.language,
                })}
              </li>
            ))}
            {more > 0 ? (
              <li className="border-t border-line-2 py-2 text-md text-ink-2">
                {t('item.more', { count: more })}
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="m-0 mt-2 text-md text-ink-2">
            {past ? t('nothingLeftPast') : t('nothingLeft')}
          </p>
        )}
      </section>
    </div>
  );
}
