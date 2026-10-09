import { useRef, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui/Icon';
import {
  AVATAR_COLOR_KEYS,
  avatarGradientForKey,
  isAvatarColorKey,
  type AvatarColorKey,
} from '@/components/ui/Avatar';

export interface AvatarColorPickerProps {
  /** Saved palette key; null/unknown = the member never chose (name-derived). */
  value?: string | null;
  onChange: (key: AvatarColorKey) => void;
  disabled?: boolean;
  /**
   * A save is in flight: presses are ignored but the swatches STAY focusable
   * (`aria-disabled`). A native `disabled` on the focused swatch drops keyboard
   * focus to <body> (WCAG 2.4.3). Use `disabled` only when unavailable.
   */
  busy?: boolean;
}

/**
 * Member colour picker: a `radiogroup` of the six avatar palette keys, the
 * twin of mobile's `AvatarColorPicker`.
 *
 * - Selection is a ring AND a check mark, never colour alone (WCAG 1.4.1).
 * - Each swatch is a 44x44 `role="radio"` button named by its colour (EN/ES
 *   `profile:avatarColor.names.*`) with `aria-checked`.
 * - Roving tabindex: one tab stop; ArrowLeft/Right/Up/Down/Home/End move FOCUS
 *   only, Space/Enter choose. (Selection-follows-focus would fire a save per
 *   arrow press.) The global `*:focus-visible` ring shows the focus.
 */
export function AvatarColorPicker({
  value,
  onChange,
  disabled = false,
  busy = false,
}: AvatarColorPickerProps): ReactElement {
  const { t } = useTranslation('profile');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = isAvatarColorKey(value) ? AVATAR_COLOR_KEYS.indexOf(value) : -1;
  const tabbable = selectedIndex >= 0 ? selectedIndex : 0;
  const count = AVATAR_COLOR_KEYS.length;
  // Literal keys (not a template) so the translation-key scan resolves them.
  const names: Record<AvatarColorKey, string> = {
    moss: t('avatarColor.names.moss'),
    coral: t('avatarColor.names.coral'),
    dusk: t('avatarColor.names.dusk'),
    clay: t('avatarColor.names.clay'),
    forest: t('avatarColor.names.forest'),
    amber: t('avatarColor.names.amber'),
  };

  function onKeyDown(index: number, event: KeyboardEvent<HTMLButtonElement>): void {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('avatarColor.pickerTitle')}
      className="flex flex-wrap gap-2"
      data-testid="avatar-color-picker"
    >
      {AVATAR_COLOR_KEYS.map((key, index) => {
        const selected = index === selectedIndex;
        const [from, to] = avatarGradientForKey(key);
        return (
          <button
            key={key}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={names[key]}
            data-testid={`avatar-color-${key}`}
            disabled={disabled}
            aria-disabled={busy && !disabled ? true : undefined}
            tabIndex={index === tabbable ? 0 : -1}
            onClick={() => {
              if (!busy) onChange(key);
            }}
            onKeyDown={(event) => onKeyDown(index, event)}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-2 bg-transparent p-0 transition-colors duration-fast aria-disabled:cursor-not-allowed ${
              selected ? 'border-ink' : 'border-transparent'
            }`}
          >
            <span
              aria-hidden="true"
              className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full text-cream"
              style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
            >
              {selected ? <Icon name="checkmark" size="chrome" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
