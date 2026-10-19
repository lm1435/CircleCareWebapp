// WCAG 2.x contrast validator for CircleCare light vs dark palettes.
// Parses the REAL css: light = the @theme block of src/styles/globals.css, dark =
// its `:root[data-theme='dark']` block. Exit code 0 only when every gated pairing
// passes in dark (the same pairings are also asserted by
// src/__tests__/a11yContrastTokens.test.tsx).
// Usage: node scripts/contrast.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles') + path.sep;
const block = (css, open) => {
  const start = css.indexOf(open);
  if (start < 0) throw new Error('block not found: ' + open);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unterminated block: ' + open);
};
const parse = (css) => {
  const o = {};
  // Only plain #hex / rgb(a)() values are contrast-checkable; anything else (var(), color-mix()) is skipped.
  for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    const v = m[2].trim().replace(/\/\*.*$/, '').trim();
    if (/^(#[0-9a-f]{6}|rgba?\([^)]*\))$/i.test(v)) o[m[1]] = v;
  }
  return o;
};
const globals = fs.readFileSync(ROOT + 'globals.css', 'utf8');
const light = parse(block(globals, '@theme {'));
const dark = parse(block(globals, ":root[data-theme='dark'] {"));
const missing = Object.keys(light).filter((k) => !(k in dark));
const extra = Object.keys(dark).filter((k) => !(k in light));

const toRGBA = (v) => {
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error('bad color ' + v);
};
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Resolve `key` over a chain of grounds. `on` is a key resolved first (opaque after compositing onto page `bg`).
function resolve(P, key, on) {
  const base = on ? resolve(P, on) : toRGBA(P['bg']);
  const c = toRGBA(P[key]);
  return c[3] < 1 ? over(c, base) : c;
}
function measure(P, p) {
  // ground = `bg` composited over `on` (soft wash over the surface it sits on)
  const ground = resolve(P, p.bg, p.on);
  let fg = toRGBA(P[p.fg]);
  if (fg[3] < 1) fg = over(fg, ground);
  return ratio(fg, ground);
}

const T = 4.5, N = 3; // text, non-text/large/icon
const pairs = [];
const add = (group, fg, bg, min, on, note) => pairs.push({ group, fg, bg, min, on, note });
const surf = ['bg', 'cream', 'bg-2'];
// Neutral text
for (const g of surf) for (const f of ['ink', 'ink-2', 'ink-3']) add('text', f, g, T);
add('text', 'ink', 'bg-3', T); add('text', 'ink-2', 'bg-3', T);
add('text', 'ink-3', 'bg-3', T, null, 'light baseline expected < 4.5 (bg-3 paints skeletons only)');
for (const g of ['cream', 'bg-2']) add('placeholder', 'placeholder', g, T, null, 'composited over the field ground');
// Tint text on neutral grounds
const tints = { moss: ['moss', 'moss-deep'], terracotta: ['terracotta', 'terracotta-deep'], coral: ['coral-deep'], clay: ['clay', 'clay-deep'], dusk: ['dusk', 'dusk-deep'], amber: ['amber-deep'] };
for (const [t, fgs] of Object.entries(tints)) for (const f of fgs) for (const g of ['bg', 'cream']) add('tint-text', f, g, T);
// Tint text on its own soft wash (wash composited over bg and over cream)
const soft = { moss: ['moss', 'moss-deep'], terracotta: ['terracotta', 'terracotta-deep'], coral: ['coral-deep'], clay: ['clay', 'clay-deep'], dusk: ['dusk', 'dusk-deep'], amber: ['amber-deep'] };
for (const [t, fgs] of Object.entries(soft)) for (const f of fgs) for (const on of ['bg', 'cream']) add('on-soft', f, t + '-soft', T, on);
for (const f of ['moss-deep', 'ink']) for (const on of ['bg', 'cream']) add('on-soft', f, 'moss-wash', T, on);
for (const on of ['bg', 'cream']) { add('on-soft', 'clay-deep', 'clay-line', T, on); add('on-soft', 'ink', 'clay-line', T, on); }
for (const t of ['moss', 'terracotta', 'clay', 'dusk', 'amber', 'coral']) for (const on of ['bg', 'cream']) add('on-soft', 'ink', t + '-soft', T, on);
// Coral base: icon / decoration / >= 24px text only
for (const g of ['bg', 'cream']) add('icon', 'coral', g, N, null, 'coral = icons / large text only');
add('icon', 'coral', 'coral-soft', N, 'cream');
// Text on solid fills (text-cream / icon-cream on bg-<tint>)
for (const f of ['moss', 'moss-mid', 'moss-deep', 'clay', 'dusk', 'terracotta', 'terracotta-deep', 'ink', 'ink-2', 'moss-dark', 'clay-ramp-deep', 'amber-deep', 'coral-deep']) add('on-solid', 'cream', f, T);
add('on-solid', 'cream', 'coral', N, null, 'icon-only on coral (AI button, role badges)');
// Inverse pill: cream/80 label over bg-ink (AddMenu 2xs label)
{ pairs.push({ group: 'on-solid', fg: 'cream', bg: 'ink', min: T, on: null, note: 'inverse pill label (cream/80 modeled below)', alpha: 0.8 }); }
// Non-text boundaries
for (const g of ['bg', 'cream', 'bg-2', 'moss-wash']) add('border', 'line-strong', g, N, g === 'moss-wash' ? 'bg' : null, 'field edge / switch OFF track');
for (const g of ['bg', 'cream']) { add('border', 'moss', g, N, null, 'focus edge / checked checkbox'); add('border', 'terracotta', g, N, null, 'error field edge'); }
for (const g of surf) add('border', 'ink', g, N, null, 'focus ring');
for (const t of ['clay', 'dusk', 'moss']) for (const g of ['bg', 'cream']) add('dot', t, g, N, null, 'event-type dots');
const hair = [];
for (const f of ['line', 'line-2']) for (const g of ['bg', 'cream']) hair.push({ group: 'hairline', fg: f, bg: g, min: 0, note: 'decorative separator, informational' });

function run(P) {
  const rows = [];
  for (const p of [...pairs, ...hair]) {
    const q = { ...p };
    let r;
    if (p.alpha) {
      const ground = resolve(P, p.bg, p.on);
      const f = toRGBA(P[p.fg]); f[3] = p.alpha; r = ratio(over(f, ground), ground);
    } else r = measure(P, q);
    rows.push({ ...p, ratio: r, pass: r >= p.min });
  }
  return rows;
}
const L = run(light), D = run(dark);
let fail = 0, pass = 0, lightFail = 0, regress = 0;
const lines = [];
D.forEach((d, i) => {
  const l = L[i];
  if (d.group === 'hairline') { lines.push(['INFO', d, l]); return; }
  if (d.pass) pass++; else fail++;
  if (!l.pass) lightFail++;
  if (!d.pass && l.pass) regress++;
  lines.push([d.pass ? 'PASS' : 'FAIL', d, l]);
});
const fmt = (x) => x.toFixed(2).padStart(5);
const label = (d) => `${d.group.padEnd(11)} ${d.fg}${d.alpha ? '/' + d.alpha * 100 : ''} on ${d.bg}${d.on && d.on !== d.bg ? ' (over ' + d.on + ')' : ''}`;
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(lines.map(([s, d, l]) => ({ status: s, label: label(d), min: d.min, dark: +d.ratio.toFixed(2), light: +l.ratio.toFixed(2), lightPass: l.pass, note: d.note || '' })), null, 1));
} else {
  for (const [s, d, l] of lines) console.log(`${s} ${label(d).padEnd(52)} min ${String(d.min).padEnd(3)} dark ${fmt(d.ratio)}  light ${fmt(l.ratio)}${l.pass || d.group === 'hairline' ? '' : '  (light also fails)'}`);
  console.log(`\nvars missing from dark: ${missing.length ? missing.join(', ') : 'none'}; extra: ${extra.length ? extra.join(', ') : 'none'}`);
  console.log(`DARK  pass ${pass}  fail ${fail}  of ${pass + fail} gated pairings (hairlines informational)`);
  console.log(`LIGHT pass ${pass + fail - lightFail}  fail ${lightFail}`);
  console.log(`dark fails where light passes (regressions): ${regress}`);
}

