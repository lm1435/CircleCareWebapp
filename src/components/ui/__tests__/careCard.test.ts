import {
  careCardShell,
  careCardActionsInline,
  careCardActionsRow,
  STATUS_PILL,
  careCardStatusPill,
  careCardSurface,
  careCardSurfaceMuted,
  careCardTopRow,
  careCardTitle,
  careCardMeta,
  careCardListGap,
  // legacy aliases — must still exist so pre-migration callers keep compiling
  careCardNameRow,
  careCardStatusPush,
  careCardActions,
} from '../careCard';

describe('careCard shell', () => {
  it('carries mobile-numeric padding, border, radius and container containment', () => {
    expect(careCardShell).toContain('p-3.5');
    expect(careCardShell).toContain('border-[1.5px]');
    expect(careCardShell).toContain('rounded-xl');
    expect(careCardShell).toContain('[container-type:inline-size]');
  });

  it('surfaces share the same border/radius as the shell', () => {
    expect(careCardSurface).toContain('rounded-xl');
    expect(careCardSurface).toContain('border-[1.5px]');
    expect(careCardSurfaceMuted).toContain('rounded-xl');
    expect(careCardSurfaceMuted).toContain('border-[1.5px]');
  });
});

describe('careCard action row container query', () => {
  it('hides the inline actions once the card narrows past 360px', () => {
    expect(careCardActionsInline).toContain('@max-[360px]:hidden');
  });

  it('shows the stacked row only once the card narrows past 360px', () => {
    expect(careCardActionsRow).toContain('@max-[360px]:flex');
    expect(careCardActionsRow).toContain('hidden');
  });
});

describe('STATUS_PILL', () => {
  it('every tone is built on careCardStatusPill', () => {
    for (const value of Object.values(STATUS_PILL)) {
      expect(value.startsWith(careCardStatusPill)).toBe(true);
    }
  });

  it('covers every mobile-parity tone', () => {
    expect(Object.keys(STATUS_PILL).sort()).toEqual(
      ['dueSoon', 'inactive', 'overdue', 'skipped', 'taken', 'upcoming'].sort()
    );
  });
});

describe('legacy exports (pre-migration callers)', () => {
  it('careCardNameRow, careCardStatusPush and careCardActions still exist', () => {
    expect(typeof careCardNameRow).toBe('string');
    expect(typeof careCardStatusPush).toBe('string');
    expect(typeof careCardActions).toBe('string');
  });

  it('careCardTopRow, careCardTitle, careCardMeta, careCardListGap are non-empty strings', () => {
    for (const value of [careCardTopRow, careCardTitle, careCardMeta, careCardListGap]) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
