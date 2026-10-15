import { onlineManager } from '@tanstack/react-query';
import '@/i18n';
import {
  __resetOfflineWriteForTests,
  blockOfflineWrite,
  guardOfflineWrite,
  isOfflineWriteRejection,
  offlineWriteMessage,
  offlineWriteRejection,
  setOfflineWriteExplainer,
} from '@/lib/offlineWrite';

// NO WRITES WHILE OFFLINE (owner decision 2026-10-14) — the gate every write
// control calls at press time. Mobile twin: mobile/src/utils/offlineWrite.ts.

const explain = vi.fn();

beforeEach(() => {
  __resetOfflineWriteForTests();
  explain.mockReset();
  setOfflineWriteExplainer(explain);
});

afterEach(() => {
  onlineManager.setOnline(true);
  setOfflineWriteExplainer(null);
});

describe('offlineWrite', () => {
  it('the three sentences are mobile\'s, word for word', () => {
    expect(offlineWriteMessage('mark')).toBe("You're offline. Connect to mark this.");
    expect(offlineWriteMessage('save')).toBe("You're offline. Connect to save this.");
    expect(offlineWriteMessage('change')).toBe("You're offline. Connect to make changes.");
  });

  it('online: lets the write through and says nothing', () => {
    expect(blockOfflineWrite('mark')).toBe(false);
    expect(explain).not.toHaveBeenCalled();
  });

  it('offline: refuses and explains with the matching sentence', () => {
    onlineManager.setOnline(false);
    expect(blockOfflineWrite('save')).toBe(true);
    expect(explain).toHaveBeenCalledWith("You're offline. Connect to save this.");
  });

  it('explains ONCE: a second press of the same kind is silent while the first is up', () => {
    onlineManager.setOnline(false);
    blockOfflineWrite('mark');
    blockOfflineWrite('mark');
    blockOfflineWrite('mark');
    expect(explain).toHaveBeenCalledTimes(1);
    // A different sentence is new information and replaces it.
    blockOfflineWrite('change');
    expect(explain).toHaveBeenCalledTimes(2);
    expect(explain).toHaveBeenLastCalledWith("You're offline. Connect to make changes.");
  });

  it('guardOfflineWrite reads connectivity at PRESS time, not wrap time', () => {
    const write = vi.fn();
    const guarded = guardOfflineWrite(write, 'mark');
    onlineManager.setOnline(false);
    guarded();
    expect(write).not.toHaveBeenCalled();
    onlineManager.setOnline(true);
    guarded();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('the backstop rejection is shaped like a backend envelope', () => {
    const body = offlineWriteRejection();
    expect(body).toEqual({
      success: false,
      error: { code: 'OFFLINE', message: 'Offline: write not sent' },
    });
    expect(isOfflineWriteRejection(body)).toBe(true);
    expect(isOfflineWriteRejection({ error: { code: 'FORBIDDEN' } })).toBe(false);
    expect(isOfflineWriteRejection(null)).toBe(false);
  });
});
