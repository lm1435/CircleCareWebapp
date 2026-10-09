import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@/styles/globals.css';
import i18n from '@/i18n';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import { DailyUpdateCardView } from '@/components/dailyUpdate/DailyUpdateCardView';
import {
  DailyUpdateDayArrows,
  DailyUpdateDayView,
} from '@/components/dailyUpdate/DailyUpdateDayView';
import { Hero } from '@/components/overview/Hero';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { capitalizeFirst } from '@/lib/dailyUpdateCopy';
import { formatDailyUpdateDate } from '@/lib/dailyUpdateWindow';

/**
 * THE DAILY UPDATE CARD AND PAGE, ON FIXTURE DATA, WITH NO BACKEND — the
 * design-review surface for docs/plans/daily-update.md "Design v2 B2".
 *
 * The card is gated on 19:00-24:00 recipient time, a day with activity and a
 * live preference read, so a screenshot of the real Home needs a backend, a
 * circle with records and a clock. This page mounts the exact production
 * markup (`DailyUpdateCardView`, `DailyUpdateDayView`, `DailyUpdateDayArrows`)
 * on a Contract-v2-shaped fixture instead, under the real Hero so the card is
 * seen in the composition it ships in. Served by the Vite dev server straight
 * off source, like `picker-geometry.html`; nothing in the app links to it.
 *
 * Query string:
 *   `view=card|page|past|empty|counts`  what to mount (default `card`;
 *                                        `counts` = a backend without item detail)
 *   `solo=1`                     a solo owner (adds "Invite someone to share this")
 *   `lang=en|es|…`               language (default `en`)
 */

const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'card';
const solo = params.get('solo') === '1';
const lang = params.get('lang') ?? 'en';
void i18n.changeLanguage(lang);

const TZ = 'America/Denver';
const TODAY = '2026-10-08';

/** The prototype's day for Luis, seen at 7:10 PM (today) or the morning after (past). */
function fixture(past: boolean): DailyUpdateData {
  const date = past ? '2026-10-07' : TODAY;
  return {
    enabled: true,
    date,
    is_today: !past,
    timezone: TZ,
    window: { opens_at: '2026-10-09T01:00:00.000Z', closes_at: '2026-10-09T06:00:00.000Z' },
    eligible: true,
    has_activity: true,
    recipient_name: 'Luis',
    is_solo: solo,
    doses: past
      ? { taken: 3, taken_late: 0, skipped: 0, not_marked: 1, upcoming: 0 }
      : { taken: 1, taken_late: 1, skipped: 1, not_marked: 0, upcoming: 1 },
    as_needed: null,
    tasks: { done: past ? 1 : 2 },
    appointments: { past_count: past ? 0 : 1 },
    notes: { count: 1, authors: [past ? 'Luis' : 'Jennie'], more_authors: 0 },
    still_to_do: past
      ? []
      : [
          { kind: 'dose', id: 'e9', title: 'Escitalopram', time: '21:00', status: 'upcoming' },
          { kind: 'task', id: 't9', title: 'Call the pharmacy about the dosage', time: null, status: 'open' },
        ],
    still_to_do_more: 0,
    doses_detail: past
      ? [
          { event_id: 'p1', medication_id: 'm1', medication_name: 'Sertraline', dosage: '50mg', time: '08:00', status: 'taken', marked_by_name: 'Jennie', marked_at: '08:05' },
          { event_id: 'p2', medication_id: 'm2', medication_name: 'Metformin', dosage: null, time: '13:00', status: 'taken', marked_by_name: 'Luis', marked_at: '13:02' },
          { event_id: 'p3', medication_id: 'm3', medication_name: 'Vitamin D', dosage: null, time: '13:00', status: 'taken', marked_by_name: 'Luis', marked_at: '13:02' },
          { event_id: 'p4', medication_id: 'm4', medication_name: 'Escitalopram', dosage: '10mg', time: '21:00', status: 'not_marked', marked_by_name: null, marked_at: null },
        ]
      : [
          { event_id: 'd1', medication_id: 'm1', medication_name: 'Sertraline', dosage: '50mg', time: '08:00', status: 'taken', marked_by_name: 'Jennie', marked_at: '08:05' },
          { event_id: 'd2', medication_id: 'm2', medication_name: 'Metformin', dosage: null, time: '13:00', status: 'taken_late', marked_by_name: 'Luis', marked_at: '14:10' },
          { event_id: 'd3', medication_id: 'm3', medication_name: 'Vitamin D', dosage: null, time: '13:00', status: 'skipped', marked_by_name: 'Luis', marked_at: '13:20' },
          { event_id: 'd4', medication_id: 'm4', medication_name: 'Escitalopram', dosage: '10mg', time: '21:00', status: 'upcoming', marked_by_name: null, marked_at: null },
        ],
    tasks_done_detail: past
      ? [{ event_id: 'k3', title: 'Laundry', completed_by_name: 'Jennie', completed_at: '15:30' }]
      : [
          { event_id: 'k1', title: 'Groceries', completed_by_name: 'Luis', completed_at: '11:20' },
          { event_id: 'k2', title: 'Pick up the refill', completed_by_name: 'Jennie', completed_at: '16:05' },
        ],
    appointments_detail: past
      ? []
      : [{ event_id: 'a1', title: 'Dr. Patel, cardiology follow-up', time: '10:30', location: null }],
    notes_detail: [
      past
        ? { note_id: 'n2', kind: 'care', event_id: null, author_name: 'Luis', created_at: '20:40', excerpt: 'Felt tired after dinner and went to bed early. Slept through, no headache this time.' }
        : { note_id: 'n1', kind: 'care', event_id: null, author_name: 'Jennie', created_at: '16:10', excerpt: 'Luis ate well at lunch and walked to the corner and back. Dr. Patel wants the blood pressure log at the next visit, so keep writing it down each morning.' },
    ],
    nav: past
      ? { prev_date: '2026-10-06', next_date: TODAY }
      : { prev_date: '2026-10-07', next_date: null },
  };
}

