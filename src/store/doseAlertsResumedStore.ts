import { create } from 'zustand';

/**
 * "Alerts are on" after a resume (quiet-circle back-off, 1.4.2).
 *
 * A resume can happen on the check-in page (still_giving) or on the notice
 * itself ("Turn alerts back on"). Either way Today shows the one quiet
 * confirmation line in place of the notice for the rest of that Today visit,
 * so the person sees what their tap did. Keyed by circle; Today clears its
 * circle's entry when the visit ends (unmount / circle switch).
 */
interface DoseAlertsResumedState {
  resumed: Record<string, true>;
  markResumed: (circleId: string) => void;
  clear: (circleId: string) => void;
}

export const useDoseAlertsResumedStore = create<DoseAlertsResumedState>((set) => ({
  resumed: {},
  markResumed: (circleId) =>
    set((s) => (s.resumed[circleId] ? s : { resumed: { ...s.resumed, [circleId]: true } })),
  clear: (circleId) =>
    set((s) => {
      if (!s.resumed[circleId]) return s;
      const next = { ...s.resumed };
      delete next[circleId];
      return { resumed: next };
    }),
}));
