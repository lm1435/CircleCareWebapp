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
