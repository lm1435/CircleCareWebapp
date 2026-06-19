import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar } from '../Avatar';

describe('Avatar', () => {
  it('renders initials from the first and last name on a tinted surface', () => {
    render(<Avatar name="Rose Meza" />);
    // Decorative initials — surrounding context names the person.
    expect(screen.getByText('RM')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('uses a single initial when only one name token is present', () => {
    render(<Avatar name="Rose" />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('falls back to a placeholder glyph with no name', () => {
    render(<Avatar />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('maps the same name to the same tint deterministically', () => {
    const { container: a } = render(<Avatar name="Ana Reyes" />);
    const { container: b } = render(<Avatar name="Ana Reyes" />);
    expect(a.firstElementChild?.className).toBe(b.firstElementChild?.className);
  });

  it('renders the photo with an accessible label when a URL is provided', () => {
    render(<Avatar name="Rose Meza" photoUrl="https://x.supabase.co/p.jpg" />);
    const img = screen.getByRole('img', { name: 'Rose Meza' });
    expect(img).toHaveAttribute('src', 'https://x.supabase.co/p.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to initials when the image fails to load', () => {
    render(<Avatar name="Rose Meza" photoUrl="https://x.supabase.co/broken.jpg" />);
    const img = screen.getByRole('img', { name: 'Rose Meza' });
    fireEvent.error(img);
    expect(screen.getByText('RM')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
