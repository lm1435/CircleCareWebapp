import type { UnitPreferences } from '@/api/users';
import { Analytics } from '@/lib/analytics';
import { regionUnitsDecidedKey } from '@/lib/regionUnitsAutoSet';
import {
  getDefaultUnits,
  isUntouchedDefaultUnits,
  unitRegionGroup,
  type DefaultUnits,
} from '@/lib/vitalUnitsLocale';

/**
 * "USE KG AND °C?" for an EXISTING account (1.4.2). PORT of mobile/src/services/vitalUnitsPrompt.ts:
 * same rule, same event.
 *
 * The one-time region auto-set (lib/regionUnitsAutoSet) never switches an account that has logged
 * vitals; it records `has_logged_vitals`. Those people are ASKED, once per account in this browser,
 * from the Vitals page only (never at launch; never in the add/edit form, where a switch would
 * re-label a number already typed), and only when: the auto-set decision is exactly
 * `has_logged_vitals`; the browser region (`browserRegion`, the shared `resolveRegion`) is metric;
 * the units are still exactly lbs / mg/dL / °F; it was never asked (`cc:vitalUnitsPromptAsked:<id>`,
 * the decision's localStorage shape); and no other dialog is open (it never stacks).
 *
 * "Switch" calls PUT /users/me/unit-preferences (the Settings endpoint). Stored readings are never
 * rewritten: one canonical unit per type (kg, °C, mmol/L; CHECK `health_vitals_unit_check`), the
 * backend converts every write, so only the display changes. A failed switch clears the flag.
 *
 * Analytics `vital_units_prompt`: outcome shown | switched | kept | dismissed, region_group, surface.
 */

export const VITAL_UNITS_PROMPT_KEY = 'cc:vitalUnitsPromptAsked';

export function vitalUnitsPromptKey(userId: string): string {
  return `${VITAL_UNITS_PROMPT_KEY}:${userId}`;
}

export type VitalUnitsPromptOutcome = 'switched' | 'kept' | 'dismissed';
type MetricGroup = 'metric_mg_dl' | 'metric_mmol_l';

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface VitalUnitsPromptOffer {
  target: DefaultUnits;
  group: MetricGroup;
}

/**
 * The offer to make now, or null. Pure read: records nothing (a busy or unready moment asks later).
 * No storage (blocked site data): null, since "once" could not be remembered.
 */
export function vitalUnitsPromptOffer(input: {
  userId: string | null | undefined;
  region: string | null | undefined;
  prefs: UnitPreferences | null | undefined;
  storage?: KeyValueStorage | null;
}): VitalUnitsPromptOffer | null {
  const { userId, region, prefs } = input;
  if (!userId || !prefs) return null;
  const group = unitRegionGroup(region);
  if (group !== 'metric_mg_dl' && group !== 'metric_mmol_l') return null;
  if (!isUntouchedDefaultUnits(prefs)) return null;
  const storage = input.storage === undefined ? browserStorage() : input.storage;
  if (!storage) return null;
  try {
    if (storage.getItem(regionUnitsDecidedKey(userId)) !== 'has_logged_vitals') return null;
    if (storage.getItem(vitalUnitsPromptKey(userId))) return null;
  } catch {
    return null;
  }
  return { target: getDefaultUnits(region), group };
}

function write(storage: KeyValueStorage | null, fn: (s: KeyValueStorage) => void): void {
  if (!storage) return;
  try {
    fn(storage);
  } catch {
    // Storage is best-effort; the dialog itself must never break.
  }
}

/** The dialog is going up: remember it FIRST (a closed tab never asks twice), then count it. */
export function markVitalUnitsPromptShown(
  userId: string,
  group: MetricGroup,
  storage: KeyValueStorage | null = browserStorage()
): void {
  write(storage, (s) => s.setItem(vitalUnitsPromptKey(userId), 'shown'));
  Analytics.vitalUnitsPrompt({ outcome: 'shown', region_group: group, surface: 'vitals' });
}

/** How it ended. */
export function recordVitalUnitsPromptOutcome(
  userId: string,
  group: MetricGroup,
  outcome: VitalUnitsPromptOutcome,
  storage: KeyValueStorage | null = browserStorage()
): void {
  write(storage, (s) => s.setItem(vitalUnitsPromptKey(userId), outcome));
  Analytics.vitalUnitsPrompt({ outcome, region_group: group, surface: 'vitals' });
}

/** They chose Switch and the PUT failed: forget the question so the next visit asks again. */
export function forgetVitalUnitsPrompt(userId: string, storage: KeyValueStorage | null = browserStorage()): void {
  write(storage, (s) => s.removeItem(vitalUnitsPromptKey(userId)));
}
