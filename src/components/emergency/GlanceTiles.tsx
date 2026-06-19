import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';

// At-a-glance tiles: the highest-priority emergency facts surfaced in a
// compact row near the top of the page, mirroring mobile's "At a glance"
// section (mobile/src/screens/emergency/EmergencyInfoScreen.tsx GlanceRow).
//
// PHI: tile values are rendered for the reader only — never logged, never
// attached to analytics. Tiles whose underlying data is absent are omitted.

/** Decorative tile glyphs — the tile label carries the accessible meaning. */
function GlyphWrap({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const BloodGlyph = (): ReactElement => (
  <GlyphWrap>
    <path d="M12 2.5S5.5 9.5 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 9.5 12 2.5 12 2.5Z" />
  </GlyphWrap>
);

const AllergyGlyph = (): ReactElement => (
  <GlyphWrap>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </GlyphWrap>
);

const ConditionGlyph = (): ReactElement => (
  <GlyphWrap>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
  </GlyphWrap>
);

const ContactGlyph = (): ReactElement => (
  <GlyphWrap>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  </GlyphWrap>
);

interface Tile {
  key: string;
  icon: ReactElement;
  label: string;
  value: string;
}

export interface GlanceTilesProps {
  info: EmergencyInfo;
}

/**
 * Compact responsive row of icon tiles summarizing the highest-priority
 * emergency facts. Only tiles whose data exists are rendered — nothing is
 * shown when none apply (the parent decides whether to mount it).
 */
export function GlanceTiles({ info }: GlanceTilesProps): ReactElement | null {
  const { t } = useTranslation('emergency');

  const allergies = [...(info.medication_allergies ?? []), ...(info.allergies ?? [])];
  const conditions = info.medical_conditions ?? [];
  const primaryContact =
    info.emergency_contacts?.find((c) => c.is_primary) ?? info.emergency_contacts?.[0];

  const tiles: Tile[] = [];

  if (info.blood_type) {
    tiles.push({
      key: 'bloodType',
      icon: <BloodGlyph />,
      label: t('atAGlance.bloodType'),
      value: info.blood_type,
    });
  }
  if (allergies.length > 0) {
    tiles.push({
      key: 'allergies',
      icon: <AllergyGlyph />,
      label: t('atAGlance.allergies'),
      value: allergies.join(', '),
    });
  }
  if (conditions.length > 0) {
    tiles.push({
      key: 'conditions',
      icon: <ConditionGlyph />,
      label: t('atAGlance.conditions'),
      value: conditions.join(', '),
    });
  }
  if (primaryContact) {
    tiles.push({
      key: 'contact',
      icon: <ContactGlyph />,
      label: t('atAGlance.primaryContact'),
      value: primaryContact.name,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <section aria-label={t('atAGlance.title')} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="print-card flex flex-col gap-2 rounded-2xl border border-line bg-cream p-4"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-terracotta-soft text-terracotta-deep">
            {tile.icon}
          </span>
          <dl className="m-0">
            <dt className="mono mb-0.5">{tile.label}</dt>
            <dd className="m-0 text-base font-medium leading-snug text-ink">{tile.value}</dd>
          </dl>
        </div>
      ))}
    </section>
  );
}
