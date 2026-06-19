// VERBATIM PORT of mobile/src/utils/activityTranslation.ts, with keys scoped
// to the `activity` namespace (web loads per-namespace JSON resources).
//
// Activity descriptions are generated in English by the backend. Translate by
// replacing known English phrases with localized ones; names, medication
// names, and other proper nouns are preserved.

type TFn = (key: string, opts?: Record<string, unknown>) => string;

export function translateActivityDescription(description: string, t: TFn): string {
  const replacements: Record<string, string> = {
    'Confirmed Medication:': t('phrases.confirmedMedication'),
    'Added Medication:': t('phrases.addedMedication'),
    'Updated Medication:': t('phrases.updatedMedication'),
    'Deleted Medication:': t('phrases.deletedMedication'),
    'Completed Medication:': t('phrases.completedMedication'),
    'Added Appointment:': t('phrases.addedAppointment'),
    'Updated Appointment:': t('phrases.updatedAppointment'),
    'Deleted Appointment:': t('phrases.deletedAppointment'),
    'Completed Appointment:': t('phrases.completedAppointment'),
    'Added Task:': t('phrases.addedTask'),
    'Updated Task:': t('phrases.updatedTask'),
    'Deleted Task:': t('phrases.deletedTask'),
    'Completed Task:': t('phrases.completedTask'),
    'Created Care Circle for': t('phrases.createdCircleFor'),
    'joined the circle as Care Recipient': t('phrases.joinedAsCareRecipient'),
    'joined the circle as Caregiver': t('phrases.joinedAsCaregiver'),
    'joined the circle as Family Member': t('phrases.joinedAsCaregiver'),
    Invited: t('phrases.invited'),
    'to join as Care Recipient': t('phrases.toJoinAsCareRecipient'),
    'to join as Caregiver': t('phrases.toJoinAsCaregiver'),
    'Updated emergency information': t('phrases.updatedEmergencyInfo'),
    '(taken late)': `(${t('phrases.takenLate')})`,
    '(taken)': `(${t('phrases.taken')})`,
    '(skipped)': `(${t('phrases.skipped')})`,
    '(missed)': `(${t('phrases.missed')})`,
    '(not taken)': `(${t('phrases.skipped')})`,
  };

  let translated = description;
  for (const [english, localized] of Object.entries(replacements)) {
    translated = translated.replace(english, localized);
  }

  // Handle complex patterns with regex

  // "Not taken: {title} on {YYYY-MM-DD}" (new format) and "Skipped {title} on {YYYY-MM-DD}" (legacy)
  translated = translated.replace(
    /^Not taken: (.+) on (\d{4}-\d{2}-\d{2})$/,
    `${t('phrases.skippedEvent')} $1 ${t('phrases.onDate')} $2`
  );
  translated = translated.replace(
    /^Skipped (.+) on (\d{4}-\d{2}-\d{2})$/,
    `${t('phrases.skippedEvent')} $1 ${t('phrases.onDate')} $2`
  );

  // "Stopped recurrence for {title} from {YYYY-MM-DD}"
  translated = translated.replace(
    /^Stopped recurrence for (.+) from (\d{4}-\d{2}-\d{2})$/,
    `${t('phrases.stoppedRecurrence')} $1 ${t('phrases.fromDate')} $2`
  );

  // "Imported N appointment(s) from calendar"
  translated = translated.replace(/^Imported (\d+) appointments? from calendar$/, (_, count) => {
    const n = parseInt(count, 10);
    return n === 1
      ? t('phrases.importedAppointment', { count: n })
      : t('phrases.importedAppointments', { count: n });
  });

  return translated;
}
