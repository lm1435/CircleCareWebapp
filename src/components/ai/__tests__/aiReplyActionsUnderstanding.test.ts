// Care-assistant understanding fix (1.4.2, docs/plans/care-assistant-understanding-fix.md §9):
// the new reply-action types, the viewer filter and the destinations. Pure half only
// (components/ai/aiReplyActions.ts). Mobile twin:
// mobile/src/__tests__/components/aiReplyActionsUnderstanding.test.ts.
import i18n from 'i18next';
import '@/i18n';
import en from '@/i18n/en/ai.json';
import es from '@/i18n/es/ai.json';
import fr from '@/i18n/fr/ai.json';
import it_ from '@/i18n/it/ai.json';
import pt from '@/i18n/pt/ai.json';
import de from '@/i18n/de/ai.json';
import type { AIReplyAction } from '@/api/ai';
import {
  filterReplyActionsForViewer,
  READ_ONLY_VIEWER,
  REPLY_ACTION_TYPES,
  replyActionDestination,
  replyActionKey,
  replyActionLabel,
  sanitizeReplyActions,
  type AIReplyViewer,
} from '../aiReplyActions';

const NEW_ACTIONS: AIReplyAction[] = [
  { type: 'open_activity' },
  { type: 'open_medications' },
  { type: 'open_emergency_info' },
  { type: 'open_vitals' },
  { type: 'open_members' },
  { type: 'open_add_medication' },
  { type: 'open_add_event', event_type: 'appointment' },
  { type: 'open_add_event', event_type: 'task' },
  { type: 'open_invite' },
  { type: 'open_settings_notifications' },
  { type: 'open_subscription' },
];

const OWNER: AIReplyViewer = { canCreate: true, canInvite: true, isOwner: true };
const MEMBER: AIReplyViewer = { canCreate: true, canInvite: false, isOwner: false };
const VIEW_ONLY: AIReplyViewer = { canCreate: false, canInvite: false, isOwner: false };

describe('sanitizeReplyActions: 1.4.2 types', () => {
  it('P: keeps every new type, in server order, rebuilt from the type alone', () => {
    const raw = NEW_ACTIONS.slice(0, 6).map((a) => ({ ...a, prefill: 'Tylenol 500mg' }));
    expect(sanitizeReplyActions(raw)).toEqual(NEW_ACTIONS.slice(0, 6));
    expect(JSON.stringify(sanitizeReplyActions(raw))).not.toContain('Tylenol');
  });

  it('P: open_add_event keeps its event_type (appointment | task)', () => {
    expect(
      sanitizeReplyActions([
        { type: 'open_add_event', event_type: 'task' },
        { type: 'open_add_event', event_type: 'appointment' },
      ])
    ).toEqual([
      { type: 'open_add_event', event_type: 'task' },
      { type: 'open_add_event', event_type: 'appointment' },
    ]);
  });

  it('N: unknown types are still dropped, and open_add_event without a known event_type is dropped', () => {
    expect(
      sanitizeReplyActions([
        { type: 'open_somewhere_new' },
        { type: 'open_add_event' },
        { type: 'open_add_event', event_type: 'medication' },
        { type: 'OPEN_ACTIVITY' },
        { type: 42 },
        null,
        'open_activity',
        { type: 'open_activity' },
      ])
    ).toEqual([{ type: 'open_activity' }]);
  });

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['it', it_],
    ['pt', pt],
    ['de', de],
  ])('%s: every new label exists and is not blank', (_code, ai) => {
    const actions = (ai as { actions: Record<string, string> }).actions;
    for (const k of [
      'openActivity', 'openMedications', 'openEmergencyInfo', 'openVitals', 'openMembers',
      'openAddMedication', 'openAddAppointment', 'openAddTask', 'openInvite',
      'openSettingsNotifications', 'openSubscription',
    ]) {
      expect(actions[k]?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(REPLY_ACTION_TYPES).toHaveLength(13);
  });
});

describe('labels / keys: 1.4.2 types', () => {
  it('P: the real English labels (same as mobile)', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.getFixedT('en', 'ai');
    expect(NEW_ACTIONS.map((a) => replyActionLabel(t, a))).toEqual([
      'Open Activity',
      'Open Medications',
      'Open Health info',
      'Open Vitals',
      'See Care team',
      'Add a medication',
      'Add an appointment',
      'Add a task',
      'Invite someone',
      'Alert settings',
      'See Subscription',
    ]);
  });

  it('keys are unique (the two add-event forms differ)', () => {
    const keys = NEW_ACTIONS.map(replyActionKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('filterReplyActionsForViewer', () => {
  it('P: the owner keeps every action', () => {
    expect(filterReplyActionsForViewer(NEW_ACTIONS, OWNER)).toEqual(NEW_ACTIONS);
  });

  it('N: a member never sees open_subscription nor, without manage rights, open_invite', () => {
    const types = filterReplyActionsForViewer(NEW_ACTIONS, MEMBER).map((a) => a.type);
    expect(types).not.toContain('open_subscription');
    expect(types).not.toContain('open_invite');
    expect(types).toContain('open_add_medication');
  });

  it('N: a view-only member never sees an add or invite action (reads and their own Alerts stay)', () => {
    expect(filterReplyActionsForViewer(NEW_ACTIONS, VIEW_ONLY).map((a) => a.type)).toEqual([
      'open_activity',
      'open_medications',
      'open_emergency_info',
      'open_vitals',
      'open_members',
      'open_settings_notifications',
    ]);
  });

  it('N: no viewer given = the read-only set (fail-closed)', () => {
    expect(filterReplyActionsForViewer(NEW_ACTIONS)).toEqual(
      filterReplyActionsForViewer(NEW_ACTIONS, READ_ONLY_VIEWER)
    );
  });
});

describe('replyActionDestination', () => {
  it.each<[string, AIReplyAction, unknown]>([
    ['open_activity', { type: 'open_activity' }, { kind: 'route', to: '/circles/c1/activity' }],
    ['open_medications', { type: 'open_medications' }, { kind: 'route', to: '/circles/c1/meds' }],
    ['open_emergency_info', { type: 'open_emergency_info' }, { kind: 'route', to: '/circles/c1/emergency' }],
    ['open_vitals', { type: 'open_vitals' }, { kind: 'route', to: '/circles/c1/vitals' }],
    ['open_members', { type: 'open_members' }, { kind: 'route', to: '/circles/c1/members' }],
    ['open_invite', { type: 'open_invite' }, { kind: 'route', to: '/circles/c1/members', state: { openInvite: true } }],
    ['open_settings_notifications', { type: 'open_settings_notifications' }, { kind: 'route', to: '/profile/alerts' }],
    ['open_subscription', { type: 'open_subscription' }, { kind: 'route', to: '/profile/subscription' }],
    ['open_add_medication', { type: 'open_add_medication' }, { kind: 'create', type: 'medication' }],
    ['open_add_event appointment', { type: 'open_add_event', event_type: 'appointment' }, { kind: 'create', type: 'appointment' }],
    ['open_add_event task', { type: 'open_add_event', event_type: 'task' }, { kind: 'create', type: 'task' }],
    ['open_notes (unchanged)', { type: 'open_notes' }, { kind: 'route', to: '/circles/c1/notes' }],
  ])('P: %s', (_label, action, expected) => {
    expect(replyActionDestination(action, 'c1')).toEqual(expected);
  });
});
