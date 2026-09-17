import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  MoreMenu,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  Text,
  useToast,
  careCardBadgeRow,
  careCardListGap,
  careCardMeta,
  careCardMetaDetail,
  careCardShell,
  careCardSurface,
  careCardSurfaceMuted,
  careCardTitle,
  careCardTopRow,
  STATUS_PILL,
  type MoreMenuEntry,
} from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { CareTabs } from '@/components/layout/CareTabs';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { DeleteEventDialog } from '@/components/calendar/DeleteEventDialog';
import { DiscontinueMedDialog } from '@/components/calendar/DiscontinueMedDialog';
import { formatRecurrenceLabel } from '@/components/calendar/recurrenceLabel';
import { useMedicationRoster, useMedicationStatus } from '@/hooks/useCalendarEvents';
import { useCircle } from '@/hooks/useCircle';
import { getMedKey, getSeriesRoot } from '@/utils/medicationGrouping';
import { MedicationDetailModal } from '@/components/meds/MedicationDetailModal';
import { AdherenceHero } from '@/components/meds/AdherenceHero';
import { HistoryList } from '@/components/meds/HistoryList';
import { MedicationFilter } from '@/components/meds/MedicationFilter';
import {
  historyParams,
  medicationOptions,
  type HistoryConfirmation,
} from '@/components/meds/historyQuery';
import { useMedicationConfirmations } from '@/hooks/useMedConfirmation';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { HourCycle } from '@/utils/hourCycle';
import { formatEventTimeCompact } from '@/utils/timezone';
import { Analytics } from '@/lib/analytics';

// The Medications page (spec §6.4), mirroring mobile's MedicationHistoryScreen:
// a masthead, then MEDICATIONS · HISTORY under it.
//
// MEDICATIONS is the roster — ONE card per medication (normalized name +
// dosage, see getMedKey), split into Active and "Inactive / Past medications".
// This page is the primary surface where INACTIVE meds are reachable on web:
// the calendar GET excludes them by default, so reactivation lives here.
//
// HISTORY is what was actually taken: the 30-day adherence hero, a filter row,
// and the confirmation record grouped by day.
//
// Action parity (Meds page ↔ calendar detail): Edit, Discontinue/Reactivate
// (whole-medication — every series of the same name + dose), Delete. Editing
// an INACTIVE med is guarded by a reactivate-first prompt (mobile parity).

const SKELETON_ROWS = [0, 1, 2];

type Tab = 'medications' | 'history';

/** One medication card's grouped data (all series sharing a med key). */
interface MedGroup {
  key: string;
  /** Representative event — a series-root row when one is loaded. */
  event: CalendarEvent;
  name: string;
  dosage: string | null;
  /** Distinct scheduled times (HH:MM) across every series, sorted. */
  times: string[];
  /** Representative recurring event for the frequency label, if any. */
  recurrenceEvent: CalendarEvent | null;
  inactive: boolean;
  /**
   * Whole days of supply left, or null when this med is not refill-tracked.
   * Aggregated across the group's events, not read off `event` — see
   * `stockDaysLeft` and the reducer in `groupMedications`.
   */
  daysLeft: number | null;
}

/**
 * Below this many days of supply, the roster card shows the low-stock badge.
 * Same threshold mobile uses (MedicationHistoryScreen `isLowStock`) — a
 * medication must not read "low" on one platform and fine on the other.
 */
const LOW_STOCK_DAYS = 14;

/**
 * Whole days of supply left for ONE series row, or null when the row is not
 * refill-tracked. Mirrors mobile exactly, floor included: 9 pills at 2/day is 4
 * full days, and rounding that up to 5 would promise a dose the bottle cannot
 * cover.
 */
function stockDaysLeft(e: CalendarEvent): number | null {
  const remaining = e.quantity_remaining;
  const perDay = e.pills_per_day;
  if (typeof remaining !== 'number' || typeof perDay !== 'number' || perDay <= 0) return null;
  return Math.floor(remaining / perDay);
}

