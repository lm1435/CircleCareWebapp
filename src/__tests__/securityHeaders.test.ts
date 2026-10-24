import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// public/.htaccess IS the production server config for my.circlecare.app
// (Namecheap LiteSpeed; Vite copies it into dist/). Every security header the
// web companion ships with lives in that one file, and nothing else checked it:
// a careless edit (an `'unsafe-inline'` for a quick script, a dropped
// frame-ancestors) would deploy silently.
//
// The CSP is load-bearing beyond the usual XSS story. The PDF exports print a
// HTML document built from circle members' free text in a same-origin `srcdoc`
// iframe (src/pdf/printHtml.ts), and a srcdoc document INHERITS this policy —
// so `script-src` without 'unsafe-inline' is what makes a template escaping
// miss inert instead of script running on our origin next to the in-memory
// access token. (web security audit 2026-10-17)

const htaccess = readFileSync(resolve(__dirname, '../../public/.htaccess'), 'utf8');

/** Value of `Header always set <name> "<value>"`, or null. */
function header(name: string): string | null {
  const re = new RegExp(`^\\s*Header\\s+always\\s+set\\s+${name}\\s+"([^"]*)"`, 'mi');
  return re.exec(htaccess)?.[1] ?? null;
}

function cspDirectives(): Map<string, string[]> {
  const csp = header('Content-Security-Policy');
  if (csp === null) throw new Error('no Content-Security-Policy header in public/.htaccess');
  const map = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), values);
  }
  return map;
}

describe('production security headers (public/.htaccess)', () => {
  it('CSP: scripts only from self + named hosts — no inline, eval, data:, blob: or wildcards', () => {
    const csp = cspDirectives();
    const scriptSrc = csp.get('script-src');
    expect(scriptSrc, 'script-src must be explicit (never fall back to a looser default-src)').toBeDefined();
    expect(scriptSrc).toContain("'self'");
    for (const banned of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", 'data:', 'blob:', '*', 'http:', 'https:']) {
      expect(scriptSrc, `script-src must not allow ${banned}`).not.toContain(banned);
    }
    for (const source of scriptSrc!) {
      expect(source, `script-src host ${source} must be https and not a wildcard host`).toMatch(
        /^('self'|https:\/\/[a-z0-9.-]+)$/
      );
    }
    expect(csp.get('default-src')).toEqual(["'self'"]);
  });

  it('CSP: no plugins, no <base> hijack, no framing, forms post to self only', () => {
    const csp = cspDirectives();
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.has('upgrade-insecure-requests')).toBe(true);
    for (const directive of ['connect-src', 'img-src', 'frame-src', 'media-src']) {
      expect(csp.get(directive), `${directive} must not be a bare wildcard`).not.toContain('*');
    }
  });

  it('CSP: help videos and posters load from the Supabase host (media-src + img-src), nowhere else', () => {
    const csp = cspDirectives();
    expect(csp.get('media-src')).toEqual(["'self'", 'https://*.supabase.co']);
    expect(csp.get('img-src')).toContain('https://*.supabase.co');
  });

  it('HSTS (>= 1 year, includeSubDomains), nosniff, DENY framing, referrer policy', () => {
    const hsts = header('Strict-Transport-Security') ?? '';
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    expect(hsts).toMatch(/includeSubDomains/);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Permissions-Policy')).toMatch(/camera=\(\)/);
  });

  it('no directory listings, and entry documents are never cached', () => {
    expect(htaccess).toMatch(/^Options -Indexes$/m);
    expect(htaccess).toMatch(
      /<FilesMatch "\^index[^"]*\\\.html\$">\s*\n\s*Header set Cache-Control "no-cache, no-store, must-revalidate"/
    );
  });
});
