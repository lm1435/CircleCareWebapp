/**
 * Assistant reply ACTIONS (FIND_NOTES, backend `routes/ai.ts` `resolveFindNotes`).
 *
 * The backend answers "where are the notes?" / "show me Dr. Patel's notes" with a
 * locally formatted message plus buttons that open the place. This module is the
 * pure half: it validates the wire shape (unknown types are dropped, never
 * rendered), picks each button's label from the app's own UI strings, and builds
 * the route.
 *
 * Mobile twin: mobile/src/components/ai/aiReplyActions.ts (same types, labels, order).
 */
import type { TFunction } from 'i18next';
import type { AINotesPath, AIReplyAction } from '@/api/ai';

/** The backend never sends more than 6 (5 doctors + Doctors); anything past that is noise. */
export const MAX_REPLY_ACTIONS = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only well-formed actions, in server order, capped. */
export function sanitizeReplyActions(raw: unknown): AIReplyAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AIReplyAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (a.type === 'open_notes' || a.type === 'open_doctors') {
      out.push({ type: a.type });
    } else if (
      a.type === 'open_provider' &&
      typeof a.provider_id === 'string' &&
      UUID_RE.test(a.provider_id) &&
      typeof a.provider_name === 'string' &&
      a.provider_name.trim().length > 0
    ) {
      out.push({ type: 'open_provider', provider_id: a.provider_id, provider_name: a.provider_name.trim() });
    }
    if (out.length >= MAX_REPLY_ACTIONS) break;
  }
  return out;
}

/** The FIND_NOTES analytics summary, or null when the server sent none / a bad shape. */
export function parseNotesPath(raw: unknown): AINotesPath | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.target !== 'doctor' && p.target !== 'doctor_list' && p.target !== 'notes') return null;
  return { target: p.target, doctor_named: p.doctor_named === true, doctor_matched: p.doctor_matched === true };
}

/** `t` bound to the `ai` namespace. */
export function replyActionLabel(t: TFunction, action: AIReplyAction): string {
  switch (action.type) {
    case 'open_notes':
      return t('actions.openNotes');
    case 'open_doctors':
      return t('actions.openDoctors');
    case 'open_provider':
      return t('actions.openProvider', { name: action.provider_name });
  }
}

/** Stable React key / test id suffix. */
export function replyActionKey(action: AIReplyAction): string {
  return action.type === 'open_provider' ? `open_provider-${action.provider_id}` : action.type;
}

/**
 * Where an action goes.
 *   open_notes    -> Care > Notes (daily care notes)
 *   open_doctors  -> Health > Emergency Info (the Doctors section)
 *   open_provider -> that doctor's Visits & notes; `state.source` feeds
 *                    `provider_visits_opened.source` (ProviderVisitsPage)
 */
export function replyActionRoute(
  action: AIReplyAction,
  circleId: string
): { to: string; state?: { source: 'ai_chat' } } {
  const base = `/circles/${encodeURIComponent(circleId)}`;
  switch (action.type) {
    case 'open_notes':
      return { to: `${base}/notes` };
    case 'open_doctors':
      return { to: `${base}/emergency` };
    case 'open_provider':
      return { to: `${base}/providers/${encodeURIComponent(action.provider_id)}`, state: { source: 'ai_chat' } };
  }
}
