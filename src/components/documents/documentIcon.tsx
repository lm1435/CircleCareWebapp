import type { BadgeVariantName, IconTileTone } from '@/components/ui';
import type { DocumentCategory } from '@/api/documents';

/**
 * Category → `IconTile` tone (spec §6.6; mirrors mobile's `CATEGORY_STYLES`
 * map in `DocumentRow.tsx`). Drives the row's icon tile background/glyph
 * color, and — via `categoryBadgeVariant` below — its category `Badge`.
 *
 * This file used to also pick a per-file-type glyph (image/PDF/category
 * icons drawn as hand-rolled SVG elements). The icon vocabulary web is allowed to
 * use (`ICON_NAMES`, spec §4.4) has exactly one document-family glyph —
 * `document-text-outline` — so every row now renders that same icon inside
 * the category-tinted tile instead of a different image/PDF/category glyph.
 * There is no allowlisted glyph to differentiate them; flagged as a gap in
 * the Task 19 report rather than inventing a new icon name.
 */
export const CATEGORY_TONE: Record<DocumentCategory, IconTileTone> = {
  medical_records: 'moss',
  insurance: 'dusk',
  legal: 'clay',
  prescriptions: 'terracotta',
  other: 'neutral',
};

const BADGE_VARIANT_BY_TONE: Record<IconTileTone, BadgeVariantName> = {
  moss: 'primary',
  dusk: 'dusk',
  clay: 'accent',
  terracotta: 'error',
  coral: 'coral',
  neutral: 'default',
};

/** Category → `Badge` variant, derived from the same tone map (spec §6.6). */
export function categoryBadgeVariant(category: DocumentCategory): BadgeVariantName {
  return BADGE_VARIANT_BY_TONE[CATEGORY_TONE[category]];
}
