// Explicit per-icon `?raw` imports (rather than an eager `import.meta.glob`
// over all 1357 ionicons SVGs) so only the ~55 glyphs the app actually uses
// are bundled — measured cost: see Icon.tsx module doc comment.
import iconHomeOutline from '../../../node_modules/ionicons/dist/svg/home-outline.svg?raw';
import iconHome from '../../../node_modules/ionicons/dist/svg/home.svg?raw';
import iconCalendarOutline from '../../../node_modules/ionicons/dist/svg/calendar-outline.svg?raw';
import iconCalendar from '../../../node_modules/ionicons/dist/svg/calendar.svg?raw';
import iconMedicalOutline from '../../../node_modules/ionicons/dist/svg/medical-outline.svg?raw';
import iconMedical from '../../../node_modules/ionicons/dist/svg/medical.svg?raw';
import iconSparklesOutline from '../../../node_modules/ionicons/dist/svg/sparkles-outline.svg?raw';
import iconSparkles from '../../../node_modules/ionicons/dist/svg/sparkles.svg?raw';
import iconAddOutline from '../../../node_modules/ionicons/dist/svg/add-outline.svg?raw';
import iconMedkitOutline from '../../../node_modules/ionicons/dist/svg/medkit-outline.svg?raw';
import iconCheckboxOutline from '../../../node_modules/ionicons/dist/svg/checkbox-outline.svg?raw';
import iconCheckbox from '../../../node_modules/ionicons/dist/svg/checkbox.svg?raw';
import iconSquareOutline from '../../../node_modules/ionicons/dist/svg/square-outline.svg?raw';
import iconDocumentTextOutline from '../../../node_modules/ionicons/dist/svg/document-text-outline.svg?raw';
import iconPulseOutline from '../../../node_modules/ionicons/dist/svg/pulse-outline.svg?raw';
import iconHeartOutline from '../../../node_modules/ionicons/dist/svg/heart-outline.svg?raw';
import iconPeopleOutline from '../../../node_modules/ionicons/dist/svg/people-outline.svg?raw';
import iconSettingsOutline from '../../../node_modules/ionicons/dist/svg/settings-outline.svg?raw';
import iconArrowBack from '../../../node_modules/ionicons/dist/svg/arrow-back.svg?raw';
import iconSend from '../../../node_modules/ionicons/dist/svg/send.svg?raw';
import iconCreateOutline from '../../../node_modules/ionicons/dist/svg/create-outline.svg?raw';
import iconShareOutline from '../../../node_modules/ionicons/dist/svg/share-outline.svg?raw';
import iconDownloadOutline from '../../../node_modules/ionicons/dist/svg/download-outline.svg?raw';
import iconOptionsOutline from '../../../node_modules/ionicons/dist/svg/options-outline.svg?raw';
import iconCloseOutline from '../../../node_modules/ionicons/dist/svg/close-outline.svg?raw';
import iconPersonCircleOutline from '../../../node_modules/ionicons/dist/svg/person-circle-outline.svg?raw';
import iconPersonOutline from '../../../node_modules/ionicons/dist/svg/person-outline.svg?raw';
import iconLockClosedOutline from '../../../node_modules/ionicons/dist/svg/lock-closed-outline.svg?raw';
import iconEyeOutline from '../../../node_modules/ionicons/dist/svg/eye-outline.svg?raw';
import iconEyeOffOutline from '../../../node_modules/ionicons/dist/svg/eye-off-outline.svg?raw';
import iconCallOutline from '../../../node_modules/ionicons/dist/svg/call-outline.svg?raw';
import iconChevronForward from '../../../node_modules/ionicons/dist/svg/chevron-forward.svg?raw';
import iconChevronBack from '../../../node_modules/ionicons/dist/svg/chevron-back.svg?raw';
import iconChevronDown from '../../../node_modules/ionicons/dist/svg/chevron-down.svg?raw';
import iconPencilOutline from '../../../node_modules/ionicons/dist/svg/pencil-outline.svg?raw';
import iconAlertCircleOutline from '../../../node_modules/ionicons/dist/svg/alert-circle-outline.svg?raw';
import iconCheckmark from '../../../node_modules/ionicons/dist/svg/checkmark.svg?raw';
import iconCheckmarkCircle from '../../../node_modules/ionicons/dist/svg/checkmark-circle.svg?raw';
import iconEllipseOutline from '../../../node_modules/ionicons/dist/svg/ellipse-outline.svg?raw';
import iconMailOutline from '../../../node_modules/ionicons/dist/svg/mail-outline.svg?raw';
import iconTrendingUp from '../../../node_modules/ionicons/dist/svg/trending-up.svg?raw';
import iconTrendingDown from '../../../node_modules/ionicons/dist/svg/trending-down.svg?raw';
import iconEllipsisHorizontal from '../../../node_modules/ionicons/dist/svg/ellipsis-horizontal.svg?raw';
import iconNotificationsOutline from '../../../node_modules/ionicons/dist/svg/notifications-outline.svg?raw';
import iconTrashOutline from '../../../node_modules/ionicons/dist/svg/trash-outline.svg?raw';
import iconPrintOutline from '../../../node_modules/ionicons/dist/svg/print-outline.svg?raw';
import iconWaterOutline from '../../../node_modules/ionicons/dist/svg/water-outline.svg?raw';
import iconScaleOutline from '../../../node_modules/ionicons/dist/svg/scale-outline.svg?raw';
import iconTimeOutline from '../../../node_modules/ionicons/dist/svg/time-outline.svg?raw';
import iconLocationOutline from '../../../node_modules/ionicons/dist/svg/location-outline.svg?raw';
import iconRepeatOutline from '../../../node_modules/ionicons/dist/svg/repeat-outline.svg?raw';
import iconHelpCircleOutline from '../../../node_modules/ionicons/dist/svg/help-circle-outline.svg?raw';
import iconLogoApple from '../../../node_modules/ionicons/dist/svg/logo-apple.svg?raw';
import iconLogoGoogle from '../../../node_modules/ionicons/dist/svg/logo-google.svg?raw';
import iconLogOutOutline from '../../../node_modules/ionicons/dist/svg/log-out-outline.svg?raw';
import iconRemove from '../../../node_modules/ionicons/dist/svg/remove.svg?raw';

