/**
 * PK15 — guarded decimal-comma parse for vitals value fields.
 *
 * A Spanish / LatAm keyboard types the decimal separator as ",". Rule: input
 * with exactly ONE comma and NO period is a decimal comma ("72,5" -> 72.5).
 * Anything else with a comma ("1,200,5", "7,2,1", "1.200,5") is NOT guessed at:
 * it stays unparseable and the caller shows its normal invalid message.
 * Range validation runs AFTER this, so a thousands-style "1,200" (read as 1.2)
 * is rejected by the per-type range check wherever 1.2 is absurd.
 *
 * Returns null for blank / non-numeric input. Mirrors
 * mobile/src/utils/vitalNumber.ts (keep the two identical).
 */
export function parseVitalNumber(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  if (!s.includes('.') && s.split(',').length === 2) {
    s = s.replace(',', '.');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