/**
 * Representative-selection priority for a med group's `event` (used as the
 * Edit/Delete/Discontinue target): an ACTIVE series root beats an inactive
 * series root beats an active non-root beats an inactive non-root.
 *
 * WA3: the old rule only preferred "is a root" and ignored status, so a
 * mixed-state group (e.g. an 8am series discontinued, a sibling 8pm series of
 * the SAME name+dose still active) could pick the DISCONTINUED root as the
 * representative even though the group as a whole is Active. Two symptoms:
 * Edit opened the discontinued root (no reactivate-first guard, wrong
 * content), and DiscontinueMedDialog derived its direction from that stale
 * representative's `discontinued_at`, so clicking "Discontinue" on an
 * overall-active card silently REACTIVATED instead.
 */
function representativeScore(e: CalendarEvent): number {
  const isRoot = !e.parent_event_id;
  const isActive = !e.discontinued_at;
  return (isRoot ? 2 : 0) + (isActive ? 1 : 0);
}

/**
 * Group the roster's medication events into one entry per med key, split into
 * Active and Inactive. Mirrors mobile's MedicationHistoryScreen split: a key
 * with ANY active event is Active; an inactive entry is suppressed when an
 * active med of the SAME key exists (e.g. re-added at the same dose).
 */
function groupMedications(events: CalendarEvent[]): {
  active: MedGroup[];
  inactive: MedGroup[];
} {
  const groups = new Map<string, MedGroup>();

  for (const e of events) {
    if (e.event_type !== 'medication') continue;
    const name = e.medication_name || e.title || '';
    if (!name) continue;

    const key = getMedKey(e);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        event: e,
        name,
        dosage: e.medication_dosage || null,
        times: [],
        recurrenceEvent: null,
        inactive: true,
        daysLeft: null,
      };
      groups.set(key, group);
    }

    // Prefer an ACTIVE series-root row as the representative (Edit/Delete/
    // Discontinue target it) — see representativeScore above.
    if (representativeScore(e) > representativeScore(group.event)) group.event = e;
    if (!group.dosage && e.medication_dosage) group.dosage = e.medication_dosage;
    if (!group.recurrenceEvent && e.recurrence_rule) group.recurrenceEvent = e;
    if (e.scheduled_time) {
      const hhmm = e.scheduled_time.slice(0, 5);
      if (!group.times.includes(hhmm)) group.times.push(hhmm);
    }
    // Any active event of this key makes the whole med Active.
    if (!e.discontinued_at) group.inactive = false;

    // Stock is aggregated across the group rather than read off `event`. One
    // card can cover several series of the same med (8am + 8pm), and only the
    // refill-group primary row carries the counter — its siblings are written
    // with `quantity_remaining: undefined` on purpose (see
    // utils/firstRunMedication). `representativeScore` picks the Edit/Delete
    // target, which is frequently one of those empty siblings, so reading the
    // representative would hide the badge on exactly the multi-dose meds that
    // run out fastest. The MINIMUM wins: if any LIVE series of this medication
    // is low, the medication is low.
    //
    // DISCONTINUED ROWS ARE EXCLUDED, per row and not just per group. A stopped
    // series' counter froze at whatever was left the day it stopped — nothing
    // decrements it again — so it is a fact about a bottle that is no longer in
    // use. The card's own `!group.inactive` guard cannot catch this: `getMedKey`
    // keys on name + dosage, so a medication re-added at the same dose shares a
    // group with the stopped one, and a single live row makes that group Active.
    // The minimum then came off the DEAD row: a fresh 90-count bottle read
    // "Low stock · 4 days left" forever, on the card that says a stopped
    // medication is never low.
    if (e.discontinued_at) continue;

    const rowDaysLeft = stockDaysLeft(e);
    if (rowDaysLeft !== null) {
      group.daysLeft =
        group.daysLeft === null ? rowDaysLeft : Math.min(group.daysLeft, rowDaysLeft);
    }
  }

  const active: MedGroup[] = [];
  const inactive: MedGroup[] = [];
  for (const group of groups.values()) {
    group.times.sort();
    (group.inactive ? inactive : active).push(group);
  }
  const byName = (a: MedGroup, b: MedGroup) => a.name.localeCompare(b.name);
  active.sort(byName);
  inactive.sort(byName);
  return { active, inactive };
}

