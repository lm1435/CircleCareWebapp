import type { ReactElement } from 'react';

// Activity-type icon (Task 26). Mirrors the action_type → icon mapping in
// mobile/src/screens/activity/ActivityFeedScreen.tsx (getEditorialConfig)
// with inline SVGs (no icon dependency) and web design-system token colors.
// Decorative only — always aria-hidden; the action text carries the meaning.

export type ActivityIconName =
  | 'medication'
  | 'appointment'
  | 'task'
  | 'emergency'
  | 'circle'
  | 'generic';

export function getActivityIconName(actionType: string): ActivityIconName {
  switch (actionType) {
    case 'medication_confirmed':
    case 'medication_taken':
    case 'medication_completed':
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
    case 'circle_created':
    case 'circle_updated':
      return 'circle';
    default:
      return 'generic';
  }
}

// Section tints mirror mobile's activity icon editorial config:
// medication → clay, appointment → dusk, task → moss, emergency → terracotta,
// circle (people/profile) → moss, generic → neutral.
const TILE_CLASS: Record<ActivityIconName, string> = {
  medication: 'bg-clay/15 text-clay-deep',
  appointment: 'bg-dusk/15 text-dusk-deep',
  task: 'bg-moss/15 text-moss-deep',
  emergency: 'bg-terracotta/15 text-terracotta-deep',
  circle: 'bg-moss/10 text-moss-deep',
  generic: 'bg-bg-3 text-ink-3',
};

const ICON_PATHS: Record<ActivityIconName, ReactElement> = {
  // Medkit (mobile: medkit-outline)
  medication: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M12 10.5v6" />
      <path d="M9 13.5h6" />
    </>
  ),
  // Calendar (mobile: calendar-outline)
  appointment: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
    </>
  ),
  // Checkmark (mobile: checkmark-outline)
  task: <path d="M5 13l4 4L19 7" />,
  // Shield (mobile: shield-outline)
  emergency: <path d="M12 3l7 3v5.5c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V6l7-3z" />,
  // People (mobile: people-outline)
  circle: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M1 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  // Dot (mobile: ellipse-outline)
  generic: <circle cx="12" cy="12" r="4" />,
};

export interface ActivityIconProps {
  actionType: string;
}

export function ActivityIcon({ actionType }: ActivityIconProps): ReactElement {
  const name = getActivityIconName(actionType);
  return (
    <span
      aria-hidden="true"
      data-activity-icon={name}
      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TILE_CLASS[name]}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {ICON_PATHS[name]}
      </svg>
    </span>
  );
}
