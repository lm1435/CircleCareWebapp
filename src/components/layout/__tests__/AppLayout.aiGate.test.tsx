import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/store/authStore';
import { useCircle } from '@/hooks/useCircle';
import { expandAiEntryCases, type AiEntryScenario } from '@/__tests__/fixtures/aiEntryCases';

/**
 * VIEW-ONLY AI GATING (spec: the client half of the live backend gate).
 *
 *   view_only member         → HIDE the entry entirely. No prompt, no sale:
 *                              they cannot change their own role.
 *   frozen circle + owner    → SHOW; tapping raises the upgrade prompt.
 *   frozen circle + non-owner→ HIDE.
 *   otherwise                → SHOW; tapping opens the assistant.
 *
 * The entry has THREE surfaces and all three must agree: the sidebar's
 * Assistant button, the floating pill's AI cell, and the modal's own mount.
 */

vi.mock('@/hooks/useCircles', () => ({
  useCircles: vi.fn(() => ({
    data: [{ id: 'c1', name: "Mom's Care", recipient_name: 'Rosa' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));

// The layout raises the upgrade affordance itself for the frozen OWNER, so the
// gate is mocked here to assert the call rather than chase a toast's DOM.
const promptUpgrade = vi.fn();
const usePremiumGate = vi.fn((_context?: string) => ({ promptUpgrade }));
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: (context?: string) => usePremiumGate(context),
}));

vi.mock('@/components/NeedsCircleSelectionBanner', () => ({
  NeedsCircleSelectionBanner: () => null,
}));

// `aiChatModalRendered` records every render of the modal, open or not: the DOM
// only shows the LAST commit, and the mount gate's job includes the commits in
// between (see the paywalled-state tests below).
const aiChatModalRendered = vi.fn();
vi.mock('@/components/ai/AIChatModal', () => ({
  AIChatModal: ({ isOpen }: { isOpen: boolean }) => {
    aiChatModalRendered(isOpen);
    return isOpen ? <div role="dialog" aria-label="Care Assistant" data-testid="ai-chat-modal" /> : null;
  },
}));

vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: () => <div data-testid="add-event-modal" />,
}));

vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));

const OWNER_ID = 'owner-1';
const VIEWER_ID = 'viewer-2';

interface CircleFlags {
  ownerId?: string;
  canEdit: boolean;
  viewOnly: boolean;
  /** "Premium benefits apply to THIS viewer here" — the gate's actual input.
   *  Required, not defaulted: a fixture that omits it is silently a free-tier
   *  circle, which is a different row of the rule than it usually means. */
  isPremiumCircle: boolean;
}

