import { useEffect, useRef, type ReactElement } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isDailyUpdateEnabled } from '@/api/dailyUpdate';
import { Button, Sheet, Skeleton } from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { DailyUpdateSections } from '@/components/dailyUpdate/DailyUpdateSections';
import { useCircle } from '@/hooks/useCircle';
import {
  isDailyUpdateUnavailableError,
  useDailyUpdate,
  useDailyUpdateWindow,
} from '@/hooks/useDailyUpdate';
import { Analytics } from '@/lib/analytics';
import { formatDailyUpdateDate, isDateInDailyUpdateRange } from '@/lib/dailyUpdateWindow';
import { useAuthStore } from '@/store/authStore';

interface DailyUpdateLocationState {
  dailyUpdateSource?: 'card';
}

/**
 * Full daily update / dated view (docs/plans/daily-update.md §5.4, §6).
 *
 *   /circles/:circleId/daily-update              → today (recipient-local)
 *   /circles/:circleId/daily-update/:date        → that day
 *   /circles/:circleId/daily-update?date=YYYY-MM-DD
 *
 * `date` must lie within the last 7 recipient-local days; anything else shows
 * "This update is no longer available." without a request (the server
 * enforces the same bound with 400 DATE_OUT_OF_RANGE).
 *
 * Today: heading "{{name}}'s day", sections "Today so far" / "Still to do".
 * Past day: heading = the formatted date, eyebrow "{{name}}'s day", sections
 * "What happened" / "Not done that day"; nothing at all → "Nothing was
 * recorded on this day."
 */
export default function DailyUpdatePage(): ReactElement {
  const { circleId = '', date: pathDate } = useParams<{ circleId: string; date?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const { t, i18n } = useTranslation(['dailyUpdate', 'common']);
  const { circle, timezone, members } = useCircle(circleId);
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

  const recipientName = (data?.recipient_name ?? circle?.recipient_name ?? '').trim();
  const nameHeading = recipientName
    ? t('heading', { name: recipientName })
    : t('headingSelfFallback');
  const title = isPast && date ? formatDailyUpdateDate(date, i18n.language) : nameHeading;
  const eyebrow = isPast
    ? recipientName
      ? t('dated.eyebrow', { name: recipientName })
      : t('eyebrow')
    : t('eyebrow');

  const currentUserId = useAuthStore((s) => s.user?.id);
  const viewerIsRecipient = members.some((m) => m.is_care_recipient && m.id === currentUserId);
  const loading = timezone === null || (inRange && query.isLoading);
  const unavailable =
    (today !== null && !inRange) ||
    (query.isError && isDailyUpdateUnavailableError(query.error)) ||
    (query.data !== undefined && (data === null || !data.eligible)) ||
    viewerIsRecipient;

  let body: ReactElement;
  if (loading) {
    body = (
      <div role="status" aria-live="polite" className="pt-4">
        <span className="sr-only">{t('common:loading')}</span>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-3 h-4 w-2/3 max-w-80" />
        <Skeleton className="mt-2 h-4 w-1/2 max-w-64" />
      </div>
    );
  } else if (unavailable) {
    body = <p className="m-0 pt-4 text-md text-ink-2">{t('dated.unavailable')}</p>;
  } else if (query.isError || data === null) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 pt-4">
        <p className="m-0 text-md text-ink">{t('error')}</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  } else if (isPast && !data.has_activity && data.still_to_do.length === 0) {
    body = <p className="m-0 pt-4 text-md text-ink-2">{t('dated.empty')}</p>;
  } else {
    body = <DailyUpdateSections data={data} past={!data.is_today} headingLevel="h2" />;
  }

  return (
    <section className="mx-auto max-w-5xl pb-8">
      <PageMasthead
        section={eyebrow}
        tone="moss"
        title={title}
        backTo={`/circles/${circleId}`}
      />
      <div className="px-5">
        <Sheet padding="none" className="px-[22px] pt-1 pb-5" data-testid="daily-update-page">
          {body}
        </Sheet>
      </div>
    </section>
  );
}
