import { useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Accordion,
  Button,
  Card,
  ChipSelect,
  ConfirmDialog,
  EmptyState,
  Eyebrow,
  Icon,
  IconTile,
  MoreMenu,
  Sheet,
  Skeleton,
  Text,
  useAccordionGroup,
  useToast,
  careCardListGap,
  careCardMeta,
  careCardShell,
  careCardTitle,
  careCardTopRow,
  type IconName,
  type IconTileTone,
} from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { AddVitalModal } from '@/components/vitals/AddVitalModal';
import { EditVitalModal } from '@/components/vitals/EditVitalModal';
import { VitalsChart, type VitalsChartSeries } from '@/components/vitals/VitalsChart';
import { useVitals, useDeleteVital } from '@/hooks/useVitals';
import { useUnitPreferences } from '@/hooks/useUnitPreferences';
import { useCircle } from '@/hooks/useCircle';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { HealthVital, VitalType } from '@/api/vitals';
import {
  DEFAULT_UNIT_PREFERENCES,
  formatVitalValue,
  fromCanonicalValue,
  getDisplayUnit,
  type GlucoseUnit,
  type WeightUnit,
} from '@/lib/vitals';
import { utcISOToRecipientWallTime } from '@/components/vitals/vitalDateTime';
import { formatTimeOfDay } from '@/utils/timezone';

// Task 21 (mobile parity) — vitals page. MIRRORS
// mobile/src/screens/vitals/VitalsDetailScreen.tsx: masthead (moss), type
// chips, range pill, latest-reading hero, inline SVG trend chart, and the
// readings list; VitalFormScreen supplies the add/edit/delete affordances.
//
// GATING:
//   - all write affordances (Add / Edit / Delete) require useCircle().canEdit.
//     Every reading is manual and freely editable/deletable.
//
// TIMEZONE: recorded_at is a UTC ISO timestamp; we render its date/time in the
// care recipient's timezone (utcISOToRecipientWallTime) — never device-local.

const VITAL_TYPES: VitalType[] = ['blood_pressure', 'heart_rate', 'glucose', 'weight'];
const TYPE_FILTERS: Array<VitalType | 'all'> = ['all', ...VITAL_TYPES];

/**
 * Per-type glyph + tint, copied from mobile `TYPE_CONFIG` (VitalsDetailScreen
 * ~74-97): blood pressure clay, heart rate terracotta, glucose dusk, weight
 * moss.
 */
const TYPE_CONFIG: Record<VitalType, { icon: IconName; tone: IconTileTone }> = {
  blood_pressure: { icon: 'heart-outline', tone: 'clay' },
  heart_rate: { icon: 'pulse-outline', tone: 'terracotta' },
  glucose: { icon: 'water-outline', tone: 'dusk' },
  weight: { icon: 'scale-outline', tone: 'moss' },
};

/**
 * Blood pressure plots two lines. Systolic takes the BP type colour (warm
 * clay); diastolic takes the cool dusk token — the same colour the Glucose
 * type uses, which is safe because the two are never on screen together
 * (mobile `DIASTOLIC_COLOR`).
 */
const DIASTOLIC_COLOR = 'dusk' as const;

type RangeChoice = '7d' | '30d' | '90d';
const RANGE_CHOICES: RangeChoice[] = ['7d', '30d', '90d'];
const RANGE_DAYS: Record<RangeChoice, number> = { '7d': 7, '30d': 30, '90d': 90 };

const SKELETON_ROWS = [0, 1, 2, 3];

/** A curve needs two points; below that the chart section stays closed. */
const MIN_CHART_POINTS = 2;

/**
 * Localized "Jun 15, 2026" label for a reading's recorded day, in the CARE
 * RECIPIENT's timezone (same date-only convention as VitalRow: format the
 * wall date at UTC noon with timeZone: 'UTC' so the day never shifts).
 */
