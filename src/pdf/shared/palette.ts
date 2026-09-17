/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */

/**
 * The CircleCare colour tokens the PDF templates paint with, embedded as
 * literals so this folder needs neither the mobile `CC` theme object nor the
 * web `--color-*` custom properties.
 *
 * Both apps pin these: `mobile/src/__tests__/pdf/palette.test.ts` asserts each
 * value `===` the matching `CC` token, and the web mirror test asserts each
 * against `globals.css`. A token that changes in one place fails a test rather
 * than silently drifting in a printed document.
 *
 * Keys are the theme's own names, so a template reads `CC.moss` the same way
 * a screen does.
 */
export const PDF_PALETTE = {
  paper: '#FBF9F5',
  paperDeep: '#F3EFE6',
  ink: '#1A1916',
  inkSoft: '#4A4742',
  inkMute: '#6E6961',
  hair: 'rgba(26,25,22,0.08)',
  hairStrong: 'rgba(26,25,22,0.14)',
  moss: '#5C6B4E',
  mossWash: '#F5F7F3',
  mossLine: '#D0D9C9',
  mossMuted: '#A4B599',
  mossInk: '#3A4832',
  terracotta: '#A84B3A',
  terracottaSoft: '#F6ECE6',
  duskDeep: '#3A4E5E',
  amber: '#B07A2E',
  amberDeep: '#7E5620',
} as const;

export type PdfPaletteKey = keyof typeof PDF_PALETTE;
