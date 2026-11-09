import { clearOnEdit, editPatch } from '../editPatch';

// SAME TEST on mobile and web (the two helpers must keep the same semantics).
// Each row is (stored, next, isEditing) -> expected, where `undefined` means
// "the key is omitted" and `null` means "clear it".

describe('editPatch (differ-only)', () => {
  const rows: Array<[string, unknown, unknown, boolean, unknown]> = [
    ['create, value', null, 'Bring the card', false, 'Bring the card'],
    ['create, value trimmed', null, '  Bring  ', false, 'Bring'],
    ['create, empty -> omitted, never null', null, '', false, undefined],
    ['create, whitespace -> omitted', 'stale', '   ', false, undefined],
    ['create, a stored value is irrelevant', 'old', '', false, undefined],
    ['edit, stored emptied -> null', 'Bring the card', '', true, null],
    ['edit, stored emptied to whitespace -> null', 'Bring the card', '   ', true, null],
    ['edit, stored emptied to undefined -> null', 'x', undefined, true, null],
    ['edit, nothing stored, still empty -> omitted', null, '', true, undefined],
    ['edit, stored "" counts as empty', '', '  ', true, undefined],
    ['edit, unchanged -> omitted', 'Bring the card', 'Bring the card', true, undefined],
    ['edit, unchanged after trim -> omitted', ' Bring the card ', 'Bring the card  ', true, undefined],
    ['edit, changed -> new value', 'Bring the card', 'Bring the form', true, 'Bring the form'],
    ['edit, added -> new value', null, 'New', true, 'New'],
    ['edit, number unchanged -> omitted', 60, 60, true, undefined],
    ['edit, number changed', 60, 90, true, 90],
    ['edit, number cleared -> null', 60, undefined, true, null],
    ['edit, number 0 is a value, not empty', 60, 0, true, 0],
    ['create, number', null, 45, false, 45],
    ['create, number absent', null, undefined, false, undefined],
  ];
  it.each(rows)('%s', (_name, stored, next, isEditing, expected) => {
    expect(editPatch(stored as never, next as never, { isEditing })).toBe(expected);
  });

  it('normalize decides equality (a stored HH:MM:SS equals the form HH:MM)', () => {
    const normalize = (v: string | number) => String(v).slice(0, 5);
    expect(editPatch('09:00:00', '09:00', { isEditing: true, normalize })).toBeUndefined();
    expect(editPatch('09:00:00', '09:30', { isEditing: true, normalize })).toBe('09:30');
    expect(editPatch('09:00:00', '', { isEditing: true, normalize })).toBeNull();
  });
});

describe('clearOnEdit (a present value always travels)', () => {
  const rows: Array<[string, unknown, unknown, boolean, unknown]> = [
    ['create, value', null, '09:00', false, '09:00'],
    ['create, empty -> omitted, never null', '09:00', '', false, undefined],
    ['edit, unchanged value is still sent', '09:00', '09:00', true, '09:00'],
    ['edit, changed', '09:00', '10:00', true, '10:00'],
    ['edit, stored emptied -> null', '09:00:00', undefined, true, null],
    ['edit, nothing stored, still empty -> omitted', null, undefined, true, undefined],
    ['edit, nothing stored ("") still empty -> omitted', '', '', true, undefined],
  ];
  it.each(rows)('%s', (_name, stored, next, isEditing, expected) => {
    expect(clearOnEdit(stored as never, next as never, { isEditing })).toBe(expected);
  });
});
