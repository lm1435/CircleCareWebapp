import { describe, it, expect, vi, afterAll, beforeAll, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';

const submit = vi.fn();
vi.mock('@/api/feedback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/feedback')>();
  return { ...actual, submitCancellationFeedback: (...args: unknown[]) => submit(...args) };
});

const shown = vi.fn();
const submitted = vi.fn();
const dismissed = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    cancelReasonPromptShown: (p: unknown) => shown(p),
    cancelReasonPromptSubmitted: (p: unknown) => submitted(p),
    cancelReasonPromptDismissed: (p: unknown) => dismissed(p),
    logout: vi.fn(),
  },
}));

import { useAuthStore } from '@/store/authStore';
import {
  CancelReasonPrompt,
  PRESENT_DELAY_MS,
  THANKS_DURATION_MS,
} from '@/components/subscription/CancelReasonPrompt';
import {
  __resetCancelReasonPromptForTests,
  cancelAskKey,
  wasCancelReasonEvaluatedThisPageLoad,
} from '@/lib/cancelReasonPrompt';
import { queryKeys } from '@/lib/queryKeys';
import type { CancelPromptStatus, SubscriptionStatus } from '@/api/subscriptionStatus';

const USER = 'user-1';
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const UNSUB = NOW - 2 * DAY;
const EXPIRES = Date.UTC(2026, 9, 5, 12, 0, 0); // Oct 5, 2026
/**
 * Node's WebCrypto resolves `digest` from the libuv threadpool — outside the
 * microtask queue that `advanceTimersByTimeAsync` drains — so under fake timers
 * the show-once hash could land after an assertion (a flaky "no dialog", or a
 * negative test passing for the wrong reason). Same SHA-256 via node:crypto,
 * resolved as a plain microtask. The real WebCrypto path is covered in
 * lib/__tests__/cancelReasonPrompt.test.ts.
 */
function syncSha256(_algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
  const view =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = createHash('sha256').update(view).digest();
  return Promise.resolve(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
}

/** The show-once key for USER/UNSUB — hashed, so computed once up front. */
let KEY = '';
beforeAll(async () => {
  vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
    syncSha256 as typeof globalThis.crypto.subtle.digest
  );
  KEY = await cancelAskKey(USER, UNSUB);
});
afterAll(() => {
  vi.restoreAllMocks();
});

/** Backend `GET /subscription-status` `cancelPrompt` fixture. */
function cancelPromptFixture(overrides: Partial<CancelPromptStatus> = {}): CancelPromptStatus {
  return {
    renewalOffAt: new Date(UNSUB).toISOString(),
    accessEndsAt: new Date(EXPIRES).toISOString(),
    periodType: 'trial',
    entitlementActive: true,
    isSandbox: false,
    ...overrides,
  };
}

function statusWith(cancelPrompt: CancelPromptStatus | null): SubscriptionStatus {
  return { tier: 'premium', needsCircleSelection: false, cancelPrompt };
}

let navigateTo: (path: string) => void = () => {};
function NavProbe(): null {
  const navigate = useNavigate();
  navigateTo = (path) => navigate(path);
  return null;
}

/**
 * Seeded `GET /subscription-status` cache — this component NEVER fetches it
 * itself (see `useCancelPromptFromCache` in the component: `enabled: false`).
 * `undefined` = nobody else on the page has fetched it yet, the state a real
 * page load is in for the instant before `NeedsCircleSelectionBanner`'s own
 * request resolves.
 */
let seedStatus: SubscriptionStatus | undefined;
let queryClient: QueryClient;

