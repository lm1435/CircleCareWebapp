import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';

export interface NotificationsOffBadgeProps {
  /** Member's first name; a neutral "This member" line is used when missing. */
  firstName?: string | null;
}

/**
 * Owner-only "Notifications off" badge with a one-line explanation tooltip.
 * Its own button (a real control, keyboard focusable) so it never competes
 * with the row. The explanation shows on hover, on keyboard focus and on
 * click/tap (pinned; Escape or an outside press dismisses), and is wired with
 * `aria-describedby`. The tooltip stays in the DOM (hidden attribute) so the
 * description is always resolvable. The button's name is the badge text.
 */
export function NotificationsOffBadge({ firstName }: NotificationsOffBadgeProps): ReactElement {
  const { t } = useTranslation('members');
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;

  useEffect(() => {
    if (!pinned) return undefined;
    const onDown = (e: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned]);

  const name = firstName?.trim();
  const explanation = name
    ? t('member.notificationsOffExplain', { name })
    : t('member.notificationsOffExplainNoName');

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        // Name the member: two badges in one list must not share an accessible name.
        aria-label={name ? t('member.notificationsOffFor', { name }) : undefined}
        aria-describedby={tipId}
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setPinned(false);
            setHover(false);
            setFocus(false);
          }
        }}
        className="inline-flex min-h-6 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss"
      >
        <Badge variant="warning" size="sm" icon="notifications-off-outline">
          {t('member.notificationsOff')}
        </Badge>
      </button>
      <span
        id={tipId}
        role="tooltip"
        hidden={!open}
        className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[80vw] rounded-md bg-ink px-3 py-2 text-xs text-cream shadow-md"
      >
        {explanation}
      </span>
    </span>
  );
}
