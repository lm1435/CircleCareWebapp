import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';
import { Analytics } from '@/lib/analytics';
import { formatGmtOffset, buildTimezoneOptions, filterTimezoneOptions } from '@/lib/timezoneOptions';
import { CircleTimezoneCard } from '../CircleTimezoneCard';

// Circle-timezone spec, web T11: the Edit Circle "Time zone" row.
// Zones used here (Mexico City, Monterrey, Bogota, Tokyo, Kolkata) observe no DST, so
// every offset asserted below is the same whatever day the suite runs.

type MutateOptions = { onSuccess?: () => void };
const updateMutate = vi.fn((_data: unknown, opts?: MutateOptions) => opts?.onSuccess?.());
let updatePending = false;
vi.mock('@/hooks/useCircleAdmin', () => ({
  useUpdateCircle: () => ({ mutate: updateMutate, isPending: updatePending }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const CIRCLE_ID = 'circle-1';

function member(overrides: Partial<CircleMember>): CircleMember {
  return {
    id: 'm',
    email: 'm@example.com',
    first_name: null,
    last_name: null,
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-01-01T00:00:00Z',
    timezone: null,
    ...overrides,
  };
}

const OWNER = member({ id: 'owner-1', role: 'owner', timezone: 'America/Bogota' });

function makeCircle(overrides: Partial<CircleDetail> = {}): CircleDetail {
  return {
    id: CIRCLE_ID,
    name: 'Maria',
    recipient_name: 'Maria',
    recipient_photo_url: null,
    recipient_dob: null,
    recipient_conditions: null,
    owner_id: 'owner-1',
    created_at: '2026-01-01T00:00:00Z',
    is_self_care: false,
    care_recipient_timezone: 'America/Mexico_City',
    circle_timezone: 'America/Mexico_City',
    circle_timezone_source: 'circle',
    members: [OWNER],
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    ...overrides,
  };
}

function renderCard(circle: CircleDetail) {
  return render(<CircleTimezoneCard circleId={CIRCLE_ID} circle={circle} />);
}

const combobox = () => screen.getByRole('combobox', { name: 'Time zone' });

let tzSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  updatePending = false;
  tzSpy = vi.spyOn(Analytics, 'circleTimezoneSet').mockImplementation(() => {});
});

afterEach(async () => {
  tzSpy.mockRestore();
  await i18n.changeLanguage('en');
});

describe('timezoneOptions', () => {
  it('formats offsets as GMT±H[:MM]', () => {
    expect(formatGmtOffset('America/Mexico_City')).toBe('GMT-6');
    expect(formatGmtOffset('Asia/Kolkata')).toBe('GMT+5:30');
    expect(formatGmtOffset('Africa/Abidjan')).toBe('GMT');
  });

  it('groups by region, names by city, and leaves out Etc/* zones', () => {
    const options = buildTimezoneOptions('en', (r) => r);
    expect(options.find((o) => o.zone === 'America/Mexico_City')?.label).toBe('Mexico City (GMT-6)');
    expect(options.some((o) => o.zone.startsWith('Etc/'))).toBe(false);
    // America comes before Europe.
    const firstEurope = options.findIndex((o) => o.region === 'Europe');
    const lastAmerica = options.map((o) => o.region).lastIndexOf('America');
    expect(lastAmerica).toBeLessThan(firstEurope);
  });

  it('search is case- and accent-insensitive and matches the IANA id', () => {
    const options = buildTimezoneOptions('en', (r) => r);
    expect(filterTimezoneOptions(options, 'MONTERREY').map((o) => o.zone)).toEqual(['America/Monterrey']);
    expect(filterTimezoneOptions(options, 'mexico_city').map((o) => o.zone)).toContain('America/Mexico_City');
  });
});

describe('CircleTimezoneCard', () => {
  it('shows the effective zone as "City (GMT-X)" with the "Set by you" source and both helper lines', () => {
    renderCard(makeCircle());
    expect(combobox()).toHaveValue('Mexico City (GMT-6)');
    expect(screen.getByTestId('circle-timezone-source')).toHaveTextContent('Set by you');
    expect(screen.getByText('Medication times follow this zone')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Times keep their clock time — an 8:00 AM dose stays 8:00 AM in the new time zone.'
      )
    ).toBeInTheDocument();
    // The helper lines describe the field for assistive tech.
    expect(combobox()).toHaveAccessibleDescription(/Set by you/);
  });

  it.each([
    ['recipient', "From Maria's device"],
    ['owner', 'From your device (default)'],
    ['default', 'From your device (default)'],
  ] as const)('source %s → "%s"', (source, text) => {
    renderCard(makeCircle({ circle_timezone: null, circle_timezone_source: source }));
    expect(screen.getByTestId('circle-timezone-source')).toHaveTextContent(text);
  });

  it('derives the source when an older backend omits it', () => {
    renderCard(
      makeCircle({
        circle_timezone: undefined,
        circle_timezone_source: undefined,
        members: [OWNER, member({ id: 'r', is_care_recipient: true, timezone: 'America/Mexico_City' })],
      })
    );
    expect(screen.getByTestId('circle-timezone-source')).toHaveTextContent("From Maria's device");
  });

  it('the search box placeholder matches mobile', async () => {
    const user = userEvent.setup();
    renderCard(makeCircle());
    await user.click(combobox());
    expect(combobox()).toHaveAttribute('placeholder', 'Search city or region');
  });

  it('search filters the list, and the automatic option leaves while searching', async () => {
    const user = userEvent.setup();
    renderCard(makeCircle());
    await user.click(combobox());
    const list = screen.getByRole('listbox', { name: 'Time zones' });
    // No recipient account: automatic follows the owner's device (Bogota here).
    const automatic = within(list).getAllByRole('option')[0];
    expect(automatic).toHaveTextContent(/^Automatic/);
    expect(within(automatic).getByText('Follow your device · currently Bogota')).toBeInTheDocument();
    // The current choice carries the checkmark state.
    expect(within(list).getByRole('option', { name: 'Mexico City (GMT-6)' })).toHaveAttribute('aria-selected', 'true');
    // Region groups are labelled.
    expect(within(list).getByRole('group', { name: 'Americas' })).toBeInTheDocument();

    await user.type(combobox(), 'monterr');
    const filtered = screen.getByRole('listbox', { name: 'Time zones' });
    expect(within(filtered).getAllByRole('option').map((o) => o.textContent)).toEqual(['Monterrey (GMT-6)']);
    expect(within(filtered).queryByRole('option', { name: /Automatic/ })).toBeNull();
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderCard(makeCircle());
    await user.type(combobox(), 'zzzzqq');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('No matching time zones')).toBeInTheDocument();
  });

  it('picking a zone PATCHes it and fires circle_timezone_set (no circle_id)', async () => {
    const user = userEvent.setup();
    renderCard(
      makeCircle({
        members: [OWNER, member({ id: 'r', is_care_recipient: true, timezone: 'America/Mexico_City' })],
      })
    );
    await user.type(combobox(), 'Tokyo');
    await user.click(screen.getByRole('option', { name: 'Tokyo (GMT+9)' }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({ timezone: 'Asia/Tokyo' });
    expect(tzSpy).toHaveBeenCalledWith({
      source: 'edit_circle',
      cleared: false,
      zone: 'Asia/Tokyo',
      recipient_zone_mismatch: true,
    });
    expect(Object.keys(tzSpy.mock.calls[0][0] as object)).not.toContain('circle_id');
    expect(showToast).toHaveBeenCalledWith('Circle updated.', 'success');
    // The list closes after a pick.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('"Automatic" clears the override with timezone: null', async () => {
    const user = userEvent.setup();
    renderCard(
      makeCircle({
        members: [OWNER, member({ id: 'r', is_care_recipient: true, timezone: 'America/Monterrey' })],
      })
    );
    await user.click(combobox());
    const automatic = screen.getByRole('option', { name: /^Automatic/ });
    // Two parts: the label, then "Follow {name}'s device · currently {city}".
    expect(within(automatic).getByText('Automatic')).toBeInTheDocument();
    expect(within(automatic).getByText("Follow Maria's device · currently Monterrey")).toBeInTheDocument();
    await user.click(automatic);

    expect(updateMutate.mock.calls[0][0]).toEqual({ timezone: null });
    expect(tzSpy).toHaveBeenCalledWith({
      source: 'edit_circle',
      cleared: true,
      // What automatic resolves to: the recipient's device zone.
      zone: 'America/Monterrey',
      recipient_zone_mismatch: false,
    });
  });

  it('re-picking the current choice saves nothing', async () => {
    const user = userEvent.setup();
    renderCard(makeCircle({ circle_timezone: null, circle_timezone_source: 'owner' }));
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: /^Automatic/ }));
    expect(updateMutate).not.toHaveBeenCalled();
    expect(tzSpy).not.toHaveBeenCalled();
  });

  it('keyboard: ArrowDown + Enter picks the highlighted option', async () => {
    const user = userEvent.setup();
    renderCard(makeCircle());
    await user.type(combobox(), 'Bogota');
    await user.keyboard('{ArrowDown}');
    expect(combobox()).toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(updateMutate.mock.calls[0][0]).toEqual({ timezone: 'America/Bogota' });
  });

  it('Escape closes the list without saving', async () => {
    const user = userEvent.setup();
    renderCard(makeCircle());
    await user.click(combobox());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('typing again after Escape (focus never left) searches only what was typed', async () => {
    // Real-browser regression (Playwright): the closed field still holds the
    // chosen label, so the keystroke used to append to it ("Mexico City (GMT-6)Bogota").
    const user = userEvent.setup();
    renderCard(makeCircle());
    await user.click(combobox());
    await user.keyboard('{Escape}');
    expect(combobox()).toHaveFocus();
    await user.keyboard('Bogota');
    expect(combobox()).toHaveValue('Bogota');
    expect(screen.getByRole('option', { name: 'Bogota (GMT-5)' })).toBeInTheDocument();
  });

  it('shows the mismatch hint when the recipient phone disagrees with the owner-set zone', () => {
    renderCard(
      makeCircle({
        members: [OWNER, member({ id: 'r', is_care_recipient: true, timezone: 'America/Monterrey' })],
      })
    );
    expect(screen.getByTestId('circle-timezone-mismatch')).toHaveTextContent(
      "Maria's phone reports Monterrey. Your setting wins — the schedule runs on Mexico City time."
    );
  });

  it('no mismatch hint when the zones agree, or when nothing is owner-set', () => {
    const { unmount } = renderCard(
      makeCircle({
        members: [OWNER, member({ id: 'r', is_care_recipient: true, timezone: 'America/Mexico_City' })],
      })
    );
    expect(screen.queryByTestId('circle-timezone-mismatch')).toBeNull();
    unmount();
    renderCard(
      makeCircle({
        circle_timezone: null,
        circle_timezone_source: 'recipient',
        members: [OWNER, member({ id: 'r', is_care_recipient: true, timezone: 'America/Monterrey' })],
      })
    );
    expect(screen.queryByTestId('circle-timezone-mismatch')).toBeNull();
  });

  it('a save in flight ignores picks', async () => {
    updatePending = true;
    const user = userEvent.setup();
    renderCard(makeCircle());
    await user.type(combobox(), 'Bogota');
    await user.click(screen.getByRole('option', { name: 'Bogota (GMT-5)' }));
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('renders in Spanish', async () => {
    await i18n.changeLanguage('es');
    renderCard(makeCircle());
    expect(screen.getByRole('combobox', { name: 'Zona horaria' })).toBeInTheDocument();
    expect(screen.getByTestId('circle-timezone-source')).toHaveTextContent('Configurada por ti');
    expect(screen.getByText('Los horarios de los medicamentos siguen esta zona')).toBeInTheDocument();
  });
});
