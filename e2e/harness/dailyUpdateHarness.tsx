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
import { DailyUpdateSections } from '@/components/dailyUpdate/DailyUpdateSections';
import { DAILY_UPDATE_SURFACE } from '@/components/dailyUpdate/surface';
import { Hero } from '@/components/overview/Hero';
import { PageMasthead } from '@/components/layout/PageMasthead';

/**
 * THE DAILY UPDATE CARD AND PAGE, ON FIXTURE DATA, WITH NO BACKEND — the
 * design-review surface for docs/plans/daily-update.md "Design (Fable)".
 *
 * The card is gated on 19:00-24:00 recipient time, a day with activity and a
 * live preference read, so a screenshot of the real Home needs a backend, a
 * circle with records and a clock. This page mounts the exact production
 * markup (`DailyUpdateCardView`, `DailyUpdateSections`, the shared surface)
 * on a §4.1-shaped fixture instead, under the real Hero so the card is seen
 * in the composition it ships in. Served by the Vite dev server straight off
 * source, like `picker-geometry.html`; nothing in the app links to it.
 *
 * Query string:
 *   `view=card|page|past|empty`  what to mount (default `card`)
 *   `solo=1`                     a solo owner (adds "Invite someone to share this")
 *   `lang=en|es`                 language (default `en`)
 *   `long=1`                     long names / many items, for wrap and "+N more"
 */

const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'card';
const solo = params.get('solo') === '1';
const long = params.get('long') === '1';
const lang = params.get('lang') ?? 'en';
void i18n.changeLanguage(lang);

const TZ = 'America/Denver';

function fixture(past: boolean): DailyUpdateData {
  return {
    enabled: true,
    date: past ? '2026-10-07' : '2026-10-08',
    is_today: !past,
    timezone: TZ,
    window: { opens_at: '2026-10-09T01:00:00.000Z', closes_at: '2026-10-09T06:00:00.000Z' },
    eligible: true,
    has_activity: true,
    recipient_name: long ? 'Maria Guadalupe' : 'Rose',
    is_solo: solo,
    doses: { taken: 3, taken_late: 1, skipped: 1, not_marked: past ? 1 : 0, upcoming: 1 },
    as_needed: long ? { given: 1 } : null,
    tasks: { done: 2 },
    appointments: { past_count: 1 },
    notes: long
      ? { count: 3, authors: ['Ana', 'Isabel'], more_authors: 1 }
      : { count: 1, authors: ['Ana'], more_authors: 0 },
    still_to_do: past
      ? [{ kind: 'task', id: 't1', title: 'Groceries', time: null, status: 'open' }]
      : [
          { kind: 'dose', id: 'e1', title: 'Metformin', time: '21:00:00', status: 'upcoming' },
          {
            kind: 'dose',
            id: 'e2',
            title: long ? 'Lisinopril hydrochlorothiazide 20 mg' : 'Lisinopril',
            time: '19:30:00',
            status: 'not_marked',
          },
          ...(long
            ? [
                { kind: 'task' as const, id: 't2', title: 'Evening walk', time: null, status: 'open' as const },
              ]
            : []),
        ],
    still_to_do_more: long ? 2 : 0,
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
};

function App(): ReactElement {
  if (view === 'card') {
    const data = fixture(false);
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
            headingId="du-heading"
            openTo="/circles/c1/daily-update"
            inviteTo={solo ? '/circles/c1/members' : null}
            onDismiss={() => undefined}
            onTurnOff={() => undefined}
            animate={false}
          />
        </div>
      </main>
    );
  }
  const past = view !== 'page';
  const data = view === 'empty' ? empty : fixture(past);
  const name = data.recipient_name ?? '';
  const title = past ? 'Wednesday, Oct 7' : `${name}'s day`;
  const eyebrow = past ? `${name}'s day` : 'Daily update';
  return (
    <main className="mx-auto max-w-5xl pb-8">
      <PageMasthead section={eyebrow} tone="moss" title={title} backTo="/circles/c1" />
      <div className="px-5">
        <div className={`${DAILY_UPDATE_SURFACE} px-5 py-5`} data-testid="daily-update-page">
          {view === 'empty' ? (
            <p className="m-0 text-md leading-normal text-ink-2">Nothing was recorded on this day.</p>
          ) : (
            <DailyUpdateSections data={data} past={past} headingLevel="h2" />
          )}
        </div>
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
