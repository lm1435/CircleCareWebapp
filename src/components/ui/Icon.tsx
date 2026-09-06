import { ICON_FILES, type IconName } from './iconNames';

export type IconSize = 'meta' | 'inline' | 'row' | 'chrome' | 'fab' | number;
/** Mobile's icon tiers (mobile/src/theme/index.ts `icon`), plus fab=28 for the nav "+". */
const SIZE: Record<Exclude<IconSize, number>, number> = {
  meta: 14,
  inline: 16,
  row: 20,
  chrome: 24,
  fab: 28,
};

// SVG source: an explicit `?raw` import per icon name (iconNames.ts#ICON_FILES),
// not an eager `import.meta.glob` over all 1357 ionicons/dist/svg/*.svg files.
// Measured: the eager glob (all files, always resolved) bundled 883 KB raw /
// 209 KB gzip for the icon module alone. The explicit-import form only pulls
// in the ~55 names actually referenced, and is fully tree-shakeable.

export interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
  /** When given, the icon is announced (role="img"); otherwise it is decorative (aria-hidden). */
  label?: string;
}

export function Icon({ name, size = 'row', className, label }: IconProps) {
  const px = typeof size === 'number' ? size : SIZE[size];
  const raw = ICON_FILES[name];
  if (!raw) throw new Error(`Unknown icon: ${name}`);
  const svg = raw.replace(
    '<svg',
    `<svg width="${px}" height="${px}" fill="currentColor" stroke="currentColor"${
      label ? '' : ' aria-hidden="true"'
    } focusable="false"`,
  );
  return (
    <span
      className={`inline-flex shrink-0 leading-none ${className ?? ''}`.trim()}
      style={{ width: px, height: px }}
      role={label ? 'img' : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
