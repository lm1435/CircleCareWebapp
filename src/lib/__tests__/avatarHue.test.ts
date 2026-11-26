import {
  parseHue,
  formatHue,
  hueGradientLight,
  hueGradientDark,
  gradientFromHexLight,
  gradientFromHexDark,
  contrastRatio,
  DARK_INITIAL,
} from '@/lib/avatarHue';
import {
  AVATAR_COLOR_KEYS,
  AVATAR_EXTRA_COLORS,
  AVATAR_QUICK_PICKS,
  avatarGradientFor,
  avatarGradientForKey,
  avatarDynVars,
  isValidAvatarColor,
} from '@/components/ui/Avatar';

describe('hue colour contrast (all 360 hues)', () => {
  it('light: white initial >= 4.5:1 on BOTH gradient stops, every hue', () => {
    for (let h = 0; h < 360; h++) {
      const [a, b] = hueGradientLight(h);
      expect(contrastRatio('#FFFFFF', a)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#FFFFFF', b)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark: the dark initial (#232019) >= 4.5:1 on BOTH gradient stops, every hue', () => {
    for (let h = 0; h < 360; h++) {
      const [a, b] = hueGradientDark(h);
      expect(contrastRatio(DARK_INITIAL, a)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(DARK_INITIAL, b)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every extra quick pick carries white >= 4.5:1 (light) and the dark initial (dark)', () => {
    for (const hex of Object.values(AVATAR_EXTRA_COLORS)) {
      gradientFromHexLight(hex).forEach((c) =>
        expect(contrastRatio('#FFFFFF', c)).toBeGreaterThanOrEqual(4.5)
      );
      gradientFromHexDark(hex).forEach((c) =>
        expect(contrastRatio(DARK_INITIAL, c)).toBeGreaterThanOrEqual(4.5)
      );
    }
  });
});

describe('quick picks and legacy keys', () => {
  it('offers 12 valid picks; forest / amber are valid but not offered', () => {
    expect(AVATAR_QUICK_PICKS).toHaveLength(12);
    expect(new Set(AVATAR_QUICK_PICKS).size).toBe(12);
    expect(AVATAR_QUICK_PICKS).not.toContain('forest');
    expect(AVATAR_QUICK_PICKS).not.toContain('amber');
    for (const k of [...AVATAR_QUICK_PICKS, 'forest', 'amber']) expect(isValidAvatarColor(k)).toBe(true);
  });

  it('legacy keys keep their token gradients and the name-hash palette is still six', () => {
    expect(AVATAR_COLOR_KEYS).toEqual(['moss', 'coral', 'dusk', 'clay', 'forest', 'amber']);
    expect(avatarGradientForKey('forest')).toEqual(['var(--color-avatar-moss-mid)', 'var(--color-avatar-moss-dark)']);
    expect(avatarGradientForKey('amber')).toEqual(['var(--color-avatar-amber-deep)', 'var(--color-avatar-clay-deep)']);
    expect(avatarGradientForKey('moss')).toEqual(['var(--color-avatar-moss)', 'var(--color-avatar-moss-deep)']);
    expect(avatarDynVars('moss')).toBeUndefined();
    expect(avatarDynVars('forest')).toBeUndefined();
  });

  it('new keys carry exactly the approved hex as the light first stop', () => {
    for (const [k, hex] of Object.entries(AVATAR_EXTRA_COLORS)) {
      expect(avatarDynVars(k)).toMatchObject({ '--av-lf': hex });
    }
  });
});

describe('hue storage format', () => {
  it.each(['hue:0', 'hue:9', 'hue:10', 'hue:99', 'hue:100', 'hue:299', 'hue:300', 'hue:359'])(
    'accepts %s',
    (v) => {
      expect(parseHue(v)).toBe(Number(v.slice(4)));
      expect(isValidAvatarColor(v)).toBe(true);
    }
  );

  it.each([
    'hue:360', 'hue:-1', 'hue:abc', 'hue:', 'hue:007', 'hue:12.5', 'hue: 5', 'HUE:5', 'hue:5 ', '#5C6B4E',
    'teal', '', null, undefined, 5, {},
  ])('rejects %j', (v) => {
    expect(parseHue(v)).toBeNull();
    expect(isValidAvatarColor(v)).toBe(false);
  });

  it('formatHue round-trips and wraps', () => {
    for (let h = 0; h < 360; h++) expect(parseHue(formatHue(h))).toBe(h);
    expect(formatHue(360)).toBe('hue:0');
    expect(formatHue(-15)).toBe('hue:345');
  });

  it('an invalid stored value falls back to the name hash (what a 1.4.3 client does with hue:N)', () => {
    expect(avatarGradientFor('Maria', 'hue:360')).toEqual(avatarGradientFor('Maria'));
    expect(avatarGradientFor('Maria', 'hue:abc')).toEqual(avatarGradientFor('Maria'));
    expect(avatarDynVars('hue:360')).toBeUndefined();
    expect(avatarGradientFor('Maria', 'hue:120')).not.toEqual(avatarGradientFor('Maria'));
    expect(avatarDynVars('hue:120')).toMatchObject({ '--av-lf': hueGradientLight(120)[0] });
  });
});
