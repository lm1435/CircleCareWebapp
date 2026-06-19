import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui';

const WEEK_COLUMNS = [0, 1, 2, 3, 4, 5, 6];
const MONTH_CELLS = Array.from({ length: 42 }, (_, i) => i);

/** Grid-shaped loading skeletons matching the week/month layouts. */
export function CalendarSkeleton({ view }: { view: 'week' | 'month' }): ReactElement {
  const { t } = useTranslation('common');

  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-cream">
      <span className="sr-only">{t('loading')}</span>
      {view === 'week' ? (
        <>
          {/* Header row: time-axis spacer + 7 day header pills */}
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-line-2 p-2">
            <div />
            {WEEK_COLUMNS.map((column) => (
              <div key={column} className="flex justify-center px-1">
                <Skeleton className="h-12 w-9 rounded-lg" />
              </div>
            ))}
          </div>
          {/* Timed grid: time axis column + 7 day columns with block placeholders */}
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] p-2">
            <div className="flex flex-col gap-6 pr-1">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <Skeleton key={row} className="ml-auto h-3 w-8" />
              ))}
            </div>
            {WEEK_COLUMNS.map((column) => (
              <div key={column} className="flex flex-col gap-3 border-l border-line-2 px-1">
                <Skeleton className="h-8 w-full rounded" />
                <Skeleton className="mt-10 h-12 w-full rounded" />
                <Skeleton className="h-8 w-full rounded" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-7 gap-2 p-3">
          {MONTH_CELLS.map((cell) => (
            <Skeleton key={cell} className="h-16 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}
