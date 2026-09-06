export {
  Accordion,
  useAccordionGroup,
  type AccordionProps,
  type AccordionGroup,
  type UseAccordionGroupOptions,
} from './Accordion';
export { Avatar, avatarGradientFor, AVATAR_GRADIENTS, type AvatarProps, type AvatarSize } from './Avatar';
export { EmptyState, type EmptyStateProps, type EmptyStateTone } from './EmptyState';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export {
  MoreMenu,
  type MoreMenuProps,
  type MoreMenuItem,
  type MoreMenuEntry,
  type MoreMenuDivider,
  type MoreMenuTriggerProps,
} from './MoreMenu';
export { Card, type CardProps, type CardVariant, type CardPadding } from './Card';
export { SectionHeader, type SectionHeaderProps, type SectionHeaderTone } from './SectionHeader';
export {
  Badge,
  type BadgeProps,
  type BadgeVariant,
  type BadgeVariantName,
  type BadgeSize,
} from './Badge';
export { Spinner, type SpinnerProps } from './Spinner';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { ToastProvider, useToast, type Toast, type ToastType } from './Toast';
export { Modal, type ModalProps } from './Modal';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { TextField, type TextFieldProps } from './TextField';
export { TextArea, type TextAreaProps } from './TextArea';
export { TagInput, type TagInputProps } from './TagInput';
export { ChipSelect, type ChipSelectProps, type ChipSelectOption } from './ChipSelect';
export { Select, type SelectProps, type SelectOption } from './Select';
export { DateField, type DateFieldProps } from './DateField';
export { TimeField, type TimeFieldProps } from './TimeField';
export { Toggle, type ToggleProps } from './Toggle';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './RadioGroup';
export { RequiredMarker } from './RequiredMarker';
export {
  useZodForm,
  validateWithZod,
  focusFirstError,
  type FieldErrors,
  type UseZodFormResult,
} from './useZodForm';
export {
  careCardSurface,
  careCardSurfaceMuted,
  careCardShell,
  careCardTopRow,
  careCardLeading,
  careCardTitle,
  careCardBadgeRow,
  careCardMeta,
  careCardMetaDetail,
  careCardStatusPill,
  careCardActionsInline,
  careCardActionsRow,
  careCardActionBtn,
  careCardActionPrimary,
  careCardActionSecondary,
  careCardActionText,
  careCardListGap,
  STATUS_PILL,
  // Deprecated aliases (removed in Task 24)
  careCardNameRow,
  careCardStatusPush,
  careCardActions,
} from './careCard';

// ── Wave 1 (mobile-parity) primitives ────────────────────────────────────
export { Text, TEXT_CLASS, type TextProps, type TextVariant } from './Text';
export { Icon, type IconProps, type IconSize } from './Icon';
export { ICON_NAMES, ICON_FILES, type IconName } from './iconNames';
export {
  Sheet,
  SheetRow,
  SheetRowPressable,
  type SheetProps,
  type SheetRowProps,
  type SheetRowPressableProps,
  type SheetPadding,
} from './Sheet';
export { IconTile, type IconTileProps, type IconTileTone, type IconTileSize } from './IconTile';
export { CircleButton, type CircleButtonProps } from './CircleButton';
export { Eyebrow, type EyebrowProps, type EyebrowColor } from './Eyebrow';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedControlOption,
  type SegmentedControlChangeMeta,
} from './SegmentedControl';
export { UndoBadge, type UndoBadgeProps, type UndoBadgeKind } from './UndoBadge';
export {
  INPUT_SHELL,
  INPUT_SHELL_MULTILINE,
  INPUT_SHELL_ERROR,
  INPUT_SHELL_DISABLED,
  INPUT_TEXT,
  INPUT_TRAILING,
  INPUT_LABEL,
  INPUT_HINT,
  INPUT_ERROR,
  PICKER_INDICATOR_OVERLAY,
  CHIP_BASE,
  CHIP_SELECTED,
  CHIP_UNSELECTED,
  OPTION_ROW,
  OPTION_ROW_SELECTED,
  fieldShell,
  chipClass,
  optionRow,
  type FieldShellOptions,
} from './inputStyles';
