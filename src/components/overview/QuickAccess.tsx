import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconTile, SectionHeader, Sheet, SheetRowPressable } from '@/components/ui';
import type { IconName } from '@/components/ui';
import type { IconTileTone } from '@/components/ui';
import { useTasks } from '@/hooks/useTasks';
import { Analytics } from '@/lib/analytics';

// Spec §6.3.4 — port of mobile's Quick Access list
// (CircleDetailScreen.tsx:890-1019 + `utils/quickAccessTabs.ts`).
//
// Order is mobile's, in mobile's two groups: the Care destinations first
// (Notes, Calendar, Meds, Tasks, Vitals) and then the two that have no other
// way in (Activity feed, Care info). Web draws one continuous list, exactly
// as mobile does — mobile's two `<View>` groups exist only so its hairline
// logic can run per group, and it deliberately keeps the rule between them.

interface QuickAccessRow {
  /** Analytics/series id — mobile's `entry.labelKey.replace('quickAccess.',  '')`. */
  id: string;
  labelKey: string;
  icon: IconName;
  tone: IconTileTone;
  /** Path segment under `/circles/:circleId`. */
  segment: string;
}

/**
 * Exported so the order is assertable rather than read off the JSX.
 *
 * TWO GLYPH DIVERGENCES FROM MOBILE, both taken from spec §6.3.4 (which is
 * the authority here) and both reported with this task:
 *   - Vitals uses `heart-outline`; mobile uses `fitness-outline`, which this
 *     app's icon set does not bundle (`iconNames.ts`).
 *   - Care info uses `medical-outline`; mobile uses `heart-outline`, which
 *     would now collide with the Vitals row two lines above it.
 */
export const QUICK_ACCESS_ROWS: readonly QuickAccessRow[] = [
  { id: 'notes', labelKey: 'quickAccess.notes', icon: 'document-text-outline', tone: 'dusk', segment: 'notes' },
  { id: 'calendar', labelKey: 'quickAccess.calendar', icon: 'calendar-outline', tone: 'moss', segment: 'calendar' },
  { id: 'medications', labelKey: 'quickAccess.medications', icon: 'medkit-outline', tone: 'clay', segment: 'meds' },
  { id: 'tasks', labelKey: 'quickAccess.tasks', icon: 'checkbox-outline', tone: 'dusk', segment: 'tasks' },
  { id: 'vitals', labelKey: 'quickAccess.vitals', icon: 'heart-outline', tone: 'moss', segment: 'vitals' },
  { id: 'activityFeed', labelKey: 'quickAccess.activityFeed', icon: 'pulse-outline', tone: 'dusk', segment: 'activity' },
  { id: 'careInfo', labelKey: 'quickAccess.careInfo', icon: 'medical-outline', tone: 'terracotta', segment: 'emergency' },
] as const;

export interface QuickAccessProps {
  circleId: string;
}

/**
 * The seven-row navigation Sheet under the adherence card.
 *
 * The open-task count is the ONE live datum in this block (mobile dropped the
 * per-row note lines in 2026-08 because six of the seven merely restated their
 * own label). `?? 0` is applied HERE and not at the query, mirroring mobile:
 * a badge has nothing to show while the count is unknown, whereas OpenTasksCard
 * must be able to tell "unknown" from "none" to decide about its overflow row.
 *
 * `limit: 1` — this row only ever needs the COUNT, never the tasks array, so
 * asking for one row and reading `total` (the backend's pre-limit match
 * count) avoids fetching every open task just to measure `.length`. The
 * `?? tasks.length` fallback is only a safety net for a stale/rolled-back
 * backend that doesn't send `total` yet — with `limit: 1` in effect it would
 * itself read as at most 1, not the real count, so it undercounts rather than
 * crashing. Ship-together backend/frontend means that path should not occur
 * in practice.
 */
export function QuickAccess({ circleId }: QuickAccessProps): ReactElement {
  const { t } = useTranslation('overview');
  const tasksQuery = useTasks(circleId, { status: 'open', limit: 1 });
  const openTaskCount = tasksQuery.data?.total ?? tasksQuery.data?.tasks.length ?? 0;

  return (
    <section aria-labelledby="quick-access-heading">
      <SectionHeader id="quick-access-heading" title={t('quickAccess.title')} />
      {/* Rows are DIRECT children of the Sheet, not wrapped in <li>: the row's
          hairline is drawn by `first:border-t-0`, which is relative to the
          row's own parent. Wrapping each row in a list item would make every
          row "first" and erase every rule between them. */}
      <Sheet as="nav" padding="none" className="overflow-hidden" aria-labelledby="quick-access-heading">
        {QUICK_ACCESS_ROWS.map((row) => {
          const label = t(row.labelKey);
          const badge = row.id === 'tasks' && openTaskCount > 0 ? openTaskCount : null;
          return (
            <SheetRowPressable
              key={row.id}
              to={`/circles/${circleId}/${row.segment}`}
              // Same event + destination id as mobile's `quick_access_tapped`,
              // so one PostHog insight covers both surfaces. The Link still
              // navigates; this only observes the press.
              onClick={() => Analytics.quickAccessTapped(row.id)}
              aria-label={
                badge === null ? label : `${label}, ${t('quickAccess.tasksNote', { count: badge })}`
              }
            >
              <IconTile size={36} tone={row.tone} name={row.icon} />
              {/* Mobile's label is 15/500; web's dense-row size is 16
                  (`text-md`, spec §3.3) — arbitrary sizes are banned and 15
                  is not on the scale. Reported as a deviation with Task 14. */}
              <span className="min-w-0 flex-1 text-md font-medium text-ink">{label}</span>
              {badge !== null ? (
                <span className="min-w-5 rounded-full bg-dusk px-1.5 py-0.5 text-center text-xs font-medium text-cream">
                  {badge}
                </span>
              ) : null}
              <Icon name="chevron-forward" size="inline" className="text-ink-3" />
            </SheetRowPressable>
          );
        })}
      </Sheet>
    </section>
  );
}

export default QuickAccess;
