import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import {
  joinedCircleMessage,
  joinedCirclePath,
  useOpenJoinedCircle,
} from '@/hooks/useOpenJoinedCircle';

// The post-accept handoff shared by every web accept path (invite link,
// pending invites, join-by-code): named toast + open the joined circle, or the
// generic copy + the picker when the backend's `circle` is null.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const t = i18n.t.bind(i18n) as unknown as Parameters<typeof joinedCircleMessage>[0];
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('joinedCircleMessage', () => {
  it('names the circle (EN)', () => {
    expect(joinedCircleMessage(t, { id: 'c1', name: "Rose's Circle" })).toBe(
      "You've joined Rose's Circle."
    );
  });

  it('names the circle (ES)', async () => {
    await i18n.changeLanguage('es');
    expect(joinedCircleMessage(t, { id: 'c1', name: 'Mamá' })).toBe('Te uniste a Mamá.');
  });

  it('null circle → generic copy (EN + ES)', async () => {
    expect(joinedCircleMessage(t, null)).toBe('You joined the circle.');
    await i18n.changeLanguage('es');
    expect(joinedCircleMessage(t, null)).toBe('Te uniste al círculo.');
  });

  it('blank name → generic copy, never "You\'ve joined ."', () => {
    expect(joinedCircleMessage(t, { id: 'c1', name: '  ' })).toBe('You joined the circle.');
  });
});

describe('joinedCirclePath', () => {
  it('opens the joined circle', () => {
    expect(joinedCirclePath({ id: 'c1', name: 'x' })).toBe('/circles/c1');
  });

  it('falls back to the picker when the circle is unknown', () => {
    expect(joinedCirclePath(null)).toBe('/circles');
  });
});

describe('useOpenJoinedCircle', () => {
  it('toasts the named success and navigates into the circle', () => {
    const { result } = renderHook(() => useOpenJoinedCircle(), { wrapper });
    result.current({ id: 'c9', name: 'Care Team' });
    expect(showToast).toHaveBeenCalledWith("You've joined Care Team.", 'success');
    expect(navigate).toHaveBeenCalledWith('/circles/c9');
  });

  it('null → generic success toast + /circles', () => {
    const { result } = renderHook(() => useOpenJoinedCircle(), { wrapper });
    result.current(null);
    expect(showToast).toHaveBeenCalledWith('You joined the circle.', 'success');
    expect(navigate).toHaveBeenCalledWith('/circles');
  });

  // Onboarding 1.3.1: with the invite's details AND a signed-in user, the handoff
  // lands on the invitee welcome (no toast); without a user it is the old handoff.
  it('welcome details + signed-in user: records the welcome and opens /welcome, no toast', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    const { peekPendingInviteeWelcome } = await import('@/lib/inviteeWelcome');
    sessionStorage.clear();
    useAuthStore.setState({ user: { id: 'u1' } as never, isAuthenticated: true });
    const { result } = renderHook(() => useOpenJoinedCircle(), { wrapper });
    result.current({ id: 'c9', name: 'Care Team' }, { inviterName: 'Sam', recipientName: 'Rose' });
    expect(navigate).toHaveBeenCalledWith('/circles/c9/welcome');
    expect(showToast).not.toHaveBeenCalled();
    expect(peekPendingInviteeWelcome('u1', 'c9')?.inviter).toBe('Sam');
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });

  it('welcome details but no signed-in user: falls back to toast + circle', () => {
    sessionStorage.clear();
    const { result } = renderHook(() => useOpenJoinedCircle(), { wrapper });
    result.current({ id: 'c9', name: 'Care Team' }, { inviterName: 'Sam', recipientName: 'Rose' });
    expect(showToast).toHaveBeenCalledWith("You've joined Care Team.", 'success');
    expect(navigate).toHaveBeenCalledWith('/circles/c9');
  });
});