/** Only the fields the layout's AI gate reads. */
function circleFlags({ ownerId = OWNER_ID, canEdit, viewOnly, isPremiumCircle }: CircleFlags) {
  return {
    circle: { id: 'c1', owner_id: ownerId, is_self_care: false },
    circleSummary: undefined,
    timezone: 'America/New_York',
    members: [],
    canEdit,
    accessLevel: canEdit ? 'edit' : 'view',
    isPremiumCircle,
    viewOnly,
    readOnly: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
}

function setCircle(flags: CircleFlags): void {
  vi.mocked(useCircle).mockReturnValue(
    circleFlags(flags) as unknown as ReturnType<typeof useCircle>
  );
}

/**
 * What `useCircle` returns for a circleId whose detail query has nothing cached
 * — the state a circle SWITCH passes through. Every gating flag is `?? false`,
 * so this is not "unknown", it is "no": `resolveAiEntry` reads it as 'hidden'.
 */
function setCircleLoading(): void {
  vi.mocked(useCircle).mockReturnValue({
    circle: undefined,
    circleSummary: undefined,
    timezone: 'America/New_York',
    members: [],
    canEdit: false,
    accessLevel: undefined,
    isPremiumCircle: false,
    viewOnly: false,
    readOnly: false,
    isLoading: true,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCircle>);
}

const initialAuthState = useAuthStore.getState();

function layoutTree(): ReactElement {
  return (
    <MemoryRouter initialEntries={['/circles/c1/calendar']}>
      <Routes>
        <Route path="/circles/:circleId" element={<AppLayout />}>
          <Route path="calendar" element={<div>Calendar page stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function renderLayout(): ReturnType<typeof render> {
  return render(layoutTree());
}

function pill(): HTMLElement {
  return screen.getByTestId('floating-nav');
}

/**
 * The sidebar's Assistant button — rendered only when the entry is allowed.
 *
 * ANCHORED. A bare `queryByRole(...)` returns null for a layout that rendered
 * NOTHING, so `expect(sidebarAssistant()).not.toBeInTheDocument()` was
 * vacuously true — it passed with `AppLayout` stubbed to `return null`. Every
 * absence assertion has to run through a `getBy*` that THROWS when the thing it
 * is scoped to is missing; the pill's testid is that anchor (the desktop
 * sidebar is `xl:`-only in jsdom, so it has no reliable landmark of its own).
 */
function sidebarAssistant(): HTMLElement | null {
  expect(pill()).toBeInTheDocument();
  return screen.queryByRole('button', { name: 'Assistant' });
}

/** The pill's AI cell — rendered only when the entry is allowed. */
function pillAssistant(): HTMLElement | null {
  return within(pill()).queryByRole('button', { name: 'AI' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: VIEWER_ID, email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
    isAuthenticated: true,
  });
});

afterEach(() => {
  useAuthStore.setState(initialAuthState, true);
  document.documentElement.style.removeProperty('--nav-h');
});

describe('AppLayout — AI gate, A: view-only member', () => {
  beforeEach(() => setCircle({ canEdit: false, viewOnly: true, isPremiumCircle: false }));

  it('hides the sidebar Assistant entry', () => {
    renderLayout();
    expect(sidebarAssistant()).not.toBeInTheDocument();
  });

  it('hides the pill AI cell', () => {
    renderLayout();
    expect(pillAssistant()).not.toBeInTheDocument();
  });

  it('offers no upgrade prompt — a view-only seat cannot buy its way in', () => {
    renderLayout();
    // Anchored: "no prompt" is also true of a layout that never rendered.
    expect(pillAssistant()).not.toBeInTheDocument();
    expect(promptUpgrade).not.toHaveBeenCalled();
  });

  // A view-only member of a PREMIUM circle is the population the mobile bug
  // hits: the backend returns early before reading the owner's tier, so the
  // premium flag it reports is false and a premium-flag-first client sells
  // them a subscription that grants them nothing. `view_only` is read first.
  it('hides the entry even when the circle is otherwise editable', () => {
    setCircle({ canEdit: true, viewOnly: true, isPremiumCircle: true });
    renderLayout();
    expect(sidebarAssistant()).not.toBeInTheDocument();
    expect(pillAssistant()).not.toBeInTheDocument();
  });
});

describe('AppLayout — AI gate, B: frozen circle, viewer IS the owner', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: OWNER_ID, email: 'own@example.com', first_name: 'Owen', last_name: 'Reed' },
      isAuthenticated: true,
    });
    setCircle({ ownerId: OWNER_ID, canEdit: false, viewOnly: false, isPremiumCircle: false });
  });

  it('shows the entry on both surfaces', () => {
    renderLayout();
    expect(sidebarAssistant()).toBeInTheDocument();
    expect(pillAssistant()).toBeInTheDocument();
  });

  it('raises the upgrade prompt instead of opening the assistant', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(pillAssistant() as HTMLElement);

    expect(promptUpgrade).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
  });

  it('raises the same prompt from the sidebar entry', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(sidebarAssistant() as HTMLElement);

    expect(promptUpgrade).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
  });

  // Mobile splits its whole paywall funnel on this property; a premium-only
  // SURFACE is 'feature', not the default "went looking for it" bucket.
  it('attributes the paywall to the feature context', () => {
    renderLayout();
    // Anchored: `usePremiumGate` is called during render whether or not the
    // layout produces any DOM, so the entry it attributes must be asserted too.
    expect(pillAssistant()).toBeInTheDocument();
    expect(usePremiumGate).toHaveBeenCalledWith('feature');
  });
});

