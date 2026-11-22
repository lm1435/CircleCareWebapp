/**
 * "The form remembers its save" (owner-approved Option A, 2026-11-21).
 *
 * createEvent / updateEvent (api/calendarEvents.ts) keep ONE Idempotency-Key per request OBJECT.
 * A form builds a fresh object on every Save press, so a second press after every automatic attempt
 * lost its answer (row written) minted a NEW key and wrote a second medication.
 *
 * This hands the form the SAME object back while the payload is byte-identical (stable serialization,
 * per slot: 'primary', 'dose:1', ...), so the key follows. A changed payload yields the new object,
 * hence a new key (the server answers 422 IDEMPOTENCY_KEY_REUSED for a key with a different body, so
 * a key must never outlive its body). After a success or a definite refusal createEvent/updateEvent
 * drop the key themselves, so the very same object gets a fresh key on the next press.
 */

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = (v as Record<string, unknown>)[k];
      }
      return out;
    }
    return v;
  });
}

export interface SaveIntentKeys {
  /** Same object back while the payload is unchanged for this slot; otherwise `data` itself. */
  stable<T extends object>(slot: string, data: T): T;
  /** Forget a slot (or all). */
  reset(slot?: string): void;
}

export function createSaveIntentKeys(): SaveIntentKeys {
  const slots = new Map<string, { fingerprint: string; data: object }>();
  return {
    stable<T extends object>(slot: string, data: T): T {
      const fingerprint = stableStringify(data);
      const held = slots.get(slot);
      if (held && held.fingerprint === fingerprint) return held.data as T;
      slots.set(slot, { fingerprint, data });
      return data;
    },
    reset(slot) {
      if (slot === undefined) slots.clear();
      else slots.delete(slot);
    },
  };
}
