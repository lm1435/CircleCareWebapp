import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@/styles/globals.css';
import '@/i18n';
import { Checkbox } from '@/components/ui/Checkbox';
import { DateField } from '@/components/ui/DateField';
import { TimeField } from '@/components/ui/TimeField';

/**
 * ONE FIELD, ON A PAGE WITH NOTHING ELSE ON IT — the only place the picker's
 * SCROLL ARITHMETIC can actually be tested.
 *
 * `centerInColumn` reads `offsetTop`, `clientHeight`, `scrollHeight` and writes
 * `scrollTop`. jsdom reports 0 for all four and ignores the write, so the
 * ~99 vitest specs around this widget can only assert against a hand-built
 * stub of those numbers — which is exactly how `offsetTop` being measured
 * against the wrong box survived them all (the stub returned `index * ROW`,
 * i.e. the answer the code was supposed to compute). Real geometry needs a
 * real engine, so this page exists purely to put ONE `TimeField` or
 * `DateField` in front of Chromium with the app's real stylesheet loaded.
 *
 * Served by the Vite dev server the e2e run already starts, straight off
 * source — so it can never drift from the components it measures the way a
 * hand-copied fixture would. Driven by `e2e/picker-geometry.spec.ts` (project
 * `picker-geometry`) and by `e2e/coarse-pointer.spec.ts` (the
 * `coarse-pointer-*` projects, which mount the same `field=time|date` cases on
 * touch engines to prove the popover is absent there); it is not part of the
 * app and nothing links to it.
 *
 * BACKEND-FREE, like the `a11y-*` projects: `useHourCycle` is a React Query
 * read that is `enabled: false` while signed out, so the provider below is all
 * it needs and no request is ever made. The cycle therefore falls back to the
 * BROWSER LOCALE — which is why the spec pins `locale: 'en-US'` (12-hour) and
 * a `timezoneId`, rather than inheriting whatever the machine is set to.
 *
 * `field=checkbox` IS NOT A PICKER, and rides along here for the same reason the
 * pickers do: `Checkbox` is a `<label htmlFor>` pointing at a
 * `<button role="checkbox">`, and label forwarding to a non-form control is
 * spec-valid but ENGINE behaviour — jsdom's click delegation is its own
 * implementation of the HTML activation-behaviour rules, not Chromium's, so a
 * green jsdom test is evidence about jsdom. Mounting the real component in a
 * real browser is the only way to know a caregiver tapping the WORDS toggles the
 * box. It needs no backend either, so it costs this project nothing.
 *
 * Query string:
 *   `field=time|date|checkbox`  which control to mount (default `time`)
 *   `time=HH:MM`       the time field's value
 *   `date=YYYY-MM-DD`  the date field's value
 *   `top=<px>`         how far down the viewport the field sits, which is what
 *                      decides how much room the panel is clamped to — the
 *                      grid's `clientHeight` in the date cases is a function of
 *                      this and the viewport height, nothing else.
 */

const FIELDS = ['time', 'date', 'checkbox'] as const;
type Field = (typeof FIELDS)[number];

const params = new URLSearchParams(window.location.search);
const requested = params.get('field');
const field: Field = FIELDS.includes(requested as Field) ? (requested as Field) : 'time';
const initialTime = params.get('time') ?? '';
const initialDate = params.get('date') ?? '';
const top = Number(params.get('top') ?? 24);

// Retries and background refetches would be noise in a page that makes no
// requests at all; `enabled: false` means this client never runs a query.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Harness(): ReactElement {
  const [time, setTime] = useState(initialTime);
  const [date, setDate] = useState(initialDate);
  const [checked, setChecked] = useState(false);

  return (
    // `border-box` + `maxWidth` so the column NARROWS with the viewport instead
    // of forcing the document wider than it. A fixed 360 + 24 of padding is 384
    // css px, which at the 320px viewport the sheet specs measure would make the
    // PAGE scroll sideways — and "the picker does not break out of 320px" is
    // exactly the claim being tested there, so a harness that overflows on its
    // own would answer it for the widget.
    <div
      style={{
        paddingTop: top,
        paddingLeft: 24,
        paddingRight: 24,
        width: 360,
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {field === 'time' && (
        <TimeField id="at" label="Time" value={time} onChange={(e) => setTime(e.target.value)} />
      )}
      {field === 'date' && (
        <DateField id="on" label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      )}
      {field === 'checkbox' && (
        // A `hint` is supplied deliberately: it makes the label a two-line
        // column, which is the case `items-start` exists for AND the case where
        // a click lands furthest from the box — so the spec's label click is
        // testing forwarding, not proximity to the button's own 44px target.
        <Checkbox
          id="notify"
          checked={checked}
          onChange={setChecked}
          label="Remind the circle"
          hint="Everyone gets the reminder, so nobody has to be the one who remembers."
        />
      )}
    </div>
  );
}

document.body.style.margin = '0';

// No `StrictMode`: it double-invokes effects, and the shell's open-time work is
// a deliberate one-shot guarded by refs that survive the remount. Measuring the
// second, half-skipped pass would not be measuring what ships.
createRoot(document.getElementById('root') as HTMLElement).render(
  <QueryClientProvider client={queryClient}>
    <Harness />
  </QueryClientProvider>
);
