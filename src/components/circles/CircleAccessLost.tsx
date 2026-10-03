import { useEffect, useRef, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { TerminalState } from '@/components/auth/TerminalState';

export type CircleAccessLostReason = 'FORBIDDEN' | 'NOT_FOUND';

/**
 * The "access removed" state for a circle whose READ answered FORBIDDEN or NOT_FOUND
 * (removed by the owner / circle deleted). Rendered once, at the circle layout, in
 * place of every circle page. Mobile twin: the error branch of CircleDetailScreen
 * (same copy, same two variants: FORBIDDEN = "Access removed", NOT_FOUND = "Circle
 * not found"). 5xx / network failures never get here — pages keep their retry cards.
 *
 * a11y: the single <h1> takes focus on mount (this replaces the page the user was
 * on, so focus would otherwise fall back to <body>), and the action is a real link.
 */
export function CircleAccessLost({ reason }: { reason: CircleAccessLostReason }): ReactElement {
  const { t } = useTranslation('circles');
  const ref = useRef<HTMLDivElement>(null);
  const forbidden = reason === 'FORBIDDEN';

  useEffect(() => {
    const h1 = ref.current?.querySelector('h1');
    if (!h1) return;
    h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: true });
  }, [reason]);

  return (
    <div ref={ref} className="mx-auto w-full max-w-md px-4 py-16" data-testid="circle-access-lost">
      <TerminalState
        icon={forbidden ? 'lock-closed-outline' : 'alert-circle-outline'}
        title={t(forbidden ? 'accessLost.removedTitle' : 'accessLost.notFoundTitle')}
        body={t(forbidden ? 'accessLost.removedBody' : 'accessLost.notFoundBody')}
      >
        <Button as={Link} to="/circles" variant="primary" size="lg" fullWidth>
          {t('accessLost.returnToCircles')}
        </Button>
      </TerminalState>
    </div>
  );
}
