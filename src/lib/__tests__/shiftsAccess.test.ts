import { describe, expect, it } from 'vitest';
import { canWriteShifts, resolveShiftsEntry, showShiftCreateOption } from '../shiftsAccess';

// Schedule | Shifts visibility (docs/plans/care-shifts.md, User Flow step 1).
describe('resolveShiftsEntry', () => {
  const cases: Array<[string, Parameters<typeof resolveShiftsEntry>[0], string]> = [
    ['premium owner', { viewOnly: false, isPremiumCircle: true, isOwner: true }, 'available'],
    ['premium manager / member', { viewOnly: false, isPremiumCircle: true, isOwner: false }, 'available'],
    ['free owner -> teaser', { viewOnly: false, isPremiumCircle: false, isOwner: true }, 'teaser'],
    ['free manager / member -> nothing', { viewOnly: false, isPremiumCircle: false, isOwner: false }, 'hidden'],
    ['view-only seat of a premium circle -> nothing (viewOnly first)', { viewOnly: true, isPremiumCircle: true, isOwner: false }, 'hidden'],
    ['free owner WITH shifts (Premium lapsed) -> readonly', { viewOnly: false, isPremiumCircle: false, isOwner: true, hasShifts: true }, 'readonly'],
    ['free manager / member WITH shifts -> readonly', { viewOnly: false, isPremiumCircle: false, isOwner: false, hasShifts: true }, 'readonly'],
    ['free circle, hasShifts false -> unchanged (teaser / hidden)', { viewOnly: false, isPremiumCircle: false, isOwner: true, hasShifts: false }, 'teaser'],
    ['premium circle with the flag present stays available', { viewOnly: false, isPremiumCircle: true, isOwner: false, hasShifts: true }, 'available'],
    ['view-only seat stays hidden even with shifts', { viewOnly: true, isPremiumCircle: false, isOwner: false, hasShifts: true }, 'hidden'],
    ['view-only owner flag is never sold the teaser', { viewOnly: true, isPremiumCircle: false, isOwner: true }, 'hidden'],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(resolveShiftsEntry(input)).toBe(expected);
  });
});

describe('showShiftCreateOption / canWriteShifts', () => {
  it('"New > Shift" is offered for available and teaser only', () => {
    expect(showShiftCreateOption('available')).toBe(true);
    expect(showShiftCreateOption('teaser')).toBe(true);
    expect(showShiftCreateOption('readonly')).toBe(false);
    expect(showShiftCreateOption('hidden')).toBe(false);
  });
  it('writes need available AND edit access; readonly never writes', () => {
    expect(canWriteShifts('available', true)).toBe(true);
    expect(canWriteShifts('available', false)).toBe(false);
    expect(canWriteShifts('readonly', true)).toBe(false);
    expect(canWriteShifts('teaser', true)).toBe(false);
  });
});
