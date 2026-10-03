import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast }) }));

import { saveDraftsForForcedSignOut, onSessionEnded, registerDraft } from '@/lib/sessionDraft';
import { useAuthStore } from '@/store/authStore';
import { useSessionDraft } from '../useSessionDraft';

function saveFor(userId: string, key: string, value: unknown): void {
  const off = registerDraft(key, () => value);
  saveDraftsForForcedSignOut(userId);
  onSessionEnded();
  off();
}

describe('useSessionDraft (PK9)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    showToast.mockClear();
    useAuthStore.setState({ user: { id: 'u1', email: 'a@b.c', first_name: null, last_name: null } });
  });

  it('restores the same user\'s draft on mount, shows the notice, and deletes it', () => {
    saveFor('u1', 'k', { body: 'hello' });
    const restore = vi.fn();
    renderHook(() => useSessionDraft('k', () => null, restore));
    expect(restore).toHaveBeenCalledWith({ body: 'hello' });
    expect(showToast).toHaveBeenCalledWith('We restored your unsaved draft.', 'info');
    expect(sessionStorage.length).toBe(0);
  });

  it('does not restore another user\'s draft and removes it', () => {
    saveFor('u1', 'k', { body: 'hello' });
    useAuthStore.setState({ user: { id: 'u2', email: 'x@y.z', first_name: null, last_name: null } });
    const restore = vi.fn();
    renderHook(() => useSessionDraft('k', () => null, restore));
    expect(restore).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('does nothing for a different form key', () => {
    saveFor('u1', 'other', { body: 'hello' });
    const restore = vi.fn();
    renderHook(() => useSessionDraft('k', () => null, restore));
    expect(restore).not.toHaveBeenCalled();
  });

  it('a null key disables it, and the live getter is what a forced sign-out saves', () => {
    const restore = vi.fn();
    const { unmount } = renderHook(() => useSessionDraft('live', () => ({ n: 1 }), restore));
    saveDraftsForForcedSignOut('u1');
    onSessionEnded();
    unmount();
    const again = vi.fn();
    renderHook(() => useSessionDraft('live', () => null, again));
    expect(again).toHaveBeenCalledWith({ n: 1 });
    sessionStorage.clear();
    renderHook(() => useSessionDraft(null, () => ({ n: 2 }), restore));
    saveDraftsForForcedSignOut('u1');
    onSessionEnded();
    expect(sessionStorage.length).toBe(0);
  });
});
