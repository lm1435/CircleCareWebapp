import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Analytics } from '@/lib/analytics';
import {
  __resetEmailLinkLandingForTests,
  emailLinkType,
  hasEmailLinkItemTarget,
  markEmailLinkNeededLogin,
  reportEmailLinkLanding,
} from '../emailLinkLanding';

let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sessionStorage.clear();
  __resetEmailLinkLandingForTests();
  spy = vi.spyOn(Analytics, 'emailLinkOpened').mockImplementation(() => undefined);
});
afterEach(() => spy.mockRestore());

describe('emailLinkType', () => {
  it.each([
    'welcome',
    'welcome_caregiver',
    'weekly_digest',
    'trial_reminder',
    'drip_d1_first_entry',
    'drip_d4_team_checkin',
  ])('keeps the known src %s', (src) => {
    expect(emailLinkType(src)).toBe(src);
  });

  it.each(['', 'Mom Smith', 'drip_d9_nope', 'a@b.com', 'weekly_digest2'])(
    'buckets %j as other (free text never reaches analytics)',
    (src) => {
      expect(emailLinkType(src)).toBe('other');
    }
  );
});

describe('reportEmailLinkLanding', () => {
  it('fires once with enum + boolean props only', () => {
    reportEmailLinkLanding({
      pathname: '/circles/c-1',
      search: '?src=weekly_digest',
      landed: true,
      targetFound: true,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      type: 'weekly_digest',
      appState: 'signed_in',
      landed: true,
      targetFound: true,
    });
    // No id, date or free text anywhere in the payload.
    expect(JSON.stringify(spy.mock.calls[0])).not.toMatch(/c-1/);
  });

  it('reports a gone target with target_found false', () => {
    reportEmailLinkLanding({
      pathname: '/circles/c-1/calendar',
      search: '?date=2026-06-12&eventId=ev-1&src=weekly_digest',
      landed: true,
      targetFound: false,
    });
    expect(spy).toHaveBeenCalledWith({
      type: 'weekly_digest',
      appState: 'signed_in',
      landed: true,
      targetFound: false,
    });
  });

  it('is silent without ?src=', () => {
    reportEmailLinkLanding({ pathname: '/circles/c-1', search: '', landed: true, targetFound: true });
    reportEmailLinkLanding({
      pathname: '/circles/c-1',
      search: '?utm_source=x&src=',
      landed: true,
      targetFound: true,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('fires ONE event per link, even when the page scrubs its item params afterwards', () => {
    const base = { pathname: '/circles/c-1/calendar', landed: true, targetFound: false };
    reportEmailLinkLanding({ ...base, search: '?eventId=ev-1&src=weekly_digest' });
    // The page deleted eventId; the layout re-reports with what is left.
    reportEmailLinkLanding({ ...base, targetFound: true, search: '?src=weekly_digest' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ targetFound: false });
  });

  it('a different link in the same page load is reported separately', () => {
    reportEmailLinkLanding({ pathname: '/circles/c-1', search: '?src=welcome', landed: true, targetFound: true });
    reportEmailLinkLanding({ pathname: '/circles/c-2', search: '?src=welcome', landed: true, targetFound: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('an unknown src is bucketed as other', () => {
    reportEmailLinkLanding({ pathname: '/circles', search: '?src=Pat%20Rivera', landed: true, targetFound: true });
    expect(spy.mock.calls[0][0]).toMatchObject({ type: 'other' });
  });
});

describe('signed_out: the visitor had to log in first', () => {
  const path = '/circles/c-1/meds?medication=m-1&src=weekly_digest';

  it('reports signed_out once, for the exact link LoginPage parked', () => {
    markEmailLinkNeededLogin(`${path}#x`);
    reportEmailLinkLanding({
      pathname: '/circles/c-1/meds',
      search: '?medication=m-1&src=weekly_digest',
      landed: true,
      targetFound: true,
    });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ appState: 'signed_out' }));
    expect(sessionStorage.length).toBe(0);
  });

  it('a marker for another link never tags this one', () => {
    markEmailLinkNeededLogin('/circles/c-9?src=welcome');
    reportEmailLinkLanding({ pathname: '/circles/c-1', search: '?src=welcome', landed: true, targetFound: true });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ appState: 'signed_in' }));
  });

  it('a login redirect that is not an email link parks nothing', () => {
    markEmailLinkNeededLogin('/circles/c-1/meds');
    expect(sessionStorage.length).toBe(0);
  });
});

describe('hasEmailLinkItemTarget', () => {
  it.each([
    ['/circles/c-1/calendar', '?eventId=e&src=x', true],
    ['/circles/c-1/calendar', '?src=x', false],
    ['/circles/c-1/meds', '?medication=m', true],
    ['/circles/c-1/meds', '?tab=history', false],
    ['/circles/c-1/notes', '?date=2026-06-12', true],
    ['/circles/c-1/daily-update/2026-06-12', '', true],
    ['/circles/c-1/daily-update', '', true],
    ['/circles/c-1', '?src=weekly_digest', false],
    ['/circles', '?src=welcome', false],
  ])('%s%s -> %s', (pathname, search, expected) => {
    expect(hasEmailLinkItemTarget(pathname, search)).toBe(expected);
  });
});
