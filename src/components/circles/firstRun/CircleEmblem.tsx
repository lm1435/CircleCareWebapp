import type { CSSProperties, ReactElement } from 'react';
import { prefersReducedMotion } from '@/components/ui/motion';

/**
 * M2 / M5 (motion.md): the circle emblem. The care recipient's initial on a clay disc inside a dashed
 * guide ring; a moss ring that draws to 85% and HOLDS until the circle exists (`state="forming"`), then
 * closes (`"ready"`) and the owner's dot pops onto it; an open seat (dashed, with a plus) for the one
 * caregiver the free plan includes; `seatFilled` once an invite link was shared (never "joined").
 *
 * Decorative: `aria-hidden`. The words around it carry the meaning (the title is the live region).
 * Under prefers-reduced-motion no animation class is applied, so the END frame renders at once.
 */
export type EmblemState = 'forming' | 'ready' | 'failed';

export interface CircleEmblemProps {
  initial: string;
  ownerInitial?: string;
  state: EmblemState;
  size?: number;
  seatFilled?: boolean;
}

const R = 46;
const C = 2 * Math.PI * R;

export function CircleEmblem({
  initial,
  ownerInitial,
  state,
  size = 168,
  seatFilled = false,
}: CircleEmblemProps): ReactElement {
  const still = prefersReducedMotion();
  const ringStyle = {
    '--cc-ring-c': `${C}`,
    '--cc-ring-hold': `${C * 0.15}`,
    strokeDasharray: `${C}`,
  } as CSSProperties;
  const ready = state === 'ready';
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-testid="circle-emblem"
      data-state={state}
      data-reduced-motion={still ? 'true' : 'false'}
      className="block"
    >
      <circle cx="60" cy="60" r={R} fill="none" strokeWidth="1.5" strokeDasharray="3 4" className="stroke-line-strong" />
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
        className={`stroke-moss ${still ? '' : 'cc-fr-ring'}`}
        style={still ? { strokeDasharray: `${C}`, strokeDashoffset: ready ? 0 : state === 'failed' ? C : C * 0.15 } : ringStyle}
        data-closed={ready ? 'true' : 'false'}
        data-failed={state === 'failed' ? 'true' : 'false'}
        data-testid="circle-emblem-ring"
      />
      <g className={still ? '' : 'cc-fr-pop'} style={{ transformOrigin: '60px 60px' }}>
        <circle cx="60" cy="60" r="30" className="fill-clay" />
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" fontSize="26" fontWeight="600" className="fill-on-primary">
          {initial}
        </text>
      </g>
      {ready && ownerInitial ? (
        <g className={still ? '' : 'cc-fr-pop'} style={{ transformOrigin: '60px 14px' }} data-testid="circle-emblem-owner">
          <circle cx="60" cy="14" r="11" className="fill-moss stroke-bg" strokeWidth="2" />
          <text x="60" y="14" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="600" className="fill-on-primary">
            {ownerInitial}
          </text>
        </g>
      ) : null}
      {ready ? (
        <g data-testid="circle-emblem-seat" data-filled={seatFilled ? 'true' : 'false'}>
          <circle
            cx="27"
            cy="93"
            r="10"
            strokeWidth="1.5"
            strokeDasharray={seatFilled ? undefined : '2 2.5'}
            className={seatFilled ? `fill-dusk stroke-bg ${still ? '' : 'cc-fr-pop'}` : 'fill-bg stroke-dusk'}
            style={{ transformOrigin: '27px 93px' }}
          />
          {seatFilled ? null : (
            <path d="M27 88.5v9M22.5 93h9" strokeWidth="1.5" strokeLinecap="round" className="stroke-dusk" />
          )}
        </g>
      ) : null}
    </svg>
  );
}
