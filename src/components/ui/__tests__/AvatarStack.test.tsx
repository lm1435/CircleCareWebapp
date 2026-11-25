import { render, screen } from '@testing-library/react';
import { AvatarStack } from '@/components/ui/AvatarStack';

const PEOPLE = [
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Ben' },
  { id: 'c', name: 'Cy' },
];

describe('AvatarStack: positive', () => {
  it('is aria-hidden and overlaps every avatar after the first (28: -ml-2)', () => {
    render(<AvatarStack people={PEOPLE} testId="stack" />);
    const stack = screen.getByTestId('stack');
    expect(stack).toHaveAttribute('aria-hidden', 'true');
    const kids = Array.from(stack.children) as HTMLElement[];
    expect(kids.map((k) => k.className)).toEqual(['', '-ml-2', '-ml-2']);
  });

  it('32 px uses the 10 px overlap and h-8 w-8 avatars, each ringed', () => {
    render(<AvatarStack people={PEOPLE} size={32} testId="stack" />);
    const kids = Array.from(screen.getByTestId('stack').children) as HTMLElement[];
    expect(kids.map((k) => k.className)).toEqual(['', '-ml-2.5', '-ml-2.5']);
    for (const k of kids) {
      expect(k.firstElementChild!.className).toContain('h-8 w-8');
      expect(k.firstElementChild!.className).toContain('ring-cream');
    }
  });

  it('shows the +N chip overlapped after the last avatar', () => {
    render(<AvatarStack people={PEOPLE} more={3} testId="stack" moreTestId="more" />);
    expect(screen.getByTestId('more')).toHaveTextContent('+3');
    expect(screen.getByTestId('more').className).toContain('-ml-2');
  });
});

describe('AvatarStack: negative', () => {
  it('no +N chip at 0', () => {
    render(<AvatarStack people={PEOPLE} more={0} testId="stack" moreTestId="more" />);
    expect(screen.queryByTestId('more')).toBeNull();
  });

  it('is never announced: no img role, no accessible text', () => {
    render(<AvatarStack people={PEOPLE} more={2} testId="stack" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('A').closest('[aria-hidden="true"]')).not.toBeNull(); // initials sit inside the hidden stack
  });

  it('a single person gets no overlap class', () => {
    render(<AvatarStack people={[PEOPLE[0]!]} testId="stack" />);
    expect((screen.getByTestId('stack').firstElementChild as HTMLElement).className).toBe('');
  });
});
