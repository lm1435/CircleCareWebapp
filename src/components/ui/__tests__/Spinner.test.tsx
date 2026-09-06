import { render, screen } from '@testing-library/react';
import { Spinner } from '../Spinner';

describe('Spinner', () => {
  it('announces itself as a status with the translated default label', () => {
    render(<Spinner />);
    const status = screen.getByRole('status');
    // i18n is not initialised in unit tests; the key itself is the worst-case
    // fallback the `useSuspense: false` comment describes.
    expect(status.getAttribute('aria-label')).toBeTruthy();
  });

  it('uses an explicit label when given', () => {
    render(<Spinner label="Thinking" />);
    expect(screen.getByRole('status', { name: 'Thinking' })).toBeInTheDocument();
  });

  it('sizes the ring from `size`, defaulting to 24px', () => {
    const { rerender, container } = render(<Spinner />);
    const ring = () => container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(ring().style.width).toBe('24px');
    expect(ring().style.height).toBe('24px');

    rerender(<Spinner size={32} />);
    expect(ring().style.width).toBe('32px');
  });

  it('inherits currentColor rather than hardcoding coral (spec §4.5)', () => {
    const { container } = render(<Spinner />);
    const ring = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(ring.className).toContain('border-current/20');
    expect(ring.className).toContain('border-t-current');
    expect(ring.className).not.toContain('coral');
    expect(ring.className).not.toContain('border-line');
  });

  it('keeps spinning under reduced motion, only slower (it is the only progress signal)', () => {
    const { container } = render(<Spinner />);
    const ring = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(ring.className).toContain('animate-spin');
    expect(ring.className).toContain('motion-reduce:animate-[spin_1.5s_linear_infinite]');
  });

  it('merges a caller className onto the wrapper', () => {
    render(<Spinner className="text-moss" />);
    expect(screen.getByRole('status').className).toContain('text-moss');
  });

  it('decorative: no role, no label, aria-hidden — so it cannot pollute a host control’s name', () => {
    const { container } = render(
      <button type="button" aria-busy>
        <Spinner decorative />
        Save
      </button>
    );
    // Button.loading swaps the label for a spinner; a role="status" here would
    // read the button out as "Loading… Save" and re-announce on every press.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button').textContent).toBe('Save');
    const wrapper = container.querySelector('button > span') as HTMLElement;
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper.hasAttribute('role')).toBe(false);
    expect(wrapper.hasAttribute('aria-label')).toBe(false);
    // Still draws the same ring.
    expect(wrapper.querySelector('span')?.className).toContain('animate-spin');
  });

  it('decorative ignores an accidental label rather than leaking it', () => {
    render(<Spinner decorative label="Thinking" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Thinking')).not.toBeInTheDocument();
  });

  it('spreads remaining HTML attributes onto the root', () => {
    render(<Spinner data-testid="ring" id="save-spinner" />);
    const el = screen.getByTestId('ring');
    expect(el).toHaveAttribute('id', 'save-spinner');
    // The default status semantics survive the spread.
    expect(el).toHaveAttribute('role', 'status');
  });

  it('a caller-supplied aria-hidden wins over the default status role', () => {
    const { container } = render(<Spinner aria-hidden role={undefined} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('role')).toBe(false);
  });
});
