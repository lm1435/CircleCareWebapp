import { baseLanguage } from '@/i18n/locales';
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, useToast } from '@/components/ui';
import {
  type AsNeededSummary,
  type RecentlyLoggedConflict,
} from '@/api/medicationAsNeeded';
import { isMedicationDiscontinuedError, isPermissionDeniedError } from '@/lib/apiErrors';
import {
  backdatedBucket,
  firstNameOf,
  formatInstantClock,
  logFailureReason,
  minutesAgo,
  minutesSinceLastBucket,
  recentDoseByOther,
} from '@/lib/asNeeded';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useHourCycle } from '@/hooks/useHourCycle';
import { getTimezoneSuffix, type TimeLanguage } from '@/utils/timezone';
import { useAuthStore } from '@/store/authStore';
import { LogDoseDialog, type LogDoseSubmit } from './LogDoseDialog';
import { useAsNeededUndo, type AsNeededLogEntry } from './useAsNeededUndo';

// The whole "Gave a dose" flow, in one place so Home's section and the
// Medications roster behave identically:
//
//   tap "Gave a dose"
//     ├─ another member logged this medication in the last 30 min (the card
//     │  already shows it) → "Jennie logged a dose 1 minute ago. Log another?"
//     └─ otherwise → the Log dialog (time + optional note)
//   "Log dose" → 5 s undo window → POST (client_request_id, known_last_dose_id)
//     └─ 409 AS_NEEDED_DOSE_RECENTLY_LOGGED (a stale card: someone logged in the
//        meantime) → the SAME prompt → "Log another" re-sends the SAME
//        client_request_id with acknowledge_recent:true
//
// It is never blocked and never warns about amounts or timing.

export interface GiveTarget {
  /** The medication's event id (the PRN root). */
  id: string;
  name: string;
  dosage?: string | null;
  /** Where the flow started; defaults to the hook's `surface`. */
  surface?: AsNeededSurface;
}

export type AsNeededSurface = 'home' | 'meds_tab' | 'detail';

/** What analytics needs to know about one dose, keyed by its client_request_id. */
interface DoseContext {
  surface: AsNeededSurface;
  afterRecentPrompt: boolean;
  /** `given_at` of the newest dose this client showed at log time (null = none). */
  lastDoseGivenAt: string | null;
}

interface RecentPrompt {
  name: string | null;
  /** ISO instant of the other member's dose, when known. */
  givenAt: string | null;
  medName: string;
  /** Pre-check: nothing built yet. Server: the entry that was refused. */
  source: { kind: 'precheck'; target: GiveTarget } | { kind: 'server'; entry: AsNeededLogEntry };
}

export interface UseAsNeededGiveOptions {
  circleId: string;
  timezone: string | null;
  /** `eventId → summary`, as the cards render it (also the pre-check's source). */
  summaries: Record<string, AsNeededSummary>;
  /** Default analytics surface for this hook's flow (Home 'home', Meds page 'meds_tab'). */
  surface?: AsNeededSurface;
}

export interface UseAsNeededGiveResult {
  /** Start the flow for a medication. */
  requestGive: (target: GiveTarget) => void;
  pending: Record<string, true>;
  inFlight: Record<string, true>;
  undo: (eventId: string) => void;
  /** Render ONCE, anywhere in the tree: the Log dialog and the "log another?" prompt. */
  dialogs: ReactElement | null;
}

