import { describe, expect, it } from 'vitest';
import { ENTRY_SOURCES, WEB_ENTRY_SOURCE, isAddedByVoice } from '../entrySource';

describe('entrySource', () => {
  it('knows exactly the three values the backend accepts', () => {
    expect([...ENTRY_SOURCES]).toEqual(['form', 'scan', 'voice']);
  });

  it('the web app only ever creates typed entries', () => {
    expect(WEB_ENTRY_SOURCE).toBe('form');
  });

  it('isAddedByVoice is true only for "voice"', () => {
    expect(isAddedByVoice({ entry_source: 'voice' })).toBe(true);
    for (const value of ['form', 'scan', null, undefined, 'VOICE', '']) {
      expect(isAddedByVoice({ entry_source: value })).toBe(false);
    }
    expect(isAddedByVoice(null)).toBe(false);
    expect(isAddedByVoice(undefined)).toBe(false);
    expect(isAddedByVoice({})).toBe(false);
  });
});
