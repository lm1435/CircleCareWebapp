import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  captureSignupAttribution,
  getSignupAttribution,
  getSignupAttributionProps,
} from '../signupAttribution';
import { setPendingInviteCode } from '../pendingInviteCode';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('captureSignupAttribution', () => {
  it('captures utm/src/ref and is first-touch', () => {
    captureSignupAttribution('?utm_source=fb&utm_medium=cpc&utm_campaign=oct&src=welcome', '/');
    captureSignupAttribution('?utm_source=other&utm_campaign=new', '/');
    const { signup_source_detail: d } = getSignupAttribution();
    expect(d).toMatchObject({ utm_source: 'fb', utm_medium: 'cpc', utm_campaign: 'oct' });
  });

  it('fills fields missing on first touch without overwriting', () => {
    captureSignupAttribution('?utm_source=fb', '/');
    captureSignupAttribution('?utm_source=x&utm_medium=cpc', '/');
    expect(getSignupAttribution().signup_source_detail).toMatchObject({
      utm_source: 'fb',
      utm_medium: 'cpc',
    });
  });

  it('tolerates throwing storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => captureSignupAttribution('?utm_source=fb', '/')).not.toThrow();
    expect(getSignupAttribution().signup_source).toBe('web');
  });

  it('ignores corrupt stored JSON and caps value length', () => {
    sessionStorage.setItem('cc_signup_attribution', '{nope');
    captureSignupAttribution(`?utm_source=${'a'.repeat(500)}`, '/');
    expect(getSignupAttribution().signup_source_detail.utm_source).toHaveLength(128);
  });
});

describe('source derivation', () => {
  it('plain web signup defaults to web with empty detail', () => {
    expect(getSignupAttribution()).toEqual({ signup_source: 'web', signup_source_detail: {} });
  });
  it('utm/ref -> web', () => {
    captureSignupAttribution('?ref=friend', '/');
    expect(getSignupAttribution().signup_source).toBe('web');
  });
  it('src -> email', () => {
    captureSignupAttribution('?src=welcome_cta&utm_source=x', '/');
    expect(getSignupAttribution().signup_source).toBe('email');
  });
  it('invite route beats src, boolean only, never the code', () => {
    captureSignupAttribution('?src=welcome', '/invite/ABC234');
    const a = getSignupAttribution();
    expect(a.signup_source).toBe('invite');
    expect(a.signup_source_detail.invite_code_present).toBe(true);
    expect(JSON.stringify(a)).not.toContain('ABC234');
    expect(JSON.stringify(sessionStorage)).not.toContain('ABC234');
  });
  it('parked pending invite code counts as invite', () => {
    setPendingInviteCode('ABC234');
    const a = getSignupAttribution();
    expect(a.signup_source).toBe('invite');
    expect(JSON.stringify(a)).not.toContain('ABC234');
  });
});

describe('analytics props', () => {
  it('is conservative: source + utm/src only', () => {
    captureSignupAttribution('?utm_source=fb&ref=r', '/invite/ABC234');
    expect(getSignupAttributionProps()).toEqual({ source: 'invite', utm_source: 'fb' });
  });
});
