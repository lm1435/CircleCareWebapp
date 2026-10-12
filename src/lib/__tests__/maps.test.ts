import { isAppleDevice, isMapsOpenable, mapsUrl, singleLineAddress } from '../maps';

const G = 'https://www.google.com/maps/search/?api=1&query=';
const A = 'https://maps.apple.com/?q=';

describe('mapsUrl', () => {
  it('uses Google Maps off Apple devices and encodes commas, #, & and accents', () => {
    expect(mapsUrl('12 Main St #4, Café & Co, Zürich', false)).toBe(
      `${G}12%20Main%20St%20%234%2C%20Caf%C3%A9%20%26%20Co%2C%20Z%C3%BCrich`
    );
  });
  it('uses Apple Maps on Apple devices', () => {
    expect(mapsUrl('1 Infinite Loop, Cupertino', true)).toBe(
      `${A}1%20Infinite%20Loop%2C%20Cupertino`
    );
  });
  it('collapses a multi-line address to one line', () => {
    expect(mapsUrl('12 Main St\n  Apt 4\r\nDenver', false)).toBe(`${G}12%20Main%20St%2C%20Apt%204%2C%20Denver`);
    expect(singleLineAddress(' a  x \n\n b ')).toBe('a x, b');
  });
  it('returns null for empty or whitespace only (doctor addresses: URLs still link)', () => {
    expect(mapsUrl('', false)).toBeNull();
    expect(mapsUrl('  \n ', true)).toBeNull();
    expect(mapsUrl(null, false)).toBeNull();
  });
  it('turns free text like "Room 3" into a maps link', () => {
    expect(mapsUrl('Room 3', false)).toBe(`${G}Room%203`);
  });
});

describe('isAppleDevice', () => {
  it('detects iPhone, iPad, Mac', () => {
    expect(isAppleDevice({ platform: 'iPhone', userAgent: 'x' })).toBe(true);
    expect(isAppleDevice({ platform: 'MacIntel', userAgent: 'Macintosh' })).toBe(true);
    expect(isAppleDevice({ platform: '', userAgent: 'Mozilla (iPad; CPU OS 17)' })).toBe(true);
  });
  it('is false for Windows, Android, Linux', () => {
    expect(isAppleDevice({ platform: 'Win32', userAgent: 'Windows NT' })).toBe(false);
    expect(isAppleDevice({ platform: 'Linux armv8l', userAgent: 'Android 14' })).toBe(false);
  });
});

describe('isMapsOpenable (appointment locations)', () => {
  it.each(['Zoom', 'https://x.y', 'meet.google.com/abc', 'Telehealth visit', 'call Dr. Lee', '', '  '])(
    '%j is not a link',
    (v) => expect(isMapsOpenable(v)).toBe(false)
  );
  it.each(['123 Main St, Denver', 'Room 3', "St. Mary's Hospital"])('%j is a link', (v) =>
    expect(isMapsOpenable(v)).toBe(true)
  );
});
