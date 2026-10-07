import { baseLanguage } from '@/i18n/locales';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Modal, Skeleton, Text, useToast } from '@/components/ui';
import type { AsNeededDose } from '@/api/medicationAsNeeded';
import { isAsNeededAlreadyRemovedError, isAsNeededNotFoundError } from '@/api/medicationAsNeeded';
import { fullNameOf, formatInstantClock, minutesAgo, removedAgeBucket } from '@/lib/asNeeded';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import { isPermissionDeniedError } from '@/lib/apiErrors';
import { useAsNeededDoses, useRemoveAsNeededDose } from '@/hooks/useAsNeeded';
import { useHourCycle } from '@/hooks/useHourCycle';
import { dayInZone } from '@/utils/recipientEventDate';
import {
  getCachedDateTimeFormat,
  getRelativeDateLabel,
  getTimezoneSuffix,
  type TimeLanguage,
} from '@/utils/timezone';

// One as-needed medication's dose log, newest first, grouped by the day each
// dose was given IN THE CARE RECIPIENT'S ZONE (`given_at` is an instant; the
// browser's zone must never decide which day a 11:40 PM dose belongs to).
//
// Any editing member can remove a dose (a tombstone: the row stays, struck
// through, "Removed by Luis", and the circle is told). A view-only member sees
// the log and no Remove.

export interface DoseHistoryModalProps {
  circleId: string;
  eventId: string;
  name: string;
  timezone: string;
  canEdit: boolean;
  onClose: () => void;
}

interface DayGroup {
  day: string;
  doses: AsNeededDose[];
}

export function DoseHistoryModal({
  circleId,
  eventId,
  name,
  timezone,
  canEdit,
  onClose,
}: DoseHistoryModalProps): ReactElement {
  const { t, i18n } = useTranslation(['meds', 'common']);
  const { showToast } = useToast();
  const hourCycle = useHourCycle();
  const language: TimeLanguage = baseLanguage(i18n.language);
  const query = useAsNeededDoses(circleId, eventId);
  const removeDose = useRemoveAsNeededDose(circleId);
  const [removing, setRemoving] = useState<AsNeededDose | null>(null);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);

  // Once per open (the confirm swaps the view but keeps this mounted).
  useEffect(() => {
    Analytics.asNeededHistoryViewed({ scope: 'medication' });
  }, []);

  const doses = useMemo(() => query.data?.pages.flatMap((p) => p.doses) ?? [], [query.data]);

  const groups = useMemo<DayGroup[]>(() => {
    const byDay = new Map<string, AsNeededDose[]>();
    for (const dose of doses) {
      const key = dayInZone(new Date(dose.given_at), timezone);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(dose);
      else byDay.set(key, [dose]);
    }
    // The server returns newest first; keep that order inside and across days.
    return [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, list]) => ({ day, doses: list }));
  }, [doses, timezone]);

  const clock = (iso: string): string => {
    const at = new Date(iso);
    return `${formatInstantClock(at, timezone, hourCycle, language)}${getTimezoneSuffix(timezone, at, { language })}`;
  };

  function dayTitle(day: string): string {
    const relative = getRelativeDateLabel(day, timezone);
    if (relative === 'today') return t('history.today');
    if (relative === 'yesterday') return t('history.yesterday');
    return getCachedDateTimeFormat(language, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00Z`));
  }

  async function confirmRemove(): Promise<void> {
    if (!removing) return;
    const target = removing;
    try {
      await removeDose.mutateAsync({ eventId, doseId: target.id });
      Analytics.asNeededDoseRemoved({
        age_bucket: removedAgeBucket(minutesAgo(target.given_at)),
        own: !!myUserId && target.given_by === myUserId,
      });
      showToast(t('asNeeded.toast.removed'), 'success');
    } catch (error) {
      // The hook already toasted a permission rejection.
      if (!isPermissionDeniedError(error)) {
        showToast(
          t(
            isAsNeededAlreadyRemovedError(error) || isAsNeededNotFoundError(error)
              ? 'asNeeded.toast.alreadyRemoved'
              : 'asNeeded.toast.removeFailed'
          ),
          'error'
        );
      }
    } finally {
      setRemoving(null);
    }
  }

  // The confirm REPLACES the history sheet rather than stacking on it (the same
  // "close the sheet first" rule every dialog launched from a sheet follows).
  if (removing) {
    return (
      <ConfirmDialog
        variant="destructive"
        title={t('asNeeded.remove.title')}
        message={t('asNeeded.remove.body', {
          time: clock(removing.given_at),
          name: fullNameOf(removing.given_by_user) ?? t('asNeeded.history.someone'),
        })}
        confirmLabel={t('asNeeded.remove.confirm')}
        cancelLabel={t('asNeeded.log.cancel')}
        loading={removeDose.isPending}
        onConfirm={() => confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    );
  }

  return (
    <Modal
      title={t('asNeeded.history.title')}
      onClose={onClose}
      closeLabel={t('asNeeded.history.close')}
      size="md"
    >
      <p className="m-0 mb-4 text-sm text-ink-2">{t('asNeeded.history.subtitle', { name })}</p>

      {query.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">{t('asNeeded.history.loading')}</span>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : query.isError ? (
        <div className="text-center">
          <p className="m-0 font-medium text-ink">{t('asNeeded.history.error')}</p>
          <Button variant="ghost" className="mt-3" onClick={() => void query.refetch()}>
            {t('common:retry')}
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center" data-testid="dose-history-empty">
          <p className="m-0 font-medium text-ink">{t('asNeeded.history.empty')}</p>
          <p className="m-0 mt-1 text-sm text-ink-3">{t('asNeeded.history.emptyHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.day}>
              <Text variant="sectionTitle" as="h3" className="mb-1">
                {dayTitle(group.day)}
              </Text>
              <ul className="m-0 flex list-none flex-col p-0">
                {group.doses.map((dose) => {
                  const removed = !!dose.removed_at;
                  const by = fullNameOf(dose.given_by_user) ?? t('asNeeded.history.someone');
                  return (
                    <li
                      key={dose.id}
                      data-testid="dose-row"
                      data-removed={removed ? 'true' : 'false'}
                      className="flex flex-wrap items-start justify-between gap-2 border-t border-line-2 py-3 first:border-t-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={`m-0 text-md font-semibold ${
                            removed ? 'text-ink-3 line-through' : 'text-ink'
                          }`}
                        >
                          {clock(dose.given_at)}
                        </p>
                        <p className={`m-0 text-sm ${removed ? 'text-ink-3' : 'text-ink-2'}`}>
                          {t('asNeeded.history.givenBy', { name: by })}
                        </p>
                        {dose.note && (
                          <p
                            className={`m-0 mt-0.5 break-words text-sm ${
                              removed ? 'text-ink-3 line-through' : 'text-ink-2'
                            }`}
                          >
                            “{dose.note}”
                          </p>
                        )}
                        {removed && (
                          <p className="m-0 mt-0.5 text-sm text-ink-2">
                            {t('asNeeded.history.removedBy', {
                              name:
                                fullNameOf(dose.removed_by_user) ?? t('asNeeded.history.someone'),
                            })}
                          </p>
                        )}
                      </div>
                      {canEdit && !removed && (
                        <Button
                          variant="ghost"
                          size="md"
                          onClick={() => setRemoving(dose)}
                          aria-label={t('asNeeded.remove.actionA11y', {
                            time: clock(dose.given_at),
                          })}
                        >
                          {t('asNeeded.remove.action')}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {t('asNeeded.history.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
