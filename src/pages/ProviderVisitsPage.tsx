import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProviderVisit, VisitNote } from '@/api/providers';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { PhoneLink } from '@/components/emergency/PhoneLink';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { VisitCard, VisitNoteCard, VisitsSectionHeader } from '@/components/providers/VisitCard';
import { groupVisitsByYear } from '@/components/providers/visitFormat';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  Skeleton,
  Text,
} from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { providerDisplayName, useProviderVisits } from '@/hooks/useProviders';
import { Analytics, providerVisitBucket } from '@/lib/analytics';
import { isNotFoundError } from '@/lib/apiErrors';
import { isSafeRouteId } from '@/lib/routeIds';

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
  const { t } = useTranslation(['emergency', 'common', 'calendar']);
  const { canEdit, timezone } = useCircle(circleId);

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
  // Every upcoming visit, soonest first (an older server sends only `next_visit`).
  const upcomingVisits = useMemo<ProviderVisit[]>(
    () => firstPage?.upcoming_visits ?? firstPage?.upcoming ?? (nextVisit ? [nextVisit] : []),
    [firstPage, nextVisit]
  );
  const pastVisits = useMemo<ProviderVisit[]>(
    () => (data ? data.pages.flatMap((page) => page.visits) : []),
    [data]
  );
  const yearGroups = useMemo(() => groupVisitsByYear(pastVisits), [pastVisits]);
  // Every note for this doctor (upcoming + loaded past visits), newest first. Past visits load in
  // pages, so while more remain this is a prefix and says so ("N+", "Show earlier notes").
  const allNotes = useMemo(() => {
    const seen = new Set<string>();
    const out: { note: VisitNote; visit: ProviderVisit }[] = [];
    for (const v of [...upcomingVisits, ...pastVisits]) {
      for (const n of v.notes) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push({ note: n, visit: v });
      }
    }
    return out.sort((a, b) =>
      a.note.created_at !== b.note.created_at
        ? a.note.created_at < b.note.created_at
          ? 1
          : -1
        : a.note.id < b.note.id
          ? 1
          : -1
    );
  }, [upcomingVisits, pastVisits]);
  // Open/closed is remembered for this visit of the page only.
  const [open, setOpen] = useState({ upcoming: true, notes: true, past: false });
  const toggleSection = (id: 'upcoming' | 'notes' | 'past'): void => {
    Analytics.providerVisitsSectionToggled({ section: id, expanded: !open[id] });
    setOpen((cur) => ({ ...cur, [id]: !cur[id] }));
  };

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
      upcoming_count_bucket: providerVisitBucket(upcomingVisits.length),
      notes_count_bucket: providerVisitBucket(
        [...upcomingVisits, ...firstPage.visits].reduce((n, v) => n + v.notes.length, 0)
      ),
      has_notes: [...firstPage.visits, ...upcomingVisits].some((visit) => visit.note_count > 0),
    });
  }, [firstPage, providerId, source, upcomingVisits]);

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

  const isEmpty = pastVisits.length === 0 && upcomingVisits.length === 0;

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

        <div className="mt-1">
          <HowDoesThisWork slug="doctor-visits-and-notes" />
        </div>

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
            {upcomingVisits.length > 0 && (
              <section className="mt-6" data-testid="provider-visits-upcoming">
                <VisitsSectionHeader
                  id="upcoming"
                  title={t('providers.visits.upcomingVisits')}
                  count={String(upcomingVisits.length)}
                  open={open.upcoming}
                  onToggle={() => toggleSection('upcoming')}
                />
                {open.upcoming && (
                  <ul id="provider-visits-panel-upcoming" className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
                    {upcomingVisits.map((visit) => (
                      <VisitCard
                        key={visit.id}
                        circleId={circleId}
                        visit={visit}
                        timezone={timezone}
                        canEdit={canEdit}
                        upcoming
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="mt-6" data-testid="provider-visits-notes">
              <VisitsSectionHeader
                id="notes"
                title={t('providers.visits.notesSection')}
                count={`${allNotes.length}${hasNextPage ? '+' : ''}`}
                open={open.notes}
                onToggle={() => toggleSection('notes')}
              />
              {open.notes && (
                <div id="provider-visits-panel-notes">
                  {allNotes.length === 0 ? (
                    <p className="m-0 mt-2 text-sm text-ink-3" data-testid="provider-notes-empty">
                      {t('providers.visits.notesEmpty')}
                    </p>
                  ) : (
                    <ul className="m-0 mt-2 flex list-none flex-col gap-3 p-0">
                      {allNotes.map(({ note, visit }) => (
                        <VisitNoteCard
                          key={note.id}
                          circleId={circleId}
                          note={note}
                          visit={visit}
                          timezone={timezone}
                        />
                      ))}
                    </ul>
                  )}
                  {hasNextPage && (
                    <Button
                      variant="secondary"
                      fullWidth
                      className="mt-3"
                      loading={isFetchingNextPage}
                      data-testid="provider-notes-show-earlier"
                      onClick={() => void fetchNextPage()}
                    >
                      {t('providers.visits.showEarlierNotes')}
                    </Button>
                  )}
                </div>
              )}
            </section>

            <section className="mt-6" data-testid="provider-visits-past">
              <VisitsSectionHeader
                id="past"
                title={t('providers.visits.pastVisits')}
                count={`${pastVisits.length}${hasNextPage ? '+' : ''}`}
                open={open.past}
                onToggle={() => toggleSection('past')}
              />

              {open.past && pastVisits.length === 0 ? (
                <p className="m-0 mt-2 text-sm text-ink-3">{t('providers.visits.noPast')}</p>
              ) : null}
              {open.past && pastVisits.length > 0 && (
                <div id="provider-visits-panel-past" ref={listRef} className="mt-2 flex flex-col gap-4">
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
              {open.past && hasNextPage && (
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
