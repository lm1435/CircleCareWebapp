import { useEffect, useMemo, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem } from '@/api/activityFeed';
import { ActivityItem } from '@/components/activity/ActivityItem';
import { LatestHero } from '@/components/activity/LatestHero';
import { formatDayLabel, getLocalDateKey } from '@/components/activity/activityFormat';
import { Button, Card, EmptyState, Skeleton, Text } from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useCircle } from '@/hooks/useCircle';
import { Analytics } from '@/lib/analytics';

// Activity feed page (Task 17, web mobile-parity wave; mirrors mobile's
// ActivityFeedScreen per spec §6.5): read-only feed grouped by viewer-local day
// (Today / Yesterday / date headings) with "Load more" pagination against
// GET /circles/:circleId/activity (limit/offset).

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

interface DayGroup {
  date: string; // viewer-local YYYY-MM-DD key
  activities: ActivityFeedItem[];
}

export default function ActivityFeedPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['activity', 'common']);
  // Gates the empty-state invite CTA — view-only members can't invite.
  // `circle` gates the timezone: useCircle reports a hardcoded
  // 'America/New_York' while the detail query is in flight, and that is
  // indistinguishable from a real New York circle. Parameterized rows fall back
  // to the server description until it resolves.
  const { canEdit, circle, timezone: resolvedTimezone } = useCircle(circleId);
  const timezone = circle ? resolvedTimezone : null;

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useActivityFeed(circleId);

  // Instrumented from day one (the vitals lesson) — ids only, never content.
  useEffect(() => {
    if (circleId) Analytics.activityFeedViewed(circleId);
  }, [circleId]);

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
    <section className="mx-auto max-w-5xl pb-8">
      <PageMasthead
        section={t('common:nav.activity')}
        tone="dusk"
        title={t('activity:title')}
        subtitle={t('activity:subtitle')}
      />

      {isLoading && (
        <div role="status" aria-live="polite" className="px-5">
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
        <div className="px-5">
          <Card className="text-center">
            <p className="m-0 font-medium text-ink">{t('activity:errorTitle')}</p>
            <p className="m-0 mt-1 text-sm text-ink-3">{t('activity:errorHint')}</p>
            <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </Button>
          </Card>
        </div>
      )}

      {!isLoading && !isError && activities.length === 0 && (
        <div className="px-5">
          <EmptyState
            tone="dusk"
            icon="pulse-outline"
            title={t('activity:noActivity')}
            description={t('activity:noActivityHint')}
          >
            {canEdit ? (
              <Button as={Link} to={`/circles/${circleId}/members`} variant="ghost">
                {t('activity:inviteCta')}
              </Button>
            ) : null}
          </EmptyState>
        </div>
      )}

      {!isLoading && !isError && activities.length > 0 && (
        <>
          <div className="px-5">
            <LatestHero activity={activities[0]!} timezone={timezone} />
          </div>

          {dayGroups.map((group) => (
            <div key={group.date}>
              <Text variant="sectionTitle" as="h2" className="px-5 pt-7 pb-3">
                {formatDayLabel(group.date, t)}
              </Text>
              <ul className="m-0 list-none p-0">
                {group.activities.map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} timezone={timezone} />
                ))}
              </ul>
            </div>
          ))}

          <div className="mt-8 px-5 text-center">
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
              <Text variant="caption" as="p" className="text-center">
                {t('activity:endOfFeed')}
              </Text>
            )}
          </div>
        </>
      )}
    </section>
  );
}
