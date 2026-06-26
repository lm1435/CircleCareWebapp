import { type ReactElement } from 'react';
import type { HealthVital } from '@/api/vitals';
import { VitalFormModal } from './VitalFormModal';

// Task 6.4 — edit-mode vitals modal. Thin wrapper over the shared VitalFormModal.
// Every reading is manual and editable.

export interface EditVitalModalProps {
  circleId: string;
  vital: HealthVital;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditVitalModal({
  circleId,
  vital,
  onClose,
  onSaved,
}: EditVitalModalProps): ReactElement | null {
  return (
    <VitalFormModal circleId={circleId} vital={vital} onClose={onClose} onSaved={onSaved} />
  );
}
