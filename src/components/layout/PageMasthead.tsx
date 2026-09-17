import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, CircleButton, Eyebrow, Icon, Text, type IconName } from '@/components/ui';

/**
 * The section colours a masthead eyebrow can take (spec §5.4). A subset of
 * `EyebrowColor` — `ink-2` is body chrome, never a section.
 */
export type MastheadTone = 'moss' | 'clay' | 'dusk' | 'terracotta' | 'coral' | 'ink-3';

export interface MastheadAction {
  name: IconName;
  /** The action's name. Labels the round control below xl and the button at xl. */
  label: string;
  onClick?: () => void;
  to?: string;
  /**
   * Disables both renderings of the action (e.g. a storage-full upload entry
   * point). `title`, when given, becomes a native tooltip explaining why —
   * pass the same storage-full copy shown elsewhere on the page.
   */
  disabled?: boolean;
  title?: string;
  /**
   * The action is in progress (an export being generated): the labelled
   * button shows its spinner (`loading`), the round control is `aria-busy`,
   * and both are disabled. Distinct from `disabled` so a screen reader hears
   * "busy" rather than an unexplained dead control.
   */
  busy?: boolean;
}

export interface PageMastheadProps {
  /** Translated section name for the eyebrow (e.g. "Care", "Health"). */
  section: string;
  tone: MastheadTone;
  title: string;
  subtitle?: string;
  /** Renders the back control below xl (the sidebar is the way back at xl). */
  backTo?: string;
  rightAction?: MastheadAction;
  /**
   * A second, lesser action (e.g. Print beside Edit). Renders next to
   * `rightAction` at both widths: a second round control in the chrome strip
   * below xl, a `secondary` button before the primary at xl. Ignored without
   * a `rightAction` — a lone secondary action is just the right action.
   */
  secondaryAction?: MastheadAction;
  /** 32/600 title instead of 42/600, for titles that would wrap to three lines. */
  compact?: boolean;
  /** Rendered beneath the subtitle — the Care/Health `SegmentedControl`. */
  children?: ReactNode;
}

/**
 * A fixed 44×44 slot on each end of row 1. It stays even when its control is
 * hidden (`xl:hidden`) or absent, because the eyebrow is centred by having
 * equal weight on both sides — an empty end would slide it off centre.
 */
const SPACER = 'flex h-11 w-11 shrink-0 items-center justify-center';
/**
 * The end slots when the strip holds TWO round controls: both ends widen to
 * the same 44+8+44 so the eyebrow stays centred between equal weights.
 */
const SPACER_WIDE = 'flex h-11 w-[96px] shrink-0 items-center gap-2';

/**
 * The page header every interior page wears (spec §5.4; mobile `Shell`'s top
 * bar plus its editorial header).
 *
 * Row 1 is the 44-tall chrome strip: back · section eyebrow · right action.
 * Row 2 is the editorial block: 42/600 title, then the subtitle.
 *
 * The right action renders TWICE by design. Below xl it is mobile's icon-only
 * `CircleButton` in the chrome strip; from xl up that same action reappears on
 * the title row as a labelled `primary` button, because a mouse user reading a
 * wide page needs the action named, not guessed from a glyph (spec §5.4). Only
 * one is ever visible.
 */
export function PageMasthead({
  section,
  tone,
  title,
  subtitle,
  backTo,
  rightAction,
  secondaryAction: secondaryActionProp,
  compact = false,
  children,
}: PageMastheadProps): ReactElement {
  const { t } = useTranslation('common');
  const secondaryAction = rightAction ? secondaryActionProp : undefined;
  const endSlot = secondaryAction ? SPACER_WIDE : SPACER;

  return (
    <header>
      {/* Mobile Shell.topBar: 12 above (past the status bar), 4 below. On web
          the 60px app header sits directly above this strip, so without the
          12 the eyebrow row hugged its rule while the title block below kept
          its full 28 — the row read as jammed against the header. */}
      <div className="flex min-h-[44px] items-center justify-between px-5 pb-1 pt-3">
        <span className={`${endSlot} ${secondaryAction ? 'justify-start' : ''}`}>
          {backTo && (
            <CircleButton
              name="arrow-back"
              label={t('nav.back')}
              to={backTo}
              className="xl:hidden"
            />
          )}
        </span>

        <Eyebrow dot color={tone} as="p">
          {section}
        </Eyebrow>

        {/* `data-print-hide`: actions are chrome, never part of a printed
            sheet (spec §6.6) — print.css hides the whole header anyway, the
            attribute makes the intent explicit and testable. */}
        <span
          className={`${endSlot} ${secondaryAction ? 'justify-end' : ''}`}
          data-print-hide
        >
          {secondaryAction && (
            <CircleButton
              name={secondaryAction.name}
              label={secondaryAction.label}
              {...(secondaryAction.to
                ? { to: secondaryAction.to }
                : { onClick: secondaryAction.onClick })}
              disabled={secondaryAction.disabled || secondaryAction.busy}
              aria-busy={secondaryAction.busy || undefined}
              title={secondaryAction.title}
              className="xl:hidden"
            />
          )}
          {rightAction && (
            <CircleButton
              name={rightAction.name}
              label={rightAction.label}
              {...(rightAction.to ? { to: rightAction.to } : { onClick: rightAction.onClick })}
              disabled={rightAction.disabled || rightAction.busy}
              aria-busy={rightAction.busy || undefined}
              title={rightAction.title}
              className="xl:hidden"
            />
          )}
        </span>
      </div>

      {/* 16 above the title, not mobile's 28: the chrome strip above is a
          44px row with the eyebrow centred in it, so its own slack already
          separates the two — the full 28 read as a hole between them. */}
      <div className="px-7 pb-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <Text variant={compact ? 'editorialTitleCompact' : 'editorialTitle'}>{title}</Text>
          {/* Labelled desktop action. The `hidden` lives on a WRAPPER: on the Button
              itself it lost the cascade to Button's own `inline-flex` (Tailwind emits
              `.hidden` first), so both actions showed at phone width. */}
          {rightAction && (
            <span className="hidden gap-3 xl:inline-flex" data-print-hide>
            {secondaryAction &&
              (secondaryAction.to ? (
                <Button
                  as={Link}
                  to={secondaryAction.to}
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icon name={secondaryAction.name} size="row" />}
                  disabled={secondaryAction.disabled}
                  title={secondaryAction.title}
                >
                  {secondaryAction.label}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={secondaryAction.onClick}
                  leftIcon={<Icon name={secondaryAction.name} size="row" />}
                  disabled={secondaryAction.disabled}
                  loading={secondaryAction.busy}
                  title={secondaryAction.title}
                >
                  {secondaryAction.label}
                </Button>
              ))}
            {rightAction.to ? (
              <Button
                as={Link}
                to={rightAction.to}
                variant="primary"
                size="sm"
                leftIcon={<Icon name={rightAction.name} size="row" />}
                disabled={rightAction.disabled}
                title={rightAction.title}
              >
                {rightAction.label}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={rightAction.onClick}
                leftIcon={<Icon name={rightAction.name} size="row" />}
                disabled={rightAction.disabled}
                loading={rightAction.busy}
                title={rightAction.title}
              >
                {rightAction.label}
              </Button>
            )}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-3.5 text-md font-medium leading-[22.5px] text-ink">{subtitle}</p>
        )}
      </div>

      {children}
    </header>
  );
}
