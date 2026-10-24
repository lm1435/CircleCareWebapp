/**
 * Shared browser setup for the web how-to recordings (use-on-a-computer). See help-videos/RECIPE.md "Web video".
 *
 * - Chromium, headless, 1280x720 CSS viewport at deviceScaleFactor 1.5 = 1920x1080 frames: the desktop layout (side
 *   menu) at a text size that stays readable when the frame is drawn into the video's browser window.
 * - Fresh context every run: no profile, bookmarks, extensions or saved passwords. Light colour scheme. Locale and
 *   time zone = the demo circle's (state/web-<lang>.json), so the app shows no zone suffix.
 * - The Vite server is started with vite.howto.config.ts on :5298 (its proxy sends the Origin the :4298 backend's
 *   cookie-login allowlist accepts; see that file).
 * - Analytics: the Vite server is started with VITE_POSTHOG_KEY empty (analytics off), and every request to a
 *   non-local host is ABORTED and logged, so nothing reaches PostHog, RevenueCat or any third party.
 * - A drawn mouse pointer (DOM overlay, pointer-events none) follows real mouse moves, so the footage shows a cursor.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'package.json'));
export const { chromium } = require('playwright');

export const VIEW = { width: 1280, height: 720 };
export const DSF = 1.5;

export const state = (lang) => JSON.parse(readFileSync(join(here, 'state', `web-${lang}.json`), 'utf8'));

const CURSOR = `
(() => {
  const mk = () => {
    if (document.getElementById('__howto_cursor')) return;
    const d = document.createElement('div');
    d.id = '__howto_cursor';
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);will-change:transform';
    d.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L7.5 18.8 L11.4 27.6 L15 26 L11.2 17.4 L18.6 17.4 Z" fill="#1A1916" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(d);
    const p = window.__howtoPos || [-100, -100];
    d.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)';
  };
  window.addEventListener('mousemove', (e) => {
    window.__howtoPos = [e.clientX, e.clientY];
    const d = document.getElementById('__howto_cursor');
    if (d) d.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk();
  new MutationObserver(mk).observe(document, { childList: true, subtree: false });
})();`;

export async function open({ lang, baseURL, log = console.log }) {
  const st = state(lang);
  const locale = lang === 'es' ? 'es-MX' : 'en-US';
  // --lang as well as the context locale: Chromium formats native <input type=date> by the BROWSER language, so without
  // it the Spanish Notes date read 10/23/2026 instead of 23/10/2026.
  const browser = await chromium.launch({ headless: true, args: [`--lang=${locale}`] });
  const context = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: DSF, locale, timezoneId: st.tz,
    colorScheme: 'light', reducedMotion: 'no-preference', baseURL,
  });
  await context.addInitScript(CURSOR);
  const blocked = [];
  await context.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) { blocked.push(u.host); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  return { browser, context, page, st, blocked };
}

/** Glide the pointer to an element's centre (or a fraction of it) like a person would, then pause. */
export async function moveTo(page, locator, { steps = 28, fx = 0.5, fy = 0.5 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${locator}`);
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  await page.mouse.move(x, y, { steps });
  return { x, y };
}
