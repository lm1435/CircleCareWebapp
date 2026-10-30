import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumePendingReturnPath,
  isSafeReturnPath,
  setPendingReturnPath,
  toReturnPath,
} from '../returnPath';

beforeEach(() => sessionStorage.clear());

describe('isSafeReturnPath', () => {
  it.each([
    '/circles',
    '/circles/c-1/calendar?date=2026-06-12&eventId=ev-1&src=weekly_digest#notes',
    '/invite/ABC234',
    '/circles/c-1/daily-update/2026-06-12',
  ])('accepts the same-origin relative path %s', (p) => {
    expect(isSafeReturnPath(p)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['no leading slash', 'circles'],
    ['protocol-relative', '//evil.example'],
    ['protocol-relative with path', '//evil.example/circles'],
    ['slash-backslash', '/\\evil.example'],
    ['backslash inside', '/circles\\..\\x'],
    ['absolute https', 'https://evil.example'],
    ['absolute http', 'http://evil.example/circles'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,x'],
    ['newline', '/circles\n//evil.example'],
    ['tab', '/\t/evil.example'],
    ['login loop', '/login'],
    ['login with query', '/login?x=1'],
    ['oauth callback', '/auth/callback?code=1'],
    ['not a string', 42],
    ['null', null],
  ])('rejects %s', (_label, p) => {
    expect(isSafeReturnPath(p as unknown)).toBe(false);
  });

  it('rejects an absurdly long value', () => {
    expect(isSafeReturnPath(`/${'a'.repeat(3000)}`)).toBe(false);
  });
});

describe('toReturnPath', () => {
  it('joins pathname + search + hash', () => {
    expect(toReturnPath({ pathname: '/circles/c-1', search: '?a=1', hash: '#x' })).toBe(
      '/circles/c-1?a=1#x'
    );
  });
  it('is null for a missing or unsafe location', () => {
    expect(toReturnPath(null)).toBeNull();
    expect(toReturnPath({ pathname: '//evil.example' })).toBeNull();
    expect(toReturnPath({ pathname: '/login' })).toBeNull();
  });
});

describe('pending return path storage', () => {
  it('round-trips once: read AND clear', () => {
    setPendingReturnPath('/circles/c-1?src=weekly_digest');
    expect(consumePendingReturnPath()).toBe('/circles/c-1?src=weekly_digest');
    expect(consumePendingReturnPath()).toBeNull();
  });

  it('never stores an unsafe path, and clears a stale one', () => {
    setPendingReturnPath('/circles/old');
    setPendingReturnPath('//evil.example');
    expect(consumePendingReturnPath()).toBeNull();
  });

  it('null clears', () => {
    setPendingReturnPath('/circles/c-1');
    setPendingReturnPath(null);
    expect(consumePendingReturnPath()).toBeNull();
  });

  it('refuses a value tampered into storage', () => {
    sessionStorage.setItem('cc_pending_return_path', '//evil.example');
    expect(consumePendingReturnPath()).toBeNull();
    expect(sessionStorage.getItem('cc_pending_return_path')).toBeNull();
  });
});
