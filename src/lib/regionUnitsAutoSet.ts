import { getCircles } from '@/api/circles';
import { getUnitPreferences, updateUnitPreferences, type UnitPreferences } from '@/api/users';
import { getLatestVitals, getVitals } from '@/api/vitals';
import { Analytics } from '@/lib/analytics';
import {
  getDefaultUnits,
  isUntouchedDefaultUnits,
  unitRegionGroup,
  type DefaultUnits,
} from '@/lib/vitalUnitsLocale';

/**
 * ONE-TIME REGION UNITS for a never-used account (1.4.2). PORT of
 * mobile/src/services/regionUnitsAutoSet.ts: same rule, same event.
 *
 * Every account starts on lbs / mg/dL / °F, so a German who logged "70" saved 70 lb. This moves an
 * account to the browser region's units ONCE, through PUT /users/me/unit-preferences (the Settings
 * toggles' endpoint; no backend change), only when: no decision is recorded for this account in
 * this browser; the region (`browserRegion`) is metric (US / unknown records nothing); the units are
 * still exactly lbs / mg/dL / °F; and the account has NEVER logged a vital in any circle it can see.
 * Stored readings are never touched (they are canonical; only their display changes). Units are
 * per user, so other members are unaffected. The decision is remembered per account in
 * localStorage (`cc:vitalUnitsRegionDecided:<userId>`, the `scopedKey` shape; web sign-out never
 * clears localStorage), so a user who goes back to lbs is not switched again. A failure records
 * nothing and the next session retries.
 */

export const REGION_UNITS_DECIDED_KEY = 'cc:vitalUnitsRegionDecided';

export function regionUnitsDecidedKey(userId: string): string {
  return `${REGION_UNITS_DECIDED_KEY}:${userId}`;
}

export type RegionUnitsOutcome =
  | 'applied'
  | 'has_logged_vitals'
  | 'units_already_set'
  | 'not_metric_region'
  | 'already_decided'
  | 'no_user'
  | 'failed';

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RegionUnitsDeps {
  userId: string | null | undefined;
  region: string | null | undefined;
  getPrefs?: () => Promise<UnitPreferences>;
  hasLoggedVitals?: (userId: string) => Promise<boolean>;
  updatePrefs?: (units: DefaultUnits) => Promise<UnitPreferences>;
  storage?: KeyValueStorage;
}

const HISTORY_FROM = '2000-01-01T00:00:00.000Z';

/** Has this user recorded any vital in a circle they belong to? (cheap latest read first). */
export async function hasLoggedAnyVital(userId: string): Promise<boolean> {
  const circles = (await getCircles()) ?? [];
  for (const circle of circles) {
    const latest = await getLatestVitals(circle.id);
    const readings = Object.values(latest ?? {}).filter(Boolean) as { recorded_by: string | null }[];
    if (readings.length === 0) continue;
    if (readings.some((r) => r.recorded_by === userId)) return true;
    const history = await getVitals(circle.id, {
      from: HISTORY_FROM,
      to: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    if (history.some((v) => v.recorded_by === userId)) return true;
  }
  return false;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<RegionUnitsOutcome>>();

/** Test seam. */
export function resetRegionUnitsAutoSetForTests(): void {
  inflight.clear();
}

export function runRegionUnitsAutoSet(deps: RegionUnitsDeps): Promise<RegionUnitsOutcome> {
  const userId = deps.userId;
  if (!userId) return Promise.resolve('no_user');
  const existing = inflight.get(userId);
  if (existing) return existing;
  const run = decide(deps, userId).finally(() => inflight.delete(userId));
  inflight.set(userId, run);
  return run;
}

async function decide(deps: RegionUnitsDeps, userId: string): Promise<RegionUnitsOutcome> {
  const group = unitRegionGroup(deps.region);
  // Before any read: a US / unknown region costs nothing and records nothing.
  if (group !== 'metric_mg_dl' && group !== 'metric_mmol_l') return 'not_metric_region';
  // No storage (blocked cookies): we could not remember the decision, so make none.
  const storage = deps.storage ?? browserStorage();
  if (!storage) return 'failed';
  const getPrefs = deps.getPrefs ?? getUnitPreferences;
  const hasLoggedVitals = deps.hasLoggedVitals ?? hasLoggedAnyVital;
  const updatePrefs = deps.updatePrefs ?? ((units: DefaultUnits) => updateUnitPreferences(units));
  const key = regionUnitsDecidedKey(userId);
  try {
    if (storage.getItem(key)) return 'already_decided';

    const target = getDefaultUnits(deps.region);
    const prefs = await getPrefs();
    let outcome: 'applied' | 'has_logged_vitals' | 'units_already_set';
    if (!isUntouchedDefaultUnits(prefs)) {
      outcome = 'units_already_set';
    } else if (await hasLoggedVitals(userId)) {
      outcome = 'has_logged_vitals';
    } else {
      await updatePrefs(target);
      outcome = 'applied';
    }

    storage.setItem(key, outcome);
    const shown = outcome === 'applied' ? target : prefs;
    Analytics.vitalUnitsAutoSet({
      applied: outcome === 'applied',
      region_group: group,
      skip_reason: outcome === 'applied' ? null : outcome,
      weight_unit: shown.weight_unit,
      glucose_unit: shown.glucose_unit,
      temperature_unit: shown.temperature_unit ?? (shown.weight_unit === 'kg' ? '°C' : '°F'),
    });
    return outcome;
  } catch {
    return 'failed';
  }
}
