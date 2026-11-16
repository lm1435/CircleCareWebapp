/**
 * 1.4.2 i18n audit E: accented letters are letters. Mirrors
 * mobile/src/screens/auth/__tests__/authValidation.test.ts.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { passwordRules } from '@/components/auth/PasswordRequirements';
import {
  PASSWORD_LOWERCASE,
  PASSWORD_NUMBER,
  PASSWORD_SPECIAL,
  PASSWORD_UPPERCASE,
} from '@/lib/passwordPolicy';

const allMet = (pw: string) => passwordRules.every((r) => r.test(pw));

/** The ASCII rules exactly as they were before. */
const legacy = (pw: string) =>
  pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

const ASCII_SAMPLES = [
  '', 'a', 'Ab1!', 'abcdefgh', 'ABCDEFGH', '12345678', '!!!!!!!!', 'abcdefg1', 'Abcdefgh',
  'Abcdefg1', 'Abcdefg!', 'abcdefg1!', 'ABCDEFG1!', 'Password1!', 'Password1! with spaces',
  'aB1!aB1!', 'aB1!aB1', '        1aB!', 'aB1 aaaa', 'aB1~aaaa',
];

describe('password policy', () => {
  it.each(ASCII_SAMPLES)('judges all-ASCII %j exactly as the old rules', (pw) => {
    expect(allMet(pw)).toBe(legacy(pw));
    // and per rule
    expect(PASSWORD_UPPERCASE.test(pw)).toBe(/[A-Z]/.test(pw));
    expect(PASSWORD_LOWERCASE.test(pw)).toBe(/[a-z]/.test(pw));
    expect(PASSWORD_NUMBER.test(pw)).toBe(/[0-9]/.test(pw));
    expect(PASSWORD_SPECIAL.test(pw)).toBe(/[^A-Za-z0-9]/.test(pw));
  });

  // POSITIVE
  it.each(['Äpfelbaum1!', 'Écoledemo1!', 'Ñandúes12?', 'ÁRBOLes1!'])('accepts %j', (pw) => {
    expect(allMet(pw)).toBe(true);
    expect(PASSWORD_UPPERCASE.test(pw)).toBe(true);
  });

  it('counts É as uppercase and é as lowercase, neither as special', () => {
    expect(PASSWORD_UPPERCASE.test('É')).toBe(true);
    expect(PASSWORD_SPECIAL.test('É')).toBe(false);
    expect(PASSWORD_LOWERCASE.test('é')).toBe(true);
    expect(PASSWORD_UPPERCASE.test('é')).toBe(false);
    expect(PASSWORD_SPECIAL.test('É')).toBe(false);
  });

  // NEGATIVE
  it.each([
    ['Äpfelbaum1', 'no special: Ä is a letter now, not a symbol'],
    ['äpfelbaum1!', 'no uppercase'],
    ['ÄPFELBAUM1!', 'no lowercase'],
    ['Äpfelbaum!', 'no number'],
    ['Äpf1!', 'too short'],
    ['Ab1éééééé', 'é is not special'],
  ])('rejects %j (%s)', (pw) => {
    expect(allMet(pw)).toBe(false);
  });
});
