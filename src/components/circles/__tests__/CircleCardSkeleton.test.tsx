import { render } from '@testing-library/react';
import { CircleCardSkeleton } from '@/components/circles/CircleCardSkeleton';

describe('CircleCardSkeleton', () => {
  it('uses the same 12px padding as the real card shell', () => {
    const { container } = render(
      <ul>
        <CircleCardSkeleton />
      </ul>
    );

    // The card content wrapper (avatar + text placeholders) is `p-3` — the
    // same 12px CircleCard uses, so the skeleton and the settled card are the
    // same height and nothing shifts once the real data lands.
    const contentRow = container.querySelector('.p-3');
    expect(contentRow).not.toBeNull();
    expect(contentRow?.className).toContain('flex');

    // Three placeholder blocks: avatar, name, subtitle.
    expect(container.querySelectorAll('[aria-hidden="true"].cc-shimmer')).toHaveLength(3);
  });
});
