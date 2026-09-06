import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { Button } from '../Button';

/** The rendered <button> — the accessible name is unreliable while `loading`
 *  (the Spinner's role="status" label joins it), so read the node directly. */
function btn(container: HTMLElement): HTMLButtonElement {
  const node = container.querySelector('button');
  if (!node) throw new Error('no <button> rendered');
  return node;
}

describe('Button', () => {
  describe('base', () => {
    it('applies the shared base classes on every button', () => {
      const { container } = render(<Button>Save</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('inline-flex');
      expect(cls).toContain('items-center');
      expect(cls).toContain('justify-center');
      expect(cls).toContain('gap-2');
      expect(cls).toContain('font-semibold');
      expect(cls).toContain('whitespace-nowrap');
      expect(cls).toContain('select-none');
    });

    it('animates transform/background/shadow over 150ms with the spring easing', () => {
      const { container } = render(<Button>Save</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('transition-[transform,background-color,box-shadow]');
      // `duration-fast` is a real utility (see globals.css `@utility duration-fast`),
      // not the arbitrary-value literal — that form is banned by typeScale.test.ts.
      expect(cls).toContain('duration-fast');
      expect(cls).toContain('ease-spring');
    });

    it('presses in with active:scale-[0.97]', () => {
      const { container } = render(<Button>Save</Button>);
      expect(btn(container).className).toContain('active:scale-[0.97]');
    });

    it('never reaches for the deprecated .btn* compatibility classes', () => {
      const { container } = render(<Button>Save</Button>);
      expect(btn(container).className.split(/\s+/)).not.toContain('btn');
      expect(btn(container).className).not.toMatch(/\bbtn-/);
    });

    it('defaults to type="button" so forms never submit accidentally', () => {
      render(<Button>Save</Button>);
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
    });

    it('honours an explicit type="submit"', () => {
      render(<Button type="submit">Save</Button>);
      expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
    });

    it('appends className last so callers can override', () => {
      const { container } = render(<Button className="mt-4 custom">Go</Button>);
      expect(btn(container).className.endsWith('mt-4 custom')).toBe(true);
    });

    it('forwards the ref to the underlying button', () => {
      const ref = createRef<HTMLButtonElement>();
      render(<Button ref={ref}>R</Button>);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    it('passes through native and aria attributes', () => {
      render(
        <Button aria-label="Close" title="Close" form="my-form" onClick={() => {}}>
          X
        </Button>
      );
      const el = screen.getByRole('button', { name: 'Close' });
      expect(el).toHaveAttribute('title', 'Close');
      expect(el).toHaveAttribute('form', 'my-form');
    });
  });

  describe('variants', () => {
    it('primary: moss under cream text with the resting shadow', () => {
      const { container } = render(<Button variant="primary">P</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('bg-moss');
      expect(cls).toContain('text-cream');
      expect(cls).toContain('shadow-md');
      expect(cls).toContain('hover:bg-moss-mid');
    });

    it('secondary: cream with a 1.5px line border, the unselected-chip treatment', () => {
      const { container } = render(<Button variant="secondary">S</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('bg-cream');
      expect(cls).toContain('text-ink');
      expect(cls).toContain('border-[1.5px]');
      expect(cls).toContain('border-line ');
      expect(cls).not.toContain('border-line-2');
      expect(cls).toContain('hover:bg-bg-2');
    });

    it('ghost: transparent with moss text and a moss-soft hover', () => {
      const { container } = render(<Button variant="ghost">G</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('bg-transparent');
      expect(cls).toContain('text-moss');
      expect(cls).toContain('hover:bg-moss-soft');
      expect(cls).not.toContain('shadow-md');
    });

    it('danger: terracotta-soft fill, terracotta-deep text, color-mix hover', () => {
      const { container } = render(<Button variant="danger">D</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('bg-terracotta-soft');
      expect(cls).toContain('text-terracotta-deep');
      expect(cls).toContain('hover:bg-[color-mix(in_oklab,var(--color-terracotta-soft),black_6%)]');
      // Never raw --terracotta behind text (contrast rule) — only -deep.
      expect(cls.split(' ')).not.toContain('text-terracotta');
    });

    it('defaults to primary', () => {
      const { container } = render(<Button>Default</Button>);
      expect(btn(container).className).toContain('bg-moss');
    });
  });


  describe('sizes', () => {
    it('sm keeps the 44px touch target (the old 36px web sm is gone)', () => {
      const { container } = render(<Button size="sm">S</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('min-h-[44px]');
      expect(cls).not.toContain('min-h-[36px]');
      expect(cls).toContain('px-4');
      expect(cls).toContain('py-2');
      expect(cls).toContain('rounded-md');
      expect(cls).toContain('text-sm');
    });

    it('md (default) is 16/24 padding, r16, 16px text, 44px min height', () => {
      const { container } = render(<Button>M</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('min-h-[44px]');
      expect(cls).toContain('px-6');
      expect(cls).toContain('py-4');
      expect(cls).toContain('rounded-lg');
      expect(cls).toContain('text-md');
      expect(cls).not.toContain('text-[16px]');
    });

    it('lg is 20/32 padding, r20, 16px text, 52px min height', () => {
      const { container } = render(<Button size="lg">L</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('min-h-[52px]');
      expect(cls).toContain('px-8');
      expect(cls).toContain('py-5');
      expect(cls).toContain('rounded-xl');
      expect(cls).toContain('text-md');
    });
  });

  describe('fullWidth', () => {
    it('adds w-full', () => {
      const { container } = render(<Button fullWidth>W</Button>);
      expect(btn(container).className).toContain('w-full');
    });

    it('omits w-full by default', () => {
      const { container } = render(<Button>W</Button>);
      expect(btn(container).className).not.toContain('w-full');
    });
  });

  describe('icons', () => {
    it('renders leftIcon before and rightIcon after the label', () => {
      const { container } = render(
        <Button
          leftIcon={<span data-testid="left">L</span>}
          rightIcon={<span data-testid="right">R</span>}
        >
          Label
        </Button>
      );
      expect(btn(container).textContent).toBe('LLabelR');
      const order = Array.from(btn(container).querySelectorAll('[data-testid]')).map((n) =>
        n.getAttribute('data-testid')
      );
      expect(order).toEqual(['left', 'right']);
    });

    it('renders neither slot when not supplied', () => {
      const { container } = render(<Button>Label</Button>);
      expect(btn(container).textContent).toBe('Label');
    });
  });

  describe('loading', () => {
    it('renders a Spinner, sets aria-busy and disables the button', () => {
      const { container } = render(<Button loading>Save</Button>);
      expect(btn(container).querySelector('.animate-spin')).not.toBeNull();
      expect(btn(container)).toHaveAttribute('aria-busy', 'true');
      expect(btn(container)).toBeDisabled();
    });

    it('keeps the label for assistive tech but hides it visually', () => {
      const { container } = render(<Button loading>Save</Button>);
      const srOnly = btn(container).querySelector('.sr-only');
      expect(srOnly).not.toBeNull();
      expect(srOnly?.textContent).toBe('Save');
    });

    it('keeps the visible label in flow (invisible, not sr-only) so the width holds', () => {
      const { container } = render(<Button loading>Save</Button>);
      const inFlowLabel = btn(container).querySelector('span.invisible');
      expect(inFlowLabel).not.toBeNull();
      expect(inFlowLabel?.textContent).toBe('Save');
      // `sr-only` collapses the box; `invisible` (visibility:hidden) keeps it.
      expect(inFlowLabel?.className).not.toContain('sr-only');
    });

    it('centres the spinner over the hidden label rather than replacing it', () => {
      const { container } = render(<Button loading>Save</Button>);
      expect(btn(container).className).toContain('relative');
      const overlay = btn(container).querySelector('span.absolute.inset-0');
      expect(overlay).not.toBeNull();
      expect(overlay?.className).toContain('place-items-center');
      expect(overlay?.querySelector('.animate-spin')).not.toBeNull();
    });

    it('leaves the accessible name alone — the spinner is decorative', () => {
      const { container } = render(<Button loading>Save</Button>);
      // The regression this guards: a non-decorative Spinner splices its
      // role="status" label in, making the name "Loading… Save" and firing a
      // live region on every press.
      //
      // The matcher is a predicate, not the literal 'Save', because jsdom runs
      // with `css: false` — Tailwind's `invisible` never becomes a computed
      // `visibility: hidden`, so the in-flow label is NOT pruned from the
      // accessibility tree here and the name reads 'Save Save'. A real browser
      // prunes it and computes 'Save'. Either way it must never say "Loading".
      const found = screen.getByRole('button', {
        name: (name) => name.includes('Save') && !/loading/i.test(name),
      });
      expect(found).toBe(btn(container));
      expect(btn(container).querySelector('[role="status"]')).toBeNull();
      expect(btn(container).querySelector('[aria-label]')).toBeNull();
    });

    it('adds no positioning context when idle', () => {
      const { container } = render(<Button>Save</Button>);
      expect(btn(container).className).not.toContain('relative');
      expect(btn(container).querySelector('span.absolute')).toBeNull();
    });

    it('keeps the icons in flow while loading so the width holds there too', () => {
      const { container } = render(
        <Button loading leftIcon={<span data-testid="left">L</span>}>
          Save
        </Button>
      );
      const icon = container.querySelector('[data-testid="left"]');
      expect(icon).not.toBeNull();
      expect(icon?.closest('span.invisible')).not.toBeNull();
    });

    it('sets no aria-busy when not loading', () => {
      const { container } = render(<Button>Save</Button>);
      expect(btn(container)).not.toHaveAttribute('aria-busy');
    });
  });

  describe('disabled', () => {
    it('dims a disabled button to 50% and kills pointer events', () => {
      const { container } = render(<Button disabled>D</Button>);
      const cls = btn(container).className;
      expect(cls).toContain('disabled:opacity-50');
      expect(cls).toContain('disabled:pointer-events-none');
      // 0.4 / 0.6 are banned dim levels (spec §4.5)
      expect(cls).not.toMatch(/opacity-(40|60)\b/);
      expect(btn(container)).toBeDisabled();
    });
  });

  describe('polymorphic `as`', () => {
    it('renders an anchor for as={Link} with `to`', () => {
      render(
        <MemoryRouter>
          <Button as={Link} to="/care">
            Care
          </Button>
        </MemoryRouter>
      );
      const link = screen.getByRole('link', { name: 'Care' });
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', '/care');
      expect(link.className).toContain('bg-moss');
    });

    it('never puts type or disabled on a non-button element', () => {
      render(
        <MemoryRouter>
          <Button as={Link} to="/care" disabled>
            Care
          </Button>
        </MemoryRouter>
      );
      const link = screen.getByRole('link', { name: 'Care' });
      expect(link).not.toHaveAttribute('type');
      expect(link).not.toHaveAttribute('disabled');
    });

    it('marks a disabled link with aria-disabled, tabIndex -1 and a static dim', () => {
      render(
        <MemoryRouter>
          <Button as={Link} to="/care" disabled>
            Care
          </Button>
        </MemoryRouter>
      );
      const link = screen.getByRole('link', { name: 'Care' });
      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(link).toHaveAttribute('tabindex', '-1');
      // :disabled never matches an <a>, so the dim has to be unconditional
      expect(link.className).toContain('opacity-50');
      expect(link.className).toContain('pointer-events-none');
    });

    it('leaves an enabled link untouched', () => {
      render(
        <MemoryRouter>
          <Button as={Link} to="/care">
            Care
          </Button>
        </MemoryRouter>
      );
      const link = screen.getByRole('link', { name: 'Care' });
      expect(link).not.toHaveAttribute('aria-disabled');
      expect(link).not.toHaveAttribute('tabindex');
    });

    it('renders an intrinsic element too', () => {
      const { container } = render(
        <Button as="a" href="/x">
          Anchor
        </Button>
      );
      expect(container.querySelector('a')).not.toBeNull();
      expect(container.querySelector('button')).toBeNull();
    });
  });
});
