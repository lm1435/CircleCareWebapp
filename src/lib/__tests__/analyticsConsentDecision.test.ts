import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ONE place a consent answer becomes client state.
 *
 * Both surfaces that can record an answer — the signup checkbox and the Profile
 * toggle — go through this, so the teardown/opt-in/identify sequence cannot
 * drift between them. Getting the sequence wrong is silent in every direction:
 * skip the teardown and a withdrawal transmits the batch it was meant to drop;
 * skip the re-init and an acceptance keeps running the anonymous client while
 * the UI reads ON.
 */

const disableAnalytics = vi.fn();
const initAnalytics = vi.fn();
const identifyUser = vi.fn();

vi.mock('@/lib/posthog', () => ({
  disableAnalytics: (...args: unknown[]) => disableAnalytics(...args),
  initAnalytics: (...args: unknown[]) => initAnalytics(...args),
  identifyUser: (...args: unknown[]) => identifyUser(...args),
}));

const calls: string[] = [];

beforeEach(async () => {
  localStorage.clear();
  calls.length = 0;
  disableAnalytics.mockReset().mockImplementation(() => void calls.push('disable'));
  initAnalytics.mockReset().mockImplementation(() => void calls.push('init'));
  identifyUser.mockReset().mockImplementation(() => void calls.push('identify'));
  const consent = await import('@/lib/analyticsConsent');
  consent.__resetAnalyticsConsentCache();
});

async function load() {
  const decision = await import('../analyticsConsentDecision');
  const consent = await import('@/lib/analyticsConsent');
  return { ...decision, ...consent };
}

describe('accepting', () => {
  it('records GRANTED and (re)configures the client', async () => {
    const { recordAnalyticsConsentDecision, getAnalyticsConsentState } = await load();

    recordAnalyticsConsentDecision(true);

    expect(getAnalyticsConsentState()).toBe('granted');
    expect(initAnalytics).toHaveBeenCalledTimes(1);
    expect(disableAnalytics).not.toHaveBeenCalled();
  });

  it('identifies when a user is already known', async () => {
    const { recordAnalyticsConsentDecision } = await load();

    recordAnalyticsConsentDecision(true, { id: 'u1' });

    // ID ONLY — the recorder no longer accepts or forwards an email.
    expect(identifyUser.mock.calls).toEqual([['u1']]);
    // Order matters: the client has to be configured and opted in before the
    // identify lands, or it is dropped/queued against an unconfigured SDK.
    expect(calls.indexOf('init')).toBeLessThan(calls.indexOf('identify'));
  });

  it('stamps the answer with the account that gave it', async () => {
    const { recordAnalyticsConsentDecision, getAnalyticsConsentOwner } = await load();

    recordAnalyticsConsentDecision(true, { id: 'u1' });

    // Without the stamp the answer is ownerless, and an ownerless answer is
    // ADOPTED by whichever account signs in next on this browser.
    expect(getAnalyticsConsentOwner()).toBe('u1');
  });

  it('leaves the answer ownerless when no user is known yet', async () => {
    const { recordAnalyticsConsentDecision, getAnalyticsConsentOwner, setAnalyticsConsentOwner } =
      await load();
    setAnalyticsConsentOwner('previous-account');

    recordAnalyticsConsentDecision(true);

    // A new answer never inherits the PREVIOUS account's stamp.
    expect(getAnalyticsConsentOwner()).toBeNull();
  });

  it('does not identify when no user is known yet (email signup has no session)', async () => {
    const { recordAnalyticsConsentDecision } = await load();

    recordAnalyticsConsentDecision(true);

    expect(identifyUser).not.toHaveBeenCalled();
  });
});

describe('declining', () => {
  it('records DECLINED — an answer, not an absence', async () => {
    const { recordAnalyticsConsentDecision, getAnalyticsConsentState, hasAnsweredAnalyticsConsent } =
      await load();

    expect(getAnalyticsConsentState()).toBe('unasked');
    recordAnalyticsConsentDecision(false);

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(hasAnsweredAnalyticsConsent()).toBe(true);
  });

  it('never identifies and never opts in', async () => {
    const { recordAnalyticsConsentDecision } = await load();

    recordAnalyticsConsentDecision(false, { id: 'u1' });

    expect(identifyUser).not.toHaveBeenCalled();
    expect(initAnalytics).not.toHaveBeenCalled();
  });

  it('stamps a DECLINE with the account that gave it, just as a grant is', async () => {
    const { recordAnalyticsConsentDecision, getAnalyticsConsentOwner } = await load();

    recordAnalyticsConsentDecision(false, { id: 'u1' });

    // An unowned decline would be adopted by whoever signs in next.
    expect(getAnalyticsConsentOwner()).toBe('u1');
  });

  /**
   * TEARDOWN ONLY WHEN THERE IS SOMETHING TO TEAR DOWN.
   *
   * `disableAnalytics` calls posthog's `reset()`, which DROPS THE PENDING
   * QUEUE. At signup the visitor was 'unasked' — already on the anonymous
   * client — and the queue holds their `signup_started`. Resetting there
   * deletes a funnel event to withdraw a consent that was never given.
   */
  it('does NOT tear down when moving from UNASKED to DECLINED', async () => {
    const { recordAnalyticsConsentDecision } = await load();

    recordAnalyticsConsentDecision(false);

    expect(disableAnalytics).not.toHaveBeenCalled();
  });

  it('DOES tear down when withdrawing an existing GRANT', async () => {
    const { recordAnalyticsConsentDecision, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);

    recordAnalyticsConsentDecision(false);

    expect(disableAnalytics).toHaveBeenCalledTimes(1);
    expect(getAnalyticsConsentState()).toBe('declined');
  });

  it('tears down BEFORE the new value is persisted', async () => {
    const { recordAnalyticsConsentDecision, setAnalyticsConsent } = await load();
    setAnalyticsConsent(true);
    // `disableAnalytics` resolves the declined mode from the answer being
    // GIVEN, and the emit-path gate re-reads storage per event — so anything
    // still queued must be dropped while the stored state still says granted.
    let stateAtTeardown: string | null = null;
    disableAnalytics.mockImplementation(() => {
      stateAtTeardown = localStorage.getItem('cc_analytics_enabled');
    });

    recordAnalyticsConsentDecision(false);

    expect(stateAtTeardown).toBe('true');
    expect(localStorage.getItem('cc_analytics_enabled')).toBe('false');
  });
});

describe('re-recording the same answer', () => {
  it('a repeated GRANT is idempotent in storage', async () => {
    const { recordAnalyticsConsentDecision, getAnalyticsConsentState } = await load();
    recordAnalyticsConsentDecision(true);
    recordAnalyticsConsentDecision(true);
    expect(getAnalyticsConsentState()).toBe('granted');
  });

  it('a repeated DECLINE never triggers a teardown', async () => {
    const { recordAnalyticsConsentDecision } = await load();
    recordAnalyticsConsentDecision(false);
    recordAnalyticsConsentDecision(false);
    expect(disableAnalytics).not.toHaveBeenCalled();
  });
});