/**
 * "8:00 AM · 8:00 PM" — the dose times alone. The detail sheet shows these in its
 * Time row and the recurrence in its own Repeat row (mobile's layout), so it must
 * NOT get the full schedule line, which ends with the recurrence and printed
 * "Daily" twice. The roster card still uses `formatSchedule`, which builds on this.
 */
function formatTimes(group: MedGroup, timezone: string, t: TFunction, cycle: HourCycle): string {
  return group.times.length > 0
    ? group.times.map((time) => formatEventTimeCompact(time, timezone, cycle)).join(' · ')
    : t('meds:page.noTime');
}

/**
 * "8:00 AM · 8:00 PM · Daily" — the medication's schedule as one line.
 *
 * Extracted so the roster card and the detail sheet render the identical
 * string; computing it twice is how the same medication ends up described two
 * different ways on two surfaces.
 *
 * `cycle` is threaded in as a parameter: this is a module-level helper, and the
 * `.map()` below is outside React, so `useHourCycle()` cannot be called here.
 */
function formatSchedule(
  group: MedGroup,
  timezone: string,
  t: TFunction,
  language: string,
  cycle: HourCycle
): string {
  const timesLabel = formatTimes(group, timezone, t, cycle);
  const recurrenceLabel = group.recurrenceEvent
    ? formatRecurrenceLabel(group.recurrenceEvent, t, language)
    : null;
  return [timesLabel, recurrenceLabel].filter(Boolean).join(' · ');
}

interface MedCardProps {
  group: MedGroup;
  timezone: string;
  /** Viewer's resolved 12h/24h clock, from the page's useHourCycle(). */
  hourCycle: HourCycle;
  canEdit: boolean;
  onEdit: (group: MedGroup) => void;
  onToggleStatus: (group: MedGroup) => void;
  onDelete: (group: MedGroup) => void;
  onViewDetails: (group: MedGroup) => void;
}

