import { describe, it, expect } from 'vitest';
import { parseVitalNumber } from '../vitalNumber';

// PK15 table. Must stay identical to mobile/src/__tests__/utils/vitalNumber.test.ts.
describe('parseVitalNumber', () => {
  it.each([
    ['72.5', 72.5],
    ['72,5', 72.5],
    [' 98,6 ', 98.6],
    ['1,200', 1.2],
    ['72', 72],
    ['.5', 0.5],
    [',5', 0.5],
    ['5,', 5],
    ['-3,5', -3.5],
  ])('%j -> %j', (input, expected) => {
    expect(parseVitalNumber(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['7,2,1'],
    ['1,200,5'],
    ['1.200,5'],
    ['72.5,1'],
    ['1e2'],
    ['0x10'],
    ['Infinity'],
    ['72 5'],
    [','],
    ['.'],
  ])('%j -> null', (input) => {
    expect(parseVitalNumber(input)).toBeNull();
  });
});
