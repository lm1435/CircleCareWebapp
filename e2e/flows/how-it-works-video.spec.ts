import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { checkA11y } from '../helpers';

// 1.4.3 "See how it works" video on /how-it-works (lib/previewVideo.ts; mock
// docs/mocks-143/preview-video). Maestro twin: mobile/.maestro/parity/auth/preview-video.yaml.
//
// The app config is answered by a route stub (the local app_settings rows are
// normally empty, and the production URLs are never touched); the "video" is a
// 2 s VP9 sample (e2e/media) served for the derived 16:9 URL, because
// Playwright's Chromium has no H.264.
//   P1 the app-language key -> the 16:9 cut plays muted + looping with its
//      poster; the pause / play control works; Get started -> Sign up; axe-clean.
//   N1 prefers-reduced-motion: no autoplay (paused on the poster) until Play.
//   N2 the source fails to load -> today's carousel, no dead frame.
//   N3 no key configured -> the carousel.
// FALSIFY (PW_FALSIFY=how-it-works-video): the config stub serves no key, so
// P1's video assertions go red.

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));
const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(resolve(HERE, '../media/preview-sample.webm'));
const POSTER = readFileSync(resolve(HERE, '../media/preview-sample.jpg'));
const ORIGIN = 'https://video.e2e.invalid';
const EN_URL = `${ORIGIN}/help-videos/preview-demo-en-4x5.mp4`;

test.use({ storageState: { cookies: [], origins: [] } });

async function stubConfig(page: Page, data: Record<string, string>): Promise<void> {
  await page.route('**/api/app-config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
  );
}

async function serveVideo(page: Page, opts: { broken?: boolean } = {}): Promise<string[]> {
  const requested: string[] = [];
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    if (path.endsWith('.jpg')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: POSTER });
    if (opts.broken) return route.fulfill({ status: 404, body: 'gone' });
    return route.fulfill({ status: 200, contentType: 'video/webm', body: SAMPLE });
  });
  return requested;
}

const videoEl = (page: Page) => page.getByTestId('preview-video').locator('video');

test('P1: the language cut plays muted and looping, pauses, and Get started opens Sign up', async ({
  page,
}, testInfo) => {
  await stubConfig(page, FALSIFY.has('how-it-works-video') ? {} : { preview_video_url_en: EN_URL });
  const requested = await serveVideo(page);
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { level: 1, name: 'See CircleCare in action' })).toBeVisible({
    timeout: 20_000,
  });
  const video = videoEl(page);
  await expect(video).toHaveAttribute('src', `${ORIGIN}/help-videos/preview-demo-en-16x9.mp4`);
  await expect(video).toHaveAttribute('poster', `${ORIGIN}/help-videos/preview-demo-en-16x9.jpg`);
  expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop, v.playsInline])).toEqual([true, true, true]);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused), { timeout: 15_000 }).toBe(true);
  expect(requested).toContain('/help-videos/preview-demo-en-16x9.mp4');
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubConfig(page, { preview_video_url_en: EN_URL });
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

test('N2: a source that fails to load hands over to the carousel', async ({ page }) => {
  await stubConfig(page, { preview_video_url_en: EN_URL });
  await serveVideo(page, { broken: true });
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Medication schedule' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('preview-video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
});

test('N3: no key configured -> the carousel', async ({ page }) => {
  await stubConfig(page, {});
  const requested = await serveVideo(page);
  await page.goto('/how-it-works', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Medication schedule' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('preview-video')).toHaveCount(0);
  expect(requested).toEqual([]);
});
