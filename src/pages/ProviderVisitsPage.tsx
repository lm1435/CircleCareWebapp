import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProviderVisit } from '@/api/providers';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { PhoneLink } from '@/components/emergency/PhoneLink';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { VisitCard } from '@/components/providers/VisitCard';
import {
  groupVisitsByYear,
  visitCalendarPath,
} from '@/components/providers/visitFormat';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Sheet,
  SheetRowPressable,
  Skeleton,
  Text,
} from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useHourCycle } from '@/hooks/useHourCycle';
import { providerDisplayName, useProviderVisits } from '@/hooks/useProviders';
import { Analytics, providerVisitBucket } from '@/lib/analytics';
import { isNotFoundError } from '@/lib/apiErrors';
import { isSafeRouteId } from '@/lib/routeIds';
import { formatEventTimeForDisplay, getDateInTimezone, zoneReferenceInstant } from '@/utils/timezone';

// Visits & notes for ONE doctor (docs/plans/notes-by-doctor.md, flow 2;
// PROVIDERS_API_CONTRACT §1.5). Header, "Next visit", past visits by year with
// their notes inline, "Show earlier visits" paging, and the empty / loading /
// error / not-found states. Readable by every member (view-only included);
// only the "Add a note" and "Add an appointment" affordances need edit rights.
//
// PHI page: the doctor's name and the notes are health data. Never log them and
// never put any of it in an analytics event.

const SKELETON_ROWS = [0, 1, 2];

type VisitsSource = 'medical_info' | 'appointment' | 'ai_chat';

/** Where the user came from, carried in router state by the two entry points. */
function sourceFromState(state: unknown): VisitsSource {
  const source = (state as { source?: unknown } | null)?.source;
  // A direct visit (typed URL, bookmark) has no state: Medical Info is the
  // page's home, so it is the honest default.
  // `ai_chat`: an assistant reply's "Visits & notes" button (FIND_NOTES).
  return source === 'appointment' || source === 'ai_chat' ? source : 'medical_info';
}