/**
 * Only glyphs the mobile app uses (mobile/src, @expo/vector-icons Ionicons).
 * Adding a name here requires a mobile precedent.
 */
export const ICON_NAMES = [
  'home-outline',
  'home',
  'calendar-outline',
  'calendar',
  'medical-outline',
  'medical',
  'sparkles-outline',
  'sparkles',
  'add-outline',
  'medkit-outline',
  'checkbox-outline',
  'checkbox',
  'square-outline',
  'document-text-outline',
  'pulse-outline',
  'heart-outline',
  'people-outline',
  'settings-outline',
  'arrow-back',
  'send',
  'create-outline',
  'share-outline',
  'download-outline',
  'options-outline',
  'close-outline',
  'person-circle-outline',
  'person-outline',
  'lock-closed-outline',
  'eye-outline',
  'eye-off-outline',
  'call-outline',
  'chevron-forward',
  'chevron-back',
  'chevron-down',
  'pencil-outline',
  'alert-circle-outline',
  'checkmark',
  'checkmark-circle',
  'ellipse-outline',
  'mail-outline',
  'trending-up',
  'trending-down',
  'ellipsis-horizontal',
  'notifications-outline',
  'trash-outline',
  'print-outline',
  'water-outline',
  'scale-outline',
  'time-outline',
  'location-outline',
  'repeat-outline',
  'help-circle-outline',
  'logo-apple',
  'logo-google',
  'log-out-outline', // mobile ProfileScreen sign-out row
  'remove', // mobile VitalsDetailScreen's stable-trend glyph
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** Raw SVG markup for every allowed icon, keyed by name. See Icon.tsx. */
export const ICON_FILES: Record<IconName, string> = {
  'home-outline': iconHomeOutline,
  home: iconHome,
  'calendar-outline': iconCalendarOutline,
  calendar: iconCalendar,
  'medical-outline': iconMedicalOutline,
  medical: iconMedical,
  'sparkles-outline': iconSparklesOutline,
  sparkles: iconSparkles,
  'add-outline': iconAddOutline,
  'medkit-outline': iconMedkitOutline,
  'checkbox-outline': iconCheckboxOutline,
  checkbox: iconCheckbox,
  'square-outline': iconSquareOutline,
  'document-text-outline': iconDocumentTextOutline,
  'pulse-outline': iconPulseOutline,
  'heart-outline': iconHeartOutline,
  'people-outline': iconPeopleOutline,
  'settings-outline': iconSettingsOutline,
  'arrow-back': iconArrowBack,
  send: iconSend,
  'create-outline': iconCreateOutline,
  'share-outline': iconShareOutline,
  'download-outline': iconDownloadOutline,
  'options-outline': iconOptionsOutline,
  'close-outline': iconCloseOutline,
  'person-circle-outline': iconPersonCircleOutline,
  'person-outline': iconPersonOutline,
  'lock-closed-outline': iconLockClosedOutline,
  'eye-outline': iconEyeOutline,
  'eye-off-outline': iconEyeOffOutline,
  'call-outline': iconCallOutline,
  'chevron-forward': iconChevronForward,
  'chevron-back': iconChevronBack,
  'chevron-down': iconChevronDown,
  'pencil-outline': iconPencilOutline,
  'alert-circle-outline': iconAlertCircleOutline,
  checkmark: iconCheckmark,
  'checkmark-circle': iconCheckmarkCircle,
  'ellipse-outline': iconEllipseOutline,
  'mail-outline': iconMailOutline,
  'trending-up': iconTrendingUp,
  'trending-down': iconTrendingDown,
  'ellipsis-horizontal': iconEllipsisHorizontal,
  'notifications-outline': iconNotificationsOutline,
  'trash-outline': iconTrashOutline,
  'print-outline': iconPrintOutline,
  'water-outline': iconWaterOutline,
  'scale-outline': iconScaleOutline,
  'time-outline': iconTimeOutline,
  'location-outline': iconLocationOutline,
  'repeat-outline': iconRepeatOutline,
  'help-circle-outline': iconHelpCircleOutline,
  'logo-apple': iconLogoApple,
  'logo-google': iconLogoGoogle,
  'log-out-outline': iconLogOutOutline,
  remove: iconRemove,
};
