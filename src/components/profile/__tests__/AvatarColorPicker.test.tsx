import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { AvatarColorPicker, RAINBOW_GRADIENT } from '../AvatarColorPicker';
import { AVATAR_QUICK_PICKS, avatarDynVars } from '@/components/ui/Avatar';
import { hueGradientLight } from '@/lib/avatarHue';

const slider = () => screen.getByRole('slider', { name: 'Custom color' });

describe('AvatarColorPicker quick picks', () => {
  it('is a radiogroup of twelve 44px radios; forest and amber are not offered', () => {
    render(<AvatarColorPicker value={null} name="Sam Doe" onChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'Choose your color' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(12);
    expect(radios).toHaveLength(AVATAR_QUICK_PICKS.length);
    expect(within(group).queryByRole('radio', { name: 'Forest green' })).toBeNull();
    expect(within(group).queryByRole('radio', { name: 'Amber' })).toBeNull();
    for (const r of radios) expect(r.className).toMatch(/h-11 w-11/);
  });

  it('announces the selected swatch (aria-checked + check glyph) and only that one', () => {
    render(<AvatarColorPicker value="sea" name="Sam" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Sea green' })).toBeChecked();
    expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked || r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Sea green' }).querySelector('svg')).not.toBeNull();
  });

  it('a stored hue or legacy key checks no swatch', () => {
    for (const v of ['hue:120', 'forest', 'garbage']) {
      const { unmount } = render(<AvatarColorPicker value={v} name="Sam" onChange={vi.fn()} />);
      expect(screen.getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
      unmount();
    }
  });

  it('a click reports the key as a quick pick', async () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value={null} name="Sam" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Plum' }));
    expect(onChange).toHaveBeenCalledWith('plum', 'quick_pick');
  });

  it('ignores clicks while a save is in flight (busy) but stays focusable', async () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value={null} name="Sam" onChange={onChange} busy />);
    const plum = screen.getByRole('radio', { name: 'Plum' });
    await userEvent.setup().click(plum);
    expect(onChange).not.toHaveBeenCalled();
    expect(plum).not.toBeDisabled();
  });
});

