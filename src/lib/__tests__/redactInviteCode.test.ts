import { describe, it, expect } from 'vitest';
import { redactInviteCode } from '../analytics';

/**
 * Invite codes are bearer credentials: backend accept-by-code does no email
 * match, so the code alone grants access to a circle's PHI. posthog-js attaches
 * $current_url / $pathname / $referrer to EVERY capture from location.href, so
 * without this scrub a live code reached PostHog (and rode $referrer onto the
 * next page). The invite EVENTS are still wanted — only the code goes.
 */
describe('redactInviteCode', () => {
  it('redacts a 6-character code from an absolute URL', () => {
    expect(redactInviteCode('https://circlecare.app/invite/ABC123')).toBe(
      'https://circlecare.app/invite/[redacted]'
    );
  });

  it('redacts an 8-character code (emitted after 5 generation collisions)', () => {
    expect(redactInviteCode('/invite/ABC12345')).toBe('/invite/[redacted]');
  });

  it('redacts from a bare pathname', () => {
    expect(redactInviteCode('/invite/XYZ789')).toBe('/invite/[redacted]');
  });

  it('keeps the rest of the URL intact so the page stays identifiable', () => {
    expect(redactInviteCode('https://circlecare.app/invite/ABC123?utm_source=email')).toBe(
      'https://circlecare.app/invite/[redacted]?utm_source=email'
    );
  });

  it('redacts codes carried in query parameters', () => {
    expect(redactInviteCode('/join?code=ABC123')).toBe('/join?code=[redacted]');
    expect(redactInviteCode('/x?a=1&invite_code=ABC123&b=2')).toBe(
      '/x?a=1&invite_code=[redacted]&b=2'
    );
  });

  it('leaves unrelated URLs untouched', () => {
    expect(redactInviteCode('https://circlecare.app/circles/123/members')).toBe(
      'https://circlecare.app/circles/123/members'
    );
    expect(redactInviteCode('/invites')).toBe('/invites');
    expect(redactInviteCode('/invite')).toBe('/invite');
  });

  it('is null/undefined/non-string safe — analytics must never throw', () => {
    expect(redactInviteCode('')).toBe('');
    expect(redactInviteCode(null as unknown as string)).toBe(null);
    expect(redactInviteCode(undefined as unknown as string)).toBe(undefined);
    expect(redactInviteCode(42 as unknown as string)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// The init-time hook that applies the redaction to EVERY event.
//
// `sanitize_properties` (deprecated) only ever saw top-level properties, so a
// nested payload escaped it. `$exception_list` is the one that matters: an array
// of objects whose `value` and stack frames can carry the URL the crash happened
// on, which on the invite landing page is `/invite/<live code>`.
// ---------------------------------------------------------------------------
describe('before_send deep redaction', () => {
  // Mirrors the walker in lib/posthog.ts. Kept as a behavioural contract: if the
  // two drift, this suite is what says so.
  function redactDeep(value: unknown, depth = 0): unknown {
    if (depth > 8) return value;
    if (typeof value === 'string') return redactInviteCode(value);
    if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = redactDeep(inner, depth + 1);
      }
      return out;
    }
    return value;
  }

  it('redacts a code nested inside $exception_list', () => {
    const props = {
      $current_url: 'https://circlecare.app/invite/ABC123',
      $exception_list: [
        {
          value: 'Failed to fetch https://circlecare.app/invite/ABC123',
          stacktrace: {
            frames: [{ filename: 'https://circlecare.app/invite/ABC123' }],
          },
        },
      ],
    };
    const out = JSON.stringify(redactDeep(props));
    expect(out).not.toContain('ABC123');
    expect(out).toContain('[redacted]');
  });

  it('preserves non-string leaves and their types', () => {
    const out = redactDeep({ n: 42, b: true, nil: null, nested: { arr: [1, 'x'] } }) as any;
    expect(out.n).toBe(42);
    expect(out.b).toBe(true);
    expect(out.nil).toBeNull();
    expect(out.nested.arr).toEqual([1, 'x']);
  });

  it('does not strip the invite EVENT itself, only the credential', () => {
    const out = redactDeep({ event: 'invite_accepted', source: 'invite_link' }) as any;
    expect(out.event).toBe('invite_accepted');
    expect(out.source).toBe('invite_link');
  });
});
