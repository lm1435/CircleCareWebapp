/**
 * Assistant reply ACTIONS: buttons under a reply that open a place in the app.
 *
 * FIND_NOTES (1.3.0) answers "where are the notes?" with Notes / Doctors / one doctor's page. The
 * care-assistant understanding fix (1.4.2, docs/plans/care-assistant-understanding-fix.md §9) adds
 * destinations for the new intents and for APP_HELP / ACTION_REQUEST ("I can't change records, but
 * here's where to do it"). This module is the pure half: it validates the wire shape (unknown types
 * are dropped, never rendered), drops what THIS viewer cannot use, picks each button's label from
 * the app's own UI strings, and says where each one goes.
 *
 * Mobile twin: mobile/src/components/ai/aiReplyActions.ts (same types, labels, order, viewer rules).
 */
import type { TFunction } from 'i18next';
import type { AINotesPath, AIReplyAction } from '@/api/ai';
import { REPLY_ACTION_TYPES } from '@/lib/aiChatSignals';
import { settingsPath } from '@/lib/settingsSections';

/** Every action type this build can render (lib/aiChatSignals.ts, shared with analytics). */
export { REPLY_ACTION_TYPES };
// Compile-time: every listed type is a real AIReplyAction type.
const _replyActionTypesAreKnown: readonly AIReplyAction['type'][] = REPLY_ACTION_TYPES;
void _replyActionTypesAreKnown;

/** The parameterless types: `{ type }` and nothing else. */
const PLAIN_ACTION_TYPES: ReadonlySet<string> = new Set([
  'open_notes',
  'open_doctors',
  'open_activity',
  'open_medications',
  'open_emergency_info',
  'open_vitals',
  'open_members',
  'open_add_medication',
  'open_invite',
  'open_settings_notifications',
  'open_subscription',
]);

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
    if (typeof a.type === 'string' && PLAIN_ACTION_TYPES.has(a.type)) {
      // Rebuilt from the type alone: nothing else the server put on the object rides along.
      out.push({ type: a.type } as AIReplyAction);
    } else if (
      a.type === 'open_add_event' &&
      (a.event_type === 'appointment' || a.event_type === 'task')
    ) {
      out.push({ type: 'open_add_event', event_type: a.event_type });
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

/**
 * What THIS viewer may act on. Fail-closed: a host that does not say gets the read-only set.
 *   canCreate  can add medications / appointments / tasks (`can_edit` and not a view-only seat)
 *   canInvite  can invite (owner or manager, and can create)
 *   isOwner    owns the circle: the only person a subscription button may be shown to
 *              (owner-aware premium gates: a member is never sold a plan for someone else's circle)
 */
export interface AIReplyViewer {
  canCreate: boolean;
  canInvite: boolean;
  isOwner: boolean;
}

export const READ_ONLY_VIEWER: AIReplyViewer = { canCreate: false, canInvite: false, isOwner: false };

/**
 * Drop the buttons this viewer could not use. The reply text still names the place, so a dropped
 * button never leaves the answer incomplete; it only avoids a door that opens onto a refusal.
 * Settings > Alerts is the viewer's OWN account page, open to everyone.
 */
export function filterReplyActionsForViewer(
  actions: readonly AIReplyAction[],
  viewer: AIReplyViewer = READ_ONLY_VIEWER
): AIReplyAction[] {
  return actions.filter((action) => {
    switch (action.type) {
      case 'open_add_medication':
      case 'open_add_event':
        return viewer.canCreate === true;
      case 'open_invite':
        return viewer.canInvite === true;
      case 'open_subscription':
        return viewer.isOwner === true;
      default:
        return true;
    }
  });
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
    case 'open_activity':
      return t('actions.openActivity');
    case 'open_medications':
      return t('actions.openMedications');
    case 'open_emergency_info':
      return t('actions.openEmergencyInfo');
    case 'open_vitals':
      return t('actions.openVitals');
    case 'open_members':
      return t('actions.openMembers');
    case 'open_add_medication':
      return t('actions.openAddMedication');
    case 'open_add_event':
      return action.event_type === 'task' ? t('actions.openAddTask') : t('actions.openAddAppointment');
    case 'open_invite':
      return t('actions.openInvite');
    case 'open_settings_notifications':
      return t('actions.openSettingsNotifications');
    case 'open_subscription':
      return t('actions.openSubscription');
  }
}

