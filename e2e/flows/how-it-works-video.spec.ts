import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { loadEnv } from 'vite';
import { test, expect } from '@playwright/test';
import { checkA11y } from '../helpers';

// 1.4.3 "See how it works" video on /how-it-works (lib/previewVideo.ts; mock
// docs/mocks-143/preview-video). Maestro twin: mobile/.maestro/parity/auth/preview-video.yaml.
//
// The address is FIXED (no app config): {https Supabase base}/storage/v1/object/
// public/help-videos/preview-demo-{lang}-16x9.{mp4,jpg}. Every request to the
// bucket is answered by a route stub (production is never touched); the "video"
// is a 2 s VP9 sample (e2e/media), because Playwright's Chromium has no H.264.
//   P1 en -> preview-demo-en-16x9 plays muted + looping with its poster; the
//      pause / play control works; Get started -> Sign up; axe-clean.
//   P2 an es-MX browser -> preview-demo-es-16x9 (regional tag -> es).
//   N1 prefers-reduced-motion: no autoplay (paused on the poster) until Play.
//   N2 the file fails to load -> today's carousel, no dead frame.
//   N3 no app-config request, never an http: video URL, no URL in analytics.
// FALSIFY (PW_FALSIFY=how-it-works-video): the bucket stub answers 404, so P1's
// video assertions go red.

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(resolve(HERE, '../media/preview-sample.webm'));
const POSTER = readFileSync(resolve(HERE, '../media/preview-sample.jpg'));
const BUCKET = '/storage/v1/object/public/help-videos/';
// The video exists only in a build whose VITE_SUPABASE_URL is https (lib/previewVideo.ts, 2f6daf3): a local http
// Supabase (the default dev / e2e server) shows the carousel instead. The same env Vite serves is read here, so the
// video cases run where the build has a video and skip (N4 runs instead) where it cannot. To run them locally:
//   VITE_SUPABASE_URL=https://e2e-video.invalid npx vite --port 5199 --strictPort
//   VITE_SUPABASE_URL=https://e2e-video.invalid PW_BASE_URL=http://localhost:5199 \
//     npx playwright test e2e/flows/how-it-works-video.spec.ts --project=chromium --no-deps
// (every bucket request is stubbed, so the host is never contacted).
const HAS_VIDEO = /^https:\/\//.test(loadEnv('development', process.cwd(), 'VITE_').VITE_SUPABASE_URL ?? '');
const NO_VIDEO_REASON = 'this build has a non-https VITE_SUPABASE_URL: /how-it-works shows the carousel (see N4)';

const FILE_RE = /^https:\/\/[^/]+\/storage\/v1\/object\/public\/help-videos\/preview-demo-/;

test.use({ storageState: { cookies: [], origins: [] } });

async function serveVideo(page: Page, opts: { broken?: boolean } = {}): Promise<string[]> {
  const requested: string[] = [];
  await page.route(`**${BUCKET}**`, (route) => {
    const url = new URL(route.request().url());
    requested.push(url.href);
    if (url.pathname.endsWith('.jpg')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: POSTER });
    if (opts.broken) return route.fulfill({ status: 404, body: 'gone' });
    return route.fulfill({ status: 200, contentType: 'video/webm', body: SAMPLE });
  });
  return requested;
}

const videoEl = (page: Page) => page.getByTestId('preview-video').locator('video');

test('P1: the fixed en 16:9 file plays muted and looping, pauses, and Get started opens Sign up', async ({
  page,
}, testInfo) => {
  test.skip(!HAS_VIDEO, NO_VIDEO_REASON);
  const requested = await serveVideo(page, { broken: FALSIFY.has('how-it-works-video') });
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'See CircleCare in action' })).toBeVisible({
    timeout: 20_000,
  });
  const video = videoEl(page);
  await expect(video).toHaveAttribute('src', new RegExp(`${FILE_RE.source}en-16x9\\.mp4$`));
  await expect(video).toHaveAttribute('poster', new RegExp(`${FILE_RE.source}en-16x9\\.jpg$`));
  expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop, v.playsInline])).toEqual([true, true, true]);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused), { timeout: 15_000 }).toBe(true);
  expect(requested.some((u) => u.endsWith(`${BUCKET}preview-demo-en-16x9.mp4`))).toBe(true);
  await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pause video' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('button', { name: 'Play video' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);

  await checkA11y(page, '/how-it-works#video', testInfo, { wcag22: true });

  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test('N1: prefers-reduced-motion never autoplays; Play starts it', async ({ page }) => {
  test.skip(!HAS_VIDEO, NO_VIDEO_REASON);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await serveVideo(page);
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });

  const video = videoEl(page);
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect(video).toHaveAttribute('poster', /preview-demo-en-16x9\.jpg$/);
  await page.waitForTimeout(1500);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('button', { name: 'Play video' }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused), { timeout: 15_000 }).toBe(true);
});

test('N2: a file that fails to load hands over to the carousel', async ({ page }) => {
  await serveVideo(page, { broken: true });
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Medication schedule' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('preview-video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
});

test.describe('P2: a Spanish browser (es-MX)', () => {
  test.use({ locale: 'es-MX' });
  test('gets preview-demo-es-16x9', async ({ page }) => {
    test.skip(!HAS_VIDEO, NO_VIDEO_REASON);
    await serveVideo(page);
    await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
    await expect(videoEl(page)).toHaveAttribute('src', new RegExp(`${FILE_RE.source}es-16x9\\.mp4$`), {
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Mira CircleCare en acción' })).toBeVisible();
  });
});

test('N3: no app-config request, never an http: URL, no URL in analytics', async ({ page }) => {
  test.skip(!HAS_VIDEO, NO_VIDEO_REASON);
  const apiCalls: string[] = [];
  const posthogBodies: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) apiCalls.push(url.pathname);
    if (/posthog|\/(e|i\/v0\/e|batch)\/?$/.test(url.href)) posthogBodies.push(req.postData() ?? '');
  });
  await serveVideo(page);
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
  const video = videoEl(page);
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused), { timeout: 15_000 }).toBe(true);
  const src = await video.getAttribute('src');
  const poster = await video.getAttribute('poster');
  expect(src).toMatch(/^https:\/\//);
  expect(poster).toMatch(/^https:\/\//);
  expect(apiCalls.filter((p) => p.startsWith('/api/app-config'))).toEqual([]);
  for (const body of posthogBodies) expect(body).not.toContain('help-videos');
});

test('N4: a build with a non-https storage base shows the carousel and never asks the bucket for a video', async ({
  page,
}) => {
  test.skip(HAS_VIDEO, 'this build has an https storage base: the video cases above run instead');
  const requested = await serveVideo(page);
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Medication schedule' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
  await expect(page.getByTestId('preview-video')).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);
  expect(requested, 'no request to the help-videos bucket').toEqual([]);
});