export function useAsNeededGive({
  circleId,
  timezone,
  summaries,
  surface: defaultSurface = 'home',
}: UseAsNeededGiveOptions): UseAsNeededGiveResult {
  const { t, i18n } = useTranslation('meds');
  const hourCycle = useHourCycle();
  const language: TimeLanguage = baseLanguage(i18n.language);
  const { showToast } = useToast();
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  // The logger IS the care recipient (a self-care circle's owner membership is
  // flagged too): the dialog speaks to them in the second person.
  const { members } = useCircle(circleId);
  const isSelf = !!myUserId && members.some((m) => m.id === myUserId && m.is_care_recipient === true);
  const isSelfRef = useRef(isSelf);
  isSelfRef.current = isSelf;
  // eventId -> context of the ONE dose pending for it (the undo flow admits one).
  const contexts = useRef(new Map<string, DoseContext>());

  const [logging, setLogging] = useState<{ target: GiveTarget; acknowledged: boolean } | null>(
    null
  );
  const [prompt, setPrompt] = useState<RecentPrompt | null>(null);

  const flow = useAsNeededUndo({
    circleId,
    onLogged: (entry, result) => {
      const ctx = contexts.current.get(entry.eventId);
      contexts.current.delete(entry.eventId);
      // A replay wrote nothing: not a new dose.
      if (ctx && !result.replayed) {
        const effective = entry.body.given_at ? new Date(entry.body.given_at) : new Date();
        Analytics.asNeededDoseLogged({
          surface: ctx.surface,
          with_note: !!entry.body.note,
          backdated_bucket: backdatedBucket(
            entry.body.given_at ? minutesAgo(entry.body.given_at) : 0
          ),
          actor: isSelfRef.current ? 'recipient' : 'caregiver',
          after_recent_prompt: ctx.afterRecentPrompt,
          minutes_since_last_bucket: minutesSinceLastBucket(
            ctx.lastDoseGivenAt
              ? Math.max(
                  0,
                  Math.floor((effective.getTime() - new Date(ctx.lastDoseGivenAt).getTime()) / 60000)
                )
              : null
          ),
        });
      }
      showToast(t('asNeeded.toast.logged'), 'success');
    },
    onRecentlyLogged: (entry, conflict: RecentlyLoggedConflict) => {
      setPrompt({
        name: conflict.firstName,
        givenAt: conflict.givenAt,
        medName: entry.name,
        source: { kind: 'server', entry },
      });
    },
    onError: (error, entry) => {
      contexts.current.delete(entry.eventId);
      Analytics.asNeededDoseLogFailed({ reason: logFailureReason(error) });
      // The mutation hook already toasted a permission rejection.
      if (isPermissionDeniedError(error)) return;
      showToast(
        t(
          isMedicationDiscontinuedError(error)
            ? 'asNeeded.toast.discontinued'
            : 'asNeeded.toast.failed'
        ),
        'error'
      );
    },
  });

  const requestGive = useCallback(
    (target: GiveTarget): void => {
      const other = recentDoseByOther(summaries[target.id]?.last_dose, myUserId);
      if (other) {
        setPrompt({
          name: firstNameOf(other.given_by),
          givenAt: other.given_at,
          medName: target.name,
          source: { kind: 'precheck', target },
        });
        return;
      }
      setLogging({ target, acknowledged: false });
    },
    [summaries, myUserId]
  );

  function submitLog(values: LogDoseSubmit): void {
    if (!logging) return;
    const { target, acknowledged } = logging;
    const surface = target.surface ?? defaultSurface;
    contexts.current.set(target.id, {
      surface,
      afterRecentPrompt: acknowledged,
      lastDoseGivenAt: summaries[target.id]?.last_dose?.given_at ?? null,
    });
    flow.log({
      eventId: target.id,
      name: target.name,
      body: {
        client_request_id: values.clientRequestId,
        ...(values.givenAt ? { given_at: values.givenAt } : {}),
        note: values.note,
        // What THIS client showed: the server only prompts for a dose the
        // caregiver has not seen.
        known_last_dose_id: summaries[target.id]?.last_dose?.id ?? null,
        ...(acknowledged ? { acknowledge_recent: true } : {}),
      },
    });
    setLogging(null);
  }

  const renderDialogs = (): ReactElement | null => {
    if (prompt) {
      const ago = (() => {
        if (!prompt.givenAt) return t('asNeeded.recent.justNow');
        const minutes = minutesAgo(prompt.givenAt);
        return minutes < 1
          ? t('asNeeded.recent.justNow')
          : t('asNeeded.recent.minutesAgo', { count: minutes });
      })();
      const at = prompt.givenAt ? new Date(prompt.givenAt) : new Date();
      const time = timezone
        ? `${formatInstantClock(at, timezone, hourCycle, language)}${getTimezoneSuffix(timezone, at, { language })}`
        : '';
      return (
        <ConfirmDialog
          title={
            prompt.name
              ? t('asNeeded.recent.title', { name: prompt.name })
              : t('asNeeded.recent.titleNoName')
          }
          message={
            prompt.name
              ? t('asNeeded.recent.body', { name: prompt.name, medication: prompt.medName, ago, time })
              : t('asNeeded.recent.bodyNoName', { medication: prompt.medName, ago, time })
          }
          confirmLabel={t('asNeeded.recent.another')}
          cancelLabel={t('asNeeded.recent.no')}
          onConfirm={() => {
            const source = prompt.source;
            setPrompt(null);
            Analytics.asNeededRecentConflict({ resolution: 'logged_another' });
            if (source.kind === 'precheck') {
              setLogging({ target: source.target, acknowledged: true });
            } else {
              // The dose was already chosen and its undo window already spent:
              // re-send it now, SAME client_request_id, acknowledged.
              const ctx = contexts.current.get(source.entry.eventId);
              if (ctx) ctx.afterRecentPrompt = true;
              flow.logNow({
                ...source.entry,
                body: { ...source.entry.body, acknowledge_recent: true },
              });
            }
          }}
          onCancel={() => {
            if (prompt.source.kind === 'server') {
              // The refused dose will never be sent: drop its context.
              contexts.current.delete(prompt.source.entry.eventId);
            }
            Analytics.asNeededRecentConflict({ resolution: 'dismissed' });
            setPrompt(null);
          }}
        />
      );
    }
    if (logging && timezone) {
      return (
        <LogDoseDialog
          name={logging.target.name}
          dosage={logging.target.dosage}
          isSelf={isSelf}
          timezone={timezone}
          onCancel={() => setLogging(null)}
          onSubmit={submitLog}
        />
      );
    }
    return null;
  };

  return {
    requestGive,
    pending: flow.pending,
    inFlight: flow.inFlight,
    undo: (eventId) => {
      const surface = contexts.current.get(eventId)?.surface ?? defaultSurface;
      if (flow.undo(eventId)) {
        // Cancelled before anything was sent: no dose, no push, no feed row.
        contexts.current.delete(eventId);
        Analytics.asNeededDoseUndone({ surface });
      }
    },
    dialogs: renderDialogs(),
  };
}
