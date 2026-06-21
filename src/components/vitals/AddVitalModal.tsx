import { type ReactElement } from 'react';
import type { VitalType } from '@/api/vitals';
import { VitalFormModal } from './VitalFormModal';

// Task 6.4 — create-mode vitals modal. Thin wrapper over the shared
// VitalFormModal (which also powers EditVitalModal). Mirrors mobile's
// VitalFormScreen in its "AddVital" route.

export interface AddVitalModalProps {
  circleId: string;
  /** Pre-select the vital type. */
  initialType?: VitalType;
  onClose: () => void;
  onSaved?: () => void;
}

export function AddVitalModal({
  circleId,
  initialType,
  onClose,
  onSaved,
}: AddVitalModalProps): ReactElement | null {
  return (
    <VitalFormModal
      circleId={circleId}
      initialType={initialType}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
