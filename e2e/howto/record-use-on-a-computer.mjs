/**
 * Scripted, deterministic take of the "Use CircleCare on a computer" help video (help-videos RECIPE.md "Web video").
 *
 *   node e2e/howto/record-use-on-a-computer.mjs <en|es> <outDir> [--dry]        (from CircleCare-dark/webapp)
 *
 * Needs: the :4298 backend, the recording Vite on :5298 (vite.howto.config.ts) and the ISOLATED web demo accounts
 * (seed-web.mjs; never the iPhone kit's howto.* accounts). Runs seed-web.mjs <lang> --reset first unless --no-seed.
 *
 * Capture: Chrome DevTools screencast (JPEG q90, 1920x1080 = 1280x720 CSS at deviceScaleFactor 1.5). Like simctl it
 * only emits a frame when the page repaints, each with its own timestamp; this script then rebuilds a true-time 30 fps
 * CFR video from those timestamps (every output frame = the latest screencast frame at or before it), so a long still
 * gap can never shift later frames. Output in <outDir>:
 *   <lang>.mov            h264 CFR 30 fps 1920x1080 (the take; t=0 = the first frame)
 *   <lang>.actions.json   every scripted action in recording seconds: { t, kind: move|click|type|key|goto|wheel|mark,
 *                         label, x, y } with x/y as fractions of the viewport (the ring positions)
 * The page shows a blank tab for the first seconds: the video draws the address bar typing over it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, VIEW } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [lang = 'en', outDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
if (!['en', 'es'].includes(lang) || !outDir) { console.error('usage: record-use-on-a-computer.mjs <en|es> <outDir> [--dry] [--no-seed]'); process.exit(2); }
if (!process.argv.includes('--no-seed')) {
  const r = spawnSync('node', [join(here, 'seed-web.mjs'), lang, '--reset'], { encoding: 'utf8', env: { ...process.env, SEED_BACKEND_URL: 'http://localhost:4298/api' } });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

const L = {
  en: { all: 'All circles', nav: ['Calendar', 'Medications', 'Tasks', 'Notes'], members: 'Members' },
  es: { all: 'Todos los círculos', nav: ['Calendario', 'Medicamentos', 'Tareas', 'Notas'], members: 'Miembros' },
}[lang];

mkdirSync(outDir, { recursive: true });
const raw = join(outDir, `.raw-${lang}`);
rmSync(raw, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });

const { browser, context, page, st, blocked } = await open({ lang, baseURL: 'http://localhost:5298' });
const sleep = (ms) => page.waitForTimeout(ms);
const frames = []; // [ts seconds, file]
const actions = [];
let cdp = null;
let t0 = null;
const now = () => Date.now() / 1000;
const log = (kind, label, x, y) => {
  const a = { t: +(now() - (t0 ?? now())).toFixed(3), kind, label, ...(x !== undefined ? { x: +(x / VIEW.width).toFixed(4), y: +(y / VIEW.height).toFixed(4) } : {}) };
  actions.push(a);
  console.log(JSON.stringify(a));
};

// Pointer: ease-in-out glide (16 ms steps), so the cursor overlay moves like a hand, not a teleport.
let pos = { x: VIEW.width * 0.62, y: VIEW.height * 0.55 };
async function glide(x, y, ms = 700) {
  const n = Math.max(8, Math.round(ms / 16));
  const a = { ...pos };
  for (let i = 1; i <= n; i++) {
    const p = i / n, e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    await page.mouse.move(a.x + (x - a.x) * e, a.y + (y - a.y) * e);
    await sleep(16);
  }
  pos = { x, y };
}
async function clickOn(locator, label, { fx = 0.5, fy = 0.5, ms = 750, settle = 350 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  const b = await locator.boundingBox();
  const x = b.x + b.width * fx, y = b.y + b.height * fy;
  log('move', label, x, y);
  await glide(x, y, ms);
  await sleep(settle);
  log('click', label, x, y);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
const settled = async (ms) => { await page.waitForLoadState('networkidle').catch(() => {}); await sleep(ms); };

// ---- capture -------------------------------------------------------------------------------------------------
await page.setContent('<html><body style="margin:0;background:#FFFFFF"></body></html>');
if (!DRY) {
  cdp = await context.newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const f = join(raw, `${String(n++).padStart(6, '0')}.jpg`);
    writeFileSync(f, Buffer.from(data, 'base64'));
    frames.push([metadata.timestamp, f]);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  // force a first frame of the blank tab
  await page.evaluate(() => { document.body.style.background = '#FFFFFE'; });
  await sleep(300);
}
t0 = frames.length ? frames[0][0] : now();
log('mark', 'start');

// Step 1: blank tab (the address bar is drawn and typed by the video), then the site.
await sleep(4200);
log('goto', '/login');
await page.goto('/login');
await settled(3200);
log('mark', 'login-settled');

// Step 2: sign in with email + password.
const email = page.locator('input[type=email]');
await clickOn(email, 'email');
await sleep(250);
log('type', 'email');
await page.keyboard.type(st.owner.email, { delay: 55 });
await sleep(700);
await clickOn(page.locator('input[type=password]'), 'password', { fx: 0.3 });
await sleep(250);
log('type', 'password');
await page.keyboard.type(st.password, { delay: 60 });
await sleep(900);
await clickOn(page.locator('form button[type=submit]'), 'sign-in');
await page.waitForURL(/\/circles\/[0-9a-f-]{36}/, { timeout: 30000 });
log('mark', 'home');
await settled(4200);

// Step 3: the circle opens; All circles lists every circle; click it to open.
await clickOn(page.getByRole('button', { name: st.recipient }).first(), 'switcher');
await sleep(1600);
await clickOn(page.getByRole('menuitem', { name: L.all }).or(page.getByRole('link', { name: L.all })).first(), 'all-circles');
await page.waitForURL(/\/circles\/?$/, { timeout: 15000 });
log('mark', 'picker');
await settled(2600);
await clickOn(page.locator('main').getByText(st.recipient, { exact: true }).first(), 'circle-card');
await page.waitForURL(/\/circles\/[0-9a-f-]{36}/, { timeout: 15000 });
log('mark', 'home-again');
await settled(2400);

// Step 4: the side menu.
const side = page.locator('aside');
for (const name of L.nav) {
  await clickOn(side.getByRole('link', { name, exact: true }).first(), `nav:${name}`, { fx: 0.3, ms: 650 });
  await page.waitForTimeout(200);
  log('mark', `page:${name}`);
  await settled(2600);
}
// scroll the side menu (it scrolls on its own) to reach Members
const mb = await side.boundingBox();
await glide(mb.x + mb.width * 0.4, mb.y + mb.height * 0.62, 600);
log('wheel', 'sidebar');
for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 60); await sleep(40); }
await sleep(900);
await clickOn(side.getByRole('link', { name: L.members, exact: true }).first(), `nav:${L.members}`, { fx: 0.3, ms: 600 });
log('mark', `page:${L.members}`);
await settled(3600);
log('mark', 'end');

if (cdp) await cdp.send('Page.stopScreencast');
await sleep(300);
console.log('blocked third-party hosts:', [...new Set(blocked)].join(' ') || 'none');
await browser.close();

if (!DRY) {
  // ---- true-time CFR rebuild ------------------------------------------------------------------------------------
  const FPS = 30;
  const end = now() - t0;
  frames.sort((a, b) => a[0] - b[0]);
  const list = [];
  let j = 0;
  for (let k = 0; k < Math.ceil(end * FPS); k++) {
    const t = t0 + k / FPS;
    while (j + 1 < frames.length && frames[j + 1][0] <= t) j++;
    list.push(`file '${frames[j][1]}'\nduration ${(1 / FPS).toFixed(6)}`);
  }
  list.push(`file '${frames[j][1]}'`);
  const listFile = join(raw, 'list.txt');
  writeFileSync(listFile, list.join('\n') + '\n');
  const mov = join(outDir, `${lang}.mov`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p',
    '-r', String(FPS), '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-movflags', '+faststart', mov], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
  writeFileSync(join(outDir, `${lang}.actions.json`), JSON.stringify({ lang, fps: FPS, view: VIEW, tz: st.tz, duration: +end.toFixed(3), frames: frames.length, actions }, null, 1));
  console.log(`${frames.length} screencast frames -> ${mov} (${end.toFixed(1)} s)`);
  rmSync(raw, { recursive: true, force: true });
  void readdirSync;
}
