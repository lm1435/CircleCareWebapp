import { type ReactElement } from 'react';
import type { HealthVital } from '@/api/vitals';
import { VitalFormModal } from './VitalFormModal';

// Task 6.4 — edit-mode vitals modal. Thin wrapper over the shared VitalFormModal.
// Only MANUAL readings reach here (the page hides the edit affordance for synced
// readings via canEditVital); the backend 403s a PUT on non-manual anyway.

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
