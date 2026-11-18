// The Notifications inbox is ALWAYS on (owner decision 2026-11-17). There is no flag:
// a production build whose env lost (or flipped) VITE_NOTIFICATIONS_INBOX must still
// show the bell and serve both inbox routes.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as inbox from '@/lib/notificationsInbox';

const WEBAPP = join(__dirname, '..', '..', '..');
const SRC = join(WEBAPP, 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'test' || e.name === 'node_modules') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('notifications inbox: always on', () => {
  it('POSITIVE: the router serves /notifications and /circles/:id/notifications with no gate', () => {
    const router = readFileSync(join(SRC, 'router.tsx'), 'utf8');
    expect(router).toMatch(/\{ path: '\/notifications', element: <NotificationsPage \/> \}/);
    expect(router).toMatch(/\{ path: 'notifications', element: <CircleNotificationsPage \/> \}/);
    for (const page of ['pages/NotificationsPage.tsx', 'pages/CircleNotificationsPage.tsx']) {
      const src = readFileSync(join(SRC, page), 'utf8');
      // The only redirect left is the missing-circleId guard; never one to hide the inbox.
      expect(src).not.toMatch(/isInboxEnabled|import\.meta\.env/);
    }
  });

  it('NEGATIVE: the module exposes no flag a build env could switch off', () => {
    expect('isInboxEnabled' in inbox).toBe(false);
    expect('inboxFlagValue' in inbox).toBe(false);
  });

  it('GUARD: no source file or build config reads VITE_NOTIFICATIONS_INBOX', () => {
    const files = [
      ...sourceFiles(SRC),
      ...['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'index.html', '.env.example']
        .map((f) => join(WEBAPP, f))
        .filter((f) => existsSync(f)),
    ];
    const offenders = files.filter((f) => /NOTIFICATIONS_INBOX/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
