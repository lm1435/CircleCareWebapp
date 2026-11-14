import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/store/authStore';
import { useCircle } from '@/hooks/useCircle';

/**
 * AppLayout — the assistant's FIND_NOTES reply buttons. The modal sits outside
 * the routed outlet, so the LAYOUT owns the navigation: close the assistant,
 * then open Care > Notes, Health > Emergency Info, or one doctor's Visits &
 * notes (with `state.source = 'ai_chat'` for provider_visits_opened). Mobile
 * twin: mobile/src/__tests__/navigation/aiReplyActionNavigation.test.tsx.
 * Mock scaffolding follows AppLayout.aiGate.test.tsx.
 */

// StoreReviewBanner owns its own tests; here it would need a QueryClient.
vi.mock('@/components/StoreReviewBanner', () => ({
  StoreReviewBanner: () => null,
}));

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
// The modal is stubbed to a dialog with one button per action, so this suite
// drives the HOST's onOpenAction (the real modal's buttons are pinned in
// components/ai/__tests__/AIChatModal.replyActions.test.tsx).
const PATEL = '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
// 1.4.2: the stub also exposes the viewer props the layout passes, and one button per new type.
const NEW_STUB_ACTIONS: Array<[string, unknown]> = [
  ['stub open activity', { type: 'open_activity' }],
  ['stub open medications', { type: 'open_medications' }],
  ['stub open emergency info', { type: 'open_emergency_info' }],
  ['stub open vitals', { type: 'open_vitals' }],
  ['stub open members', { type: 'open_members' }],
  ['stub open invite', { type: 'open_invite' }],
  ['stub open alerts', { type: 'open_settings_notifications' }],
  ['stub open subscription', { type: 'open_subscription' }],
  ['stub add medication', { type: 'open_add_medication' }],
  ['stub add task', { type: 'open_add_event', event_type: 'task' }],
];
let modalViewer: { canCreate?: boolean; canInvite?: boolean; isOwner?: boolean } = {};
vi.mock('@/components/ai/AIChatModal', () => ({
  AIChatModal: ({
    isOpen,
    onOpenAction,
    canCreate,
    canInvite,
    isOwner,
  }: {
    isOpen: boolean;
    onOpenAction?: (a: unknown) => void;
    canCreate?: boolean;
    canInvite?: boolean;
    isOwner?: boolean;
  }) => {
    modalViewer = { canCreate, canInvite, isOwner };
    return isOpen ? (
      <div role="dialog" aria-label="Care Assistant" data-testid="ai-chat-modal">
        {NEW_STUB_ACTIONS.map(([label, action]) => (
          <button key={label} onClick={() => onOpenAction?.(action)}>
            {label}
          </button>
        ))}
        <button onClick={() => onOpenAction?.({ type: 'open_notes' })}>stub open notes</button>
        <button onClick={() => onOpenAction?.({ type: 'open_doctors' })}>stub open doctors</button>
        <button
          onClick={() =>
            onOpenAction?.({ type: 'open_provider', provider_id: '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', provider_name: 'Dr Patel' })
          }
        >
          stub open provider
        </button>
      </div>
    ) : null;
  },
}));

vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ initialType, entry }: { initialType?: string; entry?: string }) => (
    <div data-testid="add-event-modal" data-type={initialType} data-entry={entry} />
  ),
}));

vi.mock('@/lib/onboardingAnalytics', () => ({ trackCirclesLoaded: vi.fn() }));

const OWNER_ID = 'owner-1';

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


/** Renders where the router is, and the state it carried. */
function Where(): JSX.Element {
  const location = useLocation();
  return (
    <div data-testid="where">
      {location.pathname}|{JSON.stringify(location.state ?? null)}
    </div>
  );
}

const initialAuthState = useAuthStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: OWNER_ID, email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
    isAuthenticated: true,
  });
  vi.mocked(useCircle).mockReturnValue(
    circleFlags({ canEdit: true, viewOnly: false, isPremiumCircle: true }) as unknown as ReturnType<typeof useCircle>
  );
});

afterEach(() => {
  useAuthStore.setState(initialAuthState, true);
  document.documentElement.style.removeProperty('--nav-h');
});

function renderAt(): void {
  render(
    <MemoryRouter initialEntries={['/circles/c1/calendar']}>
      <Routes>
        <Route path="/circles/:circleId" element={<AppLayout />}>
          <Route path="calendar" element={<Where />} />
          <Route path="notes" element={<Where />} />
          <Route path="emergency" element={<Where />} />
          <Route path="providers/:providerId" element={<Where />} />
          <Route path="activity" element={<Where />} />
          <Route path="meds" element={<Where />} />
          <Route path="vitals" element={<Where />} />
          <Route path="members" element={<Where />} />
        </Route>
        <Route path="/profile/:section" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

async function openAssistantAndTap(label: string): Promise<void> {
  const user = userEvent.setup();
  renderAt();
  await user.click(within(screen.getByTestId('floating-nav')).getByRole('button', { name: 'AI' }));
  expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: label }));
}

describe('AppLayout — AI reply actions', () => {
  it.each([
    ['stub open notes', '/circles/c1/notes|null'],
    ['stub open doctors', '/circles/c1/emergency|null'],
    ['stub open provider', `/circles/c1/providers/${PATEL}|{"source":"ai_chat"}`],
  ])('%s: closes the assistant and opens %s', async (label, where) => {
    await openAssistantAndTap(label);
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(where);
  });
});

describe('AppLayout — 1.4.2 reply actions', () => {
  it.each([
    ['stub open activity', '/circles/c1/activity|null'],
    ['stub open medications', '/circles/c1/meds|null'],
    ['stub open emergency info', '/circles/c1/emergency|null'],
    ['stub open vitals', '/circles/c1/vitals|null'],
    ['stub open members', '/circles/c1/members|null'],
    ['stub open invite', '/circles/c1/members|{"openInvite":true}'],
    ['stub open alerts', '/profile/alerts|null'],
    ['stub open subscription', '/profile/subscription|null'],
  ])('P: %s closes the assistant and opens %s', async (label, where) => {
    await openAssistantAndTap(label);
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(where);
  });

  it.each([
    ['stub add medication', 'medication'],
    ['stub add task', 'task'],
  ])('P: %s opens the New menu form of that type (entry ai_chat), staying on the page', async (label, type) => {
    await openAssistantAndTap(label);
    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();
    const form = screen.getByTestId('add-event-modal');
    expect(form).toHaveAttribute('data-type', type);
    expect(form).toHaveAttribute('data-entry', 'ai_chat');
    expect(screen.getByTestId('where')).toHaveTextContent('/circles/c1/calendar|null');
  });

  it('P: the owner of an editable circle may be offered add, invite and subscription buttons', async () => {
    vi.mocked(useCircle).mockReturnValue({
      ...circleFlags({ canEdit: true, viewOnly: false, isPremiumCircle: true }),
      canManageMembers: true,
    } as unknown as ReturnType<typeof useCircle>);
    await openAssistantAndTap('stub open notes');
    expect(modalViewer).toEqual({ canCreate: true, canInvite: true, isOwner: true });
  });

  it('N: a member (not the owner, no manage rights) gets add buttons only: no invite, no subscription', async () => {
    vi.mocked(useCircle).mockReturnValue({
      ...circleFlags({ ownerId: 'someone-else', canEdit: true, viewOnly: false, isPremiumCircle: true }),
      canManageMembers: false,
    } as unknown as ReturnType<typeof useCircle>);
    await openAssistantAndTap('stub open notes');
    expect(modalViewer).toEqual({ canCreate: true, canInvite: false, isOwner: false });
  });
});
