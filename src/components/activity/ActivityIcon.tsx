import type { EyebrowColor, IconName, IconTileTone } from '@/components/ui';

// Activity-type → visual accent mapping (Task 17, web mobile-parity wave).
// Mirrors mobile's action_type → icon/color mapping (`getEditorialConfig` in
// mobile/src/components/activity/ActivityRow.tsx), expressed through this
// project's design-system tokens (IconTile tones, Icon names, Eyebrow
// colors) instead of mobile's raw hex + Ionicons name.
//
// `note` is NOT a mobile category — mobile's `getEditorialConfig` has no case
// for `care_note_added` / `note_added` and both fall through to its default
// (dusk + ellipse-outline), which is the SAME bucket mobile uses for truly
// unknown types. This web build gives notes their own dusk-tinted
// `document-text-outline` glyph and keeps `generic` as the neutral fallback
// for anything else — a deliberate, more legible split for a mouse-driven
// reader rather than a divergence from a considered mobile choice.

export type ActivityIconName =
  | 'medication'
  | 'appointment'
  | 'task'
  | 'emergency'
  | 'circle'
  | 'note'
  | 'generic';

export function getActivityIconName(actionType: string): ActivityIconName {
  switch (actionType) {
    case 'medication_confirmed':
    case 'medication_taken':
    case 'medication_completed':
    // The calendar route writes `${event_type}_created|updated|deleted` for
    // every type, and the confirmation route writes skipped / not_taken —
    // none of which either platform's switch listed, so "Added Medication"
    // fell through to the grey placeholder dot.
    case 'medication_created':
    case 'medication_updated':
    case 'medication_deleted':
    case 'medication_skipped':
    case 'medication_not_taken':
      return 'medication';
    case 'appointment_completed':
    case 'appointment_created':
    case 'appointment_updated':
    case 'appointment_deleted':
    case 'events_imported':
      return 'appointment';
    case 'task_completed':
    case 'task_created':
    case 'task_updated':
    case 'task_deleted':
    case 'event_created':
    case 'event_updated':
    case 'event_completed':
    case 'event_deleted':
      return 'task';
    case 'emergency_info_updated':
      return 'emergency';
    case 'circle_joined':
    case 'member_joined':
    case 'member_invited':
    case 'member_left':
    case 'member_removed':
    case 'circle_created':
    case 'circle_updated':
      return 'circle';
    case 'care_note_added':
    case 'note_added':
      return 'note';
    default:
      return fromPrefix(actionType);
  }
}

/**
 * Last resort before the placeholder dot: the backend names every activity
 * `<subject>_<verb>`, so an unlisted verb on a known subject still gets that
 * subject's glyph. Only a genuinely unknown subject reads as `generic`.
 */
function fromPrefix(actionType: string): ActivityIconName {
  const subject = actionType.split('_')[0];
  switch (subject) {
    case 'medication':
      return 'medication';
    case 'appointment':
      return 'appointment';
    case 'task':
    case 'event':
      return 'task';
    case 'emergency':
      return 'emergency';
    case 'member':
    case 'circle':
      return 'circle';
    case 'note':
      return 'note';
    default:
      return 'generic';
  }
}

/** `<IconTile>` glyph per type (spec §6.5: medkit / calendar / checkbox / alert / people / document). */
const ICON_NAME: Record<ActivityIconName, IconName> = {
  medication: 'medkit-outline',
  appointment: 'calendar-outline',
  task: 'checkbox-outline',
  emergency: 'alert-circle-outline',
  circle: 'people-outline',
  note: 'document-text-outline',
  generic: 'ellipse-outline',
};

/** `<IconTile tone>` per type — drives the 44px hero medallion. */
const TONE: Record<ActivityIconName, IconTileTone> = {
  medication: 'clay',
  appointment: 'dusk',
  task: 'moss',
  emergency: 'terracotta',
  circle: 'moss',
  note: 'dusk',
  generic: 'neutral',
};

/**
 * Row icon tile classes (spec §6.5): "28×28 r8 icon tile (2px border in the
 * type color, type-soft fill, icon 14 type-deep)". `generic` is the one
 * literal exception, spelled out verbatim in the spec rather than derived
 * from a tone: `border-line bg-bg-2 text-ink-2`.
 */
const TILE_CLASS: Record<ActivityIconName, string> = {
  medication: 'border-clay bg-clay-soft text-clay-deep',
  appointment: 'border-dusk bg-dusk-soft text-dusk-deep',
  task: 'border-moss bg-moss-soft text-moss-deep',
  emergency: 'border-terracotta bg-terracotta-soft text-terracotta-deep',
  circle: 'border-moss bg-moss-soft text-moss-deep',
  note: 'border-dusk bg-dusk-soft text-dusk-deep',
  generic: 'border-line bg-bg-2 text-ink-2',
};

/** Hero's 4px leading rail — full-strength tone background per type. */
const RAIL_CLASS: Record<ActivityIconName, string> = {
  medication: 'bg-clay',
  appointment: 'bg-dusk',
  task: 'bg-moss',
  emergency: 'bg-terracotta',
  circle: 'bg-moss',
  note: 'bg-dusk',
  generic: 'bg-ink-2',
};

/**
 * Hero "LATEST" eyebrow color (spec §6.5: "eyebrow in the type deep color") —
 * paired with `Eyebrow`'s `deep` prop, which resolves each of these to its
 * `-deep` shade. `generic` has no `-deep` token, so it maps to `ink-2`
 * (the neutral "deep" ink) and `deep` is then a no-op for it, same as before.
 */
const EYEBROW_COLOR: Record<ActivityIconName, EyebrowColor> = {
  medication: 'clay',
  appointment: 'dusk',
  task: 'moss',
  emergency: 'terracotta',
  circle: 'moss',
  note: 'dusk',
  generic: 'ink-2',
};

export function getActivityIcon(actionType: string): IconName {
  return ICON_NAME[getActivityIconName(actionType)];
}

export function getActivityTone(actionType: string): IconTileTone {
  return TONE[getActivityIconName(actionType)];
}

export function getActivityTileClass(actionType: string): string {
  return TILE_CLASS[getActivityIconName(actionType)];
}

export function getActivityRailClass(actionType: string): string {
  return RAIL_CLASS[getActivityIconName(actionType)];
}

export function getActivityEyebrowColor(actionType: string): EyebrowColor {
  return EYEBROW_COLOR[getActivityIconName(actionType)];
}
