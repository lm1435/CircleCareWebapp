import { useEffect, useRef, type ReactElement } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isDailyUpdateEnabled } from '@/api/dailyUpdate';
import { Button, Skeleton } from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import {
  DailyUpdateDayArrows,
  DailyUpdateDayView,
} from '@/components/dailyUpdate/DailyUpdateDayView';
import { useCircle } from '@/hooks/useCircle';
import {
  isDailyUpdateUnavailableError,
  useDailyUpdate,
  useDailyUpdateWindow,
} from '@/hooks/useDailyUpdate';
import { Analytics } from '@/lib/analytics';
import { capitalizeFirst } from '@/lib/dailyUpdateCopy';
import { dayNav } from '@/lib/dailyUpdateLinks';
import { formatDailyUpdateDate, isDateInDailyUpdateRange } from '@/lib/dailyUpdateWindow';
import { useAuthStore } from '@/store/authStore';

interface DailyUpdateLocationState {
  dailyUpdateSource?: 'card';
}

/**
 * Full daily update, design v2 "B2" (docs/plans/daily-update.md):
 *
 *   /circles/:circleId/daily-update              → today (recipient-local)
 *   /circles/:circleId/daily-update/:date        → that day
 *   /circles/:circleId/daily-update?date=YYYY-MM-DD
 *   …#tasks                                      → scrolled to (and focused on) that section
 *
 * Eyebrow "Daily update", title = the date ("Thursday, Oct 8"), day arrows
 * within the last 7 recipient-local days, the sentence, one summary line, then
 * the section cards. `date` outside the range shows "This update is no longer
 * available." without a request (the server enforces the same bound).
 */
export default function DailyUpdatePage(): ReactElement {
  const { circleId = '', date: pathDate } = useParams<{ circleId: string; date?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { t, i18n } = useTranslation(['dailyUpdate', 'common']);
  const { timezone, members } = useCircle(circleId);
  const win = useDailyUpdateWindow(timezone);
  const today = win?.localDate ?? null;

  const requested = pathDate ?? searchParams.get('date') ?? null;
  const date = requested ?? today;
  const inRange = date !== null && today !== null && isDateInDailyUpdateRange(date, today);

  const query = useDailyUpdate(circleId, date, inRange);
  const data = isDailyUpdateEnabled(query.data) ? query.data : null;

  const isPast = date !== null && today !== null && date !== today;

  // daily_update_opened — once per page mount, after the date is resolved.
  const firedRef = useRef(false);
  const source = (location.state as DailyUpdateLocationState | null)?.dailyUpdateSource;
  useEffect(() => {
    if (firedRef.current || date === null || today === null) return;
    firedRef.current = true;
    Analytics.dailyUpdateOpened(source === 'card' ? 'card' : 'link', date !== today);
  }, [date, today, source]);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const viewerIsRecipient = members.some((m) => m.is_care_recipient && m.id === currentUserId);
  const loading = timezone === null || (inRange && query.isLoading);
  const unavailable =
    (today !== null && !inRange) ||
    (query.isError && isDailyUpdateUnavailableError(query.error)) ||
    (query.data !== undefined && (data === null || !data.eligible)) ||
    viewerIsRecipient;
  const ready = !loading && !unavailable && !query.isError && data !== null;

  // `#tasks` (the card's "2 tasks done" row): once the sections exist, bring
  // that section into view and move focus to its heading, so keyboard and
  // screen-reader users land where sighted users do. Once per hash.
  const hash = location.hash.replace(/^#/, '');
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !hash || scrolledFor.current === `${date}#${hash}`) return;
    const section = document.getElementById(hash);
    if (!section) return;
    scrolledFor.current = `${date}#${hash}`;
    section.scrollIntoView?.({ block: 'start' });
    document.getElementById(`${hash}-heading`)?.focus({ preventScroll: true });
  }, [ready, hash, date]);

  const title =
    date !== null ? capitalizeFirst(formatDailyUpdateDate(date, i18n.language), i18n.language) : '';
  const nav = date !== null && today !== null && inRange ? dayNav(date, today, data?.nav) : null;

  let body: ReactElement;
  if (loading) {
    body = (
      <div role="status" aria-live="polite">
        <span className="sr-only">{t('common:loading')}</span>
        <Skeleton className="h-6 w-3/4 max-w-80" />
        <Skeleton className="mt-3 h-4 w-2/3 max-w-72" />
        <Skeleton className="mt-5 h-32 w-full rounded-xl" />
      </div>
    );
  } else if (unavailable) {
    body = <p className="m-0 text-md leading-normal text-ink-2">{t('dated.unavailable')}</p>;
  } else if (query.isError || data === null) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="m-0 text-md leading-normal text-ink">{t('error')}</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  } else {
    body = <DailyUpdateDayView data={data} circleId={circleId} past={!data.is_today} />;
  }

  return (
    <section className="mx-auto max-w-3xl pb-10" data-testid="daily-update-page">
      <PageMasthead
        section={t('eyebrow')}
        tone="moss"
        title={title}
        backTo={`/circles/${circleId}`}
        compact
      />
      {nav && !viewerIsRecipient ? (
        <div className="px-5 pb-1">
          <DailyUpdateDayArrows
            circleId={circleId}
            prev={nav.prev}
            next={nav.next}
            isToday={!isPast}
          />
        </div>
      ) : null}
      <div className="px-5 pt-2">{body}</div>
    </section>
  );
}