/** Stable React key / test id suffix. */
export function replyActionKey(action: AIReplyAction): string {
  if (action.type === 'open_provider') return `open_provider-${action.provider_id}`;
  if (action.type === 'open_add_event') return `open_add_event-${action.event_type}`;
  return action.type;
}

/** The actions that open an add FORM (a modal the layout owns) rather than a route. */
export type CreateReplyAction = Extract<
  AIReplyAction,
  { type: 'open_add_medication' } | { type: 'open_add_event' }
>;
export type RouteReplyAction = Exclude<AIReplyAction, CreateReplyAction>;

/** Where a reply action goes: a route, or the New menu's add form of one type. */
export type ReplyActionDestination =
  | { kind: 'route'; to: string; state?: Record<string, unknown> }
  | { kind: 'create'; type: 'medication' | 'appointment' | 'task' };

/**
 * The destination of any action.
 *   open_add_medication -> the add form, Medication (the New menu's form; entry 'ai_chat')
 *   open_add_event      -> the add form, Appointment or Task
 *   everything else     -> a route (replyActionRoute)
 */
export function replyActionDestination(action: AIReplyAction, circleId: string): ReplyActionDestination {
  switch (action.type) {
    case 'open_add_medication':
      return { kind: 'create', type: 'medication' };
    case 'open_add_event':
      return { kind: 'create', type: action.event_type };
    default: {
      const { to, state } = replyActionRoute(action, circleId);
      return state ? { kind: 'route', to, state } : { kind: 'route', to };
    }
  }
}

/**
 * Where an action goes.
 *   open_notes    -> Care > Notes (daily care notes)
 *   open_doctors  -> Health > Emergency Info (the Doctors section)
 *   open_provider -> that doctor's Visits & notes; `state.source` feeds
 *                    `provider_visits_opened.source` (ProviderVisitsPage)
 *   open_activity               -> Activity
 *   open_medications            -> Meds
 *   open_emergency_info         -> Emergency info
 *   open_vitals                 -> Vitals
 *   open_members                -> Members (the care team)
 *   open_invite                 -> Members, with the invite dialog opened (`state.openInvite`)
 *   open_settings_notifications -> Settings > Alerts (`/profile/alerts`)
 *   open_subscription           -> Settings > Subscription (owner only, see filterReplyActionsForViewer)
 */
export function replyActionRoute(
  action: RouteReplyAction,
  circleId: string
): { to: string; state?: Record<string, unknown> } {
  const base = `/circles/${encodeURIComponent(circleId)}`;
  switch (action.type) {
    case 'open_notes':
      return { to: `${base}/notes` };
    case 'open_doctors':
      return { to: `${base}/emergency` };
    case 'open_provider':
      return { to: `${base}/providers/${encodeURIComponent(action.provider_id)}`, state: { source: 'ai_chat' } };
    case 'open_activity':
      return { to: `${base}/activity` };
    case 'open_medications':
      return { to: `${base}/meds` };
    case 'open_emergency_info':
      return { to: `${base}/emergency` };
    case 'open_vitals':
      return { to: `${base}/vitals` };
    case 'open_members':
      return { to: `${base}/members` };
    case 'open_invite':
      return { to: `${base}/members`, state: { openInvite: true } };
    case 'open_settings_notifications':
      return { to: settingsPath('alerts') };
    case 'open_subscription':
      return { to: settingsPath('subscription') };
  }
}
