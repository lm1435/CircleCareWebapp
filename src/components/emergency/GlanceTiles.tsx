import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { Badge, Card, IconTile, Text, type IconName } from '@/components/ui';

// At-a-glance tiles: the highest-priority emergency facts surfaced in a
// compact row near the top of the page, mirroring mobile's "At a glance"
// section (mobile/src/screens/emergency/EmergencyInfoScreen.tsx GlanceRow).
//
// PHI: tile values are rendered for the reader only — never logged, never
// attached to analytics.

interface Tile {
  key: string;
  icon: IconName;
  label: string;
  value: ReactNode;
}

/** Condition Tags pill treatment (spec §6.6: the Badge error variant) with INK text, not
 *  terracotta — mobile parity (EmergencyInfoScreen Badge: terracottaSoft fill, CC.ink
 *  text). Eleven red-text pills beside four red icons read as a wall of red; the pale
 *  fill alone still flags them as medical. `!` because Badge already sets
 *  `text-terracotta-deep`, and between two text-colour utilities Tailwind resolves by
 *  stylesheet order, not className order. Scoped here: the shared `error` Badge stays
 *  red for real error states. */
function GlancePills({ items }: { items: string[] }): ReactElement {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <Badge key={`${item}-${index}`} variant="error" className="text-ink!">
          {item}
        </Badge>
      ))}
    </span>
  );
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

  const medAllergies = info.medication_allergies ?? [];
  const otherAllergies = info.allergies ?? [];
  const conditions = info.medical_conditions ?? [];
  const primaryContact =
    info.emergency_contacts?.find((c) => c.is_primary) ?? info.emergency_contacts?.[0];

  const tiles: Tile[] = [];

  if (info.blood_type) {
    tiles.push({
      key: 'bloodType',
      icon: 'water-outline',
      label: t('atAGlance.bloodType'),
      value: info.blood_type,
    });
  }
  if (medAllergies.length > 0) {
    tiles.push({
      key: 'medicationAllergies',
      icon: 'alert-circle-outline',
      label: t('medicalInfo.medicationAllergies'),
      value: <GlancePills items={medAllergies} />,
    });
  }
  if (otherAllergies.length > 0) {
    tiles.push({
      key: 'otherAllergies',
      icon: 'alert-circle-outline',
      label: t('medicalInfo.otherAllergies'),
      value: <GlancePills items={otherAllergies} />,
    });
  }
  // Round 7 merge: conditions live here (the Medical Information section was
  // removed) — same tiles-only-when-data pattern as everything else.
  if (conditions.length > 0) {
    tiles.push({
      key: 'conditions',
      icon: 'heart-outline',
      label: t('atAGlance.conditions'),
      value: <GlancePills items={conditions} />,
    });
  }
  if (primaryContact) {
    tiles.push({
      key: 'contact',
      icon: 'call-outline',
      label: t('atAGlance.primaryContact'),
      value: primaryContact.name,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <section
      aria-label={t('atAGlance.title')}
      className="glance-tiles-grid grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {tiles.map((tile) => (
        // Icon and label share a row, value beneath: the tile reads as one
        // line of "what this is" instead of a glyph floating above a label,
        // and the printed sheet gets the same compact header per tile.
        <Card key={tile.key} padding="sm" className="print-card">
          <dl className="m-0 flex flex-col gap-2">
            <dt className="flex items-center gap-3">
              <IconTile tone="terracotta" size={36} name={tile.icon} />
              <Text variant="mono" as="span" className="min-w-0 flex-1">
                {tile.label}
              </Text>
            </dt>
            <dd className="m-0 text-md font-medium leading-snug text-ink">{tile.value}</dd>
          </dl>
        </Card>
      ))}
    </section>
  );
}
