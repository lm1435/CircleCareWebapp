import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import i18n from '@/i18n';
import { AvatarColorPicker } from '../AvatarColorPicker';
import { AVATAR_COLOR_KEYS } from '@/components/ui/Avatar';

const NAMES_EN = ['Sage green', 'Coral', 'Slate blue', 'Clay', 'Forest green', 'Amber'];
const NAMES_ES = ['Verde salvia', 'Coral', 'Azul pizarra', 'Arcilla', 'Verde bosque', 'Ámbar'];

describe('AvatarColorPicker', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('is a radiogroup of six radios named by colour (EN)', () => {
    render(<AvatarColorPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Choose your color' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(NAMES_EN);
  });

  it('names the radios in Spanish', async () => {
    await i18n.changeLanguage('es');
    render(<AvatarColorPicker value={null} onChange={vi.fn()} />);
    expect(
      screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))
    ).toEqual(NAMES_ES);
    expect(screen.getByRole('radiogroup', { name: 'Elige tu color' })).toBeInTheDocument();
  });

  it('exposes aria-checked and shows a check mark on the selected swatch only', () => {
    render(<AvatarColorPicker value="dusk" onChange={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
      'false',
      'false',
    ]);
    // Not colour alone: the selected swatch holds the check glyph + ring class.
    expect(radios[2]!.querySelector('svg')).not.toBeNull();
    expect(radios[2]!.className).toContain('border-ink');
    expect(radios.filter((r) => r.querySelector('svg'))).toHaveLength(1);
  });

  it('gives every swatch a 44px target', () => {
    render(<AvatarColorPicker value={null} onChange={vi.fn()} />);
    screen.getAllByRole('radio').forEach((r) => {
      expect(r.className).toContain('h-11');
      expect(r.className).toContain('w-11');
    });
  });

  it('reports the clicked key', async () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Forest green' }));
    expect(onChange).toHaveBeenCalledWith('forest');
  });

  it('has one tab stop (roving) and arrows move focus without selecting', async () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value="coral" onChange={onChange} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([radios[1]]);
    radios[1]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(radios[2]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(radios[AVATAR_COLOR_KEYS.length - 1]).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('amber');
  });

  it('disabled: every swatch is natively disabled', () => {
    render(<AvatarColorPicker value={null} onChange={vi.fn()} disabled />);
    screen.getAllByRole('radio').forEach((r) => expect(r).toBeDisabled());
  });

  it('busy (a save in flight) keeps focus on the chosen swatch and ignores presses (WCAG 2.4.3)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<AvatarColorPicker value="coral" onChange={onChange} />);
    const coral = screen.getByRole('radio', { name: 'Coral' });
    await user.tab();
    expect(coral).toHaveFocus();
    rerender(<AvatarColorPicker value="coral" onChange={onChange} busy />);
    expect(coral).toHaveFocus();
    screen.getAllByRole('radio').forEach((r) => {
      expect(r).not.toBeDisabled();
      expect(r).toHaveAttribute('aria-disabled', 'true');
    });
    // Arrows still move focus; Space does not save.
    await user.keyboard('{ArrowRight}');
    const dusk = screen.getByRole('radio', { name: 'Slate blue' });
    expect(dusk).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
    rerender(<AvatarColorPicker value="coral" onChange={onChange} />);
    expect(dusk).not.toHaveAttribute('aria-disabled');
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith('dusk');
  });
});