function renderAt(path: string) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedStatus !== undefined) queryClient.setQueryData(queryKeys.subscriptionStatus, seedStatus);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <NavProbe />
        <CancelReasonPrompt />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderShown(path = '/circles/c1') {
  const utils = renderAt(path);
  await elapse(PRESENT_DELAY_MS);
  return utils;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetCancelReasonPromptForTests();
  submit.mockResolvedValue(undefined);
  seedStatus = statusWith(cancelPromptFixture());
  useAuthStore.setState({
    user: { id: USER, email: 'x@example.com', first_name: null, last_name: null },
    isAuthenticated: true,
    isBootstrapping: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('CancelReasonPrompt — gates', () => {
  it('shows ~2 s after landing on a circle overview, not before', async () => {
    renderAt('/circles/c1');
    await elapse(PRESENT_DELAY_MS - 100);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await elapse(100);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Your premium stays on until Oct 5, 2026.');
    expect(shown).toHaveBeenCalledWith({
      periodType: 'trial',
      daysSinceUnsubscribe: 2,
      entitlementActive: true,
      isSandbox: false,
    });
  });

  it('shows for a sandbox cancellation too (no longer excluded, dropped 2026-09-21) and tags isSandbox: true', async () => {
    seedStatus = statusWith(cancelPromptFixture({ isSandbox: true }));
    await renderShown();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(shown).toHaveBeenCalledWith({
      periodType: 'trial',
      daysSinceUnsubscribe: 2,
      entitlementActive: true,
      isSandbox: true,
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Too expensive' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(submit).toHaveBeenCalledWith({
      type: 'cancellation',
      reason: 'too_expensive',
      isSandbox: true,
    });
    expect(submitted).toHaveBeenCalledWith({
      reason: 'too_expensive',
      hasComment: false,
      periodType: 'trial',
      isSandbox: true,
    });
  });

  it('also shows on the circle picker (/circles)', async () => {
    await renderShown('/circles');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not show on a non-home route', async () => {
    await renderShown('/circles/c1/calendar');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show when the user leaves home before the show-once check resolves', async () => {
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest');
    let resolveDigest: (v: ArrayBuffer) => void = () => {};
    digestSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDigest = resolve;
        })
    );
    renderAt('/circles/c1');
    await elapse(PRESENT_DELAY_MS);
    act(() => navigateTo('/circles/c1/meds'));
    await act(async () => {
      resolveDigest(new Uint8Array(32).buffer);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show when this cancellation was already asked about', async () => {
    window.localStorage.setItem(KEY, 'true');
    await renderShown();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show while another modal is open', async () => {
    const other = document.createElement('div');
    other.setAttribute('aria-modal', 'true');
    document.body.appendChild(other);
    await renderShown();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show when a first run is parked behind the onboarding paywall', async () => {
    window.sessionStorage.setItem(
      `cc:pendingFirstRun:${USER}`,
      JSON.stringify({ circleId: 'c1', recipientName: 'Rose' })
    );
    await renderShown();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fails quiet when the show-once check throws (fails toward "already asked")', async () => {
    // Restored explicitly (not just left to the next test's vi.clearAllMocks,
    // which does NOT remove a mockImplementation) — otherwise every later
    // test's own hasAskedCancelReason call throws too, and the dialog never
    // shows again for the rest of the file.
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await renderShown();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    getItemSpy.mockRestore();
  });

  it('never fetches subscription-status itself — only observes the cache', async () => {
    seedStatus = undefined;
    await renderShown();
    await elapse(PRESENT_DELAY_MS * 3);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The passive observer never fetches on its own.
    expect(queryClient.getQueryState(queryKeys.subscriptionStatus)?.fetchStatus ?? 'idle').toBe('idle');
  });

  it('waits for the cache: shows 2 s after subscription-status lands (seeded elsewhere on the page)', async () => {
    seedStatus = undefined;
    await renderShown();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      queryClient.setQueryData(queryKeys.subscriptionStatus, statusWith(cancelPromptFixture()));
    });
    await elapse(0); // flush React Query's batched observer notification
    await elapse(PRESENT_DELAY_MS - 100);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await elapse(100);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows for a user who owns no circle — no owner gate any more, cancelPrompt is the user\'s own account', async () => {
    // Nothing here seeds or reads GET /circles at all: this component no
    // longer has any notion of circle ownership (see the removed-gate note
    // in the component).
    await renderShown();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not show when cancelPrompt is null (never cancelled, or outside the server-side window)', async () => {
    seedStatus = statusWith(null);
    await renderShown();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('evaluates at most once per page load', async () => {
    // Ineligible (dialog never opens) so the unmount cleanup — which gives
    // the page load its evaluation BACK, but only for a prompt that was
    // PRESENTED and then unmounted without an explicit close — never fires;
    // this isolates the once-per-load flag itself from that separate
    // mechanism, which has its own coverage in the "dismiss" tests below.
    seedStatus = statusWith(null);
    const first = await renderShown();
    expect(wasCancelReasonEvaluatedThisPageLoad()).toBe(true);
    first.unmount();
    expect(wasCancelReasonEvaluatedThisPageLoad()).toBe(true);
  });

  it('uses the expired headline when the entitlement has lapsed', async () => {
    seedStatus = statusWith(cancelPromptFixture({ entitlementActive: false }));
    await renderShown();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Your premium ended on Oct 5, 2026.');
  });
});

describe('CancelReasonPrompt — seen = asked (at most once per cancellation per browser)', () => {
  /** A new page load: the module-scope flag starts over, localStorage persists. */
  function newPageLoad(): void {
    __resetCancelReasonPromptForTests();
  }

  it('writes the key as the dialog is shown, before any interaction', async () => {
    await renderShown();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await vi.waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'));
    expect(submit).not.toHaveBeenCalled();
    expect(dismissed).not.toHaveBeenCalled();
  });

  it('shown, then the tab closed with no interaction → not shown on the next load', async () => {
    const first = await renderShown();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    first.unmount(); // no click: tab closed
    newPageLoad();
    await renderShown();
    expect(wasCancelReasonEvaluatedThisPageLoad()).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it('sign-out mid-dialog then the same account signs back in → not re-asked', async () => {
    const first = await renderShown();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    first.unmount(); // hands the page load its evaluation back (openRef)
    expect(wasCancelReasonEvaluatedThisPageLoad()).toBe(false);
    await renderShown();
    expect(wasCancelReasonEvaluatedThisPageLoad()).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('failed send, then a later load → not shown again', async () => {
    submit.mockRejectedValueOnce(new Error('500'));
    const first = await renderShown();
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    first.unmount();
    newPageLoad();
    await renderShown();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it('a failed key write on show still shows the dialog', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    await renderShown();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(shown).toHaveBeenCalledTimes(1);
    setItemSpy.mockRestore();
    // Dismiss still writes it (insurance for exactly this case).
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await vi.waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'));
  });

  it('after the dialog closes, navigating away and back home in the same load does not re-open it', async () => {
    await renderShown();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => navigateTo('/circles/c1/tasks'));
    act(() => navigateTo('/circles'));
    await elapse(PRESENT_DELAY_MS * 3);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shown).toHaveBeenCalledTimes(1);
  });
});

describe('CancelReasonPrompt — dialog', () => {
  it('focuses the headline, offers six native radios, and disables Send until one is picked', async () => {
    await renderShown();
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toHaveTextContent('Your premium stays on until Oct 5, 2026.');
    const group = within(dialog).getByRole('radiogroup', {
      name: 'Mind telling us why you turned off renewal? It helps us improve.',
    });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(6);
    expect(radios[0]).toHaveAttribute('type', 'radio');
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows a labelled comment field with a per-reason placeholder after a selection', async () => {
    await renderShown();
    fireEvent.click(screen.getByRole('radio', { name: "Something didn't work" }));
    const box = screen.getByRole('textbox', { name: 'Add a comment (optional)' });
    expect(box).toHaveAttribute('placeholder', 'What happened?');
    fireEvent.click(screen.getByRole('radio', { name: 'Missing a feature I need' }));
    expect(box).toHaveAttribute('placeholder', 'What were you looking for?');
    fireEvent.click(screen.getByRole('radio', { name: 'Too expensive' }));
    expect(box).toHaveAttribute('placeholder', 'Anything else? (optional)');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('on a 2xx: sends the payload, writes the key, thanks + reassurance for auto_charge, then closes', async () => {
    await renderShown();
    fireEvent.click(
      screen.getByRole('radio', { name: "I just didn't want to be charged automatically" })
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  just checking  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(submit).toHaveBeenCalledWith({
      type: 'cancellation',
      reason: 'auto_charge',
      description: 'just checking',
      isSandbox: false,
    });
    expect(window.localStorage.getItem(KEY)).toBe('true');
    expect(Object.keys(window.localStorage)).toEqual([KEY]);
    expect(KEY).toMatch(/^circlecare_install:cancel_ask:[0-9a-f]{16}:\d+$/);
    expect(KEY).not.toContain(USER);
    expect(submitted).toHaveBeenCalledWith({
      reason: 'auto_charge',
      hasComment: true,
      periodType: 'trial',
      isSandbox: false,
    });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Thanks, this really helps.');
    expect(status).toHaveTextContent('Got it. You keep full access until Oct 5, 2026.');

    await elapse(THANKS_DURATION_MS);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(dismissed).not.toHaveBeenCalled();
  });

  it('omits the reassurance for other reasons and sends no empty description', async () => {
    await renderShown();
    fireEvent.click(screen.getByRole('radio', { name: 'Too expensive' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(submit).toHaveBeenCalledWith({
      type: 'cancellation',
      reason: 'too_expensive',
      isSandbox: false,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Thanks, this really helps.');
    expect(screen.getByRole('status')).not.toHaveTextContent('full access');
  });

  it('on failure: shows an alert, keeps the selection, and the key stays written (from show)', async () => {
    submit.mockRejectedValueOnce(new Error('500'));
    await renderShown();
    await vi.waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'));
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'kept' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't send. Try again.");
    // Seen = asked: the key written on show is not undone by a failed send.
    expect(window.localStorage.getItem(KEY)).toBe('true');
    expect(screen.getByRole('radio', { name: 'Other' })).toBeChecked();
    expect(screen.getByRole('textbox')).toHaveValue('kept');
    expect(submitted).not.toHaveBeenCalled();

    // Retry succeeds.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(window.localStorage.getItem(KEY)).toBe('true');
  });

  it('Not now dismisses, writes the key and fires the dismissed event', async () => {
    await renderShown();
    window.localStorage.clear(); // drop the key written on show, so the dismiss re-write is observable
    fireEvent.click(screen.getByRole('radio', { name: 'Too expensive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The write is fire-and-forget behind an async hash.
    await vi.waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'));
    // Only the hashed form is stored — the raw user id appears in no key.
    expect(Object.keys(window.localStorage).some((k) => k.includes(USER))).toBe(false);
    expect(dismissed).toHaveBeenCalledWith({ periodType: 'trial', hadSelection: true, isSandbox: false });
    expect(submit).not.toHaveBeenCalled();
  });

  it('Escape dismisses and writes the key', async () => {
    await renderShown();
    window.localStorage.clear(); // drop the key written on show, so the dismiss re-write is observable
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'));
    expect(dismissed).toHaveBeenCalledWith({ periodType: 'trial', hadSelection: false, isSandbox: false });
  });

  it('carries no upsell or resubscribe link', async () => {
    await renderShown();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Close', 'Not now', 'Send']);
  });
});
