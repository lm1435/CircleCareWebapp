import { isAppleDevice, isMapsOpenable, isStreetAddress, mapsUrl, singleLineAddress } from '../maps';

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

// SHARED CASE TABLE: keep identical to mobile src/__tests__/utils/openInMaps.test.ts (STREET_ADDRESS_CASES).
const STREET_ADDRESS_CASES: { yes: string[]; no: string[] } = {
  yes: [
    '123 Main St',
    '123 Main Street, Denver, CO 80202',
    '1 Infinite Loop, Cupertino, CA',
    'Hauptstraße 5, 10115 Berlin',
    'Hauptstr. 5, Berlin',
    'Rua Augusta 100, Lisboa',
    'Calle 5 #10-20, Bogotá',
    '10 rue de Rivoli, 75001 Paris',
    'Via Roma 12, Milano',
    'Av. Paulista, 1578 - São Paulo',
    '4500 E 9th Ave Suite 200',
    '123 Main St\nDenver, CO',
    '12 Oak Ave\nSuite #4, Denver, CO',
    '221B Baker Street',
    '500 Elm, Denver',
    '12B Oak Lane',
    '4-6 High Road',
    'Mercy Hospital\n5th Ave #2, Denver',
    '9 Elm St & 3rd, Boulder',
    '1600 Pennsylvania Avenue NW, Washington, DC 20500',
    'Rua das Flores 25, 01000-000 São Paulo',
    '15 Kingsway, London WC2B 6UN',
    '100 Queen St W, Toronto, ON M5H 2N2',
    'Avenida Insurgentes Sur 1235, CDMX',
    'Piazza Navona 45, Roma',
    'Marktplatz 3, Bremen',
    '42 Wallaby Way, Sydney',
  ],
  no: [
    "Mom's house",
    'Casa de mamá',
    'Room 3',
    'Suite 200',
    "Dr. Smith's office",
    'Denver Health Medical Center',
    "St. Mary's Hospital",
    "St. Mary's, Room 3",
    'Telehealth',
    'Telehealth visit',
    'zoom.us/j/123',
    'https://zoom.us/j/123',
    'meet.google.com/abc',
    'Clinic',
    'Walgreens on 5th',
    '3',
    '303-555-0100',
    '(303) 555-0100',
    'Fax (303) 555-0100',
    '10/14/2026',
    '3:30 PM',
    'Oct 14, 2026',
    'Tuesday, March 3, 2026',
    '3 PM, Room 4',
    'Dr Lee at 3',
    'Floor 2, Building 4',
    'Phone call',
    '',
    '   ',
  ],
};

describe('isStreetAddress / isMapsOpenable (shared table with the web app)', () => {
  it.each(STREET_ADDRESS_CASES.yes)('%j offers Open in Maps', (v) => {
    expect(isStreetAddress(v)).toBe(true);
    expect(isMapsOpenable(v)).toBe(true);
  });
  it.each(STREET_ADDRESS_CASES.no)('%j does not', (v) => {
    expect(isStreetAddress(v)).toBe(false);
    expect(isMapsOpenable(v)).toBe(false);
  });
});
