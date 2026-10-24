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
vi.mock('@/components/ai/AIChatModal', () => ({
  AIChatModal: ({ isOpen, onOpenAction }: { isOpen: boolean; onOpenAction?: (a: unknown) => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="Care Assistant" data-testid="ai-chat-modal">
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
    ) : null,
}));

vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: () => <div data-testid="add-event-modal" />,
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
        </Route>
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
