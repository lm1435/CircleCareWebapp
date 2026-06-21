import { expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Shared crawl helpers: visit a route, prove it didn't error, prove it's not a
// white screen, and run an axe accessibility scan.

// Console messages / page exceptions that are environmental noise rather than
// app bugs. Keep this list TIGHT — every entry is a thing the crawl will no
// longer catch, so justify each one.
const CONSOLE_IGNORE: RegExp[] = [
  /favicon/i, // browser auto-requests /favicon; not an app error
  /Download the React DevTools/i, // dev-only advisory
  /React Router Future Flag/i, // router v7 migration notice (warn)
  /ResizeObserver loop/i, // benign, fires on layout thrash
  /\[vite\]/i, // HMR / dev-server chatter
  // Expected by design: cookie-mode auth keeps the access token in memory only,
  // so a fresh page load's first API call 401s, then the interceptor refreshes
  // from the httpOnly cookie and retries. The 401 resource-load is logged by the
  // browser but is not an app error. (A real auth failure surfaces as a redirect
  // to /login, which the "session is valid" test catches.)
  /Failed to load resource.*401/i,
];

// Axe rules to fail on, by impact. heading-order (the bug that prompted this
// suite) is "moderate", so we fail at moderate and above; "minor" is reported
// but not failed to avoid noise-driven flakiness.
const FAIL_IMPACTS = new Set(['moderate', 'serious', 'critical']);

export interface CrawlResult {
  route: string;
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Navigate to `route` and assert the page rendered without runtime errors and
 * isn't a blank white screen. Returns collected errors for the caller to assert
 * on (so one route's failure names the route).
 */
export async function visitAndCheck(page: Page, route: string): Promise<CrawlResult> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const onConsole = (msg: import('@playwright/test').ConsoleMessage): void => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_IGNORE.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  };
  const onPageError = (err: Error): void => {
    pageErrors.push(err.message);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    // Let React render + initial data settle. networkidle can hang on apps with
    // polling, so cap it and fall through.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    // White-screen guard: #root must render visible content. Poll (don't read
    // once) so we don't false-positive during the auth-bootstrap blank window
    // (401 → token refresh → retry) on a fresh page load.
    await expect
      .poll(async () => (await page.locator('#root').innerText().catch(() => '')).trim().length, {
        message: `Route ${route} rendered a blank #root (white screen)`,
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  return { route, consoleErrors, pageErrors };
}

/** Assert the crawl result had no runtime errors. */
export function expectNoRuntimeErrors(result: CrawlResult): void {
  expect(result.pageErrors, `Uncaught exceptions on ${result.route}`).toEqual([]);
  expect(result.consoleErrors, `Console errors on ${result.route}`).toEqual([]);
}

/**
 * Run an axe accessibility scan on the current page and fail on any violation
 * at moderate+ impact. Attaches the full violation list to the test report.
 */
export async function checkA11y(page: Page, route: string, testInfo: TestInfo): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();

  if (results.violations.length > 0) {
    await testInfo.attach(`axe-${route.replace(/\W+/g, '_')}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });
  }

  const failing = results.violations.filter((v) => FAIL_IMPACTS.has(v.impact ?? ''));
  const summary = failing
    .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join('\n');

  expect(failing, `a11y violations on ${route}:\n${summary}`).toEqual([]);
}
