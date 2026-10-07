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
import { getRosterMedKey, getSeriesRoot, indexSeriesContent } from '@/utils/medicationGrouping';
// THE shared "ended" definition (synced from mobile/src/pdf/shared): the Care
// Summary PDF uses the same helper, so the roster and the printout can never
// disagree about whether a medication is current.
import { isMedicationSeriesEnded } from '@/pdf/shared/medicationSelection';
import { MedicationDetailModal } from '@/components/meds/MedicationDetailModal';
import { AsNeededActions, LastGivenLine } from '@/components/meds/AsNeededParts';
import { DoseHistoryModal } from '@/components/meds/DoseHistoryModal';
import { useAsNeededGive } from '@/components/meds/useAsNeededGive';
import { useAsNeededSummaries, useCircleAsNeededDoses } from '@/hooks/useAsNeeded';
import { mergedMedicationOptions } from '@/components/meds/historyMerge';
import type { AsNeededSummary } from '@/api/medicationAsNeeded';
import { useAuthStore } from '@/store/authStore';
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
import {
  formatEventTimeCompact,
  getCachedDateTimeFormat,
  getDateInTimezone,
} from '@/utils/timezone';
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
   * Set only on an INACTIVE group none of whose rows is discontinued — the
   * medication stopped because its series ENDED ("This & future" delete, or an
   * end date that passed): the latest `recurrence_end_date` (naive YYYY-MM-DD,
   * recipient frame) among its ended series. Drives the "Ended <date>" badge
   * and hides Discontinue/Reactivate (Reactivate only clears `discontinued_at`
   * and could never restart a series). null for active and discontinued groups.
   */
  endedOn: string | null;
  /**
   * Inactive groups only: the most recent STOP day (YYYY-MM-DD, recipient
   * frame) across the group's stopped rows — a discontinued row's
   * `discontinued_at` resolved to a day in the recipient's zone, or an ended
   * series' `recurrence_end_date`. Orders the Inactive list, newest first.
   */
  stopDay: string;
  /**
   * Whole days of supply left, or null when this med is not refill-tracked.
   * Aggregated across the group's events, not read off `event` — see
   * `stockDaysLeft` and the reducer in `groupMedications`.
   */
  daysLeft: number | null;
  /**
   * AS-NEEDED (PRN) medication: no schedule, no times, no repeat. Keyed apart
   * from a scheduled medication of the same name + dose (D5: "1 tablet daily"
   * plus "extra as needed" are two entries, two cards).
   */
  asNeeded: boolean;
  /** The optional plain "what is it for" note (as-needed only). */
  reason: string | null;
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
 * "Jan 5, 2026" / "5 ene 2026" for a naive YYYY-MM-DD — the web twin of
 * mobile's `formatWireDay(day, locale, { month: 'short', day: 'numeric',
 * year: 'numeric' })`: the day is built at noon UTC from its parts and
 * formatted IN UTC, so the browser's own zone can never shift it.
 */
function formatNaiveDate(dateStr: string, locale: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return '';
  return getCachedDateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
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
function representativeScore(e: CalendarEvent, isActive: boolean): number {
  const isRoot = !e.parent_event_id;
  // Tiebreak only: with the root outside the window, a virtual instance
  // carries the series' current content, a materialized child a stale one.
  const isVirtual = !!e.is_virtual;
  return (isRoot ? 2 : 0) + (isActive ? 1 : 0) + (isVirtual ? 0.5 : 0);
}

/**
 * Group the roster's medication events into one entry per med key, split into
 * Active and Inactive. Mirrors mobile's MedicationHistoryScreen split: a key
 * with ANY active event is Active; an inactive entry is suppressed when an
 * active med of the SAME key exists (e.g. re-added at the same dose).
 */
function groupMedications(
  events: CalendarEvent[],
  timezone: string | null,
  now: Date = new Date()
): {
  active: MedGroup[];
  inactive: MedGroup[];
} {
  const groups = new Map<string, MedGroup>();
  const seriesContent = indexSeriesContent(events);
  // A row is LIVE when it is not discontinued AND its series has not ended.
  // "Ended" is read off the series' CURRENT content (root, or a virtual
  // instance standing in for it): a "This & future" delete writes the end date
  // on the root only, so a materialized child of an ended series must not keep
  // its medication Active.
  const seriesEndedOn = (e: CalendarEvent): string | null => {
    const source = seriesContent.get(getSeriesRoot(e)) ?? e;
    return isMedicationSeriesEnded(source, now) ? (source.recurrence_end_date ?? null) : null;
  };
  // Discontinued is PER SERIES too: with `includeInactiveRoots` the window can
  // hold only materialized children of a stopped series (confirmed doses),
  // which carry no `discontinued_at` of their own — only the root does.
  const discontinuedAtOf = (e: CalendarEvent): string | null =>
    e.discontinued_at ?? (seriesContent.get(getSeriesRoot(e)) ?? e).discontinued_at ?? null;
  const isLive = (e: CalendarEvent): boolean =>
    !discontinuedAtOf(e) && seriesEndedOn(e) === null;
  // Keys with at least one DISCONTINUED row: those stay "Inactive" + Reactivate.
  const discontinuedKeys = new Set<string>();

  for (const e of events) {
    if (e.event_type !== 'medication') continue;
    if (!(e.medication_name || e.title)) continue;

    // A child joins its series' card, and the card's name/dosage come from the
    // series' CURRENT content (root, or a virtual instance when the root is
    // outside the window) — materialized children keep point-in-time values
    // after an edit (see indexSeriesContent).
    const source = seriesContent.get(getSeriesRoot(e)) ?? e;
    // An as-needed row has no series (no parent, no virtual instances): its key
    // is its own, suffixed so it never merges into a scheduled card.
    const key = getRosterMedKey(e, seriesContent) + (e.as_needed === true ? '|as_needed' : '');
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        event: e,
        name: source.medication_name || source.title || '',
        dosage: source.medication_dosage || null,
        times: [],
        recurrenceEvent: null,
        inactive: true,
        endedOn: null,
        stopDay: '',
        daysLeft: null,
        asNeeded: e.as_needed === true,
        reason: e.as_needed === true ? (e.as_needed_reason ?? null) : null,
      };
      groups.set(key, group);
    }

    // Prefer an ACTIVE series-root row as the representative (Edit/Delete/
    // Discontinue target it) — see representativeScore above.
    const live = isLive(e);
    if (representativeScore(e, live) > representativeScore(group.event, isLive(group.event))) {
      group.event = e;
    }
    if (!group.dosage && source.medication_dosage) group.dosage = source.medication_dosage;
    // A virtual instance carries its parent's rule but NOT `recurrence_days`
    // (backend `generateVirtualInstances`), so a Mon/Wed/Fri series would label
    // as plain "Weekly" whenever a virtual row happened to come first. Prefer a
    // row that actually carries the day set.
    if (
      e.recurrence_rule &&
      (!group.recurrenceEvent ||
        (!group.recurrenceEvent.recurrence_days?.length && !!e.recurrence_days?.length))
    ) {
      group.recurrenceEvent = e;
    }
    if (e.scheduled_time) {
      const hhmm = e.scheduled_time.slice(0, 5);
      if (!group.times.includes(hhmm)) group.times.push(hhmm);
    }
    // Any LIVE event of this key makes the whole med Active — a multi-series
    // med (8am + 8pm) stays Active while any one series still runs.
    if (live) group.inactive = false;
    const discontinuedAt = discontinuedAtOf(e);
    if (discontinuedAt) discontinuedKeys.add(key);
    const endedOn = seriesEndedOn(e);
    if (endedOn && (!group.endedOn || endedOn > group.endedOn)) group.endedOn = endedOn;
    // Stop day (mobile parity): a discontinued row stops on its discontinue
    // day IN THE RECIPIENT'S ZONE, an ended one on its end date. The zone is
    // only null while the roster is still a skeleton, when order is moot.
    if (!live) {
      const stop = discontinuedAt
        ? timezone
          ? getDateInTimezone(timezone, new Date(discontinuedAt))
          : ''
        : (endedOn ?? '');
      if (stop > group.stopDay) group.stopDay = stop;
    }

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
    //
    // ENDED series are excluded the same way, for the same reason: nothing
    // decrements a counter once its series stops producing doses.
    if (!live) continue;

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
    // "Ended <date>" only when the med is inactive AND nothing of it was
    // discontinued: a discontinued series keeps the "Inactive" badge and its
    // Reactivate action, which does something for it.
    if (!group.inactive || discontinuedKeys.has(group.key)) group.endedOn = null;
    (group.inactive ? inactive : active).push(group);
  }
  // Active stays alphabetical. Inactive is MOST RECENT STOP FIRST (mobile
  // parity) — a caregiver checking a just-stopped med finds it on top; ties keep
  // arrival order (Array.prototype.sort is stable).
  const byName = (a: MedGroup, b: MedGroup) => a.name.localeCompare(b.name);
  active.sort(byName);
  inactive.sort((a, b) => (a.stopDay === b.stopDay ? 0 : a.stopDay < b.stopDay ? 1 : -1));
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
  /** As-needed cards only: the shared "Gave a dose" flow + the last-given read. */
  asNeededFlow?: {
    summary: AsNeededSummary | undefined;
    myUserId: string | null;
    pending: boolean;
    inFlight: boolean;
    onGive: (group: MedGroup) => void;
    onHistory: (group: MedGroup) => void;
    onUndo: (group: MedGroup) => void;
  };
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
  asNeededFlow,
}: MedCardProps): ReactElement {
  const { t, i18n } = useTranslation(['meds', 'calendar']);

  // An as-needed medication has no time and no repeat: the line says so, and the
  // last-given status below it is the only "state" the card carries.
  const meta = group.asNeeded
    ? t('meds:asNeeded.card.badge')
    : formatSchedule(group, timezone, t, i18n.language, hourCycle);
  const endedLabel = group.endedOn
    ? t('calendar:discontinueMed.endedOn', { date: formatNaiveDate(group.endedOn, i18n.language) })
    : null;

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
  //
  // An ENDED medication (series end date passed, never discontinued) has no
  // Discontinue/Reactivate (mobile parity): Reactivate only clears
  // `discontinued_at` and cannot restart a series, and there is nothing left
  // to discontinue. Edit and Delete stay.
  const menuItems: MoreMenuEntry[] = [
    { id: 'edit', label: t('meds:page.actions.edit'), onSelect: () => onEdit(group) },
    ...(endedLabel
      ? []
      : [
          {
            id: 'toggle-status',
            label: t(
              group.inactive ? 'meds:page.actions.reactivate' : 'meds:page.actions.discontinue'
            ),
            onSelect: () => onToggleStatus(group),
          },
        ]),
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
            aria-label={
              endedLabel
                ? `${t('meds:page.detail.viewLabel', { name: group.name })}, ${endedLabel}`
                : t('meds:page.detail.viewLabel', { name: group.name })
            }
            className={`m-0 flex min-h-[44px] w-full items-center border-0 bg-transparent p-0 text-left ${careCardTitle} ${
              group.inactive ? 'text-ink-2' : ''
            } underline-offset-2 hover:underline`}
          >
            {group.name}
          </button>

          <div className={careCardBadgeRow}>
            {group.inactive && (
              <span className={STATUS_PILL.inactive}>
                {endedLabel ?? t('calendar:discontinueMed.inactiveBadge')}
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
            {group.asNeeded && group.reason ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t('meds:asNeeded.card.forReason', { reason: group.reason })}</span>
              </>
            ) : null}
            {group.dosage ? <span aria-hidden="true">·</span> : null}
            {group.dosage && <span className={careCardMetaDetail}>{group.dosage}</span>}
          </p>

          {/* AS-NEEDED STATUS: "Last given {time} by {name}" or "Not given yet" —
              nothing else. No counter, no limit, no "OK again after". */}
          {group.asNeeded && !group.inactive && asNeededFlow && (
            <p className={`m-0 ${careCardMeta}`}>
              <LastGivenLine
                summary={asNeededFlow.summary}
                timezone={timezone}
                myUserId={asNeededFlow.myUserId}
              />
            </p>
          )}
        </div>

        {canEdit && (
          <MoreMenu
            items={menuItems}
            label={t('meds:page.actions.more', { name: group.name })}
            className="-mr-2.5 shrink-0 self-center"
          />
        )}
      </div>

      {group.asNeeded && asNeededFlow && (
        <AsNeededActions
          name={group.name}
          canEdit={canEdit}
          inactive={group.inactive}
          pending={asNeededFlow.pending}
          inFlight={asNeededFlow.inFlight}
          onGive={() => asNeededFlow.onGive(group)}
          onHistory={() => asNeededFlow.onHistory(group)}
          onUndo={() => asNeededFlow.onUndo(group)}
        />
      )}
    </li>
  );
}

export default function MedicationsPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['meds', 'calendar', 'common']);
  const { showToast } = useToast();

  const { canEdit, timezone, isError: circleReadFailed, refetch: refetchCircle } = useCircle(circleId);
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

  const { active, inactive } = useMemo(
    () => groupMedications(events, timezone),
    [events, timezone]
  );

  // AS-NEEDED (PRN): one summary read for the circle ("last dose" per active
  // as-needed medication), only when the roster has any. The give flow, the
  // dose log and the card actions are the SAME ones Home uses.
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const hasActiveAsNeeded = active.some((g) => g.asNeeded);
  const { summaries: asNeededSummaries, isSuccess: asNeededSummariesLoaded } =
    useAsNeededSummaries(circleId, { enabled: hasActiveAsNeeded });
  const give = useAsNeededGive({
    circleId,
    timezone,
    summaries: asNeededSummaries,
    surface: 'meds_tab',
  });
  const [historyGroup, setHistoryGroup] = useState<MedGroup | null>(null);
  const activeScheduled = useMemo(() => active.filter((g) => !g.asNeeded), [active]);
  const activeAsNeeded = useMemo(() => active.filter((g) => g.asNeeded), [active]);
  const asNeededFlowFor = (group: MedGroup): MedCardProps['asNeededFlow'] =>
    group.asNeeded
      ? {
          // `undefined` until the read answers: the card must not say "Not given
          // yet" off a read that has not come back.
          summary: asNeededSummariesLoaded
            ? (asNeededSummaries[group.event.id] ?? { last_dose: null })
            : undefined,
          myUserId,
          pending: !!give.pending[group.event.id],
          inFlight: !!give.inFlight[group.event.id],
          onGive: (g) =>
            give.requestGive({ id: g.event.id, name: g.name, dosage: g.dosage }),
          onHistory: (g) => setHistoryGroup(g),
          onUndo: (g) => give.undo(g.event.id),
        }
      : undefined;

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
  // As-needed doses (same 30-day window, same query key as HistoryList's, so one
  // fetch) add their medication names to the menu. Soft-fail: no doses, no names.
  const { doses: historyDoses } = useCircleAsNeededDoses(circleId, historyWindow, {
    includeRemoved: true,
    enabled: tab === 'history',
  });
  const filterOptions = useMemo(
    () =>
      mergedMedicationOptions(
        medicationOptions((historyQuery.data?.confirmations ?? []) as HistoryConfirmation[]),
        historyDoses
      ),
    [historyQuery.data, historyDoses]
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
    // Only a DISCONTINUED med is guarded (mobile's useMedicationActions keys on
    // `discontinued_at` too): reactivating an ENDED one is a no-op, so the
    // prompt would promise "Reactivated" and leave the editor closed.
    if (group.inactive && !group.endedOn) {
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
  //
  // ...unless the CIRCLE read itself failed (a removed member's 403, a 5xx): then
  // `timezone` stays null with nothing left to wait for, so show the error card
  // instead of an endless skeleton.
  if (timezone === null && circleReadFailed) {
    roster = (
      <Card className="text-center">
        <p className="m-0 font-medium text-ink">{t('meds:page.errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('meds:page.errorHint')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => refetchCircle()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (isLoading || timezone === null) {
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
        {activeScheduled.length > 0 && (
          <section aria-labelledby="meds-active-heading">
            <SectionHeader
              id="meds-active-heading"
              title={t('meds:page.active')}
              tone="clay"
              headingLevel={2}
            />
            <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
              {activeScheduled.map((group) => (
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
                  asNeededFlow={asNeededFlowFor(group)}
                />
              ))}
            </ul>
          </section>
        )}

        {/* AS NEEDED: active PRN medications, in their own section — they have no
            schedule, so they never sit among the dose-time cards. */}
        {activeAsNeeded.length > 0 && (
          <section aria-labelledby="meds-as-needed-heading">
            <SectionHeader
              id="meds-as-needed-heading"
              title={t('meds:asNeeded.section.title')}
              tone="clay"
              headingLevel={2}
            />
            <p className="m-0 mb-3 text-sm text-ink-3">{t('meds:asNeeded.section.hint')}</p>
            <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
              {activeAsNeeded.map((group) => (
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
                  asNeededFlow={asNeededFlowFor(group)}
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
                  asNeededFlow={asNeededFlowFor(group)}
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
          asNeeded={
            detailGroup.asNeeded
              ? {
                  reason: detailGroup.reason,
                  lastGiven: (
                    <LastGivenLine
                      summary={
                        asNeededSummariesLoaded
                          ? (asNeededSummaries[detailGroup.event.id] ?? { last_dose: null })
                          : undefined
                      }
                      timezone={timezone}
                      myUserId={myUserId}
                    />
                  ),
                  onGive: () => {
                    const g = detailGroup;
                    setDetailGroup(null);
                    give.requestGive({
                      id: g.event.id,
                      name: g.name,
                      dosage: g.dosage,
                      surface: 'detail',
                    });
                  },
                  onHistory: () => {
                    const g = detailGroup;
                    setDetailGroup(null);
                    setHistoryGroup(g);
                  },
                }
              : undefined
          }
          lowStock={
            !detailGroup.inactive &&
            detailGroup.daysLeft !== null &&
            detailGroup.daysLeft < LOW_STOCK_DAYS
          }
          inactive={detailGroup.inactive}
          endedLabel={
            detailGroup.endedOn
              ? t('calendar:discontinueMed.endedOn', {
                  date: formatNaiveDate(detailGroup.endedOn, i18n.language),
                })
              : null
          }
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

      {historyGroup && timezone !== null && (
        <DoseHistoryModal
          circleId={circleId}
          eventId={historyGroup.event.id}
          name={historyGroup.name}
          timezone={timezone}
          canEdit={canEdit}
          onClose={() => setHistoryGroup(null)}
        />
      )}

      {give.dialogs}

      {deletingEvent && (
        <DeleteEventDialog
          circleId={circleId}
          event={deletingEvent}
          surface="meds_tab"
          // A CARD is never a dose the user picked: `deletingEvent` is the
          // group's representative (usually the series root, dated its START
          // day). No "This dose / This and future" picker from here — that
          // anchored on the start date and erased recorded doses (test-gap
          // audit #1). Whole-medication confirm + Discontinue hint instead,
          // exactly like mobile's card (`doseScoped` false).
          doseScoped={false}
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
