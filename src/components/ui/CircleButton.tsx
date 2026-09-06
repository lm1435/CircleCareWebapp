import { createElement, type ElementType, type HTMLAttributes, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconSize } from './Icon';
import type { IconName } from './iconNames';

/** Spec §4.5 / mobile `Shell.circleBtn`: 44×44, white, 1px line, `--shadow-btn`. */
const BASE =
  'w-11 h-11 rounded-full bg-cream inline-flex items-center justify-center text-ink shrink-0 transition-transform duration-fast ease-spring active:scale-[0.97] hover:bg-bg-2';

const WITH_SHADOW = 'border border-line shadow-btn';
/** The auth top bar sits on paper with no elevation; it takes the weaker hair. */
const NO_SHADOW = 'border border-line-2';

export interface CircleButtonProps extends HTMLAttributes<HTMLElement> {
  name: IconName;
  /** Required: the glyph is decorative, so the control needs its own name. */
  label: string;
  /** Route destination — renders a react-router `Link` unless `as` overrides. */
  to?: string;
  as?: ElementType;
  /** Default true. `false` drops the elevation (auth top bar). */
  shadow?: boolean;
  size?: IconSize;
  disabled?: boolean;
}

/** The round 44×44 chrome control: back, page right-action, masthead. */
export function CircleButton({
  name,
  label,
  to,
  as,
  shadow = true,
  size = 'row',
  className,
  ...rest
}: CircleButtonProps): ReactElement {
  const tag: ElementType = as ?? (to ? Link : 'button');
  const cls = [BASE, shadow ? WITH_SHADOW : NO_SHADOW, className].filter(Boolean).join(' ');
  return createElement(
    tag,
    {
      className: cls,
      'aria-label': label,
      ...(tag === 'button' ? { type: 'button' } : { to }),
      ...rest,
    },
    <Icon key="icon" name={name} size={size} />
  );
}