function MedCard({
  group,
  timezone,
  hourCycle,
  canEdit,
  onEdit,
  onToggleStatus,
  onDelete,
  onViewDetails,
}: MedCardProps): ReactElement {
  const { t, i18n } = useTranslation(['meds', 'calendar']);

  const meta = formatSchedule(group, timezone, t, i18n.language, hourCycle);

  // A STOPPED MEDICATION IS NEVER LOW. "Low stock · 3 days left" is a claim
  // about a schedule that no longer runs, and the INACTIVE badge owns this slot
  // on a stopped card anyway — mobile forces the same exclusion, so the two
  // badges can never collide on either platform.
  const lowStockDays =
    !group.inactive && group.daysLeft !== null && group.daysLeft < LOW_STOCK_DAYS
      ? group.daysLeft
      : null;

  // THREE INLINE PILLS BECOME ONE MENU (spec §6.4). Edit / Discontinue /
  // Delete each carried a 44-tall pill beside a drug name, and below ~390px
  // that row could not fit: the name column collapsed and the actions wrapped
  // into a stack taller than the card they belonged to. One 44×44
  // `ellipsis-horizontal` trigger holds all three, exactly as mobile's
  // `medMenuButton` does, and Delete sits behind an explicit divider so it is
  // never the immediate neighbour of Edit.
  const menuItems: MoreMenuEntry[] = [
    { id: 'edit', label: t('meds:page.actions.edit'), onSelect: () => onEdit(group) },
    {
      id: 'toggle-status',
      label: t(group.inactive ? 'meds:page.actions.reactivate' : 'meds:page.actions.discontinue'),
      onSelect: () => onToggleStatus(group),
    },
    { divider: true },
    {
      id: 'delete',
      label: t('meds:page.actions.delete'),
      onSelect: () => onDelete(group),
      danger: true,
    },
  ];

  // An inactive medication keeps the same shell and geometry as a live one
  // (mobile parity) on the quieter `careCardSurfaceMuted` fill, and differs by
  // one thing: the INACTIVE badge. The badge is TEXT, so the state is never
  // carried by colour alone (WCAG 2.1 AA, SC 1.4.1).
  return (
    <li
      className={
        group.inactive
          ? `${careCardSurfaceMuted} p-3.5 [container-type:inline-size]`
          : careCardShell
      }
    >
      <div className={careCardTopRow}>
        <div className="min-w-0 flex-1">
          {/* A 44-TALL TARGET, not a 21px line of text.
              This is the card's only way into the medication, and it was the
              bare title's own text box — a ~21px strip that an older caregiver
              with an unsteady hand, or anyone on a phone, has to hit exactly
              (WCAG 2.5.5 / 2.5.8). `min-h-[44px]` with the label centred keeps
              the type metrics identical and grows only the CLICKABLE box;
              `w-full` hands it the whole name column rather than just the width
              of the word, so a short name like "Aspirin" is no harder to hit
              than a long one. */}
          <button
            type="button"
            onClick={() => onViewDetails(group)}
            aria-label={t('meds:page.detail.viewLabel', { name: group.name })}
            className={`m-0 flex min-h-[44px] w-full items-center border-0 bg-transparent p-0 text-left ${careCardTitle} ${
              group.inactive ? 'text-ink-2' : ''
            } underline-offset-2 hover:underline`}
          >
            {group.name}
          </button>

          <div className={careCardBadgeRow}>
            {group.inactive && (
              <span className={STATUS_PILL.inactive}>
                {t('calendar:discontinueMed.inactiveBadge')}
              </span>
            )}
            {/* Low stock, in the slot the INACTIVE badge uses — the two are
                mutually exclusive, so they share it the way they do on mobile.
                The text states the fact in full ("Low stock · 12 days left"),
                so terracotta is reinforcement and never the only signal. */}
            {lowStockDays !== null && (
              <span className={`${STATUS_PILL.overdue} text-terracotta`}>
                {t('meds:page.stock.lowStock')} ·{' '}
                {t('meds:page.stock.daysLeft', { count: lowStockDays })}
              </span>
            )}
          </div>

          <p className={`m-0 ${careCardMeta}`}>
            <span>{meta}</span>
            {group.dosage ? <span aria-hidden="true">·</span> : null}
            {group.dosage && <span className={careCardMetaDetail}>{group.dosage}</span>}
          </p>
        </div>

        {canEdit && (
          <MoreMenu
            items={menuItems}
            label={t('meds:page.actions.more', { name: group.name })}
            className="-mr-2.5 shrink-0 self-center"
          />
        )}
      </div>
    </li>
  );
}

