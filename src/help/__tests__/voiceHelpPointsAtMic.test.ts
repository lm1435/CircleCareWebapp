/**
 * 1.4.2: the phone app's separate "Say it" button is gone; the free voice try starts from the mic
 * inside the medication name field. Web has no voice UI (and no voice strings), but it bundles the
 * same in-app help as mobile, so the help must not tell anyone to tap a "Say it" button.
 * Mobile parity: mobile/src/__tests__/i18n/voiceTryHintPointsAtMic.test.ts.
 */
import { describe, expect, it } from 'vitest';
import help from '../content.json';

type Article = { slug: string; summary: string; body: string; steps?: string[] };
const ARTICLES = (help as unknown as { articles: Record<string, Article[]> }).articles;
const BUTTON_LABELS = ['Say it', 'Dilo', 'Einfach sagen', 'Dites-le', 'Dillo', 'Diga'];
const TAP_LABEL = new RegExp(
  `(tap|toca|tippen|appuyez|tocca|toque)[^.\\n]{0,40}["“„«]\\s?(${BUTTON_LABELS.join('|')})\\s?["”“»]`,
  'iu'
);

describe('help points at the mic, never at a "Say it" button (web bundle)', () => {
  it('POSITIVE: EN and ES say to tap the microphone in the medication form', () => {
    const body = (lng: string) => ARTICLES[lng].find((a) => a.slug === 'create-a-care-circle')!.body;
    expect(body('en')).toContain('tap the microphone in the name field of the medication form');
    expect(body('es')).toContain(
      'toca el micrófono en el campo del nombre del formulario del medicamento'
    );
  });

  it('NEGATIVE: no article in any language says to tap a "Say it" button', () => {
    for (const [lng, articles] of Object.entries(ARTICLES)) {
      for (const a of articles) {
        const text = [a.summary, a.body, ...(a.steps ?? [])].join('\n');
        expect({ lng, slug: a.slug, hit: TAP_LABEL.test(text) }).toEqual({
          lng,
          slug: a.slug,
          hit: false,
        });
      }
    }
  });
});
