import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '@/api/providers';
import { EditDoctorModal } from '@/components/emergency/EditDoctorModal';
import { synthesizeEmptyEmergencyInfo } from '@/components/emergency/emptyEmergencyInfo';
import { Button, Icon, Select, type SelectOption } from '@/components/ui';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { useProviders } from '@/hooks/useProviders';

// The appointment form's optional "Doctor" row (docs/plans/notes-by-doctor.md,
// flow 3). Appointments only. The picker is the circle's ACTIVE doctors plus
// "None"; "Add a doctor" opens the same add-doctor dialog Medical Info uses and
// selects what it saved. Nothing is ever picked automatically.
//
// A doctor that was REMOVED after the appointment was linked is still the
// stored value: it is listed as "<name> (removed)" so the form shows the truth,
// keeps it on save (the server never re-validates an unchanged id), and lets the
// user change it. It stays OFFERED while another doctor is chosen, so the user can
// switch back to it before saving.
//
// "Add a doctor" opens the add-doctor dialog and comes back to this form: the new
// doctor is listed but NOT selected (same as mobile).

/** Sentinel for the empty (None) option: `Select` values are strings. */
const NONE = '';

export interface DoctorFieldProps {
  circleId: string;
  /** The chosen doctor's id, or null for None. */
  value: string | null;
  /**
   * The doctor the appointment was linked to when the form opened (edit only). When
   * that doctor is removed (or not resolved yet) it stays in the list for the whole
   * edit, even after another doctor is picked.
   */
  storedValue?: string | null;
  /** The new choice, with the doctor row when one was picked (null for None). */
  onChange: (id: string | null, provider: Provider | null) => void;
  /** Editing an occurrence of a series: the link lives on the series root. */
  appliesToSeries?: boolean;
  /** A save is in flight: choices are ignored but the field keeps focus. */
  busy?: boolean;
}

function optionLabel(provider: Provider, primaryLabel: string): string {
  return [provider.name, provider.specialty, provider.is_primary ? primaryLabel : null]
    .filter(Boolean)
    .join(' · ');
}

/** The add-doctor dialog, mounted only while open (it reads the emergency record). */
function AddDoctorDialog({
  circleId,
  onSaved,
  onClose,
}: {
  circleId: string;
  onSaved: (provider: Provider) => void;
  onClose: () => void;
}): ReactElement {
  const { data: info } = useEmergencyInfo(circleId);
  return (
    <EditDoctorModal
      circleId={circleId}
      // A circle with no emergency record yet still lets a doctor be added (the
      // add path writes through /providers and never reads the record).
      info={info ?? synthesizeEmptyEmergencyInfo(circleId)}
      target={undefined}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

export function DoctorField({
  circleId,
  value,
  storedValue = null,
  onChange,
  appliesToSeries = false,
  busy = false,
}: DoctorFieldProps): ReactElement {
  const { t } = useTranslation(['calendar', 'emergency']);
  // One read serves both: active doctors for the picker, and the removed one
  // (if the appointment points at one) so it can be named.
  const { providers } = useProviders(circleId, { includeArchived: true });
  const [adding, setAdding] = useState(false);
  // Doctors added from this field, kept until the refetch brings them in.
  const [added, setAdded] = useState<Provider[]>([]);

  const known = [...providers, ...added.filter((a) => !providers.some((p) => p.id === a.id))];
  const active = known.filter((p) => !p.archived_at);

  const options: SelectOption[] = [
    { value: NONE, label: t('calendar:addEvent.doctor.none') },
    ...active.map((p) => ({
      value: p.id,
      label: optionLabel(p, t('emergency:primary')),
    })),
  ];
  // The stored doctor when it is not among the active ones: removed, or not
  // resolved yet (the list is loading / failed). Kept as an option for the whole
  // edit so the select shows it, a save echoes it, and the user can switch back.
  const keep = storedValue ?? value;
  if (keep && !active.some((p) => p.id === keep)) {
    const kept = known.find((p) => p.id === keep);
    options.push({
      value: keep,
      label: kept
        ? t('calendar:addEvent.doctor.removed', { name: kept.name })
        : t('calendar:addEvent.doctor.linked'),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Select
        id="provider_id"
        label={t('calendar:addEvent.doctor.label')}
        options={options}
        value={value ?? NONE}
        busy={busy}
        hint={appliesToSeries ? t('calendar:addEvent.doctor.series') : undefined}
        onChange={(e) => {
          if (busy) return;
          const id = e.target.value || null;
          onChange(id, id ? (known.find((p) => p.id === id) ?? null) : null);
        }}
      />
      <div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Icon name="add-outline" size="row" />}
          onClick={() => setAdding(true)}
          offlineKind="change"
        >
          {t('calendar:addEvent.doctor.add')}
        </Button>
      </div>
      {adding && (
        <AddDoctorDialog
          circleId={circleId}
          onClose={() => setAdding(false)}
          // Listed straight away (before the refetch lands), never auto-selected.
          onSaved={(provider) => setAdded((prev) => [...prev, provider])}
        />
      )}
    </div>
  );
}
