import { render, screen } from '@testing-library/react';
import { ChoiceTileButton } from '../ChoiceTileButton';
import { CHOICE_TILE_BOX } from '../inputStyles';

// Design 2026-11-07 (owner approved): Starts / Ends tiles flip the hierarchy. The small label is 13/500 muted,
// the time is the main text (web body size, 500, primary). Choice tiles are 48 tall, not 56 (hit area stays 44+).
describe('choice tile hierarchy + height', () => {
  it('tile box is min-h 48, not 56', () => {
    expect(CHOICE_TILE_BOX).toContain('min-h-[48px]');
    expect(CHOICE_TILE_BOX).not.toContain('min-h-[56px]');
  });

  it('timeFirst: label is 13px medium muted, time is body-size medium primary', () => {
    render(<ChoiceTileButton label="Starts" sub="8:00 AM" hierarchy="value" onClick={vi.fn()} />);
    const label = screen.getByText('Starts');
    expect(label).toHaveClass('text-[13px]', 'font-medium', 'text-ink-2');
    const time = screen.getByText('8:00 AM');
    expect(time).toHaveClass('text-base', 'font-medium', 'text-ink');
    expect(time).not.toHaveClass('text-sm');
  });

  it('timeFirst selected keeps contrast on the dark fill', () => {
    render(<ChoiceTileButton label="Ends" sub="2:00 PM" hierarchy="value" selected onClick={vi.fn()} />);
    expect(screen.getByText('Ends')).toHaveClass('text-cream/80');
    expect(screen.getByText('2:00 PM')).toHaveClass('text-cream');
  });

  it('default hierarchy is unchanged (label main)', () => {
    render(<ChoiceTileButton label="Other day" sub="Mon" onClick={vi.fn()} />);
    expect(screen.getByText('Other day')).toHaveClass('text-base', 'font-medium');
  });
});
