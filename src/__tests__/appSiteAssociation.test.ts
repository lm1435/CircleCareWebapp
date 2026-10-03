import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The iOS app claims these web URLs via public/.well-known/apple-app-site-association,
// so a user with the app installed who taps one (e.g. from an email) lands in the app.
// The mobile linking config (mobile/src/navigation/linkingConfig.ts) resolves each of
// these paths; the Android intent filters (mobile/app.config.js) claim the same set.
// Dropping one here silently sends iPhone users to the browser instead.
const CIRCLE_APP_PATHS = [
  '/circles/*/calendar',
  '/circles/*/activity',
  '/circles/*/meds',
  '/circles/*/notes',
  '/circles/*/emergency',
];

const aasaPath = resolve(__dirname, '../../public/.well-known/apple-app-site-association');

function readAasa() {
  return JSON.parse(readFileSync(aasaPath, 'utf8')) as {
    applinks: { details: { appID: string; paths: string[] }[] };
  };
}

describe('apple-app-site-association', () => {
  it('is valid JSON for the CircleCare app id', () => {
    const aasa = readAasa();
    expect(aasa.applinks.details).toHaveLength(1);
    expect(aasa.applinks.details[0].appID).toBe('68Y4NLQ3VS.com.circlecare.circlecare');
  });

  it('keeps the invite and open paths', () => {
    const { paths } = readAasa().applinks.details[0];
    expect(paths).toEqual(expect.arrayContaining(['/invite/*', '/open', '/open/*']));
  });

  it('claims every circle screen the app can open', () => {
    const { paths } = readAasa().applinks.details[0];
    expect(paths).toEqual(expect.arrayContaining(CIRCLE_APP_PATHS));
  });

  it('does not claim circle pages the app cannot route (they would open the app to nothing)', () => {
    const { paths } = readAasa().applinks.details[0];
    for (const p of ['/circles/*', '/circles/*/tasks', '/circles/*/documents', '/circles/*/vitals']) {
      expect(paths).not.toContain(p);
    }
  });
});