describe('AppLayout — AI gate, C: frozen circle, viewer is NOT the owner', () => {
  beforeEach(() =>
    setCircle({ ownerId: OWNER_ID, canEdit: false, viewOnly: false, isPremiumCircle: false })
  );

  it('hides the entry on both surfaces', () => {
    renderLayout();
    expect(sidebarAssistant()).not.toBeInTheDocument();
    expect(pillAssistant()).not.toBeInTheDocument();
  });

  it('offers no upgrade prompt — only the owner can lift the freeze', () => {
    renderLayout();
    // Anchored: see the A-block sibling.
    expect(pillAssistant()).not.toBeInTheDocument();
    expect(promptUpgrade).not.toHaveBeenCalled();
  });
});

describe('AppLayout — AI gate, circle detail still loading', () => {
  // `useCircle` fails closed while the detail query is in flight (`can_edit ??
  // false`, `view_only ?? false`, no circle → not the owner), so the entry is
  // ABSENT and then appears, rather than flashing for someone who may not have
  // it. Pinned because the opposite — render it, then take it away — is the
  // failure mode this whole change exists to remove.
  it('shows no entry until the flags resolve', () => {
    vi.mocked(useCircle).mockReturnValue({
      circle: undefined,
      circleSummary: undefined,
      timezone: 'America/New_York',
      members: [],
      canEdit: false,
      accessLevel: undefined,
      isPremiumCircle: false,
      viewOnly: false,
      readOnly: false,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCircle>);

    renderLayout();

    expect(sidebarAssistant()).not.toBeInTheDocument();
    expect(pillAssistant()).not.toBeInTheDocument();
    expect(promptUpgrade).not.toHaveBeenCalled();
  });
});

describe('AppLayout — AI gate, editable circle (status quo)', () => {
  beforeEach(() => setCircle({ canEdit: true, viewOnly: false, isPremiumCircle: true }));

  it('opens the assistant from the pill', async () => {
    const user = userEvent.setup();
    renderLayout();

    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
    await user.click(pillAssistant() as HTMLElement);

    expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();
    expect(promptUpgrade).not.toHaveBeenCalled();
  });

  // The MOUNT is gated, not just the entry: `aiOpen` is layout state that
  // survives a flag refresh, so an open modal must disappear the moment the
  // circle's flags say the viewer may no longer use it.
  it('unmounts an already-open assistant when the flags refresh to view-only', async () => {
    const user = userEvent.setup();
    const { rerender } = renderLayout();

    await user.click(pillAssistant() as HTMLElement);
    expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();

    setCircle({ canEdit: false, viewOnly: true, isPremiumCircle: false });
    rerender(
      <MemoryRouter initialEntries={['/circles/c1/calendar']}>
        <Routes>
          <Route path="/circles/:circleId" element={<AppLayout />}>
            <Route path="calendar" element={<div>Calendar page stub</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
  });

  // 'upgrade' is the state where the entry is still RENDERED (so the owner can
  // be sold to) while the chat must not be, because the server will refuse
  // every message it sends.
  //
  // HONEST SCOPE: this proves the open modal is GONE after the flip, and no
  // more. It does NOT pin the mount gate's spelling — relax `=== 'available'`
  // to `!== 'hidden'` and the `aiEntry` reset effect still closes the modal
  // before the DOM is read, so this stays green. The test after it pins the
  // gate itself.
  it('unmounts an already-open assistant when the flags refresh to a paywalled state', async () => {
    const user = userEvent.setup();
    const { rerender } = renderLayout();

    await user.click(pillAssistant() as HTMLElement);
    expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();

    // Same viewer, now the OWNER of a circle premium no longer applies to:
    // aiEntry becomes 'upgrade' — an entry that renders, and a modal that must not.
    setCircle({ ownerId: VIEWER_ID, canEdit: false, viewOnly: false, isPremiumCircle: false });
    rerender(
      <MemoryRouter initialEntries={['/circles/c1/calendar']}>
        <Routes>
          <Route path="/circles/:circleId" element={<AppLayout />}>
            <Route path="calendar" element={<div>Calendar page stub</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
  });

  // NO COMMIT AFTER THE FLIP MAY RENDER THE ASSISTANT OPEN. A hidden flip cannot
  // separate a strict mount gate from a relaxed one (both unmount), and the DOM
  // after an 'upgrade' flip cannot either (the reset effect closes the modal
  // first). What separates them is the flip COMMIT itself: `aiOpen` is still the
  // stale `true` when the layout renders with the new flags, so a gate relaxed
  // to `!== 'hidden'` (or `=== 'available' || aiOpen`) renders
  // `<AIChatModal isOpen />` for that commit — its hooks run, the suggestions
  // query enabled by `isOpen` included — before the effect shuts it.
  //
  // THE GUARANTEE, NOT A SPELLING. This used to assert the modal was not
  // rendered AT ALL after the flip, which also failed a harmless always-mounted
  // refactor (`<AIChatModal isOpen={aiOpen && aiEntry === 'available'} />`)
  // that never opens anything. What matters is that it is never rendered OPEN
  // and no dialog is ever in the document.
  it('never renders the assistant open, even for the flip commit, once the flags say upgrade', async () => {
    const user = userEvent.setup();
    const { rerender } = renderLayout();

    await user.click(pillAssistant() as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Care Assistant' })).toBeInTheDocument();
    // Anti-vacuity: the recorder does see an open render when there is one.
    expect(aiChatModalRendered).toHaveBeenLastCalledWith(true);
    aiChatModalRendered.mockClear();

    setCircle({ ownerId: VIEWER_ID, canEdit: false, viewOnly: false, isPremiumCircle: false });
    rerender(layoutTree());

    // Anchored: the entry is still there (this is 'upgrade', not 'hidden').
    expect(pillAssistant()).toBeInTheDocument();
    expect(aiChatModalRendered).not.toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // …and it stays that way: a later render (anything re-rendering the
    // layout) must not reopen it from the stale `aiOpen` either.
    rerender(layoutTree());
    expect(aiChatModalRendered).not.toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // ────────────────────────────────────────────────────────────────────────
  // THE MOUNT GATE UNMOUNTS THE MODAL; IT NEVER CLEARED `aiOpen`.
  //
  // `aiOpen` is layout state that outlives the flags, so the two tests above
  // only prove the modal DISAPPEARS. They do not prove it stays gone — and it
  // did not: the moment `aiEntry` returned to 'available', the gate re-rendered
  // `<AIChatModal isOpen={true} />` and the assistant popped open again, unbidden.
  //
  // A circle SWITCH is the everyday way to make that happen. `useCircle`'s flags
  // are `?? false`, so a new query key (no cached data yet) drives `aiEntry`
  // away from 'available' and back, and `AppLayout` is not keyed on `circleId`
  // — only `<main>`'s inner div is keyed on the pathname, and `AIChatModal`
  // sits outside it. So the caregiver lands in the NEXT circle with an
  // assistant they did not open, scoped to a DIFFERENT care recipient.
  // ────────────────────────────────────────────────────────────────────────
  it('does not re-open itself when the flags come back', async () => {
    const user = userEvent.setup();
    const { rerender } = renderLayout();

    await user.click(pillAssistant() as HTMLElement);
    expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();

    // Flags go away (a refetch on a key with no cached data) …
    setCircleLoading();
    rerender(layoutTree());
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();

    // … and come back exactly as they were.
    setCircle({ canEdit: true, viewOnly: false, isPremiumCircle: true });
    rerender(layoutTree());

    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
    // The ENTRY is back, so this is "closed", not "hidden" — anchored so a
    // layout that rendered nothing cannot pass.
    expect(pillAssistant()).toBeInTheDocument();
  });

  it('does not follow the caregiver into a different circle', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/circles/c1/calendar']}>
        <Routes>
          <Route path="/circles/:circleId" element={<AppLayout />}>
            <Route
              path="calendar"
              element={<Link to="/circles/c2/calendar">Switch circle</Link>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await user.click(pillAssistant() as HTMLElement);
    expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();

    // The switch: a new circleId, whose detail query has nothing cached yet.
    setCircleLoading();
    await user.click(screen.getByRole('link', { name: 'Switch circle' }));
    // The new circle's flags land, and they say the assistant IS available here.
    setCircle({ canEdit: true, viewOnly: false, isPremiumCircle: true });
    await user.click(screen.getByRole('link', { name: 'Switch circle' }));

    expect(pillAssistant()).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
  });

  // …AND NOT ONLY BECAUSE THE FLAGS BLINKED. The sibling above switches through
  // a frame where `aiEntry` is not 'available' (nothing cached for the new key),
  // so the safety reset alone satisfies it. When the next circle's detail is
  // ALREADY cached — the common case, since the circle switcher renders the
  // list — there is no such frame: `aiEntry` reads 'available' throughout and
  // only the `circleId` reset stands between the caregiver and an assistant
  // bound to somebody else's care recipient.
  it('closes even when the next circle is already cached and the gate never blinks', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/circles/c1/calendar']}>
        <Routes>
          <Route path="/circles/:circleId" element={<AppLayout />}>
            <Route
              path="calendar"
              element={<Link to="/circles/c2/calendar">Switch circle</Link>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await user.click(pillAssistant() as HTMLElement);
    expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();

    // The mock is left ALONE: both circles are premium and editable for this
    // viewer, so `aiEntry` is 'available' before, during and after the switch.
    await user.click(screen.getByRole('link', { name: 'Switch circle' }));

    expect(pillAssistant()).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE SHARED CASE TABLE
// ───────────────────────────────────────────────────────────────────────────
// `src/__tests__/fixtures/aiEntryCases.ts` is a VERBATIM PORT of mobile's
// canonical copy, and mobile runs the identical table against its own client
// (`mobile/src/__tests__/hooks/useAIEntryAccess.test.ts`). One product rule,
// two implementations: this is what makes a future divergence fail in
// whichever repo drifts instead of passing on both sides, which is exactly how
// the free-tier-active-circle hole survived every test on both clients.
//
// Driven through `useCircle` rather than `resolveAiEntry` because that is the
// level where all four table columns exist and where "nothing rendered" is
// literally observable.

/** `useCircle` fails closed — every gating flag is `?? false` — so a field the
 *  payload does not carry arrives at the layout as `false`, not `undefined`. */
function failClosed(value: boolean | undefined): boolean {
  return value ?? false;
}

function applyScenario(scenario: AiEntryScenario): void {
  const viewerIsOwner = scenario.isOwner === true;
  useAuthStore.setState({
    user: viewerIsOwner
      ? { id: OWNER_ID, email: 'own@example.com', first_name: 'Owen', last_name: 'Reed' }
      : { id: VIEWER_ID, email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
    isAuthenticated: true,
  });

  // `isOwner: undefined` is the table's "no resolved circle at all" — owner-ness
  // is unknowable because there is no payload to read `owner_id` from.
  const circleResolved = scenario.isOwner !== undefined;

  vi.mocked(useCircle).mockReturnValue({
    circle: circleResolved ? { id: 'c1', owner_id: OWNER_ID, is_self_care: false } : undefined,
    circleSummary: undefined,
    timezone: 'America/New_York',
    members: [],
    canEdit: failClosed(scenario.canEdit),
    isPremiumCircle: failClosed(scenario.isPremiumCircle),
    accessLevel: undefined,
    viewOnly: failClosed(scenario.viewOnly),
    readOnly: false,
    isLoading: !circleResolved,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCircle>);
}

describe('AppLayout — the shared case table (canonical: mobile fixtures/aiEntryCases.ts)', () => {
  it.each(expandAiEntryCases().map((scenario) => [scenario.label, scenario] as const))(
    '%s',
    async (_label, scenario) => {
      applyScenario(scenario);
      const user = userEvent.setup();
      renderLayout();

      // Anchor every branch on a getBy* that THROWS when the layout rendered
      // nothing: a `queryBy` "not in the document" assertion is vacuously true
      // for a component that failed to render at all.
      expect(pill()).toBeInTheDocument();

      if (scenario.expected === 'hidden') {
        expect(sidebarAssistant()).not.toBeInTheDocument();
        expect(pillAssistant()).not.toBeInTheDocument();
        expect(promptUpgrade).not.toHaveBeenCalled();
        expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
        return;
      }

      // 'show' and 'upgrade' both RENDER the entry on both surfaces; they
      // differ only in what the tap does.
      expect(sidebarAssistant()).toBeInTheDocument();
      expect(pillAssistant()).toBeInTheDocument();

      await user.click(pillAssistant() as HTMLElement);

      if (scenario.expected === 'upgrade') {
        expect(promptUpgrade).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
      } else {
        expect(promptUpgrade).not.toHaveBeenCalled();
        expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();
      }
    }
  );
});
