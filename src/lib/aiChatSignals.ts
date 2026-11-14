/**
 * Care assistant (1.4.2, docs/plans/care-assistant-understanding-fix.md §9): the PURE half of the
 * new reply fields. Validates what the backend sends (`outcome`, `reason`, `history_len`,
 * `suggestion_items`, `circle_empty`) and turns it into closed analytics enums.
 *
 * Every field is ADDITIVE on the wire: an older backend sends none of them, a newer one may send
 * values this build has never heard of. Nothing here throws, and nothing here returns free text
 * except a chip's own label, which is rendered and never sent to analytics.
 *
 * Mobile twin: mobile/src/utils/aiChatSignals.ts (same names, same values, same rules). Web has no
 * dictation, so `voice` never occurs here (the one platform exception); the enum stays shared.
 */

/** Backend `AI_OUTCOMES` (routes/ai.ts). "Didn't understand" KPI = not_understood + advice_refused. */
export const AI_OUTCOMES = [
  'answered',
  'answered_empty',
  'app_help',
  'action_redirect',
  'not_understood',
  'advice_refused',
  'service_error',
  'data_unavailable',
] as const;
export type AIOutcome = (typeof AI_OUTCOMES)[number];

/** Backend `UNKNOWN_REASONS`: sent only when `outcome = not_understood`. */
export const AI_UNKNOWN_REASONS = [
  'off_topic',
  'unsupported_data',
  'fragment_no_context',
  'unintelligible',
  'other_language',
  'other',
] as const;
export type AIUnknownReason = (typeof AI_UNKNOWN_REASONS)[number];

/** How the question was put: typed, a tapped chip, or dictated (even if edited after). */
export const AI_INPUT_METHODS = ['typed', 'chip', 'voice'] as const;
export type AIInputMethod = (typeof AI_INPUT_METHODS)[number];

/** `history_len` is a count (0-10); analytics only ever sees the bucket. */
export const AI_HISTORY_LEN_BUCKETS = ['0', '1', '2-5', '6+'] as const;
export type AIHistoryLenBucket = (typeof AI_HISTORY_LEN_BUCKETS)[number];

/** Base languages the assistant answers in. Regional tags fold into their base. */
export const AI_ANALYTICS_LANGUAGES = ['en', 'es', 'de', 'fr', 'it', 'pt'] as const;
export type AIAnalyticsLanguage = (typeof AI_ANALYTICS_LANGUAGES)[number] | 'other';

/** Every reply action type this build can render (backend `AiReplyAction`), for the sanitizer and analytics. */
export const REPLY_ACTION_TYPES = [
  'open_provider',
  'open_notes',
  'open_doctors',
  'open_activity',
  'open_medications',
  'open_emergency_info',
  'open_vitals',
  'open_members',
  'open_add_medication',
  'open_add_event',
  'open_invite',
  'open_settings_notifications',
  'open_subscription',
] as const;
export type ReplyActionType = (typeof REPLY_ACTION_TYPES)[number];

/** The outcomes whose reply carries `suggestion_items` to re-render as chips. */
export const AI_SUGGESTION_REPLY_OUTCOMES: readonly AIOutcome[] = ['not_understood', 'advice_refused'];

/** A chip: the server's text, plus the id to send back as `suggestion_id` when the server gave one. */
export interface AISuggestionItem {
  id?: string;
  text: string;
}

/** The backend sends 6; anything past that is noise. */
export const MAX_SUGGESTION_ITEMS = 6;
/** Generous ceiling for a chip label (the longest shipped one is ~60 characters). */
const MAX_SUGGESTION_TEXT = 200;
/**
 * A chip id is a stable snake_case wire value (backend `CHIP_IDS`). Anything else is dropped and the
 * chip is sent as text only, which the backend still matches without classifying. Not an allowlist
 * of today's ids on purpose: a chip the backend adds later must keep working on this build.
 */
export const SUGGESTION_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function isSuggestionId(value: unknown): value is string {
  return typeof value === 'string' && SUGGESTION_ID_RE.test(value);
}

export function parseOutcome(raw: unknown): AIOutcome | undefined {
  return (AI_OUTCOMES as readonly unknown[]).includes(raw) ? (raw as AIOutcome) : undefined;
}

/** The reason, only for a not_understood reply; an unknown value is 'other' (backend `.catch('other')`). */
export function parseUnknownReason(raw: unknown, outcome: AIOutcome | undefined): AIUnknownReason | undefined {
  if (outcome !== 'not_understood') return undefined;
  return (AI_UNKNOWN_REASONS as readonly unknown[]).includes(raw) ? (raw as AIUnknownReason) : 'other';
}

/** 0, 1, 2-5, 6+; undefined when the backend did not send a usable count. */
export function bucketHistoryLen(raw: unknown): AIHistoryLenBucket | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined;
  const n = Math.floor(raw);
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  return '6+';
}

/** The request's base language ('fr-CA' -> 'fr'); anything unrecognised is 'other'. */
export function analyticsLanguage(language: unknown): AIAnalyticsLanguage {
  if (typeof language !== 'string') return 'other';
  const base = language.split(/[-_]/)[0]?.toLowerCase();
  return (AI_ANALYTICS_LANGUAGES as readonly string[]).includes(base) ? (base as AIAnalyticsLanguage) : 'other';
}

/** `circle_empty` when the backend sent a boolean, otherwise unknown (null). */
export function parseCircleEmpty(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

/**
 * Keep only well-formed chips, in server order, de-duplicated by text, capped at 6. A malformed id
 * is dropped (the chip is still offered, as text); a malformed text drops the chip.
 */
export function sanitizeSuggestionItems(raw: unknown): AISuggestionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AISuggestionItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.text !== 'string') continue;
    const text = r.text.trim();
    if (!text || text.length > MAX_SUGGESTION_TEXT || seen.has(text)) continue;
    seen.add(text);
    out.push(isSuggestionId(r.id) ? { id: r.id, text } : { text });
    if (out.length >= MAX_SUGGESTION_ITEMS) break;
  }
  return out;
}

/** The pre-2026-11 shape (`suggestions: string[]`) as chips without ids. */
export function suggestionItemsFromStrings(raw: unknown): AISuggestionItem[] {
  if (!Array.isArray(raw)) return [];
  return sanitizeSuggestionItems(raw.map((text) => ({ text })));
}
