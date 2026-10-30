import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearFirstMedNote,
  markFirstMedNoteMarked,
  readFirstMedNote,
  writeFirstMedNote,
  type FirstMedNote,
} from '@/lib/firstMedNote';
import { useAuthStore } from '@/store/authStore';

const NOTE: FirstMedNote = {
  eventId: 'ev-1',
  name: 'Metformin',
  dosage: '500mg',
  time: '08:00:00',
  day: '2026-09-01',
  startDate: '2026-09-02',
  marked: false,
};

function signIn(id: string): void {
  useAuthStore.setState({ user: { id, email: `${id}@example.com` } as never, isAuthenticated: true });
}

beforeEach(() => {
  window.localStorage.clear();
  signIn('user-1');
});
afterEach(() => useAuthStore.setState({ user: null, isAuthenticated: false }));

describe('first-med note (Today Mark it candidate)', () => {
  it('round-trips for the same circle on the same recipient day', () => {
    writeFirstMedNote('c1', NOTE);
    expect(readFirstMedNote('c1', '2026-09-01')).toEqual(NOTE);
  });

  it('EXPIRES at the end of the recipient day', () => {
    writeFirstMedNote('c1', NOTE);
    expect(readFirstMedNote('c1', '2026-09-02')).toBeNull();
    // ...and the expired record is dropped, not just hidden.
    expect(readFirstMedNote('c1', '2026-09-01')).toBeNull();
  });

  it('is per circle and per user', () => {
    writeFirstMedNote('c1', NOTE);
    expect(readFirstMedNote('c2', '2026-09-01')).toBeNull();
    signIn('user-2');
    expect(readFirstMedNote('c1', '2026-09-01')).toBeNull();
  });

  it('marking keeps the note (so Today shows the Taken state) with marked: true', () => {
    writeFirstMedNote('c1', NOTE);
    markFirstMedNoteMarked('c1', '2026-09-01');
    expect(readFirstMedNote('c1', '2026-09-01')?.marked).toBe(true);
  });

  it('marking an absent or expired note writes nothing', () => {
    markFirstMedNoteMarked('c1', '2026-09-01');
    expect(readFirstMedNote('c1', '2026-09-01')).toBeNull();
  });

  it('ignores a corrupt or wrong-shaped record', () => {
    window.localStorage.setItem('cc:firstMedNote:c1:user-1', '{nope');
    expect(readFirstMedNote('c1', '2026-09-01')).toBeNull();
    window.localStorage.setItem('cc:firstMedNote:c1:user-1', JSON.stringify({ eventId: 1 }));
    expect(readFirstMedNote('c1', '2026-09-01')).toBeNull();
  });

  it('clears', () => {
    writeFirstMedNote('c1', NOTE);
    clearFirstMedNote('c1');
    expect(readFirstMedNote('c1', '2026-09-01')).toBeNull();
  });
});