describe('AvatarColorPicker rainbow and unmount flush', () => {
  it('the rainbow spans the thumb-centre range (14px inset, ends held)', () => {
    expect(RAINBOW_GRADIENT).toMatch(/calc\(14px \+ \(100% - 28px\) \* 0\)/);
    expect(RAINBOW_GRADIENT).toMatch(/calc\(14px \+ \(100% - 28px\) \* 1\)/);
    render(<AvatarColorPicker value={null} name="Sam" onChange={vi.fn()} />);
    expect(slider().style.getPropertyValue('--hue-rainbow')).toBe(RAINBOW_GRADIENT);
  });

  it('unmounting while a pointer is still held saves the draft once', () => {
    const onChange = vi.fn();
    const { unmount } = render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    fireEvent.pointerDown(slider());
    fireEvent.change(slider(), { target: { value: '77' } });
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hue:77', 'custom_hue');
  });

  it('unmounting with no draft saves nothing', () => {
    const onChange = vi.fn();
    const { unmount } = render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    unmount();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('AvatarColorPicker hue slider idle save', () => {
  afterEach(() => vi.useRealTimers());

  it('a change with no pointer/key held saves ONCE after the pause', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '100' } });
    fireEvent.change(slider(), { target: { value: '120' } });
    vi.advanceTimersByTime(600);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hue:120', 'custom_hue');
  });

  it('NO double save: the pause save then a release (or blur) adds nothing', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '120' } });
    vi.advanceTimersByTime(800);
    fireEvent.pointerUp(slider());
    fireEvent.blur(slider());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('NO double save: a release before the pause cancels the pending timer', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '120' } });
    fireEvent.pointerUp(slider());
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('while the pointer is held nothing saves on the pause; the release saves once', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    fireEvent.pointerDown(slider());
    fireEvent.change(slider(), { target: { value: '90' } });
    vi.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hue:90', 'custom_hue');
  });

  it('while a key is held nothing saves on the pause; the key release saves once', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AvatarColorPicker value="hue:10" name="Sam" onChange={onChange} />);
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    fireEvent.change(slider(), { target: { value: '11' } });
    vi.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyUp(slider(), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('unmounting with a pending pause saves it once; a cancelled gesture saves nothing', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { unmount } = render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '120' } });
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    render(<AvatarColorPicker value="moss" name="Sam" onChange={second} />);
    fireEvent.change(slider(), { target: { value: '120' } });
    fireEvent.pointerCancel(slider());
    vi.advanceTimersByTime(2000);
    expect(second).not.toHaveBeenCalled();
  });

  it('busy: the pause saves nothing', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AvatarColorPicker value="hue:40" name="Sam" onChange={onChange} busy />);
    fireEvent.change(slider(), { target: { value: '120' } });
    vi.advanceTimersByTime(2000);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('AvatarColorPicker hue slider and live preview', () => {
  it('is a native range 0-359 with aria-valuetext "Hue N degrees"', () => {
    render(<AvatarColorPicker value="hue:90" name="Sam" onChange={vi.fn()} />);
    const s = slider() as HTMLInputElement;
    expect(s.type).toBe('range');
    expect(s.min).toBe('0');
    expect(s.max).toBe('359');
    expect(s.value).toBe('90');
    expect(s).toHaveAttribute('aria-valuetext', 'Hue 90 degrees');
  });

  it('moving previews live but saves ONCE, on release, as hue:N', () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value="moss" name="Sam" onChange={onChange} />);
    const preview = () => screen.getByTestId('avatar-color-preview').querySelector('span[aria-hidden]') as HTMLElement;
    fireEvent.change(slider(), { target: { value: '100' } });
    fireEvent.change(slider(), { target: { value: '150' } });
    fireEvent.change(slider(), { target: { value: '200' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(slider()).toHaveAttribute('aria-valuetext', 'Hue 200 degrees');
    expect(preview().style.getPropertyValue('--av-lf')).toBe(hueGradientLight(200)[0]);
    fireEvent.pointerUp(slider());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hue:200', 'custom_hue');
    // A second release with no movement saves nothing more.
    fireEvent.pointerUp(slider());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keyboard: arrow presses preview, the key release saves once; blur flushes', () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value="hue:10" name="Sam" onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '11' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyUp(slider(), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hue:11', 'custom_hue');
    fireEvent.change(slider(), { target: { value: '40' } });
    fireEvent.blur(slider());
    expect(onChange).toHaveBeenLastCalledWith('hue:40', 'custom_hue');
  });

  it('a cancelled gesture saves nothing and the thumb returns to the saved hue', () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value="hue:40" name="Sam" onChange={onChange} />);
    fireEvent.change(slider(), { target: { value: '300' } });
    fireEvent.pointerCancel(slider());
    expect(onChange).not.toHaveBeenCalled();
    expect((slider() as HTMLInputElement).value).toBe('40');
  });

  it('busy: moving does not save and the value does not move', () => {
    const onChange = vi.fn();
    render(<AvatarColorPicker value="hue:40" name="Sam" onChange={onChange} busy />);
    fireEvent.change(slider(), { target: { value: '300' } });
    fireEvent.pointerUp(slider());
    expect(onChange).not.toHaveBeenCalled();
    expect((slider() as HTMLInputElement).value).toBe('40');
  });

  it('the preview shows the saved hue and the name + caption', () => {
    render(<AvatarColorPicker value="hue:200" name="Sam Doe" onChange={vi.fn()} />);
    const box = screen.getByTestId('avatar-color-preview');
    expect(within(box).getByText('Sam Doe')).toBeInTheDocument();
    expect(within(box).getByText('How your circles see you')).toBeInTheDocument();
    expect((box.querySelector('span[aria-hidden]') as HTMLElement).style.getPropertyValue('--av-lf')).toBe(
      avatarDynVars('hue:200')!['--av-lf' as keyof React.CSSProperties]
    );
  });
});
