import i18n from '@/i18n';

/**
 * Human-readable file size, in the reader's number format.
 *
 * The DECIMAL SEPARATOR is locale-dependent: English writes 1.5 MB, Spanish
 * writes 1,5 MB. These strings are interpolated into translated sentences
 * ("Te quedan {{remaining}}"), so a hardcoded period was an English token
 * sitting inside Spanish copy.
 *
 * Grouping is switched OFF deliberately. The byte and kilobyte branches top out
 * at 1023, and `Intl` would render that as "1,023" — a change to the English
 * output for no benefit. With grouping off, English is byte-identical to the
 * pre-i18n implementation and only Spanish changes.
 *
 * PORT: `mobile/src/utils/format.ts` `formatBytes` mirrors this exactly. The
 * arithmetic and thresholds must stay identical on both clients so the same
 * file never reports two different sizes; only the way each platform discovers
 * the active locale differs.
 */
function fmt(value: number, digits: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
}

export function formatFileSize(bytes: number, locale?: string): string {
  const l = locale ?? i18n.language;
  if (bytes < 1024) return `${fmt(bytes, 0, l)} B`;
  if (bytes < 1048576) return `${fmt(bytes / 1024, 0, l)} KB`;
  if (bytes < 1073741824) return `${fmt(bytes / 1048576, 1, l)} MB`;
  return `${fmt(bytes / 1073741824, 2, l)} GB`;
}