// ---- Role-token pairings (the semantic tokens components actually read) and the few literals that remain.
const hexOf = (a) => '#' + a.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const DK = dark;
const lit = [
  ['primary: on-primary on primary-fill', DK['on-primary'], DK['primary-fill'], 4.5],
  ['primary: on-primary on primary-fill-hover', DK['on-primary'], DK['primary-fill-hover'], 4.5],
  ['primary: primary-fill vs page (non-text)', DK['primary-fill'], DK['bg'], 3],
  ['primary: primary-fill vs card (non-text)', DK['primary-fill'], DK['cream'], 3],
  ['calendar: on-fill on task-fill', DK['on-fill'], DK['task-fill'], 4.5],
  ['calendar: on-fill on medication-fill', DK['on-fill'], DK['medication-fill'], 4.5],
  ['calendar: on-fill on appointment-fill', DK['on-fill'], DK['appointment-fill'], 4.5],
  ['calendar: task-fill vs page (non-text)', DK['task-fill'], DK['bg'], 3],
  ['raised slab: on-raised on surface-raised (chat bubble, tooltip)', DK['on-raised'], DK['surface-raised'], 4.5],
  ['toast: ink on surface-toast', DK['ink'], DK['surface-toast'], 4.5],
  ['toast: ink-3 close icon on surface-toast', DK['ink-3'], DK['surface-toast'], 3],
  ['toast: moss success icon on surface-toast', DK['moss'], DK['surface-toast'], 3],
  ['toast: terracotta-deep error icon on surface-toast', DK['terracotta-deep'], DK['surface-toast'], 3],
  ['toast: surface-toast vs page (non-text)', DK['surface-toast'], DK['bg'], 1],
  ['add-menu icon on clay circle', DK['menu-icon'], DK['menu-clay'], 4.5],
  ['add-menu icon on dusk circle', DK['menu-icon'], DK['menu-dusk'], 4.5],
  ['add-menu icon on moss circle', DK['menu-icon'], DK['menu-moss'], 4.5],
  ['add-menu label on pill', DK['menu-label'], DK['menu-pill'], 4.5],
  ['add-menu clay circle vs pill (non-text)', DK['menu-clay'], DK['menu-pill'], 3],
  ['add-menu dusk circle vs pill (non-text)', DK['menu-dusk'], DK['menu-pill'], 3],
  ['add-menu moss circle vs pill (non-text)', DK['menu-moss'], DK['menu-pill'], 3],
  ...['moss', 'moss-deep', 'moss-mid', 'moss-dark', 'coral-deep', 'terracotta-deep', 'dusk', 'dusk-deep', 'clay', 'clay-deep', 'amber-deep'].map((k) => [`avatar initials (cream) on avatar-${k}`, DK['cream'], DK['avatar-' + k], 4.5]),
  ['apple button: on-apple on apple-fill', DK['on-apple'], DK['apple-fill'], 4.5],
  ['apple button outline (.42 white) on page (non-text)', hexOf(over(toRGBA(DK['apple-line']), toRGBA(DK['bg']))), DK['bg'], 3],
  ['store badge: on-badge on badge', DK['on-badge'], DK['badge'], 4.5],
  ['nav pill: ink on nav-pill over page', DK['ink'], hexOf(over(toRGBA(DK['nav-pill']), toRGBA(DK['bg']))), 4.5],
  ['nav pill: ink-2 on nav-pill over page', DK['ink-2'], hexOf(over(toRGBA(DK['nav-pill']), toRGBA(DK['bg']))), 4.5],
  // Auth hero: on-photo text over a photo-scrim gradient (alpha .55 mid stop, .95 bottom stop) over a photo dimmed to .7
  // (worst case: a pure-white photo pixel => 178.5 grey).
  ['auth hero text on scrim over white photo (mid stop .55)', DK['on-photo'], hexOf(over([...toRGBA(DK['photo-scrim']).slice(0, 3), 0.55], [178.5, 178.5, 178.5, 1])), 4.5],
  ['auth hero text at bottom stop (.95) over white photo', DK['on-photo'], hexOf(over([...toRGBA(DK['photo-scrim']).slice(0, 3), 0.95], [178.5, 178.5, 178.5, 1])), 4.5],
];
// Every role token must exist in BOTH schemes (a role defined for light only would silently render the light value in dark).
const roleOnlyLight = Object.keys(light).filter((k) => !(k in dark) && /^(primary|on-|task|medication|appointment|surface|nav|menu|badge|apple|avatar)/.test(k));
let litFail = roleOnlyLight.length;
if (roleOnlyLight.length) console.log('FAIL role tokens missing from dark: ' + roleOnlyLight.join(', '));
console.log('\nRole-token and literal dark pairings:');
for (const [n, f, b, m] of lit) { const r = ratio(toRGBA(f), toRGBA(b)); const ok = r >= m; if (!ok) litFail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n.padEnd(62)} min ${m} dark ${r.toFixed(2)}`); }
console.log(`ROLE/LITERAL pass ${lit.length - (litFail - roleOnlyLight.length)} fail ${litFail}`);
process.exitCode = fail || litFail ? 1 : 0;
