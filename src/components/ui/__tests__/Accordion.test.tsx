import { render, screen, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Accordion, useAccordionGroup } from '../Accordion';

// A tiny controlled host so we can exercise the disclosure pattern end-to-end.
function Host({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <Accordion
      id="sec"
      title="Doctors"
      meta={3}
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <p>panel body</p>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('renders a disclosure button wired to the panel region', () => {
    render(<Host />);
    const button = screen.getByRole('button', { name: /Doctors/ });
    expect(button).toHaveAttribute('aria-expanded', 'true');

    const region = screen.getByRole('region', { name: 'Doctors' });
    expect(button).toHaveAttribute('aria-controls', region.id);
    // Region is named by the title span (not the whole button), so the chevron
    // + meta count don't leak into its accessible name.
    expect(region).toHaveAttribute('aria-labelledby', 'sec-accordion-title');

    // Header reads as an h2 title; meta count is present.
    expect(screen.getByRole('heading', { level: 2, name: /Doctors/ })).toBeInTheDocument();
    expect(button).toHaveTextContent('3');
  });

  it('renders a level-3 heading when headingAs="h3" (nested accordion use)', () => {
    render(
      <Accordion id="q1" title="Question one" open onToggle={() => {}} headingAs="h3">
        <p>answer</p>
      </Accordion>
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Question one' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Question one' })
    ).not.toBeInTheDocument();
  });

  it('toggles aria-expanded and the animated panel height', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const button = screen.getByRole('button', { name: /Doctors/ });
    const region = screen.getByRole('region', { name: 'Doctors' });

    // The grid trick: one row easing 1fr <-> 0fr is the only way to transition
    // to a content-derived height without measuring it in JS.
    expect(region.className).toContain('grid');
    expect(region.className).toContain('transition-[grid-template-rows]');
    expect(region.className).toContain('duration-normal');
    expect(region.className).toContain('ease-spring');
    expect(region.className).toContain('[grid-template-rows:1fr]');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // Same node persists (panel is never unmounted); the row collapses.
    expect(region.className).toContain('[grid-template-rows:0fr]');
    // ...and the un-prefixed 1fr is gone (the `print:` one legitimately stays).
    expect(region.className).not.toContain(' [grid-template-rows:1fr]');
  });

  it('keeps the panel content MOUNTED when collapsed (print/SR reachability)', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const region = screen.getByRole('region', { name: 'Doctors' });
    await user.click(screen.getByRole('button', { name: /Doctors/ }));

    // Collapsed to zero height, but still in the DOM, and print re-expands it.
    expect(screen.getByText('panel body')).toBeInTheDocument();
    expect(region).toBeInTheDocument();
    expect(region.className).toContain('print:[grid-template-rows:1fr]');
    expect(region.className).toContain('[grid-template-rows:0fr]');
    // The collapsing row only works if the grid item drops its auto minimum.
    const inner = region.firstElementChild as HTMLElement;
    expect(inner.className).toContain('overflow-hidden');
    expect(inner.className).toContain('min-h-0');
  });

  it('rotates the chevron 180° when open and hides it in print', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host />);
    const chevron = () => container.querySelector('svg')!.parentElement!;

    expect(chevron().className).toContain('rotate-180');
    expect(chevron().className).toContain('transition-transform');
    expect(chevron().className).toContain('print:hidden');

    await user.click(screen.getByRole('button', { name: /Doctors/ }));
    expect(chevron().className).not.toContain('rotate-180');
  });

  it('gives the header row a 44px minimum touch target', () => {
    render(<Host />);
    expect(screen.getByRole('button', { name: /Doctors/ }).className).toContain('min-h-[44px]');
  });

  it('marks the panel `inert` while collapsed so its controls leave the tab order', () => {
    render(
      <Accordion id="sec" title="Doctors" open={false} onToggle={() => {}}>
        <button>Focus me</button>
      </Accordion>
    );
    // A zero-height overflow-hidden panel is still focusable — unlike the
    // `display:none` this replaced — so without `inert` a keyboard user tabs
    // into a section they just closed. (jsdom does not implement inert's focus
    // semantics, so the attribute is what we can assert here.)
    const panel = document.getElementById('sec-accordion-panel')!;
    expect(panel.hasAttribute('inert')).toBe(true);
    // Still mounted underneath, for print.
    expect(screen.getByRole('button', { name: 'Focus me' })).toBeInTheDocument();
    // Never `inert="true"` — an unknown boolean stringified by React 18 would
    // read as inert in both states, since `inert` is a boolean attribute.
    expect(panel.getAttribute('inert')).toBe('');
  });

  it('drops `inert` when open, and flips it back on collapse', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const panel = document.getElementById('sec-accordion-panel')!;
    expect(panel.hasAttribute('inert')).toBe(false);

    await user.click(screen.getByRole('button', { name: /Doctors/ }));
    expect(panel.hasAttribute('inert')).toBe(true);

    await user.click(screen.getByRole('button', { name: /Doctors/ }));
    expect(panel.hasAttribute('inert')).toBe(false);
  });
});

describe('useAccordionGroup', () => {
  it('defaults all ids open and reflects allOpen/anyOpen', () => {
    const { result } = renderHook(() => useAccordionGroup(['a', 'b']));
    expect(result.current.isOpen('a')).toBe(true);
    expect(result.current.isOpen('b')).toBe(true);
    expect(result.current.allOpen).toBe(true);
    expect(result.current.anyOpen).toBe(true);
  });

  it('defaults all closed when defaultOpen is false', () => {
    const { result } = renderHook(() => useAccordionGroup(['a', 'b'], { defaultOpen: false }));
    expect(result.current.isOpen('a')).toBe(false);
    expect(result.current.allOpen).toBe(false);
    expect(result.current.anyOpen).toBe(false);
  });

  it('toggle flips a single id', () => {
    const { result } = renderHook(() => useAccordionGroup(['a', 'b']));
    act(() => result.current.toggle('a'));
    expect(result.current.isOpen('a')).toBe(false);
    expect(result.current.isOpen('b')).toBe(true);
    expect(result.current.allOpen).toBe(false);
    expect(result.current.anyOpen).toBe(true);
  });

  it('collapseAll then expandAll drive the whole group', () => {
    const { result } = renderHook(() => useAccordionGroup(['a', 'b']));
    act(() => result.current.collapseAll());
    expect(result.current.allOpen).toBe(false);
    expect(result.current.anyOpen).toBe(false);

    act(() => result.current.expandAll());
    expect(result.current.allOpen).toBe(true);
  });

  it('ids that arrive AFTER a bulk action honor that action', () => {
    // Simulates async-loaded groups (e.g. Vitals types arriving with data).
    let ids = ['a'];
    const { result, rerender } = renderHook(() => useAccordionGroup(ids));
    act(() => result.current.collapseAll());
    expect(result.current.isOpen('a')).toBe(false);

    ids = ['a', 'b'];
    rerender();
    // 'b' was never seen at collapse time, but the bulk mode still applies.
    expect(result.current.isOpen('b')).toBe(false);
    expect(result.current.allOpen).toBe(false);
  });
});
