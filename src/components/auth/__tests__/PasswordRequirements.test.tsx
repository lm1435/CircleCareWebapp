import { render, screen, within } from '@testing-library/react';
import '@/i18n';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';

const ruleText = {
  minLength: 'At least 8 characters',
  uppercase: 'One uppercase letter',
  lowercase: 'One lowercase letter',
  number: 'One number',
  special: 'One special character',
};

function rowFor(text: string): HTMLElement {
  return screen.getByText(text).closest('li') as HTMLElement;
}

describe('PasswordRequirements', () => {
  it('renders all five rules unmet for an empty password', () => {
    render(<PasswordRequirements value="" />);
    Object.values(ruleText).forEach((text) => {
      const row = rowFor(text);
      expect(within(row).getByText('requirement not met yet')).toBeInTheDocument();
    });
  });

  it('marks only the satisfied rules as met as the password grows', () => {
    render(<PasswordRequirements value="abcdefgh" />);
    // length + lowercase satisfied; uppercase/number/special not.
    expect(within(rowFor(ruleText.minLength)).getByText('requirement met')).toBeInTheDocument();
    expect(within(rowFor(ruleText.lowercase)).getByText('requirement met')).toBeInTheDocument();
    expect(
      within(rowFor(ruleText.uppercase)).getByText('requirement not met yet')
    ).toBeInTheDocument();
    expect(
      within(rowFor(ruleText.number)).getByText('requirement not met yet')
    ).toBeInTheDocument();
    expect(
      within(rowFor(ruleText.special)).getByText('requirement not met yet')
    ).toBeInTheDocument();
  });

  it('marks every rule met for a fully compliant password', () => {
    render(<PasswordRequirements value="Secret#123" />);
    Object.values(ruleText).forEach((text) => {
      const row = rowFor(text);
      expect(within(row).getByText('requirement met')).toBeInTheDocument();
    });
  });

  it('exposes the checklist as a polite live region', () => {
    const { container } = render(<PasswordRequirements value="" />);
    expect(container.querySelector('ul[aria-live="polite"]')).toBeInTheDocument();
  });
});
