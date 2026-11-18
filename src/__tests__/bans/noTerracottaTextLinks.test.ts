import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Never terracotta as text" (owner a11y rule; 1.4.3 old-UI audit). Red stays on the SOS card
 * (its own invariant `sos` tokens) and the allergy pills (GlanceTiles), and on genuine field
 * errors in the form primitives. These files were the audit's terracotta TEXT spots (links,
 * headings, captions, a pill's text) plus the surfaces 1.4.3 rebuilt for mobile parity: none of
 * them may colour text terracotta again.
 */
const ROOT = join(__dirname, '..', '..');
const FILES = [
  'components/MapsLink.tsx',
  'components/emergency/PhoneLink.tsx',
  'pages/EmergencyInfoPage.tsx',
  'components/emergency/EmergencySection.tsx',
  'components/emergency/EmergencyMedications.tsx',
  'components/emergency/SosCard.tsx',
  'pages/MedicationsPage.tsx',
  'components/meds/TodaysMeds.tsx',
  'pages/DocumentsPage.tsx',
  'pages/UpgradePage.tsx',
  'components/overview/TodayCareTeam.tsx',
  'pages/OverviewPage.tsx',
];
const TERRACOTTA_TEXT = /\b(?:text|outline|decoration)-terracotta(?:-deep)?\b/g;

/** The banned classes in a source (comments stripped: prose may name the rule). */
export function terracottaTextIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  return code.match(TERRACOTTA_TEXT) ?? [];
}

describe('no terracotta text', () => {
  it.each(FILES)('POSITIVE/NEGATIVE: %s colours no text terracotta', (rel) => {
    expect(terracottaTextIn(readFileSync(join(ROOT, rel), 'utf8'))).toEqual([]);
  });

  it('NEGATIVE: the scanner catches a terracotta link class (and ignores comments)', () => {
    expect(terracottaTextIn('<a className="font-medium text-terracotta-deep underline">')).toEqual([
      'text-terracotta-deep',
    ]);
    expect(terracottaTextIn('<span className={`${PILL} text-terracotta`}>')).toEqual(['text-terracotta']);
    expect(terracottaTextIn('// never text-terracotta here')).toEqual([]);
    expect(terracottaTextIn('<IconTile tone="terracotta" /> bg-terracotta-soft')).toEqual([]);
  });
});
