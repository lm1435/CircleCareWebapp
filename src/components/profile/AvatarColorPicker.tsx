import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui/Icon';
import {
  Avatar,
  AVATAR_QUICK_PICKS,
  avatarDynVars,
  avatarGradientForKey,
  AVATAR_EXTRA_COLORS,
  isAvatarColorKey,
  type AvatarColorKey,
} from '@/components/ui/Avatar';
import { formatHue, hexToHsl, hueGradientLight, parseHue } from '@/lib/avatarHue';

/** Pause after the last change with no pointer/key held before the value is saved. */
const IDLE_COMMIT_MS = 700;

export type AvatarColorSource = 'quick_pick' | 'custom_hue';

export interface AvatarColorPickerProps {
  /** Saved value (palette key or `hue:N`); null/unknown = the member never chose (name-derived). */
  value?: string | null;
  /** Drives the preview initial and the name-hash fallback. */
  name?: string;
  onChange: (value: string, source: AvatarColorSource) => void;
  disabled?: boolean;
  /**
   * A save is in flight: presses are ignored but the controls STAY focusable
   * (`aria-disabled`). A native `disabled` on the focused swatch drops keyboard
   * focus to <body> (WCAG 2.4.3). Use `disabled` only when unavailable.
   */
  busy?: boolean;
}

// One stop per 30 degrees plus the wrap, painted with the same function the avatar uses.
const RAINBOW_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 359];
/** The thumb is 28px wide, so its centre travels from 14px to (width - 14px): the rainbow spans that range. */
const THUMB_HALF = 14;
export const RAINBOW_GRADIENT = `linear-gradient(90deg, ${[
  `${hueGradientLight(0)[0]} 0`,
  ...RAINBOW_HUES.map(
    (h, i) =>
      `${hueGradientLight(h)[0]} calc(${THUMB_HALF}px + (100% - ${THUMB_HALF * 2}px) * ${i / (RAINBOW_HUES.length - 1)})`
  ),
  `${hueGradientLight(359)[0]} 100%`,
].join(', ')})`;

/** Light first stops of the quick picks (twin of mobile's gradients), for where the thumb rests. */
const KEY_HEX: Record<AvatarColorKey, string> = {
  moss: '#5C6B4E',
  coral: '#B5453C',
  dusk: '#4A6073',
  clay: '#8B5C32',
  forest: '#4A5940',
  amber: '#7E5620',
  ...AVATAR_EXTRA_COLORS,
};

/** Where the slider rests for a saved value: its hue, a key's own hue, else 0. */
function restingHue(value?: string | null): number {
  const hue = parseHue(value);
  if (hue !== null) return hue;
  if (isAvatarColorKey(value)) return Math.round(hexToHsl(KEY_HEX[value]).h) % 360;
  return 0;
}

/**
 * Member colour picker (1.4.4): a live preview, 12 quick picks (`radiogroup`) and a hue slider.
 * Twin of mobile's `AvatarColorPicker`.
 *
 * - Selection is a ring AND a check mark, never colour alone (WCAG 1.4.1).
 * - Each swatch is a 44x44 `role="radio"` button named by its colour with `aria-checked`.
 * - Roving tabindex: one tab stop; arrows move FOCUS only, Space/Enter choose.
 * - The slider is a native `input[type=range]` (0-359) with `aria-valuetext` "Hue N degrees". It
 *   previews live while moving and saves ONCE: on pointer release or key release (never per change).
 */
