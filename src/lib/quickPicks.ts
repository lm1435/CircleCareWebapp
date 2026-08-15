// Round 3 quick-pick chip options (docs/plans/condition-tags.md QP2–QP6).
// i18n KEY arrays — callers map through t() so EN/ES both come from the locale
// files. Mirrors mobile's constants (same option sets, same order).

/** `emergency` namespace — contact relationship quick-fill (QP2). */
export const RELATIONSHIP_KEYS = [
  'relationships.daughter',
  'relationships.son',
  'relationships.spousePartner',
  'relationships.sibling',
  'relationships.grandchild',
  'relationships.friend',
  'relationships.neighbor',
  'relationships.professionalCaregiver',
] as const;

/** `emergency` namespace — doctor specialty quick-fill (QP3). */
export const SPECIALTY_KEYS = [
  'specialties.primaryCare',
  'specialties.cardiologist',
  'specialties.nephrologist',
  'specialties.neurologist',
  'specialties.endocrinologist',
  'specialties.oncologist',
  'specialties.orthopedist',
  'specialties.psychiatrist',
  'specialties.physicalTherapist',
  'specialties.ophthalmologist',
  'specialties.podiatrist',
  'specialties.dentist',
] as const;

export interface MedSchedulePreset {
  /** Stable preset id — the ChipSelect value (labels stay i18n-only). */
  id: string;
  /** HH:mm primary time the preset sets. */
  time: string;
  /** Recurrence rule the preset sets. */
  recurrence: 'daily';
  /** `calendar` namespace label key. */
  labelKey: string;
}

/**
 * `calendar` namespace — medication SCHEDULE presets (Round 6 R6-2: the ONE
 * med chip strip; every chip sets a COMPLETE daily schedule — time + daily
 * recurrence together; untap clears both).
 *
 * SUBSET NOTE: mobile's full set adds twiceDaily/threeTimesDaily, which need
 * ADDITIONAL dose times per day. The web form (like the API's calendar_events
 * shape it mirrors) has exactly ONE scheduled_time per event, so only the
 * single-time presets are faithfully representable here — the multi-dose
 * presets are deliberately omitted rather than approximated. Key names mirror
 * mobile (addEvent.schedulePresets.everyMorning / everyEvening).
 */
export const MED_SCHEDULE_PRESETS: readonly MedSchedulePreset[] = [
  {
    id: 'everyMorning',
    time: '08:00',
    recurrence: 'daily',
    labelKey: 'addEvent.schedulePresets.everyMorning',
  },
  {
    id: 'everyEvening',
    time: '20:00',
    recurrence: 'daily',
    labelKey: 'addEvent.schedulePresets.everyEvening',
  },
] as const;

/** `calendar` namespace — generic appointment title fallbacks (QP6). */
export const APPOINTMENT_TITLE_KEYS = [
  'addEvent.titleSuggestions.appointment.doctorVisit',
  'addEvent.titleSuggestions.appointment.labWork',
  'addEvent.titleSuggestions.appointment.followUp',
  'addEvent.titleSuggestions.appointment.dentist',
  'addEvent.titleSuggestions.appointment.eyeExam',
] as const;

/** `calendar` namespace — generic task title fallbacks (QP6). */
export const TASK_TITLE_KEYS = [
  'addEvent.titleSuggestions.task.pickUpPrescriptions',
  'addEvent.titleSuggestions.task.groceryRun',
  'addEvent.titleSuggestions.task.checkInCall',
  'addEvent.titleSuggestions.task.driveToAppointment',
  'addEvent.titleSuggestions.task.refillPillOrganizer',
] as const;
