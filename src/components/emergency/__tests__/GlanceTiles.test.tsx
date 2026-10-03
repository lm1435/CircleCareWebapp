import { render, screen } from '@testing-library/react';
import '@/i18n';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { GlanceTiles } from '../GlanceTiles';

// a11y audit 2026-09-29 (WCAG 1.4.10 reflow): a nowrap condition pill
// ("Hypercholesterolemia", 152px) overflowed its ~106px half-width tile and ran
// past a 320px viewport. Pills wrap, and a single long word may break.
describe('GlanceTiles pills', () => {
  it('lets a long condition wrap inside its tile', () => {
    render(<GlanceTiles info={{ medical_conditions: ['Hypercholesterolemia'] } as unknown as EmergencyInfo} />);
    const pill = screen.getByText('Hypercholesterolemia');
    expect(pill.className).toContain('whitespace-normal');
    expect(pill.className).not.toContain('whitespace-nowrap');
    expect(pill.className).toContain('[overflow-wrap:anywhere]');
  });
});
