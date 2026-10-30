import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Eyebrow, Icon, Skeleton, Text } from '@/components/ui';
import { RemovedState } from '@/components/RemovedState';
import { useCircles } from '@/hooks/useCircles';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useInbox, useMarkInboxRead } from '@/hooks/useInbox';
import { Analytics } from '@/lib/analytics';
import {
  groupInbox,
  inboxSourceFromState,
  inboxTypeEnum,
  isInboxEnabled,
  resolveInboxDestination,
  rowCopy,
  rowMeta,
  unreadBucket,
  type GoneReason,
  type InboxItem,
} from '@/lib/notificationsInbox';

/**
 * `/notifications`: the account-level inbox (spans circles). Last 3 local days
 * (Today / Yesterday / 2 days ago). A row opens the same place a push tap would
 * and is marked read; a row whose target is gone opens the shared removed state.
 *
 * Flag off => redirect away; nothing is rendered and no request is made.
 */
export default function NotificationsPage(): ReactElement {
  if (!isInboxEnabled()) return <Navigate to="/circles" replace />;
  return <InboxPage />;
}

interface GoneRow {
  item: InboxItem;
  reason: GoneReason;
}

export interface InboxPageProps {
  /**
   * One circle's inbox (`/circles/:circleId/notifications`): only that circle's rows,
   * its own query key, and "Mark all read" clears that circle only. Omitted: the
   * all-circles inbox at `/notifications` (kept for email/push links, bookmarks and
   * account-level rows with no circle, which only it shows).
   */
  circleId?: string;
}

