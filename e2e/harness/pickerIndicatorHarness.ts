import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@/styles/globals.css';
import { PICKER_INDICATOR_HIDDEN } from '@/components/ui/inputStyles';

/**
 * FOUR BARE INPUTS AND NOTHING ELSE — the probe that pins the one MEASURED fact
 * the whole coarse-pointer gate rests on.
 *
 * `DateField`, `TimeField`, `useCoarsePointer` and `inputStyles` all repeat the
 * same sentence: applying `PICKER_INDICATOR_HIDDEN` (`display: none` on
 * `::-webkit-calendar-picker-indicator`) moves an input's intrinsic width in
 * Chromium and moves it NOT AT ALL in WebKit, i.e. WebKit never laid out an
 * indicator to remove, so the class suppresses nothing there and a custom
 * popover on top of it is the SECOND picker on the field. That sentence is why
 * both fields stand down on touch. Until this page existed it was prose in four
 * comments and nothing in the suite would have noticed if it stopped being true.
 *
 * Each input carries EXACTLY ONE difference — the suppression class, imported
 * from `inputStyles` rather than retyped, so a change to the class is a change
 * to what this measures. No shell, no label, no width: the number a browser
 * reports here is its own intrinsic width for the control, which is precisely
 * the quantity that shifts when an indicator is or is not in the box.
 *
 * `globals.css` IS LOADED ON PURPOSE, and is not incidental: the suppression is
 * a Tailwind arbitrary-variant class, so without the app's stylesheet the class
 * string is inert and both probes would measure identical in EVERY engine — the
 * probe would "prove" WebKit's no-op by having no CSS at all. The fonts come
 * with it for the same reason the geometry harness loads them: an input's
 * intrinsic width is a function of its font, and the recorded numbers are only
 * comparable if the text is rendered the way the app renders it.
 *
 * Driven by `e2e/coarse-pointer.spec.ts` under the `coarse-pointer-*` projects.
 * Backend-free like every other harness page: no session, no request, no store.
 */

const PROBES: ReadonlyArray<{ id: string; type: 'date' | 'time'; suppressed: boolean }> = [
  { id: 'date-bare', type: 'date', suppressed: false },
  { id: 'date-suppressed', type: 'date', suppressed: true },
  { id: 'time-bare', type: 'time', suppressed: false },
  { id: 'time-suppressed', type: 'time', suppressed: true },
];

const root = document.getElementById('root') as HTMLElement;

for (const probe of PROBES) {
  // One input per row, in a block that imposes no width of its own — a flex or
  // grid parent would hand the control a stretched box and the measurement
  // would be of the CONTAINER, identical in every engine and therefore silent.
  const row = document.createElement('div');
  const input = document.createElement('input');
  input.type = probe.type;
  input.id = probe.id;
  input.setAttribute('data-probe', probe.id);
  input.setAttribute('aria-label', probe.id);
  if (probe.suppressed) input.className = PICKER_INDICATOR_HIDDEN;
  row.appendChild(input);
  root.appendChild(row);
}

document.body.style.margin = '0';
// The spec waits on this rather than on a selector alone: an input that failed
// to mount and an input that mounted are both "not visible" to a query that
// mistypes the id, and a silent zero is exactly the failure mode this page
// exists to rule out.
document.documentElement.setAttribute('data-probes-ready', String(PROBES.length));
