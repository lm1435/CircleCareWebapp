// React Query key factory — copies mobile's query key structure VERBATIM
// (grep `queryKey` in mobile/src/hooks/*) so cache invalidation logic ports
// 1:1 when write features arrive. Do NOT invent new shapes; if mobile adds a
// key, mirror it here with the same literals and ordering.

export interface CalendarEventsRange {
  start_date: string; // YYYY-MM-DD in care recipient's timezone
  end_date: string; // YYYY-MM-DD in care recipient's timezone
}

export const queryKeys = {
  // Circles
  circles: ['circles'] as const,
  circle: (circleId: string) => ['circles', circleId] as const,
  // Mobile also uses a singular 'circle' root in a few places — kept verbatim.
  circleDetail: (circleId: string) => ['circle', circleId] as const,

  // User / app
  currentUser: ['currentUser'] as const,
  subscriptionStatus: ['subscription-status'] as const,
  // Web Billing offering (RevenueCat purchases-js) — web-only, no mobile twin.
  webOfferings: ['web-offerings'] as const,
  appConfig: ['app-config'] as const,
  unitPreferences: ['unitPreferences'] as const,
  pushTokens: ['pushTokens'] as const,

  // Calendar
  calendarEvents: (circleId: string) => ['calendarEvents', circleId] as const,
  calendarEventsRange: (circleId: string, range: CalendarEventsRange) =>
    ['calendarEvents', circleId, range] as const,
  calendarEvent: (circleId: string, eventId: string) =>
    ['calendarEvent', circleId, eventId] as const,

  // Medications
  medicationTodaySummary: (circleId: string) => ['medicationTodaySummary', circleId] as const,
  medicationConfirmations: (circleId: string, params?: Record<string, unknown>) =>
    params === undefined
      ? (['medicationConfirmations', circleId] as const)
      : (['medicationConfirmations', circleId, params] as const),
  medicationAdherence: (circleId: string, eventId: string, days?: number) =>
    ['medicationAdherence', circleId, eventId, days] as const,
  adherenceReport: (circleId: string, period?: string) =>
    period === undefined
      ? (['adherenceReport', circleId] as const)
      : (['adherenceReport', circleId, period] as const),
  weeklyAdherence: (circleId: string) => ['weeklyAdherence', circleId] as const,

  // Activity
  activityFeed: (circleId: string, pageSize?: number) =>
    pageSize === undefined
      ? (['activityFeed', circleId] as const)
      : (['activityFeed', circleId, pageSize] as const),

  // Emergency info
  emergencyInfo: (circleId: string) => ['emergencyInfo', circleId] as const,

  // Documents
  documents: (circleId: string) => ['documents', circleId] as const,

  // Event notes
  eventNotes: (circleId: string, eventId: string, scheduledDate?: string) =>
    scheduledDate === undefined
      ? (['eventNotes', circleId, eventId] as const)
      : (['eventNotes', circleId, eventId, scheduledDate] as const),

  // Tasks
  tasks: (circleId: string) => ['tasks', circleId] as const,
  // Parameterized tasks list — mirrors mobile useTasks: only DEFINED params are
  // appended (status, sort, limit), in that order, so the key stays a superset
  // of `tasks(circleId)` and invalidating that prefix still matches every list.
  tasksList: (
    circleId: string,
    params?: { status?: string; sort?: string; limit?: number }
  ) => {
    const key: (string | number)[] = ['tasks', circleId];
    if (params?.status) key.push(params.status);
    if (params?.sort) key.push(params.sort);
    if (params?.limit) key.push(params.limit);
    return key;
  },

  // Vitals
  vitals: (circleId: string) => ['vitals', circleId] as const,
  vitalsLatest: (circleId: string) => ['vitals', circleId, 'latest'] as const,

  // Invites
  invitesPending: ['invites', 'pending'] as const,
};
