import { useMemo, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem } from '@/api/activityFeed';
import { ActivityItem } from '@/components/activity/ActivityItem';
import { LatestHero } from '@/components/activity/LatestHero';
import { formatDayLabel, getLocalDateKey } from '@/components/activity/activityFormat';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { ActivityIcon } from '@/components/ui/emptyStateIcons';
import { useActivityFeed } from '@/hooks/useActivityFeed';

// Activity feed page (Task 25): read-only feed grouped by viewer-local day
// (Today / Yesterday / date headings) with "Load more" pagination against
// GET /circles/:circleId/activity (limit/offset).

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

interface DayGroup {
  date: string; // viewer-local YYYY-MM-DD key
  activities: ActivityFeedItem[];
}

export default function ActivityFeedPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['activity', 'common']);

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useActivityFeed(circleId);

  const activities = useMemo(
    () => data?.pages.flatMap((page) => page.activities) ?? [],
    [data]
  );

  // Group by viewer-local day, newest day first (backend returns newest-first).
  const dayGroups = useMemo<DayGroup[]>(() => {
    const byDate: Record<string, ActivityFeedItem[]> = {};
    for (const activity of activities) {
      const key = getLocalDateKey(activity.created_at);
      (byDate[key] ??= []).push(activity);
    }
    return Object.keys(byDate)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date, activities: byDate[date] }));
  }, [activities]);

  return (
    <section className="mx-auto max-w-4xl p-6 md:p-8">
      <header>
        <h1 className="serif m-0 text-xl text-ink">{t('activity:title')}</h1>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('activity:subtitle')}</p>
      </header>

      <div className="mt-6">
        {isLoading && (
          <div role="status" aria-live="polite">
            <span className="sr-only">{t('activity:loading')}</span>
            <Skeleton className="h-6 w-28" />
            <ul className="m-0 mt-2 list-none p-0">
              {SKELETON_ROWS.map((row) => (
                <li key={row} className="flex items-start gap-3 border-b border-line-2 py-4 last:border-b-0">
                  <Skeleton className="h-8 w-8 shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-2/3 max-w-80" />
                    <Skeleton className="mt-2 h-3 w-1/3 max-w-40" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isError && (
          <Card className="text-center">
            <p className="m-0 font-medium text-ink">{t('activity:errorTitle')}</p>
            <p className="m-0 mt-1 text-sm text-ink-3">{t('activity:errorHint')}</p>
            <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </Button>
          </Card>
        )}

        {!isLoading && !isError && activities.length === 0 && (
          <Card className="p-8">
            <EmptyState
              tone="dusk"
              icon={<ActivityIcon />}
              title={t('activity:noActivity')}
              description={t('activity:noActivityHint')}
            />
          </Card>
        )}

        {!isLoading && !isError && activities.length > 0 && (
          <>
            <LatestHero activity={activities[0]!} />

            {dayGroups.map((group) => (
              <div key={group.date}>
                <h2 className="serif m-0 mt-6 border-b border-line pb-2 text-lg text-ink first:mt-0">
                  {formatDayLabel(group.date, t, i18n.language)}
                </h2>
                <ul className="m-0 list-none p-0">
                  {group.activities.map((activity) => (
                    <ActivityItem key={activity.id} activity={activity} />
                  ))}
                </ul>
              </div>
            ))}

            <div className="mt-8 text-center">
              {hasNextPage ? (
                <Button
                  variant="ghost"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                  aria-busy={isFetchingNextPage}
                >
                  {isFetchingNextPage ? t('activity:loadingMore') : t('activity:loadMore')}
                </Button>
              ) : (
                <p className="m-0 text-sm text-ink-3">{t('activity:endOfFeed')}</p>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
