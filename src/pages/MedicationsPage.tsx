import { useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  useToast,
  careCardSurface,
  careCardSurfaceMuted,
} from '@/components/ui';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { DeleteEventDialog } from '@/components/calendar/DeleteEventDialog';
import { DiscontinueMedDialog } from '@/components/calendar/DiscontinueMedDialog';
import { formatRecurrenceLabel } from '@/components/calendar/recurrenceLabel';
import { useMedicationRoster, useMedicationStatus } from '@/hooks/useCalendarEvents';
import { useCircle } from '@/hooks/useCircle';
import { getMedKey, getSeriesRootsForMed } from '@/utils/medicationGrouping';
import { MedicationDetailModal } from '@/components/meds/MedicationDetailModal';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { HourCycle } from '@/utils/hourCycle';
import { formatEventTimeCompact } from '@/utils/timezone';

// Medications page (Stage 17 — web parity with mobile's MedicationHistoryScreen
// roster). ONE card per medication (normalized name + dosage — see
// getMedKey), split into Active and "Inactive / Past medications" sections.
// This page is the primary surface where INACTIVE meds are reachable on web:
// the calendar GET excludes them by default, so reactivation lives here.
//
// Action parity (Meds page ↔ calendar detail): Edit, Discontinue/Reactivate
// (whole-medication — every series of the same name + dose), Delete. Editing
// an INACTIVE med is guarded by a reactivate-first prompt (mobile parity).

const SKELETON_ROWS = [0, 1, 2];

/** Pill glyph for the empty-state tile (decorative). */
function MedsEmptyIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
      <path d="m8.5 8.5 7 7" />
    </svg>
  );
}

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
  cycle: HourCycle,
): string {
  const timesLabel =
    group.times.length > 0
      ? group.times.map((time) => formatEventTimeCompact(time, timezone, cycle)).join(' · ')
      : t('meds:page.noTime');
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

  return (
    <li
      className={`${group.inactive ? careCardSurfaceMuted : careCardSurface} px-4 py-3`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button
              type="button"
              onClick={() => onViewDetails(group)}
              aria-label={t('meds:page.detail.viewLabel', { name: group.name })}
              className={`m-0 border-0 bg-transparent p-0 text-left text-sm font-medium underline-offset-2 hover:underline ${
                group.inactive ? 'text-ink-2' : 'text-ink'
              }`}
            >
              {group.name}
            </button>
            {group.dosage && <span className="text-sm text-ink-2">{group.dosage}</span>}
            {group.inactive && (
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-3">
                {t('calendar:discontinueMed.inactiveBadge')}
              </span>
            )}
          </p>
          <p className="m-0 mt-0.5 text-xs text-ink-3">{meta}</p>
        </div>

        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="md"
              onClick={() => onEdit(group)}
              aria-label={t('meds:page.actions.editLabel', { name: group.name })}
            >
              {t('meds:page.actions.edit')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => onToggleStatus(group)}
              aria-label={t(
                group.inactive
                  ? 'meds:page.actions.reactivateLabel'
                  : 'meds:page.actions.discontinueLabel',
                { name: group.name }
              )}
            >
              {t(
                group.inactive ? 'meds:page.actions.reactivate' : 'meds:page.actions.discontinue'
              )}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => onDelete(group)}
              aria-label={t('meds:page.actions.deleteLabel', { name: group.name })}
            >
              {t('meds:page.actions.delete')}
            </Button>
          </div>
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

  const { active, inactive } = useMemo(() => groupMedications(events), [events]);

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
      // Reactivate EVERY series of this medication (same name + dose).
      const roots = getSeriesRootsForMed(events, inactiveEditGroup.event);
      await Promise.all(
        roots.map((rootId) =>
          medicationStatus.mutateAsync({ eventId: rootId, discontinued: false })
        )
      );
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

  let body: ReactElement;
  if (isLoading) {
    body = (
      <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-busy="true">
        <li className="sr-only">{t('meds:page.loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className="rounded-2xl border border-line bg-cream px-4 py-3">
            <Skeleton className="h-4 w-1/3 max-w-40" />
            <Skeleton className="mt-2 h-3 w-1/2 max-w-56" />
          </li>
        ))}
      </ul>
    );
  } else if (isError) {
    body = (
      <Card className="text-center">
        <p className="m-0 font-medium text-ink">{t('meds:page.errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('meds:page.errorHint')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void rosterQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (isEmpty) {
    body = (
      <Card className="p-8">
        <EmptyState
          tone="moss"
          icon={<MedsEmptyIcon />}
          title={t('meds:page.empty.title')}
          description={canEdit ? t('meds:page.empty.hint') : t('meds:page.empty.hintReadOnly')}
        >
          {canEdit && (
            <Button onClick={() => setShowAdd(true)}>{t('meds:page.empty.cta')}</Button>
          )}
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {active.length > 0 && (
          <section aria-labelledby="meds-active-heading">
            <h2 id="meds-active-heading" className="eyebrow m-0">
              {t('meds:page.active')}
            </h2>
            <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
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
                  onViewDetails={setDetailGroup}
                />
              ))}
            </ul>
          </section>
        )}

        {/* Inactive section only renders when non-empty — calm, de-emphasized. */}
        {inactive.length > 0 && (
          <section aria-labelledby="meds-inactive-heading">
            <h2 id="meds-inactive-heading" className="eyebrow m-0">
              {t('meds:page.inactive')}
            </h2>
            <p className="m-0 mt-1 text-sm text-ink-3">{t('meds:page.inactiveHint')}</p>
            <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
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
                  onViewDetails={setDetailGroup}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-5xl p-6 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="serif m-0 text-xl text-ink">{t('meds:page.title')}</h1>
          <p className="m-0 mt-1 text-sm text-ink-3">{t('meds:page.subtitle')}</p>
        </div>
        {canEdit && <Button onClick={() => setShowAdd(true)}>{t('meds:page.add')}</Button>}
      </header>

      <div className="mt-6">{body}</div>

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

      {detailGroup && (
        <MedicationDetailModal
          circleId={circleId}
          event={detailGroup.event}
          name={detailGroup.name}
          dosage={detailGroup.dosage}
          schedule={formatSchedule(detailGroup, timezone, t, i18n.language, hourCycle)}
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
          onClose={() => setStatusGroup(null)}
        />
      )}

      {inactiveEditGroup && (
        <ConfirmDialog
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
    </section>
  );
}
