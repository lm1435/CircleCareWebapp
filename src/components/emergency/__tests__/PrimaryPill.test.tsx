import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { InsurancePlan } from '@/api/emergencyInfo';
import { ContactCard } from '../ContactCard';
import { DoctorCard } from '../DoctorCard';
import { InsuranceCard } from '../InsuranceCard';

// Owner 2026-11-08 (mobile parity): "Primary" is the soft moss pill (moss-soft ground, moss text),
// never the error / red badge; at most ONE chip beside a name; a screen reader hears
// "<name>, Primary" as the heading.
function expectMossPill() {
  const pill = screen.getByTestId('primary-pill');
  expect(pill).toHaveTextContent('Primary');
  expect(pill.className).toContain('bg-moss-soft');
  expect(pill.className).not.toMatch(/terracotta|error/);
  expect(pill).toHaveAttribute('aria-hidden', 'true');
}

describe('emergency Primary pill', () => {
  it('contact: moss pill, heading reads "<name>, Primary"', () => {
    render(<ContactCard name="Ana" relationship="Daughter" phone="3035550123" isPrimary />);
    expectMossPill();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Ana, Primary');
  });

  it('doctor: moss pill, heading reads "<name>, Primary"', () => {
    render(
      <MemoryRouter>
        <DoctorCard name="Dr. Ruiz" isPrimary />
      </MemoryRouter>
    );
    expectMossPill();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Dr. Ruiz, Primary');
  });

  it('no pill and no sr suffix when not primary', () => {
    render(<ContactCard name="Ana" relationship="Daughter" phone="3035550123" />);
    expect(screen.queryByTestId('primary-pill')).toBeNull();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Ana');
  });

  it('insurance with a label AND primary: one chip (Primary); the label is a caption in the body', () => {
    const plan = { carrier: 'Aetna', label: 'Medicare', is_primary: true } as InsurancePlan;
    const { container } = render(<InsuranceCard plan={plan} />);
    expectMossPill();
    expect(container.querySelectorAll('[data-testid="primary-pill"], .rounded-full').length).toBe(1);
    const label = screen.getByTestId('insurance-plan-label');
    expect(label.tagName).toBe('P');
    expect(label).toHaveTextContent('Medicare');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Aetna, Primary');
  });
});
