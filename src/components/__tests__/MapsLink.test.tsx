import { render, screen } from '@testing-library/react';
import '@/i18n';
import { DoctorCard } from '@/components/emergency/DoctorCard';
import { MapsLink } from '../MapsLink';

function setPlatform(platform: string, userAgent: string) {
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
}

describe('MapsLink', () => {
  afterEach(() => setPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0)'));

  it('links a Google Maps search with new-tab attributes and an accessible name', () => {
    setPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0)');
    render(<MapsLink address={'12 Main St\nDenver, CO'} />);
    const link = screen.getByRole('link', { name: 'Open 12 Main St, Denver, CO in Maps' });
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=12%20Main%20St%2C%20Denver%2C%20CO'
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleDescription('Opens in a new tab');
  });

  it('uses Apple Maps on an iPhone', () => {
    setPlatform('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    render(<MapsLink address="12 Main St" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://maps.apple.com/?q=12%20Main%20St');
  });

  it('renders nothing for an empty value and plain text for a virtual free-text location', () => {
    const { container, rerender } = render(<MapsLink address="  " />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MapsLink address="https://zoom.us/j/1" freeText />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('https://zoom.us/j/1')).toBeInTheDocument();
  });
});

describe('DoctorCard address', () => {
  it('shows the address as a maps link, and no address row when empty', () => {
    const { rerender } = render(<DoctorCard name="Dr Chen" address="9 Oak Ave" />);
    expect(screen.getByRole('link', { name: 'Open 9 Oak Ave in Maps' })).toBeInTheDocument();
    rerender(<DoctorCard name="Dr Chen" address="" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('MapsLink freeText', () => {
  it('links "Room 3" and not "Zoom"', () => {
    const { rerender } = render(<MapsLink address="Room 3" freeText />);
    expect(screen.getByRole('link', { name: 'Open Room 3 in Maps' })).toBeInTheDocument();
    rerender(<MapsLink address="Zoom" freeText />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