function formatRecordedDay(
  recordedAtISO: string,
  timezone: string,
  locale: string = i18n.language
): string {
  const wall = utcISOToRecipientWallTime(recordedAtISO, timezone);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${wall.date}T12:00:00Z`));
}

/** "Jun 15" — the compact form the chart's x axis carries. */
function formatShortDay(recordedAtISO: string, timezone: string): string {
  const wall = utcISOToRecipientWallTime(recordedAtISO, timezone);
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${wall.date}T12:00:00Z`));
}

/** "Jun 15, 2026 · 12:00 PM", recipient zone + viewer hour cycle. */
function formatRecordedStamp(
  recordedAtISO: string,
  timezone: string,
  hourCycle: '12h' | '24h'
): string {
  const wall = utcISOToRecipientWallTime(recordedAtISO, timezone);
  const dayLabel = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${wall.date}T12:00:00Z`));
  const [hh, mm] = wall.time.split(':').map(Number);
  return `${dayLabel} · ${formatTimeOfDay(hh ?? 0, mm ?? 0, hourCycle)}`;
}

// ── Stats ────────────────────────────────────────────────────────────────────

interface VitalStats {
  avg: number;
  min: number;
  max: number;
  count: number;
  /** Diastolic side — blood pressure only, `null` for every other type. */
  avg2: number | null;
  min2: number | null;
  max2: number | null;
}

/**
 * PORT of mobile `computeStats` (VitalsDetailScreen ~119-176).
 *
 * Min/max identify a READING, not an independently-reduced field: reducing
 * value1 and value2 as separate arrays pairs the lowest systolic ever recorded
 * with the lowest diastolic ever recorded, so 150/70 and 100/95 report a "Min"
 * of 100/70 — a blood pressure nobody ever took. The AVERAGE stays a per-field
 * mean, because an average is synthetic by definition and there is no single
 * real reading to pair it with. Readings with no diastolic are excluded from
 * that mean rather than counted as zero.
 */
function computeStats(
  vitals: HealthVital[],
  type: VitalType,
  weightUnit: WeightUnit,
  glucoseUnit: GlucoseUnit
): VitalStats | null {
  if (vitals.length === 0) return null;

  const values = vitals.map((v) => fromCanonicalValue(type, v.value1, weightUnit, glucoseUnit));

  let minIndex = 0;
  let maxIndex = 0;
  values.forEach((v, i) => {
    if (v < values[minIndex]!) minIndex = i;
    if (v > values[maxIndex]!) maxIndex = i;
  });

  let avg2: number | null = null;
  let min2: number | null = null;
  let max2: number | null = null;
  if (type === 'blood_pressure') {
    const values2 = vitals
      .filter((v) => v.value2 != null)
      .map((v) => fromCanonicalValue(type, v.value2 as number, weightUnit, glucoseUnit));
    if (values2.length > 0) {
      avg2 = values2.reduce((a, b) => a + b, 0) / values2.length;
    }
    const minVital = vitals[minIndex]!;
    const maxVital = vitals[maxIndex]!;
    min2 =
      minVital.value2 != null
        ? fromCanonicalValue(type, minVital.value2, weightUnit, glucoseUnit)
        : null;
    max2 =
      maxVital.value2 != null
        ? fromCanonicalValue(type, maxVital.value2, weightUnit, glucoseUnit)
        : null;
  }

  return {
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    min: values[minIndex]!,
    max: values[maxIndex]!,
    count: values.length,
    avg2,
    min2,
    max2,
  };
}

interface VitalTrend {
  text: string;
  icon: IconName;
}

// ── Reading row ──────────────────────────────────────────────────────────────

interface VitalRowProps {
  vital: HealthVital;
  timezone: string;
  weightUnit: WeightUnit;
  glucoseUnit: GlucoseUnit;
  canEdit: boolean;
  onEdit: (vital: HealthVital) => void;
  onDelete: (vital: HealthVital) => void;
}

function VitalRow({
  vital,
  timezone,
  weightUnit,
  glucoseUnit,
  canEdit,
  onEdit,
  onDelete,
}: VitalRowProps): ReactElement {
  const { t } = useTranslation('vitals');
  const hourCycle = useHourCycle();

  const displayUnit = getDisplayUnit(vital.vital_type, weightUnit, glucoseUnit);
  const config = TYPE_CONFIG[vital.vital_type];

  const displayValue = useMemo(() => {
    const v1 = fromCanonicalValue(vital.vital_type, vital.value1, weightUnit, glucoseUnit);
    // value2 (BP diastolic) is canonical mmHg — pass through.
    return formatVitalValue(vital.vital_type, v1, vital.value2, displayUnit);
  }, [vital, weightUnit, glucoseUnit, displayUnit]);

  const recordedLabel = useMemo(
    // DISPLAY locale is the APP language, not the browser's.
    () => formatRecordedStamp(vital.recorded_at, timezone, hourCycle),
    [vital.recorded_at, timezone, hourCycle]
  );

  return (
    <li className={careCardShell}>
      <div className={careCardTopRow}>
        <IconTile size={36} tone={config.tone} name={config.icon} />

        <div className="min-w-0 flex-1">
          <p className={careCardTitle}>{displayValue}</p>
          <div className={careCardMeta}>
            <span>{recordedLabel}</span>
            {vital.notes && <span>· {vital.notes}</span>}
          </div>
        </div>

        {canEdit && (
          <div className="-mr-2 shrink-0">
            <MoreMenu
              label={t('actions.menuLabel', { value: displayValue })}
              items={[
                {
                  id: 'edit',
                  label: t('actions.edit'),
                  icon: 'create-outline',
                  onSelect: () => onEdit(vital),
                },
                {
                  id: 'delete',
                  label: t('actions.delete'),
                  icon: 'trash-outline',
                  danger: true,
                  onSelect: () => onDelete(vital),
                },
              ]}
            />
          </div>
        )}
      </div>
    </li>
  );
}

// ── Latest-reading hero ──────────────────────────────────────────────────────

interface LatestVitalHeroProps {
  type: VitalType;
  /** Readings of ONE type, newest-first. Never empty (caller gates on length). */
  items: HealthVital[];
  stats: VitalStats;
  trend: VitalTrend | null;
  timezone: string;
  weightUnit: WeightUnit;
  glucoseUnit: GlucoseUnit;
}

/**
 * Latest-reading hero shown above the list when a single vital type is
 * selected: the most recent value, plus average / lowest / highest across the
 * currently-loaded readings (the active range + type filter), then the trend
 * sentence versus the previous period.
 *
 * Mirrors mobile's `heroSheet` (padding 20, value 34/600/38, unit 16 inkSoft,
 * hairline, stats row, trend row).
 */
function LatestVitalHero({
  type,
  items,
  stats,
  trend,
  timezone,
  weightUnit,
  glucoseUnit,
}: LatestVitalHeroProps): ReactElement {
  const { t } = useTranslation('vitals');
  const hourCycle = useHourCycle();

  const latest = items[0]!;
  const unit = getDisplayUnit(type, weightUnit, glucoseUnit);
  const latestValue1 = fromCanonicalValue(type, latest.value1, weightUnit, glucoseUnit);

  const recordedLabel = useMemo(
    () => formatRecordedStamp(latest.recorded_at, timezone, hourCycle),
    [latest.recorded_at, timezone, hourCycle]
  );

  const formatStat = (v1: number, v2: number | null): string =>
    formatVitalValue(type, v1, v2, unit, { unit: false });

  return (
    <Sheet padding="md">
      {/* "Latest", as on mobile — NOT the type name. The chip row above and the
          chart title already say which vital is on screen; what the eyebrow has
          to add is that this one number is the most recent reading, not a
          summary of the period like the three stats under the hairline. */}
      <Eyebrow>{t('detail.latest')}</Eyebrow>
      <p className="m-0 mt-2">
        <span className="text-xl font-semibold leading-[38px] text-ink">
          {formatVitalValue(type, latestValue1, latest.value2, unit, { unit: false })}
        </span>
        <span className="ml-1 text-md text-ink-2">{unit}</span>
      </p>
      <Text variant="caption" className="mt-1">
        {recordedLabel}
      </Text>

      {/* Average/Lowest/Highest across ONE reading are all identical to the
          headline above them — the same number repeated three times, not new
          information. Only summarize once there is something to summarize. */}
      {items.length > 1 && (
        <>
          <hr className="my-4 border-line-2" />
          <div className="flex">
            <div className="flex-1">
              <Eyebrow>{t('detail.average')}</Eyebrow>
              <span className="mt-0.5 block text-md text-ink">
                {formatStat(stats.avg, stats.avg2)}
              </span>
            </div>
            <div className="flex-1">
              <Eyebrow>{t('detail.min')}</Eyebrow>
              <span className="mt-0.5 block text-md text-ink">
                {formatStat(stats.min, stats.min2)}
              </span>
            </div>
            <div className="flex-1">
              <Eyebrow>{t('detail.max')}</Eyebrow>
              <span className="mt-0.5 block text-md text-ink">
                {formatStat(stats.max, stats.max2)}
              </span>
            </div>
          </div>
        </>
      )}

      {trend && (
        <div className="mt-4 flex items-center gap-1">
          <Icon name={trend.icon} size="meta" className="text-ink-2" />
          <Text variant="caption">{trend.text}</Text>
        </div>
      )}
    </Sheet>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function VitalsPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['vitals', 'common']);
  const { showToast } = useToast();

  const { canEdit, timezone } = useCircle(circleId);
  const { data: unitPrefs } = useUnitPreferences();
  const weightUnit: WeightUnit = unitPrefs?.weight_unit ?? DEFAULT_UNIT_PREFERENCES.weight_unit;
  const glucoseUnit: GlucoseUnit = unitPrefs?.glucose_unit ?? DEFAULT_UNIT_PREFERENCES.glucose_unit;

  const [typeFilter, setTypeFilter] = useState<VitalType | 'all'>('all');
  const [range, setRange] = useState<RangeChoice>('30d');
  const [showAdd, setShowAdd] = useState(false);
  const [editingVital, setEditingVital] = useState<HealthVital | null>(null);
  const [deletingVital, setDeletingVital] = useState<HealthVital | null>(null);

  // The active window, plus the window of the SAME LENGTH immediately before it
  // — the trend sentence compares the two periods' averages (mobile
  // `getPreviousDateRange`).
  const { from, to, prevFrom, prevTo } = useMemo(() => {
    const days = RANGE_DAYS[range];
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - days);
    const prevFromDate = new Date(fromDate);
    prevFromDate.setDate(prevFromDate.getDate() - days);
    return {
      from: fromDate.toISOString(),
      to: now.toISOString(),
      prevFrom: prevFromDate.toISOString(),
      prevTo: fromDate.toISOString(),
    };
  }, [range]);

  const vitalsQuery = useVitals(circleId, {
    type: typeFilter === 'all' ? undefined : typeFilter,
    from,
    to,
  });
  // Previous period — read only for the trend sentence, and only meaningful
  // when a single type is selected (the hero is the only consumer).
  const previousQuery = useVitals(typeFilter === 'all' ? undefined : circleId, {
    type: typeFilter === 'all' ? undefined : typeFilter,
    from: prevFrom,
    to: prevTo,
  });
  const deleteMutation = useDeleteVital(circleId);

  const vitals = vitalsQuery.data ?? [];

  // Group by type (stable type order), newest reading first within each group.
  const groups = useMemo(() => {
    const byType = new Map<VitalType, HealthVital[]>();
    for (const v of vitals) {
      const list = byType.get(v.vital_type) ?? [];
      list.push(v);
      byType.set(v.vital_type, list);
    }
    return VITAL_TYPES.filter((type) => byType.has(type)).map((type) => ({
      type,
      items: (byType.get(type) ?? []).sort(
        (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
      ),
    }));
  }, [vitals]);

  // Readings backing the latest-reading hero + chart — only when a single type
  // is selected, and only when that type actually has readings in range.
  const heroItems =
    typeFilter === 'all' ? [] : (groups.find((g) => g.type === typeFilter)?.items ?? []);
  const selectedType = typeFilter === 'all' ? null : typeFilter;

  const heroStats = useMemo(
    () =>
      selectedType ? computeStats(heroItems, selectedType, weightUnit, glucoseUnit) : null,
    [heroItems, selectedType, weightUnit, glucoseUnit]
  );
  const previousStats = useMemo(
    () =>
      selectedType
        ? computeStats(previousQuery.data ?? [], selectedType, weightUnit, glucoseUnit)
        : null,
    [previousQuery.data, selectedType, weightUnit, glucoseUnit]
  );

  /**
   * PORT of mobile's trend (VitalsDetailScreen ~376-386): a plain
   * period-over-period comparison of the MEAN, with a ±1% dead band called
   * "Stable". It is deliberately NOT type-aware — mobile does not claim a
   * falling blood pressure is an improvement, and neither does this.
   */
  const trend = useMemo<VitalTrend | null>(() => {
    if (!heroStats || !previousStats || previousStats.avg === 0) return null;
    const diff = heroStats.avg - previousStats.avg;
    const pct = Math.abs((diff / previousStats.avg) * 100);
    if (pct < 1) return { text: t('detail.trendStable'), icon: 'remove' };
    return diff > 0
      ? { text: t('detail.trendUp', { pct: pct.toFixed(1) }), icon: 'trending-up' }
      : { text: t('detail.trendDown', { pct: pct.toFixed(1) }), icon: 'trending-down' };
  }, [heroStats, previousStats, t]);

  const typeOptions = useMemo(
    () =>
      TYPE_FILTERS.map((value) => ({
        value,
        label: value === 'all' ? t('filter.allTypes') : t(`types.${value}`),
      })),
    [t]
  );
  const rangeOptions = useMemo(
    () => RANGE_CHOICES.map((value) => ({ value, label: t(`filter.range.${value}`) })),
    [t]
  );
  const rangeLabel = rangeOptions.find((option) => option.value === range)?.label ?? '';

  // ── Chart series (the selected type's readings, oldest → newest) ──────────
  const chart = useMemo(() => {
    // GATED on the zone: the x-axis labels below turn two INSTANTS into
    // recipient-frame DAYS, so a placeholder zone can label a late-evening
    // reading with the wrong date. No chart until the real zone lands.
    if (!selectedType || heroItems.length < MIN_CHART_POINTS || !heroStats || !timezone) {
      return null;
    }

    const sorted = [...heroItems].sort(
      (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
    );
    const conv = (value: number): number =>
      fromCanonicalValue(selectedType, value, weightUnit, glucoseUnit);

    const primary: VitalsChartSeries = {
      points: sorted.map((v) => ({ x: new Date(v.recorded_at).getTime(), y: conv(v.value1) })),
      color: TYPE_CONFIG[selectedType].tone as VitalsChartSeries['color'],
      area: true,
    };

    // Diastolic line — readings WITHOUT a diastolic are omitted from it. Mobile
    // substitutes the systolic value there, which draws a diastolic reading
    // that was never taken; this app already refuses that elsewhere
    // (formatVitalValue never renders "140/0", the hero's mean skips nulls).
    const diastolic =
      selectedType === 'blood_pressure'
        ? sorted
            .filter((v) => v.value2 != null)
            .map((v) => ({ x: new Date(v.recorded_at).getTime(), y: conv(v.value2 as number) }))
        : [];

    const series: VitalsChartSeries[] =
      diastolic.length > 0
        ? [primary, { points: diastolic, color: DIASTOLIC_COLOR }]
        : [primary];

    const unit = getDisplayUnit(selectedType, weightUnit, glucoseUnit);
    const fmt = (v1: number, v2: number | null): string =>
      formatVitalValue(selectedType, v1, v2, unit, { unit: false });

    return {
      series,
      xLabels: [
        formatShortDay(sorted[0]!.recorded_at, timezone),
        formatShortDay(sorted[sorted.length - 1]!.recorded_at, timezone),
      ],
      yFormatter: (value: number): string =>
        formatVitalValue(selectedType, value, null, unit, { unit: false }),
      label: t('detail.chartSummary', {
        min: `${fmt(heroStats.min, heroStats.min2)} ${unit}`,
        max: `${fmt(heroStats.max, heroStats.max2)} ${unit}`,
        latest: `${fmt(
          fromCanonicalValue(selectedType, heroItems[0]!.value1, weightUnit, glucoseUnit),
          heroItems[0]!.value2
        )} ${unit}`,
      }),
      isBloodPressure: selectedType === 'blood_pressure' && diastolic.length > 0,
    };
  }, [selectedType, heroItems, heroStats, weightUnit, glucoseUnit, timezone, t]);

  // One accordion per vital-type group. The group key set is the types present;
  // useAccordionGroup recomputes allOpen/anyOpen when the set changes.
  const groupIds = useMemo(() => groups.map((g) => `vitals-group-${g.type}`), [groups]);
  const accordion = useAccordionGroup(groupIds, { defaultOpen: true });

  async function handleDeleteConfirmed(): Promise<void> {
    if (!deletingVital) return;
    try {
      await deleteMutation.mutateAsync(deletingVital.id);
      showToast(t('toast.deleted'), 'success');
      setDeletingVital(null);
    } catch {
      // The delete hook surfaces its own permission/save toast.
      setDeletingVital(null);
    }
  }

  // Takes the RESOLVED zone as an argument rather than closing over the
  // nullable hook value: every row stamps its reading with a recipient-frame
  // day and time, so "which zone" is not optional. The body below only maps
  // this once the zone is known.
  function renderRow(vital: HealthVital, tz: string): ReactElement {
    return (
      <VitalRow
        key={vital.id}
        vital={vital}
        timezone={tz}
        weightUnit={weightUnit}
        glucoseUnit={glucoseUnit}
        canEdit={canEdit}
        onEdit={setEditingVital}
        onDelete={setDeletingVital}
      />
    );
  }

  let body: ReactElement;
  // `timezone === null` joins the skeleton branch rather than defaulting: each
  // row prints the recipient-frame DAY a reading belongs to, and a reading
  // taken near midnight lands on the wrong day under a placeholder zone. The
  // vitals query is normally still in flight at that point anyway.
  if (vitalsQuery.isLoading || timezone === null) {
    body = (
      <ul className={`${careCardListGap} m-0 list-none p-0`} aria-busy="true">
        <li className="sr-only">{t('loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className={careCardShell}>
            <div className={careCardTopRow}>
              <Skeleton className="h-9 w-9 rounded-[10px]" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-1/3 max-w-40" />
                <Skeleton className="mt-2 h-3 w-1/2 max-w-56" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (vitalsQuery.isError) {
    body = (
      <Card className="text-center">
        <Text variant="bodyDense" className="font-medium">
          {t('errorTitle')}
        </Text>
        <Text variant="caption" className="mt-1">
          {t('errorHint')}
        </Text>
        <Button variant="ghost" className="mt-4" onClick={() => void vitalsQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (groups.length === 0) {
    body = (
      <Card padding="none">
        <EmptyState
          tone="moss"
          icon="heart-outline"
          title={t('empty.title')}
          description={canEdit ? t('empty.hint') : t('empty.hintReadOnly')}
          actions={canEdit ? <Button onClick={() => setShowAdd(true)}>{t('empty.cta')}</Button> : undefined}
        />
      </Card>
    );
  } else if (selectedType) {
    // One type selected — the group header would only repeat the chip above it.
    body = (
      <ul className={`${careCardListGap} m-0 list-none p-0`}>
        {(groups.find((g) => g.type === selectedType)?.items ?? []).map((v) => renderRow(v, timezone))}
      </ul>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={accordion.allOpen}
            onClick={() => (accordion.allOpen ? accordion.collapseAll() : accordion.expandAll())}
          >
            {accordion.allOpen ? t('common:collapseAll') : t('common:expandAll')}
          </Button>
        </div>
        {groups.map((group) => {
          const groupId = `vitals-group-${group.type}`;
          return (
            <Accordion
              key={group.type}
              id={groupId}
              title={t(`types.${group.type}`)}
              meta={group.items.length}
              open={accordion.isOpen(groupId)}
              onToggle={accordion.toggle}
            >
              <ul className={`${careCardListGap} m-0 list-none p-0`}>
                {group.items.map((v) => renderRow(v, timezone))}
              </ul>
            </Accordion>
          );
        })}
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl pb-10">
      <PageMasthead
        section={t('common:nav.vitals')}
        tone="moss"
        title={t('title')}
        subtitle={t('subtitle')}
        backTo={`/circles/${circleId}`}
        {...(canEdit
          ? {
              rightAction: {
                name: 'add-outline' as const,
                label: t('add.cta'),
                onClick: () => setShowAdd(true),
              },
            }
          : {})}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 px-5">
        <ChipSelect
          id="vitals-type-filter"
          label={t('filter.typeLabel')}
          options={typeOptions}
          value={typeFilter}
          onChange={(next) => setTypeFilter((next as VitalType | 'all') ?? 'all')}
          allowDeselect={false}
        />
        <MoreMenu
          items={rangeOptions.map((option) => ({
            id: option.value,
            label: option.label,
            onSelect: () => setRange(option.value),
          }))}
          renderTrigger={(props) => (
            // card-shell-ok: the range pill is a control, not a card surface.
            <button
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-cream px-4 text-sm text-ink"
              type="button"
              // The visible text is only the VALUE ("Last 30 days"), which says
              // nothing about what it selects. The name adds the field it
              // belongs to and still CONTAINS the visible text verbatim, so
              // speech control matches what the user reads (WCAG 2.5.3). An
              // sr-only prefix span cannot do this: the accessible-name
              // algorithm trims each text node, so it renders as
              // "Time range:Last 30 days".
              aria-label={`${t('filter.rangeLabel')}: ${rangeLabel}`}
              {...props}
            >
              {rangeLabel}
              <Icon name="chevron-down" size="inline" />
            </button>
          )}
        />
      </div>

      {/* GATED: the hero stamps the latest reading with its recipient-frame
          day and time, so it waits for the real zone rather than printing a
          New-York-derived date it would then have to correct. */}
      {selectedType && heroItems.length > 0 && heroStats && timezone !== null && (
        <div className="mt-4 px-5">
          <LatestVitalHero
            type={selectedType}
            items={heroItems}
            stats={heroStats}
            trend={trend}
            timezone={timezone}
            weightUnit={weightUnit}
            glucoseUnit={glucoseUnit}
          />
        </div>
      )}

      {chart && (
        <div className="mt-4 px-5">
          <Card padding="sm">
            <Eyebrow>{t('detail.chartTitle')}</Eyebrow>
            <VitalsChart
              className="mt-2"
              series={chart.series}
              yFormatter={chart.yFormatter}
              xLabels={chart.xLabels}
              label={chart.label}
            />
            {chart.isBloodPressure && (
              <div className="mt-2 flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-clay" />
                <Text variant="caption">{t('fields.systolic')}</Text>
                <span
                  aria-hidden="true"
                  className="ml-3 inline-block h-2 w-2 rounded-full bg-dusk"
                />
                <Text variant="caption">{t('fields.diastolic')}</Text>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="mt-6 px-5">{body}</div>

      {showAdd && (
        <AddVitalModal
          circleId={circleId}
          initialType={typeFilter === 'all' ? undefined : typeFilter}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editingVital && (
        <EditVitalModal
          circleId={circleId}
          vital={editingVital}
          onClose={() => setEditingVital(null)}
        />
      )}

      {/* GATED: the confirm copy names the reading by its recipient-frame DAY
          ("Delete the reading from Jun 15?"), and a delete prompt that names the
          wrong day is the worst place to guess. The dialog only opens from a
          row, which does not render until the zone resolves. */}
      {deletingVital && timezone !== null && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.message', {
            type: t(`types.${deletingVital.vital_type}`).toLocaleLowerCase(i18n.language),
            date: formatRecordedDay(deletingVital.recorded_at, timezone),
          })}
          confirmLabel={t('actions.delete')}
          cancelLabel={t('common:cancel')}
          destructive
          loading={deleteMutation.isPending}
          onConfirm={() => void handleDeleteConfirmed()}
          onCancel={() => setDeletingVital(null)}
        />
      )}
    </section>
  );
}
