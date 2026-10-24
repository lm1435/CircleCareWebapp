import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDarkModeBuild } from '../darkModeBuildFlag';

// Dark mode ships ON in production builds (1.3.0); VITE_DARK_MODE=false is the kill switch.
describe('isDarkModeBuild', () => {
  it('is ON when unset (dev server and `vite build` alike)', () => {
    expect(isDarkModeBuild(undefined)).toBe(true);
    expect(isDarkModeBuild('')).toBe(true);
  });
  it('is ON for VITE_DARK_MODE=true', () => {
    expect(isDarkModeBuild('true')).toBe(true);
  });
  it('VITE_DARK_MODE=false is the kill switch', () => {
    expect(isDarkModeBuild('false')).toBe(false);
  });
  it('vite.config.ts uses it and no longer keys the flag off the build command', () => {
    const src = readFileSync(join(__dirname, '../../../vite.config.ts'), 'utf8');
    expect(src).toMatch(/isDarkModeBuild\(env\.VITE_DARK_MODE\)/);
    expect(src).not.toMatch(/command === 'serve'/);
  });
});
