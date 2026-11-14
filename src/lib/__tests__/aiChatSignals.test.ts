// Care-assistant understanding fix (1.4.2): validation of the additive reply fields and their
// analytics enums (lib/aiChatSignals.ts). Mobile twin: mobile/src/__tests__/utils/aiChatSignals.test.ts.
import {
  analyticsLanguage,
  bucketHistoryLen,
  isSuggestionId,
  parseCircleEmpty,
  parseOutcome,
  parseUnknownReason,
  sanitizeSuggestionItems,
  suggestionItemsFromStrings,
} from '@/lib/aiChatSignals';

describe('bucketHistoryLen', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2-5'],
    [5, '2-5'],
    [6, '6+'],
    [10, '6+'],
    [3.7, '2-5'],
  ])('P: %p -> %p', (n, bucket) => {
    expect(bucketHistoryLen(n)).toBe(bucket);
  });

  it.each([[undefined], [null], [-1], [NaN], ['3'], [Infinity]])('N: %p -> undefined (never a raw value)', (raw) => {
    expect(bucketHistoryLen(raw)).toBeUndefined();
  });
});

describe('parseOutcome / parseUnknownReason', () => {
  it('P: known outcomes pass through', () => {
    expect(parseOutcome('not_understood')).toBe('not_understood');
    expect(parseOutcome('action_redirect')).toBe('action_redirect');
  });

  it('N: an unknown or missing outcome is undefined (an older or newer backend)', () => {
    expect(parseOutcome('totally_new')).toBeUndefined();
    expect(parseOutcome(undefined)).toBeUndefined();
  });

  it('P: the reason only rides on not_understood; an unknown reason is "other"', () => {
    expect(parseUnknownReason('off_topic', 'not_understood')).toBe('off_topic');
    expect(parseUnknownReason('who knows', 'not_understood')).toBe('other');
    expect(parseUnknownReason('off_topic', 'answered')).toBeUndefined();
    expect(parseUnknownReason('off_topic', undefined)).toBeUndefined();
  });
});

describe('analyticsLanguage', () => {
  it.each([
    ['en', 'en'],
    ['es-MX', 'es'],
    ['fr-CA', 'fr'],
    ['pt-PT', 'pt'],
    ['pt_BR', 'pt'],
    ['ja', 'other'],
    [undefined, 'other'],
  ])('%p -> %p', (raw, lang) => {
    expect(analyticsLanguage(raw)).toBe(lang);
  });
});

describe('parseCircleEmpty', () => {
  it('booleans only; anything else is unknown', () => {
    expect(parseCircleEmpty(true)).toBe(true);
    expect(parseCircleEmpty(false)).toBe(false);
    expect(parseCircleEmpty('true')).toBeNull();
    expect(parseCircleEmpty(undefined)).toBeNull();
  });
});

describe('sanitizeSuggestionItems', () => {
  it('P: keeps id + text in server order, capped at 6', () => {
    const raw = Array.from({ length: 8 }, (_, i) => ({ id: `chip_${i}`, text: `Question ${i}?` }));
    expect(sanitizeSuggestionItems(raw)).toEqual(raw.slice(0, 6));
  });

  it('N: an unknown-shaped id never crashes: the chip stays, without the id', () => {
    expect(
      sanitizeSuggestionItems([
        { id: 'DROP TABLE', text: 'What can you help me with?' },
        { id: 42, text: 'Tips?' },
        { id: '../x', text: 'Other?' },
      ])
    ).toEqual([{ text: 'What can you help me with?' }, { text: 'Tips?' }, { text: 'Other?' }]);
    expect(isSuggestionId('help_invite')).toBe(true);
    expect(isSuggestionId('Help Invite')).toBe(false);
  });

  it('N: malformed entries are dropped, duplicates collapse, nothing throws', () => {
    expect(
      sanitizeSuggestionItems([null, 'text', { id: 'a' }, { text: '   ' }, { text: 'x'.repeat(201) }, { text: 'A?' }, { text: 'A?' }])
    ).toEqual([{ text: 'A?' }]);
    expect(sanitizeSuggestionItems(undefined)).toEqual([]);
    expect(sanitizeSuggestionItems({ id: 'a', text: 'b' })).toEqual([]);
  });

  it('suggestionItemsFromStrings: the old shape becomes chips without ids', () => {
    expect(suggestionItemsFromStrings(['One?', '', 7, 'Two?'])).toEqual([{ text: 'One?' }, { text: 'Two?' }]);
    expect(suggestionItemsFromStrings(null)).toEqual([]);
  });
});