export default function ProviderVisitsPage(): ReactElement {
  const { circleId = '', providerId = '' } = useParams<{ circleId: string; providerId: string }>();
  const location = useLocation();
  const { t, i18n } = useTranslation(['emergency', 'common', 'calendar']);
  const { canEdit, timezone } = useCircle(circleId);
  const hourCycle = useHourCycle();

  // The id is a route param someone can type: refuse anything that is not an id
  // before it reaches a request path (lib/routeIds.ts).
  const validId = isSafeRouteId(providerId);
  const query = useProviderVisits(circleId, validId ? providerId : undefined);
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
  } = query;

  const [adding, setAdding] = useState(false);

  const firstPage = data?.pages[0];
  const provider = firstPage?.provider;
  const nextVisit = firstPage?.next_visit ?? null;
  const pastVisits = useMemo<ProviderVisit[]>(
    () => (data ? data.pages.flatMap((page) => page.visits) : []),
    [data]
  );
  const yearGroups = useMemo(() => groupVisitsByYear(pastVisits), [pastVisits]);

  // provider_visits_opened: once per doctor, when the first page lands. An enum, a
  // bucket and a boolean only: `visit_count_bucket` is the PAST visits that first page
  // returned (never a raw count), `has_notes` whether any of them carries a note.
  const reportedFor = useRef<string | null>(null);
  const source = sourceFromState(location.state);
  useEffect(() => {
    if (!firstPage || reportedFor.current === providerId) return;
    reportedFor.current = providerId;
    Analytics.providerVisitsOpened({
      source,
      visit_count_bucket: providerVisitBucket(firstPage.visits.length),
      has_notes: firstPage.visits.some((visit) => visit.note_count > 0),
    });
  }, [firstPage, providerId, source]);

  // "Show earlier visits" moves the page under the user's pointer: land focus on
  // the first newly loaded visit (the button may be gone when history ends) and
  // say what happened to a screen reader.
  const focusFromIndex = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const from = focusFromIndex.current;
    if (from === null || isFetchingNextPage || pastVisits.length <= from) return;
    focusFromIndex.current = null;
    const cards = listRef.current?.querySelectorAll<HTMLElement>('[data-testid="provider-visit"]');
    const target = cards?.[from]?.querySelector<HTMLElement>('a, button');
    target?.focus();
    setAnnounce(t('providers.visits.earlierLoaded'));
  }, [pastVisits.length, isFetchingNextPage, t]);

  const backTo = `/circles/${circleId}/emergency`;
  const removedLabel = (name: string): string => t('providers.removedName', { name });
  const title = provider
    ? providerDisplayName(provider, removedLabel)
    : t('providers.visits.title');
  const eyebrow = t('providers.visits.title');

  const masthead = (
    <PageMasthead
      section={eyebrow}
      tone="moss"
      title={title}
      subtitle={provider?.specialty ?? undefined}
      backTo={backTo}
    />
  );

  /** The text back link: the masthead's round control only exists below xl. */
  const backLink = (
    <Link
      to={backTo}
      className="no-print mt-1 hidden min-h-[44px] items-center gap-1 text-md font-medium text-moss-deep no-underline hover:underline xl:inline-flex"
    >
      <Icon name="chevron-back" size="row" />
      {t('common:nav.emergency')}
    </Link>
  );

  // `isError` is also true when only a LATER page failed (the data is still there).
  if (!validId || (isError && !data && isNotFoundError(error))) {
    return (
      <section className="mx-auto max-w-3xl pb-10">
        {masthead}
        <div className="px-5">
          <Card padding="lg" className="mt-4 text-center">
            <p className="m-0 font-medium text-ink">{t('providers.visits.notFound')}</p>
            <Button as={Link} to={backTo} variant="ghost" className="mt-4">
              {t('common:nav.emergency')}
            </Button>
          </Card>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="mx-auto max-w-3xl pb-10">
        {masthead}
        <div role="status" aria-live="polite" className="mt-2 px-5">
          <span className="sr-only">{t('providers.visits.loading')}</span>
          <div className="grid gap-3">
            {SKELETON_ROWS.map((row) => (
              <Card key={row} variant="outlined" padding="sm">
                <Skeleton className="h-5 w-1/3 max-w-48" />
                <Skeleton className="mt-3 h-4 w-3/4 max-w-96" />
                <Skeleton className="mt-2 h-4 w-1/2 max-w-64" />
              </Card>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!firstPage || !provider) {
    return (
      <section className="mx-auto max-w-3xl pb-10">
        {masthead}
        <div className="px-5">
          {backLink}
          <Card padding="lg" className="mt-4 text-center">
            <p className="m-0 font-medium text-ink">{t('providers.visits.errorTitle')}</p>
            <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>
              {t('retry')}
            </Button>
          </Card>
        </div>
      </section>
    );
  }

  const isEmpty = pastVisits.length === 0 && !nextVisit;
  const todayYear = timezone ? getDateInTimezone(timezone).slice(0, 4) : null;

  const nextVisitLabel = (visit: ProviderVisit): string => {
    const date = formatDateForDisplay(
      visit.scheduled_date,
      {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        // The year only when it is not the current one, so "Thu, Nov 12" stays short.
        ...(todayYear && visit.scheduled_date.slice(0, 4) !== todayYear
          ? { year: 'numeric' as const }
          : {}),
      },
      i18n.language
    );
    if (!visit.scheduled_time) return `${date} · ${t('calendar:allDay')}`;
    // The time is the recipient's wall clock; withheld until the zone is known
    // rather than shown in a guessed zone.
    if (!timezone) return date;
    const time = formatEventTimeForDisplay(
      visit.scheduled_time,
      timezone,
      undefined,
      zoneReferenceInstant(visit.scheduled_date),
      hourCycle
    );
    return `${date} · ${time}`;
  };

  return (
    <section className="mx-auto max-w-3xl pb-10">
      {masthead}
      <div className="px-5">
        {backLink}

        {provider.phone && !provider.archived_at && (
          <div className="mt-1">
            <PhoneLink
              phone={provider.phone}
              countryCode={provider.country_code}
              extension={provider.phone_extension}
              ariaLabel={t('callAria', { name: provider.name })}
            />
          </div>
        )}

        {isEmpty ? (
          <Card padding="lg" className="mt-6 border-dashed" data-testid="provider-visits-empty">
            <EmptyState
              tone="moss"
              icon="document-text-outline"
              title={t('providers.visits.emptyTitle', { name: providerDisplayName(provider, removedLabel) })}
              description={t('providers.visits.emptyBody', { name: provider.name })}
            >
              {canEdit && !provider.archived_at && (
                <Button variant="secondary" size="sm" onClick={() => setAdding(true)} offlineKind="change">
                  {t('providers.visits.addAppointment')}
                </Button>
              )}
            </EmptyState>
          </Card>
        ) : (
          <>
            {nextVisit && (
              <section className="mt-6" aria-labelledby="provider-next-visit">
                <Text variant="label" as="h2" id="provider-next-visit" className="uppercase tracking-wide">
                  {t('providers.visits.nextVisit')}
                </Text>
                <Sheet padding="none" className="mt-2">
                  <SheetRowPressable
                    to={visitCalendarPath(circleId, nextVisit)}
                    data-testid="provider-next-visit"
                    className="justify-between gap-3 py-3.5 text-ink no-underline"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-md font-semibold">{nextVisitLabel(nextVisit)}</span>
                      <span className="break-words text-sm text-ink-2">
                        {[nextVisit.title, nextVisit.location].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <Icon name="chevron-forward" size="row" />
                  </SheetRowPressable>
                </Sheet>
              </section>
            )}

            <section className="mt-6" aria-labelledby="provider-past-visits">
              <Text variant="label" as="h2" id="provider-past-visits" className="uppercase tracking-wide">
                {t('providers.visits.pastVisits')}
              </Text>

              {pastVisits.length === 0 ? (
                <p className="m-0 mt-2 text-sm text-ink-3">{t('providers.visits.noPast')}</p>
              ) : (
                <div ref={listRef} className="mt-2 flex flex-col gap-4">
                  {yearGroups.map((group) => (
                    <div key={group.year} role="group" aria-label={group.year}>
                      <Text variant="mono" as="h3" className="mb-2 font-bold text-ink-3">
                        {group.year}
                      </Text>
                      <ul className="m-0 flex list-none flex-col gap-3 p-0">
                        {group.visits.map((visit) => (
                          <VisitCard
                            key={visit.id}
                            circleId={circleId}
                            visit={visit}
                            timezone={timezone}
                            canEdit={canEdit}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {isFetchNextPageError && (
                <p role="alert" className="m-0 mt-3 text-sm text-ink-2">
                  {t('providers.visits.earlierFailed')}
                </p>
              )}
              {hasNextPage && (
                <Button
                  variant="secondary"
                  fullWidth
                  className="mt-3"
                  loading={isFetchingNextPage}
                  data-testid="provider-visits-show-earlier"
                  onClick={() => {
                    focusFromIndex.current = pastVisits.length;
                    // A failed page does not reject: `isFetchNextPageError` shows
                    // the inline message and the button stays for a retry.
                    void fetchNextPage();
                  }}
                >
                  {t('providers.visits.showEarlier')}
                </Button>
              )}
              <p role="status" aria-live="polite" className="sr-only">
                {announce}
              </p>
            </section>
          </>
        )}
      </div>

      {adding && (
        <AddEventModal
          circleId={circleId}
          initialType="appointment"
          initialProviderId={provider.id}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