export function InboxPage({ circleId }: InboxPageProps = {}): ReactElement {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const cycle = useHourCycle();
  const scoped = Boolean(circleId);
  const { data, isLoading, isError, isSuccess, refetch } = useInbox(circleId);
  const { data: circles } = useCircles();
  const markRead = useMarkInboxRead();
  const [gone, setGone] = useState<GoneRow | null>(null);
  /** Polite status text (WCAG 4.1.3): the region is always mounted, only its text changes. */
  const [announcement, setAnnouncement] = useState('');
  /**
   * The row whose target was gone: when the removed state is dismissed the list comes back
   * and focus returns to THAT row (the removed state took focus to its heading; without
   * this it would fall to <body> when the state unmounts).
   */
  const returnFocusTo = useRef<string | null>(null);
  useEffect(() => {
    if (gone || !returnFocusTo.current) return;
    const id = returnFocusTo.current;
    returnFocusTo.current = null;
    document.querySelector<HTMLElement>(`[data-inbox-id="${CSS.escape(id)}"]`)?.focus();
  }, [gone]);

  // The window is the viewer's LOCAL days; re-derive when fresh data lands.
  // Scoped: the server already filters by circle; the client filter is a guard for
  // an older backend that ignores `circle_id` (it must never show another circle's rows).
  const items = useMemo(
    () =>
      circleId
        ? (data?.items ?? []).filter((item) => item.circle_id === circleId)
        : (data?.items ?? []),
    [data, circleId]
  );
  const sections = useMemo(
    () => groupInbox(items, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items]
  );
  const visible = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const unreadVisible = visible.filter((item) => !item.read_at).length;
  // Every row on a circle's own inbox is that circle: naming it on each row is noise.
  const showCircle = !scoped && (circles?.length ?? 0) >= 2;
  const circle = circleId ? circles?.find((c) => c.id === circleId) : undefined;
  // The subtitle's count is the SERVER's (same 72h rule as the circle card's count,
  // so the two always match). An older backend that returned other circles' rows
  // falls back to counting this circle's rows here.
  const scopedUnread =
    data && items.length === data.items.length
      ? data.unread_count
      : items.filter((item) => !item.read_at).length;
  // The source arrives once, with the navigation that opened this page.
  const viewSource = useRef(inboxSourceFromState(location.state));

  // inbox_viewed: once per visit, after the first successful load.
  const viewed = useRef(false);
  useEffect(() => {
    if (!isSuccess || viewed.current) return;
    viewed.current = true;
    Analytics.inboxViewed({
      unreadBucket: unreadBucket(unreadVisible),
      source: viewSource.current,
      scoped,
    });
  }, [isSuccess, unreadVisible, scoped]);

  const sectionLabel = {
    today: t('inbox.sections.today'),
    yesterday: t('inbox.sections.yesterday'),
    twoDaysAgo: t('inbox.sections.twoDaysAgo'),
  };

  const t2 = t as unknown as (key: string, options?: Record<string, unknown>) => string;

  // "See older in Activity": the feed is per circle. One circle => its feed.
  // Several => the circle of the newest row that is still in the user's list,
  // else the circle picker.
  const activityTo = useMemo(() => {
    if (circleId) return `/circles/${circleId}/activity`;
    const ids = new Set((circles ?? []).map((c) => c.id));
    if (ids.size === 1) return `/circles/${[...ids][0]}/activity`;
    const newest = (data?.items ?? []).find((i) => i.circle_id && ids.has(i.circle_id));
    return newest?.circle_id ? `/circles/${newest.circle_id}/activity` : '/circles';
  }, [circles, data, circleId]);

  const openRow = (item: InboxItem): void => {
    const destination = resolveInboxDestination(item);
    Analytics.inboxRowOpened({
      type: inboxTypeEnum(item.type),
      targetFound: destination.kind !== 'gone',
    });
    if (!item.read_at) markRead.mutate({ ids: [item.id] });
    if (destination.kind === 'gone') {
      returnFocusTo.current = item.id;
      setGone({ item, reason: destination.reason });
    } else if (destination.kind === 'route') {
      navigate(destination.to);
    }
  };

  const handleMarkAll = (): void => {
    if (unreadVisible === 0 || markRead.isPending) return;
    Analytics.inboxMarkAllRead({ count: unreadVisible });
    markRead.mutate(
      circleId ? { all: true, circle_id: circleId } : { all: true },
      { onSuccess: () => setAnnouncement(t('inbox.allMarkedRead')) }
    );
  };

  const now = new Date();
  const goneCopy = gone ? rowCopy(gone.item, t2, cycle, i18n.language) : null;
  const goneMeta = gone
    ? rowMeta(gone.item, { now, cycle, language: i18n.language, showCircle, t: t2 })
    : '';

  let content: ReactElement;
  if (gone && goneCopy) {
    content = (
      <div data-testid="inbox-gone" className="flex flex-col gap-3">
        <Card variant="outlined" padding="md">
          <Text variant="bodySemiBold" as="p" data-testid="inbox-gone-title">
            {goneCopy.title}
          </Text>
          {goneCopy.body ? (
            <Text variant="caption" as="p" className="mt-1">
              {goneCopy.body}
            </Text>
          ) : null}
          {goneMeta ? (
            <Text variant="mono" as="p" className="mt-1">
              {goneMeta}
            </Text>
          ) : null}
        </Card>
        <RemovedState reason={gone.reason} layout="inline" onDismiss={() => setGone(null)} />
        {gone.reason === 'no_access' ? (
          // no_access has no "OK" of its own (it is a page state): keep a way back.
          <Button variant="secondary" size="md" onClick={() => setGone(null)}>
            {t('inbox.backToList')}
          </Button>
        ) : null}
      </div>
    );
  } else if (isLoading) {
    content = (
      <div role="status" aria-busy="true" data-testid="inbox-loading" className="flex flex-col gap-3">
        <span className="sr-only">{t('loading')}</span>
        {[0, 1].map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Card variant="outlined" padding="none" className="overflow-hidden">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex gap-3 border-b border-line-2 px-[18px] py-3 last:border-b-0">
                  <span className="w-2 shrink-0" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>
    );
  } else if (isError) {
    content = (
      <Card variant="outlined" padding="md" role="alert" data-testid="inbox-error">
        <Text variant="h3" as="h2">
          {t('inbox.errorTitle')}
        </Text>
        <Text variant="body" className="mt-1 text-ink-2!">
          {t('inbox.errorBody')}
        </Text>
        <div className="mt-4">
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              void refetch();
            }}
          >
            {t('inbox.tryAgain')}
          </Button>
        </div>
      </Card>
    );
  } else if (visible.length === 0) {
    content = (
      <Card variant="outlined" padding="md" data-testid="inbox-empty">
        <Text variant="body" className="text-ink-2!">
          {t('inbox.empty')}
        </Text>
      </Card>
    );
  } else {
    content = (
      <div className="flex flex-col gap-3">
        {sections.map((section) => (
          <section key={section.key} aria-labelledby={`inbox-section-${section.key}`} className="flex flex-col gap-2">
            <Text
              variant="eyebrow"
              as="h2"
              id={`inbox-section-${section.key}`}
              className="px-0.5 pt-1.5 tracking-[1.6px]! font-semibold!"
            >
              {sectionLabel[section.key]}
            </Text>
            <Card as="ul" variant="outlined" padding="none" className="m-0 flex list-none flex-col overflow-hidden">
              {section.items.map((item) => {
                const unread = !item.read_at;
                const copy = rowCopy(item, t2, cycle, i18n.language);
                const meta = rowMeta(item, { now, cycle, language: i18n.language, showCircle, t: t2 });
                return (
                  <li key={item.id} className="border-b border-line-2 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openRow(item)}
                      data-testid="inbox-row"
                      data-inbox-id={item.id}
                      data-unread={unread ? 'true' : 'false'}
                      data-type={item.type}
                      className="flex min-h-[44px] w-full items-start gap-3 bg-transparent px-[18px] py-3 text-left transition-colors hover:bg-bg-2"
                    >
                      {unread ? (
                        <>
                          <span
                            aria-hidden="true"
                            data-testid="inbox-unread-dot"
                            className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-moss"
                          />
                          <span className="sr-only">{t('inbox.unread')}. </span>
                        </>
                      ) : (
                        <span aria-hidden="true" className="w-2 shrink-0" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={`text-md leading-5 ${unread ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}
                        >
                          {copy.title}
                        </span>
                        {copy.body ? (
                          <span className="text-sm leading-[18px] text-ink-2">{copy.body}</span>
                        ) : null}
                        {meta ? <span className="text-xs text-ink-3">{meta}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </Card>
          </section>
        ))}
      </div>
    );
  }

  const TitleTag = gone?.reason === 'no_access' ? 'p' : 'h1';

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8" data-testid="notifications-page">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow color="moss" dot>
              {t('inbox.eyebrow')}
            </Eyebrow>
            {!gone && !isLoading && !isError && visible.length > 0 ? (
              // aria-disabled, NOT disabled: the button is what the user just pressed, and a
              // natively disabled button drops keyboard focus to <body> (2.4.3).
              <button
                type="button"
                onClick={handleMarkAll}
                aria-disabled={unreadVisible === 0 || markRead.isPending}
                className="min-h-[44px] rounded-md px-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink aria-disabled:cursor-default aria-disabled:opacity-50"
              >
                {t('inbox.markAllRead')}
              </button>
            ) : null}
          </div>
          {scoped && circleId ? (
            <div className="-mt-1 flex items-start gap-2">
              <Link
                to={`/circles/${circleId}`}
                aria-label={t('nav.back')}
                data-testid="inbox-back"
                className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink no-underline transition-colors hover:bg-bg-2"
              >
                <Icon name="arrow-back" size="chrome" />
              </Link>
              <div className="min-w-0 flex-1">
                <Text variant="editorialTitleCompact" as={TitleTag}>
                  {t('inbox.title')}
                </Text>
                {circle ? (
                  <Text
                    variant="body"
                    as="p"
                    data-testid="inbox-scoped-subtitle"
                    className="mt-0.5 break-words text-ink-2!"
                  >
                    {scopedUnread > 0 && data
                      ? t('inbox.scopedSubtitle', { name: circle.name, count: scopedUnread })
                      : circle.name}
                  </Text>
                ) : null}
              </div>
            </div>
          ) : (
            <Text variant="editorialTitleCompact" as={TitleTag} className="-mt-1">
              {t('inbox.title')}
            </Text>
          )}
          {content}
          {scoped && (circles?.length ?? 0) >= 2 ? (
            <Link
              to="/notifications"
              data-testid="inbox-all-link"
              className="inline-flex min-h-[44px] items-center gap-1 self-start text-md font-medium text-ink-2 no-underline hover:text-ink"
            >
              {t('inbox.allNotifications')}
              <Icon name="chevron-forward" size="meta" />
            </Link>
          ) : null}
          <span role="status" className="sr-only" data-testid="inbox-announcer">
            {announcement}
          </span>
        </div>

        {/* Named after its own heading: the app sidebar is an <aside> too, and two unnamed
            complementary landmarks fail axe landmark-unique (dark e2e 2026-10-30, desktop width). */}
        <aside className="flex flex-col gap-3 lg:pt-[70px]" aria-labelledby="inbox-side-title">
          <Card variant="outlined" padding="md" data-testid="inbox-side-card">
            <Text variant="h3" as="h2" id="inbox-side-title">
              {t('inbox.side.title')}
            </Text>
            <Text variant="caption" className="mt-2">
              {t('inbox.side.body')}
            </Text>
            <Link
              to={activityTo}
              className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-md font-medium text-ink-2 no-underline hover:text-ink"
            >
              {t('inbox.seeOlder')}
              <Icon name="chevron-forward" size="meta" />
            </Link>
            <Link
              to="/profile"
              className="inline-flex min-h-[44px] items-center text-md font-semibold text-moss-deep no-underline hover:text-ink"
            >
              {t('inbox.settings')}
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
