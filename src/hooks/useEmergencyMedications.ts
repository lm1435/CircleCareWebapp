import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getEvents, type CalendarEvent } from '@/api/calendarEvents';
import { careSummaryEventsKey, careSummaryEventsWindow } from '@/hooks/useCareSummaryExport';
import {
  selectCareSummaryMedications,
  type CareSummaryMedicationSelection,
} from '@/pdf/shared/medicationSelection';
import { getDateInTimezone } from '@/utils/timezone';

const EMPTY_SELECTION: CareSummaryMedicationSelection<CalendarEvent> = {
  active: [],
  asNeeded: [],
  recent: [],
  stopped: [],
  forExport: [],
  stoppedSeriesMap: new Map<string, string>(),
};

export interface EmergencyMedications extends CareSummaryMedicationSelection<CalendarEvent> {
  /** The recipient's today (`YYYY-MM-DD`), null until the zone is known. */
  todayStr: string | null;
  /** True until the window has answered (and while the zone is unknown). */
  isLoading: boolean;
  /** The read failed and there is nothing cached to show. */
  isError: boolean;
  refetch: () => void;
}

/**
 * The Current medications section of Emergency info (1.4.3, mobile parity): the SAME ±30-day
 * window, the SAME query key and the SAME selection (`selectCareSummaryMedications`) the care
 * summary prints, so the page and the PDF list the same rows in the same order (mobile's screen
 * and its PDF share them the same way).
 *
 * GATED ON THE RECIPIENT'S ZONE: `timezone` is null while the circle loads, and nothing is
 * requested or bucketed in a placeholder frame (mobile's EmergencyInfoScreen, "two values").
 * The query is persisted with the rest of the cache, so a saved copy shows offline.
 */
export function useEmergencyMedications(
  circleId: string,
  timezone: string | null
): EmergencyMedications {
  const todayStr = timezone ? getDateInTimezone(timezone) : null;
  const window = todayStr ? careSummaryEventsWindow(todayStr) : null;
  const query = useQuery<CalendarEvent[]>({
    queryKey: window
      ? careSummaryEventsKey(circleId, window)
      : ['calendarEvents', circleId, 'emergency-medications-pending'],
    queryFn: () => getEvents(circleId, window!),
    enabled: !!circleId && window != null,
  });
  const data = query.data;
  const selection = useMemo(
    () =>
      todayStr && timezone
        ? selectCareSummaryMedications(data, {
            todayStr,
            careRecipientTimezone: timezone,
            getDateInTimezone,
          })
        : EMPTY_SELECTION,
    [data, todayStr, timezone]
  );
  return {
    ...selection,
    todayStr,
    isLoading: window == null || (query.isPending && data === undefined),
    isError: query.isError && data === undefined,
    refetch: () => void query.refetch(),
  };
}
