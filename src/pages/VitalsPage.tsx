import { useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Select,
  Skeleton,
  useAccordionGroup,
  useToast,
} from '@/components/ui';
import { AddVitalModal } from '@/components/vitals/AddVitalModal';
import { EditVitalModal } from '@/components/vitals/EditVitalModal';
import { useVitals, useDeleteVital, canEditVital } from '@/hooks/useVitals';
import { useUnitPreferences } from '@/hooks/useUnitPreferences';
import { useCircle } from '@/hooks/useCircle';
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

// Task 6.4 — vitals page. Lists recent readings grouped by type, rendered in the
// user's display units (formatVitalValue). MIRRORS
// mobile/src/screens/vitals/VitalsDetailScreen.tsx for the type filter + range,
// and VitalFormScreen for the add/edit/delete affordances.
//
// GATING:
//   - all write affordances (Add / Edit / Delete) require useCircle().canEdit.
//   - SYNCED readings (source !== 'manual') render READ-ONLY — no Edit/Delete
//     (canEditVital); the backend 403s those mutations regardless.
//
// TIMEZONE: recorded_at is a UTC ISO timestamp; we render its date/time in the
// care recipient's timezone (utcISOToRecipientWallTime) — never device-local.

const VITAL_TYPES: VitalType[] = ['blood_pressure', 'heart_rate', 'glucose', 'weight'];
const TYPE_FILTERS: Array<VitalType | 'all'> = ['all', ...VITAL_TYPES];

type RangeChoice = '7d' | '30d' | '90d';
const RANGE_CHOICES: RangeChoice[] = ['7d', '30d', '90d'];
const RANGE_DAYS: Record<RangeChoice, number> = { '7d': 7, '30d': 30, '90d': 90 };

const SKELETON_ROWS = [0, 1, 2, 3];

function VitalsEmptyIcon(): ReactElement {
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
      <path d="M3 12h4l2 5 4-12 2 7h6" />
    </svg>
  );
}

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

  const isManual = canEditVital(vital);
  const displayUnit = getDisplayUnit(vital.vital_type, weightUnit, glucoseUnit);

  const displayValue = useMemo(() => {
    const v1 = fromCanonicalValue(vital.vital_type, vital.value1, weightUnit, glucoseUnit);
    // value2 (BP diastolic) is canonical mmHg — pass through.
    return formatVitalValue(vital.vital_type, v1, vital.value2, displayUnit);
  }, [vital, weightUnit, glucoseUnit, displayUnit]);

  const recordedLabel = useMemo(() => {
    const wall = utcISOToRecipientWallTime(vital.recorded_at, timezone);
    const dayLabel = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${wall.date}T12:00:00Z`));
    const [hh, mm] = wall.time.split(':').map(Number);
    const period = hh >= 12 ? 'PM' : 'AM';
    const hour12 = hh % 12 || 12;
    return `${dayLabel} · ${hour12}:${String(mm).padStart(2, '0')} ${period}`;
  }, [vital.recorded_at, timezone]);

  return (
    <li className="rounded-2xl border border-line bg-cream">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium text-ink">{displayValue}</p>
          <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
            {recordedLabel}
            {vital.notes ? ` · ${vital.notes}` : ''}
          </p>
        </div>

        {!isManual && (
          <span className="shrink-0 rounded-full border border-line-2 px-2 py-0.5 text-xs text-ink-3">
            {t('synced.badge')}
          </span>
        )}

        {canEdit && isManual && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="md"
              onClick={() => onEdit(vital)}
              aria-label={t('actions.editLabel', { value: displayValue })}
            >
              {t('actions.edit')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => onDelete(vital)}
              aria-label={t('actions.deleteLabel', { value: displayValue })}
            >
              {t('actions.delete')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

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

  const { from, to } = useMemo(() => {
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - RANGE_DAYS[range]);
    return { from: fromDate.toISOString(), to: now.toISOString() };
  }, [range]);

  const vitalsQuery = useVitals(circleId, {
    type: typeFilter === 'all' ? undefined : typeFilter,
    from,
    to,
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

  // One accordion per vital-type group. The group key set is the types present;
  // useAccordionGroup recomputes allOpen/anyOpen when the set changes.
  const groupIds = useMemo(() => groups.map((g) => `vitals-group-${g.type}`), [groups]);
  const accordion = useAccordionGroup(groupIds, { defaultOpen: true });

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

  let body: ReactElement;
  if (vitalsQuery.isLoading) {
    body = (
      <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-busy="true">
        <li className="sr-only">{t('loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className="rounded-2xl border border-line bg-cream px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
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
        <p className="m-0 font-medium text-ink">{t('errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('errorHint')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void vitalsQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (groups.length === 0) {
    body = (
      <Card className="p-8">
        <EmptyState
          tone="moss"
          icon={<VitalsEmptyIcon />}
          title={t('empty.title')}
          description={canEdit ? t('empty.hint') : t('empty.hintReadOnly')}
        >
          {canEdit && <Button onClick={() => setShowAdd(true)}>{t('empty.cta')}</Button>}
        </EmptyState>
      </Card>
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
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {group.items.map((vital) => (
                  <VitalRow
                    key={vital.id}
                    vital={vital}
                    timezone={timezone}
                    weightUnit={weightUnit}
                    glucoseUnit={glucoseUnit}
                    canEdit={canEdit}
                    onEdit={setEditingVital}
                    onDelete={setDeletingVital}
                  />
                ))}
              </ul>
            </Accordion>
          );
        })}
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-5xl p-6 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="serif m-0 text-xl text-ink">{t('title')}</h1>
          <p className="m-0 mt-1 text-sm text-ink-3">{t('subtitle')}</p>
        </div>
        {canEdit && <Button onClick={() => setShowAdd(true)}>{t('add.cta')}</Button>}
      </header>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          id="vitals-type-filter"
          label={t('filter.typeLabel')}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as VitalType | 'all')}
          options={typeOptions}
        />
        <Select
          id="vitals-range-filter"
          label={t('filter.rangeLabel')}
          value={range}
          onChange={(e) => setRange(e.target.value as RangeChoice)}
          options={rangeOptions}
        />
      </div>

      <div className="mt-6">{body}</div>

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

      {deletingVital && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.message')}
          confirmLabel={t('actions.delete')}
          cancelLabel={t('common:cancel')}
          destructive
          confirmDisabled={deleteMutation.isPending}
          onConfirm={() => void handleDeleteConfirmed()}
          onCancel={() => setDeletingVital(null)}
        />
      )}
    </section>
  );
}
