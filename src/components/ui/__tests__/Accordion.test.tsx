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

  it('toggles aria-expanded and the panel visibility class', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const button = screen.getByRole('button', { name: /Doctors/ });
    const region = screen.getByRole('region', { name: 'Doctors' });

    expect(region.className).toContain('block');
    expect(region.className).not.toContain('hidden');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // Same node persists (panel is never unmounted); class flips to hidden.
    expect(region.className).toContain('hidden');
  });

  it('keeps the panel content MOUNTED when collapsed (print/SR reachability)', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const region = screen.getByRole('region', { name: 'Doctors' });
    await user.click(screen.getByRole('button', { name: /Doctors/ }));

    // Visually hidden, but still in the DOM with print:block so @media print shows it.
    expect(screen.getByText('panel body')).toBeInTheDocument();
    expect(region).toBeInTheDocument();
    expect(region.className).toContain('print:block');
    expect(region.className).toContain('hidden');
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