const empty: DailyUpdateData = {
  ...fixture(true),
  has_activity: false,
  doses: { taken: 0, taken_late: 0, skipped: 0, not_marked: 0, upcoming: 0 },
  tasks: { done: 0 },
  appointments: { past_count: 0 },
  notes: { count: 0, authors: [], more_authors: 0 },
  still_to_do: [],
  still_to_do_more: 0,
  doses_detail: [],
  tasks_done_detail: [],
  appointments_detail: [],
  notes_detail: [],
};

/** An older backend: counts only, no item detail, no nav. */
function countsOnly(): DailyUpdateData {
  const {
    doses_detail: _d,
    tasks_done_detail: _t,
    appointments_detail: _a,
    notes_detail: _n,
    nav: _v,
    ...rest
  } = fixture(false);
  return rest;
}

function App(): ReactElement {
  if (view === 'card' || view === 'counts') {
    const data = view === 'counts' ? countsOnly() : fixture(false);
    return (
      <main className="mx-auto max-w-5xl pb-8">
        <Hero
          recipientName={data.recipient_name ?? ''}
          recipientPhotoUrl={null}
          recipientDob={null}
          members={[]}
        />
        <div className="px-5 pb-6">
          <DailyUpdateCardView
            data={data}
            circleId="c1"
            headingId="du-heading"
            inviteTo={solo ? '/circles/c1/members' : null}
            onDismiss={() => undefined}
            onTurnOff={() => undefined}
          />
        </div>
      </main>
    );
  }
  const past = view !== 'page';
  const data = view === 'empty' ? empty : fixture(past);
  const title = capitalizeFirst(formatDailyUpdateDate(data.date, lang), lang);
  return (
    <main className="mx-auto max-w-3xl pb-10" data-testid="daily-update-page">
      <PageMasthead section={i18n.t('dailyUpdate:eyebrow')} tone="moss" title={title} backTo="/circles/c1" compact />
      <div className="px-5 pb-1">
        <DailyUpdateDayArrows
          circleId="c1"
          prev={data.nav?.prev_date ?? null}
          next={data.nav?.next_date ?? null}
          isToday={!past}
        />
      </div>
      <div className="px-5 pt-2">
        <DailyUpdateDayView data={data} circleId="c1" past={past} />
      </div>
    </main>
  );
}

const client = new QueryClient();
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <App />
    </MemoryRouter>
  </QueryClientProvider>
);
