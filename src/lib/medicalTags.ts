/**
 * Curated suggestion lists for the Condition Tags feature
 * (docs/plans/condition-tags.md). Each entry is an i18n key in the `emergency`
 * namespace (`medicalTags.*`) — resolve with `t(key)` at render time so the
 * stored value is the localized label at entry time (matches current
 * free-text behavior; no normalization by design).
 *
 * Key names mirror mobile `mobile/src/constants/medicalTags.ts` (plan Task 1).
 */

/** Medical conditions (24). */
export const CONDITION_TAG_KEYS: readonly string[] = [
  'medicalTags.conditions.hypertension',
  'medicalTags.conditions.type2Diabetes',
  'medicalTags.conditions.type1Diabetes',
  'medicalTags.conditions.chronicKidneyDisease',
  'medicalTags.conditions.heartFailure',
  'medicalTags.conditions.coronaryArteryDisease',
  'medicalTags.conditions.atrialFibrillation',
  'medicalTags.conditions.copd',
  'medicalTags.conditions.asthma',
  'medicalTags.conditions.dementia',
  'medicalTags.conditions.alzheimers',
  'medicalTags.conditions.parkinsons',
  'medicalTags.conditions.stroke',
  'medicalTags.conditions.arthritis',
  'medicalTags.conditions.osteoporosis',
  'medicalTags.conditions.cancer',
  'medicalTags.conditions.depression',
  'medicalTags.conditions.anxiety',
  'medicalTags.conditions.highCholesterol',
  'medicalTags.conditions.thyroidDisease',
  'medicalTags.conditions.chronicPain',
  'medicalTags.conditions.incontinence',
  'medicalTags.conditions.sleepApnea',
  'medicalTags.conditions.visionImpairment',
];

/** Medication allergies (12). */
export const MED_ALLERGY_TAG_KEYS: readonly string[] = [
  'medicalTags.medicationAllergies.penicillin',
  'medicalTags.medicationAllergies.sulfaDrugs',
  'medicalTags.medicationAllergies.aspirin',
  'medicalTags.medicationAllergies.nsaids',
  'medicalTags.medicationAllergies.codeineOpioids',
  'medicalTags.medicationAllergies.statins',
  'medicalTags.medicationAllergies.contrastDye',
  'medicalTags.medicationAllergies.tetracycline',
  'medicalTags.medicationAllergies.cephalosporins',
  'medicalTags.medicationAllergies.anticonvulsants',
  'medicalTags.medicationAllergies.insulin',
  'medicalTags.medicationAllergies.localAnesthetics',
];

/** Other (non-medication) allergies (10). */
export const OTHER_ALLERGY_TAG_KEYS: readonly string[] = [
  'medicalTags.otherAllergies.latex',
  'medicalTags.otherAllergies.peanuts',
  'medicalTags.otherAllergies.treeNuts',
  'medicalTags.otherAllergies.shellfish',
  'medicalTags.otherAllergies.eggs',
  'medicalTags.otherAllergies.dairy',
  'medicalTags.otherAllergies.soy',
  'medicalTags.otherAllergies.beeStings',
  'medicalTags.otherAllergies.pollenSeasonal',
  'medicalTags.otherAllergies.petDander',
];
