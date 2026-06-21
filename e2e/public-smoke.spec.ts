import { test } from '@playwright/test';
import { PUBLIC_ROUTES } from './routes';
import { visitAndCheck, expectNoRuntimeErrors, checkA11y } from './helpers';

// Public-route crawl — runs with NO stored session so the auth pages render in
// their logged-out state (an authenticated session would redirect them away).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('public route crawl', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`crawl ${route}`, async ({ page }, testInfo) => {
      const result = await visitAndCheck(page, route);
      expectNoRuntimeErrors(result);
      await checkA11y(page, route, testInfo);
    });
  }
});
