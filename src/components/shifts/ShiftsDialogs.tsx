import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { RadioGroup, useToast } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import {
  useAssignShift,
  useDeleteShift,
  useDropShift,
  useShiftSeriesRoot,
  useHandleShiftFailure,
} from '@/hooks/useShifts';
import { ShiftComposer } from './ShiftComposer';
import { ShiftDetailModal, type ShiftDetailAction } from './ShiftDetailModal';
import { ShiftFormModal, type ShiftFormSource } from './ShiftFormModal';
import { ShiftScopeDialog } from './ShiftScopeDialog';
import { TakeShiftDialog } from './TakeShiftDialog';
import { holdsOnlyThisDay, isShiftRepeating, memberShortName } from './shiftUtils';

type Active =
  | { kind: 'detail'; shift: CalendarEvent }
  | { kind: 'take' | 'drop' | 'assign' | 'edit' | 'delete'; shift: CalendarEvent }
  | { kind: 'create'; source: ShiftFormSource; date?: string };

export interface ShiftsDialogsApi {
  /** Open a card's detail. */
  openDetail: (shift: CalendarEvent) => void;
  /** Open the Take dialog (a card's Take button). */
  openTake: (shift: CalendarEvent) => void;
  /** Open the create flow (form, then "saved" + add next). */
  openCreate: (source: ShiftFormSource, date?: string) => void;
  /** Render once, anywhere in the page: every Shifts dialog. */
  element: ReactElement | null;
}

/**
 * ALL the Shifts dialogs, owned by the page (never a modal inside a modal): the
 * detail asks for an action and closes, and the action's dialog opens in its
 * place, like the event detail -> edit / delete hand-off on the Calendar.
 */
export function useShiftsDialogs(circleId: string): ShiftsDialogsApi {
  const [active, setActive] = useState<Active | null>(null);
  const close = useCallback(() => setActive(null), []);

  const openDetail = useCallback((shift: CalendarEvent) => setActive({ kind: 'detail', shift }), []);
  const openTake = useCallback((shift: CalendarEvent) => setActive({ kind: 'take', shift }), []);
  const openCreate = useCallback(
    (source: ShiftFormSource, date?: string) => setActive({ kind: 'create', source, date }),
    []
  );

  const element = active ? (
    <ActiveDialog
      // A fresh dialog (and inline error / picker state) for each hand-off.
      key={`${active.kind}:${'shift' in active ? active.shift.id : 'new'}`}
      circleId={circleId}
      active={active}
      setActive={setActive}
      onClose={close}
    />
  ) : null;

  return { openDetail, openTake, openCreate, element };
}

function ActiveDialog({
  circleId,
  active,
  setActive,
  onClose,
}: {
  circleId: string;
  active: Active;
  setActive: (next: Active | null) => void;
  onClose: () => void;
}): ReactElement | null {
  const { t } = useTranslation(['shifts', 'common']);
  const { showToast } = useToast();
  const { timezone, members } = useCircle(circleId);
  const viewerId = useAuthStore((st) => st.user?.id ?? null);
  const drop = useDropShift(circleId);
  const assign = useAssignShift(circleId);
  const del = useDeleteShift(circleId);
  const handleFailure = useHandleShiftFailure();
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState('');
  // The series root (cached with the detail modal's): tells "holds only this day" apart.
  const seriesRoot = useShiftSeriesRoot(circleId, active.kind === 'create' ? null : active.shift);

  // Classified failures close the dialog with a toast; a network / server failure
  // stays open with the message inline so the action can be retried.
  const fail = (err: unknown, verb: 'drop' | 'assign' | 'delete'): void => {
    const outcome = handleFailure(err, verb);
    if (outcome.close) onClose();
    else setError(outcome.message);
  };

  if (active.kind === 'create') {
    return (
      <ShiftComposer
        circleId={circleId}
        initialDate={active.date}
        source={active.source}
        onClose={onClose}
      />
    );
  }

  const shift = active.shift;
  const name = shift.title.trim();
  const repeating = isShiftRepeating(shift);

  switch (active.kind) {
    case 'detail':
      return timezone ? (
        <ShiftDetailModal
          circleId={circleId}
          shift={shift}
          timezone={timezone}
          onClose={onClose}
          onAction={(action: ShiftDetailAction, s: CalendarEvent) =>
            setActive({ kind: action, shift: s })
          }
        />
      ) : null;
    case 'take':
      return <TakeShiftDialog circleId={circleId} shift={shift} onClose={onClose} />;
    case 'edit':
      return (
        <ShiftFormModal
          circleId={circleId}
          shift={shift}
          onClose={onClose}
          onUpdated={() => showToast(t('shifts:toast.updated'), 'success')}
        />
      );
    case 'drop': {
      // Holding only this day there is nothing in the future to drop: no scope question.
      const askScope = repeating && !holdsOnlyThisDay(shift, seriesRoot);
      return (
        <ShiftScopeDialog
          title={t('shifts:drop.title')}
          message={
            askScope
              ? t('shifts:drop.messageRepeating')
              : t('shifts:drop.message', { name: shift.title })
          }
          confirmLabel={t('shifts:drop.confirm')}
          repeating={askScope}
          loading={drop.isPending}
          onCancel={onClose}
          error={error}
          onConfirm={async (scope) => {
            setError('');
            try {
              await drop.mutateAsync({ shift, scope });
              showToast(t('shifts:toast.dropped', { name }), 'success');
              onClose();
            } catch (err) {
              fail(err, 'drop');
            }
          }}
        />
      );
    }
    case 'assign': {
      // A list, with whoever holds the shift now marked; nobody is preselected.
      const options = members
        .filter((m) => m.view_only !== true)
        .map((m) => ({
          value: m.id,
          label: m.id === viewerId ? t('shifts:form.me') : memberShortName(m),
          hint: m.id === shift.assigned_to ? t('shifts:assign.current') : undefined,
        }));
      return (
        <ShiftScopeDialog
          title={t('shifts:assign.title')}
          confirmLabel={t('shifts:assign.confirm')}
          repeating={repeating}
          loading={assign.isPending}
          confirmDisabled={!assignee}
          onCancel={onClose}
          error={error}
          onConfirm={async (scope) => {
            if (!assignee) return;
            setError('');
            try {
              await assign.mutateAsync({ shift, scope, userId: assignee });
              const who =
                members.find((m) => m.id === assignee)?.first_name?.trim() || t('shifts:someone');
              showToast(t('shifts:toast.assigned', { name: who }), 'success');
              onClose();
            } catch (err) {
              fail(err, 'assign');
            }
          }}
        >
          <RadioGroup
            name="shift_assign_member"
            label={t('shifts:assign.label')}
            options={options}
            value={assignee}
            onChange={setAssignee}
          />
        </ShiftScopeDialog>
      );
    }
    case 'delete':
      return (
        <ShiftScopeDialog
          destructive
          title={t('shifts:delete.title')}
          message={
            repeating
              ? t('shifts:delete.messageRepeating', { name: shift.title })
              : t('shifts:delete.message', { name: shift.title })
          }
          confirmLabel={t('shifts:delete.confirm')}
          repeating={repeating}
          loading={del.isPending}
          onCancel={onClose}
          error={error}
          onConfirm={async (scope) => {
            setError('');
            try {
              await del.mutateAsync({ shift, scope });
              showToast(t('shifts:toast.deleted'), 'success');
              onClose();
            } catch (err) {
              fail(err, 'delete');
            }
          }}
        />
      );
    default:
      return null;
  }
}