export function AvatarColorPicker({
  value,
  name,
  onChange,
  disabled = false,
  busy = false,
}: AvatarColorPickerProps): ReactElement {
  const { t } = useTranslation('profile');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = AVATAR_QUICK_PICKS.findIndex((k) => k === value);
  const tabbable = selectedIndex >= 0 ? selectedIndex : 0;
  const count = AVATAR_QUICK_PICKS.length;
  // The unsaved hue while the thumb moves; null = show the saved value.
  const [draftHue, setDraftHue] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const thumbHue = draftHue ?? restingHue(value);
  const previewValue = draftHue !== null ? formatHue(draftHue) : value;

  // A pointer or key is held on the slider: the release saves. With neither (assistive tech setting the
  // value, a programmatic change) a short pause saves instead, so the value is never left unsaved.
  const pointerDown = useRef(false);
  const keyDown = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<() => void>(() => undefined);

  function clearIdle(): void {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }
  function moveDraft(hue: number): void {
    if (busy || disabled) return;
    draftRef.current = hue;
    setDraftHue(hue);
    clearIdle();
    if (!pointerDown.current && !keyDown.current) {
      idleTimer.current = setTimeout(() => commitRef.current(), IDLE_COMMIT_MS);
    }
  }
  /** Release (or the idle pause): ONE save for the whole gesture; draftRef is emptied so a later release is a no-op. */
  function commitDraft(): void {
    clearIdle();
    const hue = draftRef.current;
    draftRef.current = null;
    setDraftHue(null);
    if (hue === null || busy || disabled) return;
    onChange(formatHue(hue), 'custom_hue');
  }
  // Literal keys (not a template) so the translation-key scan resolves them.
  const names: Record<AvatarColorKey, string> = {
    moss: t('avatarColor.names.moss'),
    coral: t('avatarColor.names.coral'),
    dusk: t('avatarColor.names.dusk'),
    clay: t('avatarColor.names.clay'),
    forest: t('avatarColor.names.forest'),
    amber: t('avatarColor.names.amber'),
    sea: t('avatarColor.names.sea'),
    indigo: t('avatarColor.names.indigo'),
    plum: t('avatarColor.names.plum'),
    berry: t('avatarColor.names.berry'),
    rust: t('avatarColor.names.rust'),
    ochre: t('avatarColor.names.ochre'),
    olive: t('avatarColor.names.olive'),
    slate: t('avatarColor.names.slate'),
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

  commitRef.current = commitDraft;
  // Leaving the page with an unsaved draft still saves it (twin of mobile).
  useEffect(
    () => () => {
      // Any unsaved draft (pause pending, or a pointer/key still held) is saved once on the way out.
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (draftRef.current !== null) commitRef.current();
    },
    []
  );

  return (
    <div className="flex flex-col gap-4" data-testid="avatar-color-picker">
      <div className="flex items-center gap-3" data-testid="avatar-color-preview">
        <Avatar size="lg" name={name} colorKey={previewValue} />
        <div className="min-w-0">
          <p className="m-0 truncate text-base font-semibold text-ink">{name}</p>
          <p className="m-0 text-sm text-ink-3">{t('avatarColor.preview')}</p>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label={t('avatarColor.pickerTitle')}
        className="flex flex-wrap gap-2"
        data-testid="avatar-color-quick-picks"
      >
        {AVATAR_QUICK_PICKS.map((key, index) => {
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
                if (!busy) onChange(key, 'quick_pick');
              }}
              onKeyDown={(event) => onKeyDown(index, event)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-full border-2 bg-transparent p-0 transition-colors duration-fast aria-disabled:cursor-not-allowed ${
                selected ? 'border-ink' : 'border-transparent'
              }`}
            >
              <span
                aria-hidden="true"
                className="avatar-dyn inline-flex h-[34px] w-[34px] items-center justify-center rounded-full text-cream"
                style={{
                  ...avatarDynVars(key),
                  backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
                }}
              >
                {selected ? <Icon name="checkmark" size="chrome" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="avatar-color-hue" className="text-sm text-ink-3">
          {t('avatarColor.hueLabel')}
        </label>
        <input
          id="avatar-color-hue"
          data-testid="avatar-color-hue-slider"
          type="range"
          min={0}
          max={359}
          step={1}
          value={thumbHue}
          disabled={disabled}
          aria-disabled={busy && !disabled ? true : undefined}
          aria-valuetext={t('avatarColor.hueValue', { degrees: thumbHue })}
          onChange={(event) => moveDraft(Number(event.target.value))}
          onPointerDown={() => {
            pointerDown.current = true;
          }}
          onPointerUp={() => {
            pointerDown.current = false;
            commitDraft();
          }}
          onPointerCancel={() => {
            pointerDown.current = false;
            clearIdle();
            draftRef.current = null;
            setDraftHue(null);
          }}
          onKeyDown={() => {
            keyDown.current = true;
          }}
          onKeyUp={(event) => {
            keyDown.current = false;
            if (event.key !== 'Tab' && event.key !== 'Shift') commitDraft();
          }}
          onBlur={() => {
            pointerDown.current = false;
            keyDown.current = false;
            commitDraft();
          }}
          className="hue-range h-11 w-full cursor-pointer"
          style={{ ['--hue-rainbow' as string]: RAINBOW_GRADIENT }}
        />
      </div>
    </div>
  );
}