export default function MedicationsPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['meds', 'calendar', 'common']);
  const { showToast } = useToast();

  const { canEdit, timezone } = useCircle(circleId);
  // Viewer's 12h/24h clock — threaded into every schedule string on this page.
  const hourCycle = useHourCycle();
  const rosterQuery = useMedicationRoster(circleId);
  const { events } = rosterQuery;
  const medicationStatus = useMedicationStatus(circleId);

  // THE TAB LIVES IN THE URL. A caregiver who reloads (or shares) a history
  // link must land back on History; component state alone silently dropped
  // them on the roster.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'history' ? 'history' : 'medications';
  function selectTab(next: string): void {
    const params = new URLSearchParams(searchParams);
    if (next === 'history') params.set('tab', 'history');
    else params.delete('tab');
    setSearchParams(params, { replace: true });
  }

  const [showAdd, setShowAdd] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<CalendarEvent | null>(null);
  const [detailGroup, setDetailGroup] = useState<MedGroup | null>(null);
  // Whole GROUP (not just its representative event) — DiscontinueMedDialog
  // needs the group's aggregate `inactive` flag as an explicit direction
  // override (WA3): the representative event's own `discontinued_at` can
  // disagree with the group in a mixed-state group.
  const [statusGroup, setStatusGroup] = useState<MedGroup | null>(null);
  // Inactive-edit guard: the med awaiting "reactivate to make changes".
  const [inactiveEditGroup, setInactiveEditGroup] = useState<MedGroup | null>(null);
  // History filter — a medication NAME (see MedicationFilter), or null for all.
  const [historyFilter, setHistoryFilter] = useState<string | null>(null);

  const { active, inactive } = useMemo(() => groupMedications(events), [events]);

  // The filter's options come from the SAME query HistoryList renders (React
  // Query dedupes the two calls onto one fetch), so the menu can never offer a
  // medication the list below it has no rows for.
  //
  // GATED on the recipient timezone. `historyParams` turns it into a
  // `[start_date, end_date]` pair and that pair IS the query key, so a
  // 'America/New_York' placeholder would fetch a 30-day window anchored on the
  // wrong day and then fetch a SECOND one under a different key the moment the
  // real zone landed — the same double-read that `GettingStartedChecklist` was
  // fixed for. `useCircle` reports null until the circle detail resolves.
  const historyWindow = timezone ? historyParams(timezone) : undefined;
  const historyQuery = useMedicationConfirmations(circleId, historyWindow, {
    enabled: tab === 'history' && historyWindow !== undefined,
  });
  const filterOptions = useMemo(
    () => medicationOptions((historyQuery.data?.confirmations ?? []) as HistoryConfirmation[]),
    [historyQuery.data]
  );

  // A FILTER THAT AGES OUT MUST NOT STAY ON SILENTLY.
  //
  // The filter holds a medication NAME, and the options are derived from the
  // 30-day history the reader has loaded. A medication that scrolls out of that
  // window — the day rolls over, or the med is discontinued and its last dose
  // ages past 30 days — leaves the name selected with no matching option, so
  // the trigger falls back to reading "All medications" while `HistoryList` is
  // still filtering by the vanished name. The reader then sees an EMPTY history
  // under a control that says nothing is filtered, and concludes the doses were
  // never recorded.
  //
  // Only once the options are actually loaded: an empty list mid-fetch is not
  // an aged-out filter, and resetting on it would clear the reader's choice on
  // every refetch.
  useEffect(() => {
    if (!historyFilter || filterOptions.length === 0) return;
    if (!filterOptions.some((option) => option.id === historyFilter)) setHistoryFilter(null);
  }, [historyFilter, filterOptions]);

  /**
   * Open a medication's detail modal — the read view for this page.
   *
   * Reports the "action set opened" funnel step (a deliberate click, never a
   * render).
   */
  function openMedDetail(group: MedGroup): void {
    if (canEdit) {
      Analytics.medicationActionsMenuOpened(circleId, {
        surface: 'meds_tab',
        isDiscontinued: group.inactive,
      });
    }
    setDetailGroup(group);
  }

  function handleEdit(group: MedGroup): void {
    if (group.inactive) {
      // Editing an inactive med is blocked — prompt to reactivate first.
      setInactiveEditGroup(group);
      return;
    }
    setEditingEvent(group.event);
  }

  async function handleReactivateForEdit(): Promise<void> {
    if (!inactiveEditGroup) return;
    try {
      // Reactivate EVERY series of this medication (same name + dose) in ONE
      // request — the server resolves the matching roots, so this no longer
      // depends on the roster it happens to have loaded.
      const result = await medicationStatus.mutateAsync({
        eventId: getSeriesRoot(inactiveEditGroup.event),
        discontinued: false,
        scope: 'medication',
      });
      // CONFIRMED SUCCESS only — the reactivate-to-edit path. Same mutation as
      // the explicit Reactivate action, reached from a different intent, so it
      // reports the same event. `series_count` is the server's count of roots
      // actually mutated. `capture` is non-throwing, so it cannot divert into
      // the catch below and report a success as a failure.
      Analytics.medicationReactivated(circleId, {
        surface: 'meds_tab',
        seriesCount: result.series_count ?? 0,
      });
      showToast(t('calendar:discontinueMed.reactivatedToast'), 'success');
    } catch {
      // useMedicationStatus surfaces its own permission/subscription/save toasts.
    } finally {
      setInactiveEditGroup(null);
    }
  }

  const isLoading = rosterQuery.isLoading;
  const isError = rosterQuery.isError;
  const isEmpty = active.length === 0 && inactive.length === 0;

  let roster: ReactElement;
  // `timezone === null` joins the skeleton branch rather than defaulting: every
  // card below renders its dose times with a zone SUFFIX ("8:00 AM MT"), so a
  // placeholder zone paints a label that is simply wrong and then repaints.
  // The roster query is usually still in flight at that point anyway, so this
  // costs no extra beat of skeleton in practice.
  if (isLoading || timezone === null) {
    roster = (
      <ul className={`m-0 list-none p-0 ${careCardListGap}`} aria-busy="true">
        <li className="sr-only">{t('meds:page.loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className={`${careCardSurface} p-3.5`}>
            <Skeleton className="h-4 w-1/3 max-w-40" />
            <Skeleton className="mt-2 h-3 w-1/2 max-w-56" />
          </li>
        ))}
      </ul>
    );
  } else if (isError) {
    roster = (
      <Card className="text-center">
        <p className="m-0 font-medium text-ink">{t('meds:page.errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('meds:page.errorHint')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void rosterQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (isEmpty) {
    roster = (
      <EmptyState
        tone="clay"
        icon="medkit-outline"
        title={t('meds:page.empty.title')}
        description={canEdit ? t('meds:page.empty.hint') : t('meds:page.empty.hintReadOnly')}
        actions={
          canEdit ? (
            <Button onClick={() => setShowAdd(true)}>{t('meds:page.empty.cta')}</Button>
          ) : undefined
        }
      />
    );
  } else {
    roster = (
      <div className="flex flex-col gap-8">
        {active.length > 0 && (
          <section aria-labelledby="meds-active-heading">
            <SectionHeader
              id="meds-active-heading"
              title={t('meds:page.active')}
              tone="clay"
              headingLevel={2}
            />
            <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
              {active.map((group) => (
                <MedCard
                  key={group.key}
                  group={group}
                  timezone={timezone}
                  hourCycle={hourCycle}
                  canEdit={canEdit}
                  onEdit={handleEdit}
                  onToggleStatus={setStatusGroup}
                  onDelete={(g) => setDeletingEvent(g.event)}
                  onViewDetails={openMedDetail}
                />
              ))}
            </ul>
          </section>
        )}

        {/* Inactive section only renders when non-empty — calm, de-emphasized. */}
        {inactive.length > 0 && (
          <section aria-labelledby="meds-inactive-heading">
            <SectionHeader
              id="meds-inactive-heading"
              title={t('meds:page.inactive')}
              tone="clay"
              headingLevel={2}
            />
            <p className="m-0 mb-3 text-sm text-ink-3">{t('meds:page.inactiveHint')}</p>
            <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
              {inactive.map((group) => (
                <MedCard
                  key={group.key}
                  group={group}
                  timezone={timezone}
                  hourCycle={hourCycle}
                  canEdit={canEdit}
                  onEdit={handleEdit}
                  onToggleStatus={setStatusGroup}
                  onDelete={(g) => setDeletingEvent(g.event)}
                  onViewDetails={openMedDetail}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl pb-12">
      <PageMasthead
        section={t('common:nav.meds')}
        tone="clay"
        title={t('meds:page.title')}
        subtitle={t('meds:history.subtitle')}
        rightAction={
          canEdit
            ? {
                name: 'add-outline',
                label: t('meds:page.add'),
                onClick: () => setShowAdd(true),
              }
            : undefined
        }
      >
        <CareTabs />
      </PageMasthead>

      <div className="px-5 pt-1">
        <SegmentedControl
          label={t('meds:page.title')}
          value={tab}
          onChange={selectTab}
          options={[
            { value: 'medications', label: t('meds:tabs.medications') },
            { value: 'history', label: t('meds:tabs.history') },
          ]}
        />
      </div>

      {tab === 'medications' ? (
        <div className="px-5 pt-6">{roster}</div>
      ) : (
        <div className="flex flex-col gap-4 px-5 pt-6">
          {/* THE TAB'S OWN HEADING, for the outline only.
              The masthead title is the page's `h1` and the day groups below are
              `h3` (they are sections OF this tab, not of the page), so without
              this the History tab jumped h1 -> h3 — an axe `heading-order`
              violation, and a screen-reader user navigating by heading landed
              on "Today" with nothing saying what list it belongs to. The
              Medications tab needs no equivalent: its ACTIVE / INACTIVE
              `SectionHeader`s are already the `h2` level.
              Visually hidden because the segmented control right above it
              already says "History" on screen. */}
          <Text variant="sectionTitle" as="h2" className="sr-only">
            {t('meds:history.title')}
          </Text>
          <AdherenceHero circleId={circleId} />
          <MedicationFilter
            options={filterOptions}
            value={historyFilter}
            onChange={setHistoryFilter}
          />
          {/* GATED: HistoryList derives its own 30-day window (and its day
              groupings) from this zone, so it must not mount on a guess — it
              would fetch one window, then a second under a different key. */}
          {timezone !== null && (
            <HistoryList circleId={circleId} timezone={timezone} medicationName={historyFilter} />
          )}
        </div>
      )}

      {showAdd && (
        <AddEventModal
          circleId={circleId}
          initialType="medication"
          onClose={() => setShowAdd(false)}
        />
      )}

      {editingEvent && (
        <AddEventModal
          circleId={circleId}
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {/* `timezone !== null` is structurally implied — the sheet only opens
          from a roster card, and the roster is a skeleton until the zone
          resolves — but the Time row it renders carries a zone suffix, so the
          gate is spelled out rather than defaulted. */}
      {detailGroup && timezone !== null && (
        <MedicationDetailModal
          circleId={circleId}
          event={detailGroup.event}
          name={detailGroup.name}
          dosage={detailGroup.dosage}
          times={formatTimes(detailGroup, timezone, t, hourCycle)}
          repeat={
            detailGroup.recurrenceEvent
              ? formatRecurrenceLabel(detailGroup.recurrenceEvent, t, i18n.language)
              : null
          }
          daysLeft={detailGroup.daysLeft}
          lowStock={
            !detailGroup.inactive &&
            detailGroup.daysLeft !== null &&
            detailGroup.daysLeft < LOW_STOCK_DAYS
          }
          inactive={detailGroup.inactive}
          canEdit={canEdit}
          onClose={() => setDetailGroup(null)}
          // Each action closes the sheet first, so the dialog it opens is never
          // a modal stacked on a modal.
          onEdit={() => {
            const g = detailGroup;
            setDetailGroup(null);
            handleEdit(g);
          }}
          onToggleStatus={() => {
            const g = detailGroup;
            setDetailGroup(null);
            setStatusGroup(g);
          }}
          onDelete={() => {
            const g = detailGroup;
            setDetailGroup(null);
            setDeletingEvent(g.event);
          }}
        />
      )}

      {deletingEvent && (
        <DeleteEventDialog
          circleId={circleId}
          event={deletingEvent}
          surface="meds_tab"
          onClose={() => setDeletingEvent(null)}
        />
      )}

      {statusGroup && (
        <DiscontinueMedDialog
          circleId={circleId}
          event={statusGroup.event}
          // Whole-medication semantics: the roster covers every loaded series.
          events={events}
          // Explicit direction (WA3) — the GROUP's aggregate status, not the
          // representative event's own discontinued_at, which can disagree
          // in a mixed-state group.
          groupInactive={statusGroup.inactive}
          surface="meds_tab"
          // EXPLICIT FALLBACK (to the dialog's own documented default) is fine
          // here: the prop is optional, ANALYTICS-ONLY (`days_active`), and
          // `DiscontinueMedDialog` already owns the missing-zone case. The
          // dialog can only open from a roster card, which does not render
          // until the zone resolves, so `undefined` is unreachable in practice.
          timezone={timezone ?? undefined}
          onClose={() => setStatusGroup(null)}
        />
      )}

      {inactiveEditGroup && (
        <ConfirmDialog
          icon="repeat-outline"
          iconTone="moss"
          title={t('calendar:discontinueMed.editInactiveTitle')}
          message={t('calendar:discontinueMed.editInactiveMessage')}
          confirmLabel={
            medicationStatus.isPending
              ? t('calendar:discontinueMed.working')
              : t('calendar:discontinueMed.reactivate')
          }
          cancelLabel={t('common:cancel')}
          closeLabel={t('calendar:discontinueMed.close')}
          confirmDisabled={medicationStatus.isPending}
          onConfirm={() => void handleReactivateForEdit()}
          onCancel={() => setInactiveEditGroup(null)}
        />
      )}
    </div>
  );
}
