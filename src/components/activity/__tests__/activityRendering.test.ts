import i18n from '@/i18n';
import { renderActivityDescription } from '@/components/activity/activityTranslation';

// ---------------------------------------------------------------------------
// renderActivityDescription — the KEY-BASED activity-feed renderer (web twin of
// mobile/src/__tests__/utils/activityRendering.test.ts).
//
// Rows written by a parameterized backend carry a stable `description_key` plus
// RAW `description_params`; this renderer assembles the sentence locally, which
// is what lets a time render in THIS viewer's 12h/24h clock rather than the one
// the server happened to bake in.
//
// `t` is the REAL i18next fixed-T over the shipped activity namespace, so these
// assertions fail if the copy is missing — not just if the plumbing is wrong.
//
// Dates use a fixed date far enough in the past to be neither Today nor
// Yesterday, matching the convention in the sibling activityTranslation test,
// so nothing depends on the day the suite runs.
// ---------------------------------------------------------------------------

const tEn = i18n.getFixedT('en', 'activity');
const tEs = i18n.getFixedT('es', 'activity');

const PAST = '2026-06-10';

// The VIEWER's zone, pinned. Every case below renders a circle in
// America/Denver, and a rendered time is now labelled only when the viewer is
// somewhere else — so without this the output would depend on the machine
// running the suite (the dev machine is America/Denver; CI is not). The cases
// that are ABOUT the label pin their own zone and restore this one after.
beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/Denver',
  } as Intl.ResolvedDateTimeFormatOptions);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('renderActivityDescription — key-based rendering', () => {
  describe('the live defect: server-formatted times ignored the viewer', () => {
    const rescheduled = {
      // Byte-identical to what the backend still writes.
      description: 'Rescheduled Medication: Atorvastatin to 14:30',
      description_key: 'entries.medicationRescheduled',
      description_params: { title: 'Atorvastatin', scheduledTime: '14:30:00' },
    };

    it('renders a 12-hour clock for a 12h viewer', () => {
      expect(renderActivityDescription(rescheduled, tEn, { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' })).toBe(
        'Rescheduled Medication: Atorvastatin to 2:30 PM'
      );
    });

    it('renders a 24-hour clock for a 24h viewer', () => {
      expect(renderActivityDescription(rescheduled, tEn, { timezone: 'America/Denver', hourCycle: '24h', locale: 'en' })).toBe(
        'Rescheduled Medication: Atorvastatin to 14:30'
      );
    });

    it('gives the two viewers DIFFERENT text from the same row', () => {
      // The whole point. Before parameterization both users saw the single
      // string the server baked in, so this assertion could not have held.
      expect(
        renderActivityDescription(rescheduled, tEn, { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' })
      ).not.toBe(renderActivityDescription(rescheduled, tEn, { timezone: 'America/Denver', hourCycle: '24h', locale: 'en' }));
    });

    it('renders the Spanish RAE meridiem for a 12h Spanish viewer', () => {
      expect(renderActivityDescription(rescheduled, tEs, { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' })).toBe(
        'Medicamento reprogramado: Atorvastatin a las 2:30 p. m.'
      );
    });

    it('renders Spanish 24h with no meridiem', () => {
      expect(renderActivityDescription(rescheduled, tEs, { timezone: 'America/Denver', hourCycle: '24h', locale: 'es' })).toBe(
        'Medicamento reprogramado: Atorvastatin a las 14:30'
      );
    });
  });

  describe('server-formatted dates', () => {
    it('renders "Not taken" with a localized short date, never a raw ISO string', () => {
      const row = {
        description: `Not taken: Aspirin on ${PAST}`,
        description_key: 'entries.medicationNotTaken',
        description_params: { title: 'Aspirin', scheduledDate: PAST },
      };
      expect(renderActivityDescription(row, tEn, { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' })).toBe(
        'Skipped: Aspirin on Jun 10'
      );
      expect(renderActivityDescription(row, tEs, { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' })).toBe(
        'Omitido: Aspirin el 10 jun'
      );
      expect(
        renderActivityDescription(row, tEn, { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' })
      ).not.toContain(PAST);
    });

    it('renders "Stopped recurrence" from a raw date', () => {
      const row = {
        description: `Stopped recurrence for Aspirin from ${PAST}`,
        description_key: 'entries.recurrenceStopped',
        description_params: { title: 'Aspirin', scheduledDate: PAST },
      };
      expect(renderActivityDescription(row, tEn, { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' })).toBe(
        'Stopped recurrence for Aspirin from Jun 10'
      );
      expect(renderActivityDescription(row, tEs, { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' })).toBe(
        'Detuvo recurrencia de Aspirin desde 10 jun'
      );
    });

    it('renders the key path as "Skipped:", matching the legacy phrase path', () => {
      // The divergence this test used to pin is RESOLVED (2026-09-01). It was
      // justified by "the backend has said 'Not taken:' for some time", and
      // that premise is now false: backend `translations.ts` resolves
      // activity.entries.medicationNotTaken to "Skipped: …" / "Omitido: …",
      // and mobile's en.json/es.json agree.
      //
      // The stored `description` stays "Not taken: …" on purpose — it is an
      // internal token matched by /^Not taken: (.+) on …/ so old rows keep
      // rendering on shipped 1.1.10/1.1.11 clients. The KEY is the display
      // label, and every surface now resolves it to "Skipped". Input is a
      // token; output is copy. Change all three surfaces or none.
      const row = {
        description: `Not taken: Aspirin on ${PAST}`,
        description_key: 'entries.medicationNotTaken',
        description_params: { title: 'Aspirin', scheduledDate: PAST },
      };
      expect(renderActivityDescription(row, tEn, { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' })).toContain(
        'Skipped:'
      );
    });
  });

  describe('roleLabel became a key suffix', () => {
    it('renders memberJoined for each role in English', () => {
      expect(
        renderActivityDescription(
          {
            description: 'Pat Rivera joined the circle as Caregiver',
            description_key: 'entries.memberJoined.caregiver',
            description_params: { name: 'Pat Rivera' },
          },
          tEn,
          { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' }
        )
      ).toBe('Pat Rivera joined the circle as Caregiver');

      expect(
        renderActivityDescription(
          {
            description: 'Mom joined the circle as Care Recipient',
            description_key: 'entries.memberJoined.careRecipient',
            description_params: { name: 'Mom' },
          },
          tEn,
          { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' }
        )
      ).toBe('Mom joined the circle as Care Recipient');
    });

    it('renders memberJoined for each role in Spanish', () => {
      expect(
        renderActivityDescription(
          {
            description: 'Pat Rivera joined the circle as Caregiver',
            description_key: 'entries.memberJoined.caregiver',
            description_params: { name: 'Pat Rivera' },
          },
          tEs,
          { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' }
        )
      ).toBe('Pat Rivera se unió al círculo como cuidador');

      expect(
        renderActivityDescription(
          {
            description: 'Mom joined the circle as Care Recipient',
            description_key: 'entries.memberJoined.careRecipient',
            description_params: { name: 'Mom' },
          },
          tEs,
          { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' }
        )
      ).toBe('Mom se unió al círculo como receptor de cuidado');
    });

    it('renders memberInvited for each role, EN and ES', () => {
      const caregiver = {
        description: 'Invited tom@example.com to join as Caregiver',
        description_key: 'entries.memberInvited.caregiver',
        description_params: { email: 'tom@example.com' },
      };
      expect(renderActivityDescription(caregiver, tEn, { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' })).toBe(
        'Invited tom@example.com to join as Caregiver'
      );
      expect(renderActivityDescription(caregiver, tEs, { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' })).toBe(
        'Invitó a tom@example.com a unirse como cuidador'
      );

      expect(
        renderActivityDescription(
          {
            description: 'Invited mom@example.com to join as Care Recipient',
            description_key: 'entries.memberInvited.careRecipient',
            description_params: { email: 'mom@example.com' },
          },
          tEs,
          { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' }
        )
      ).toBe('Invitó a mom@example.com a unirse como receptor de cuidado');
    });
  });
});

describe('renderActivityDescription — fallback to `description`', () => {
  it('falls back when description_key is NULL (historical row)', () => {
    expect(
      renderActivityDescription(
        {
          description: 'Confirmed Medication: Aspirin 100mg (taken)',
          description_key: null,
          description_params: null,
        },
        tEs,
        { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' }
      )
    ).toBe('Medicamento confirmado: Aspirin 100mg (tomado)');
  });

  it('falls back when the columns are ABSENT entirely (old backend)', () => {
    expect(
      renderActivityDescription({ description: 'Added Task: Pick up prescription' }, tEn, {
        timezone: 'America/Denver', hourCycle: '12h',
        locale: 'en',
      })
    ).toBe('Added Task: Pick up prescription');
  });

  // THE PARTIAL-ROLLOUT GUARANTEE. Backend and clients deploy independently, so
  // a backend WILL eventually write a key this build has never heard of.
  it('falls back when description_key is UNRECOGNISED, not merely null', () => {
    const out = renderActivityDescription(
      {
        description: 'Confirmed Medication: Aspirin 100mg (taken)',
        description_key: 'entries.somethingThisBuildHasNeverHeardOf',
        description_params: { title: 'Aspirin' },
      },
      tEs,
      { timezone: 'America/Denver', hourCycle: '12h', locale: 'es' }
    );

    expect(out).toBe('Medicamento confirmado: Aspirin 100mg (tomado)');
    // The raw key must never reach a user's screen.
    expect(out).not.toContain('entries.');
    expect(out).not.toContain('somethingThisBuildHasNeverHeardOf');
  });

  it('falls back when a KNOWN key arrives without params (malformed row)', () => {
    expect(
      renderActivityDescription(
        {
          description: 'Rescheduled Medication: Atorvastatin to 14:30',
          description_key: 'entries.medicationRescheduled',
          description_params: null,
        },
        tEn,
        { timezone: 'America/Denver', hourCycle: '24h', locale: 'en' }
      )
    ).toBe('Rescheduled Medication: Atorvastatin to 14:30');
  });

  it('refuses a real-but-non-entry key instead of rendering it', () => {
    // 'phrases.confirmedMedication' EXISTS in the namespace but is NOT an entry
    // key. A `t(key)` implementation would happily render "Medicamento
    // confirmado:" here; the allow-list refuses it and falls back.
    expect(
      renderActivityDescription(
        {
          description: 'Updated emergency information',
          description_key: 'phrases.confirmedMedication',
          description_params: {},
        },
        tEn,
        { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' }
      )
    ).toBe('Updated emergency info');
  });
});

describe('renderDate resolves Today/Yesterday in the RECIPIENT frame', () => {
  /**
   * A date param is a recipient-frame calendar day and carries no abbreviation
   * to say so, unlike a time. Judging it in the viewer's frame is therefore
   * undetectable to the reader.
   */
  const rescheduleRow = (scheduledDate: string) => ({
    description: `Not taken: Metformin on ${scheduledDate}`,
    description_key: 'entries.medicationNotTaken',
    description_params: { title: 'Metformin', scheduledDate },
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the recipient today "Today", not a date', () => {
    // 2026-08-26T04:00Z = Aug 25, 22:00 in Denver but ALREADY Aug 26 in Tokyo.
    vi.setSystemTime(new Date('2026-08-26T04:00:00Z'));
    const out = renderActivityDescription(rescheduleRow('2026-08-26'), tEn, {
      timezone: 'Asia/Tokyo',
      hourCycle: '12h',
      locale: 'en',
    });
    expect(out).toContain('Today');
    expect(out).not.toContain('Aug 26');
  });

  it('does not call the recipient yesterday "Today"', () => {
    vi.setSystemTime(new Date('2026-08-26T04:00:00Z'));
    const out = renderActivityDescription(rescheduleRow('2026-08-25'), tEn, {
      timezone: 'Asia/Tokyo',
      hourCycle: '12h',
      locale: 'en',
    });
    expect(out).toContain('Yesterday');
    expect(out).not.toContain('Today');
  });
});

describe('the allow-list is an allow-list', () => {
  const CTX = { timezone: 'America/Denver', hourCycle: '12h' as const, locale: 'en' };

  /**
   * An object literal is walked through its PROTOTYPE, so a lookup of
   * `constructor` returns `Object` — truthy and callable. The old code called
   * it, got the params OBJECT back typed as a string, and React threw
   * "Objects are not valid as a React child", blanking the entire feed.
   */
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'does not treat Object.prototype.%s as a renderer',
    (key) => {
      const out = renderActivityDescription(
        {
          description: 'Added Task: Pick up prescription',
          description_key: key,
          description_params: { title: 'x' },
        },
        tEn,
        CTX
      );
      expect(typeof out).toBe('string');
      expect(out).toBe('Added Task: Pick up prescription');
    }
  );

  /**
   * `{}` is truthy and is the JSONB column default, so the old guard let the
   * renderer run and emit "Rescheduled Medication:  to " — discarding the
   * complete server-written description on the same row.
   */
  it('falls back when params are EMPTY rather than null', () => {
    const out = renderActivityDescription(
      {
        description: 'Rescheduled Medication: Atorvastatin to 14:30',
        description_key: 'entries.medicationRescheduled',
        description_params: {},
      },
      tEn,
      CTX
    );
    expect(out).toBe('Rescheduled Medication: Atorvastatin to 14:30');
  });

  it('falls back when only SOME required params are present', () => {
    // What a renamed param key leaves behind.
    const out = renderActivityDescription(
      {
        description: 'Rescheduled Medication: Atorvastatin to 14:30',
        description_key: 'entries.medicationRescheduled',
        description_params: { title: 'Atorvastatin' },
      },
      tEn,
      CTX
    );
    expect(out).toBe('Rescheduled Medication: Atorvastatin to 14:30');
  });

  it('still renders a COMPLETE parameterized row', () => {
    const out = renderActivityDescription(
      {
        description: 'Rescheduled Medication: Atorvastatin to 14:30',
        description_key: 'entries.medicationRescheduled',
        description_params: { title: 'Atorvastatin', scheduledTime: '14:30:00' },
      },
      tEn,
      CTX
    );
    expect(out).toBe('Rescheduled Medication: Atorvastatin to 2:30 PM');
  });
});

describe('an unresolved recipient timezone falls back, not forward', () => {
  /**
   * `useCircle` reports a hardcoded 'America/New_York' while the circle detail
   * query is in flight, and that is indistinguishable from a real New York
   * circle. Rendering a parameterized row through it would label a time with
   * the wrong zone and judge Today/Yesterday in the wrong frame — confidently,
   * with nothing on screen to hint at it. The server-written `description` is
   * less specific and always right.
   */
  it('renders the server description while the timezone is null', () => {
    const out = renderActivityDescription(
      {
        description: 'Rescheduled Medication: Atorvastatin to 14:30',
        description_key: 'entries.medicationRescheduled',
        description_params: { title: 'Atorvastatin', scheduledTime: '14:30:00' },
      },
      tEn,
      { timezone: null, hourCycle: '12h', locale: 'en' }
    );
    expect(out).toBe('Rescheduled Medication: Atorvastatin to 14:30');
    // Crucially NOT the parameterized rendering, which would carry a zone
    // abbreviation the viewer has no reason to trust.
    expect(out).not.toContain('MT');
    expect(out).not.toContain('ET');
  });

  it('renders the parameterized sentence once the timezone resolves', () => {
    const out = renderActivityDescription(
      {
        description: 'Rescheduled Medication: Atorvastatin to 14:30',
        description_key: 'entries.medicationRescheduled',
        description_params: { title: 'Atorvastatin', scheduledTime: '14:30:00' },
      },
      tEn,
      { timezone: 'America/Denver', hourCycle: '12h', locale: 'en' }
    );
    expect(out).toBe('Rescheduled Medication: Atorvastatin to 2:30 PM');
  });
});

describe('params must be renderable, not merely present', () => {
  const CTX = { timezone: 'America/Denver', hourCycle: '12h' as const, locale: 'en' };

  /**
   * `!= null` was the first version of this guard and it is not enough. Found
   * by mobile-63 after I warned them about it and left it in my own code.
   */
  it('falls back for a BLANK required param (the OAuth no-first_name case)', () => {
    const out = renderActivityDescription(
      {
        description: 'Alex Kim joined the circle as Caregiver',
        description_key: 'entries.memberJoined.caregiver',
        description_params: { name: '' },
      },
      tEn,
      CTX
    );
    // The complete server sentence, not " joined the circle as Caregiver".
    expect(out).toBe('Alex Kim joined the circle as Caregiver');
    expect(out.startsWith(' ')).toBe(false);
  });

  it('falls back for a WHITESPACE-ONLY required param', () => {
    const out = renderActivityDescription(
      {
        description: 'Alex Kim joined the circle as Caregiver',
        description_key: 'entries.memberJoined.caregiver',
        description_params: { name: '   ' },
      },
      tEn,
      CTX
    );
    expect(out).toBe('Alex Kim joined the circle as Caregiver');
  });

  it('falls back for a NON-STRING required param', () => {
    const out = renderActivityDescription(
      {
        description: 'Rescheduled Medication: Metformin to 14:30',
        description_key: 'entries.medicationRescheduled',
        description_params: { title: 'Metformin', scheduledTime: 2000 },
      },
      tEn,
      CTX
    );
    expect(out).toBe('Rescheduled Medication: Metformin to 14:30');
    expect(out.endsWith(' to ')).toBe(false);
  });

  it('still renders when every required param is a real string', () => {
    const out = renderActivityDescription(
      {
        description: 'Alex Kim joined the circle as Caregiver',
        description_key: 'entries.memberJoined.caregiver',
        description_params: { name: 'Alex' },
      },
      tEn,
      CTX
    );
    expect(out).toContain('Alex');
  });
});

// ---------------------------------------------------------------------------
// The zone label on a rendered time
//
// The feed appended the care recipient's zone to every time UNCONDITIONALLY, so
// a Denver caregiver reading a Denver circle got "2:30 PM MT" on every row. A
// zone label answers "whose clock is this?"; in a single-zone circle — the
// overwhelming majority — nobody is asking.
//
// The device zone is pinned in every case below. The dev machine is
// America/Denver, and a test that reads the real one would pass here and fail
// on any other machine.
// ---------------------------------------------------------------------------

describe('the zone label', () => {
  const rescheduled = {
    description: 'Rescheduled Medication: Atorvastatin to 14:30',
    description_key: 'entries.medicationRescheduled',
    description_params: { title: 'Atorvastatin', scheduledTime: '14:30:00' },
  };

  function pinDeviceTimezone(timeZone: string) {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone,
    } as Intl.ResolvedDateTimeFormatOptions);
  }

  it('is ABSENT when the caregiver shares the care recipient’s zone', () => {
    pinDeviceTimezone('America/Denver');
    expect(
      renderActivityDescription(rescheduled, tEn, {
        timezone: 'America/Denver',
        hourCycle: '12h',
        locale: 'en',
      })
    ).toBe('Rescheduled Medication: Atorvastatin to 2:30 PM');
  });

  it('names the recipient’s CITY when the caregiver is elsewhere', () => {
    pinDeviceTimezone('America/New_York');
    expect(
      renderActivityDescription(rescheduled, tEn, {
        timezone: 'America/Denver',
        hourCycle: '12h',
        locale: 'en',
      })
    ).toBe('Rescheduled Medication: Atorvastatin to 2:30 PM (Denver)');
  });

  it('spells that city in Spanish for a Spanish reader', () => {
    pinDeviceTimezone('America/Denver');
    expect(
      renderActivityDescription(rescheduled, tEs, {
        timezone: 'Europe/Berlin',
        hourCycle: '12h',
        locale: 'es',
      })
    ).toBe('Medicamento reprogramado: Atorvastatin a las 2:30 p. m. (Berlín)');
  });

  it('judges the comparison at the instant the caller supplies', () => {
    // Phoenix and Denver share a clock in January and differ in July.
    pinDeviceTimezone('America/Phoenix');
    const winter = renderActivityDescription(rescheduled, tEn, {
      timezone: 'America/Denver',
      hourCycle: '12h',
      locale: 'en',
      now: new Date('2026-01-15T12:00:00Z'),
    });
    const summer = renderActivityDescription(rescheduled, tEn, {
      timezone: 'America/Denver',
      hourCycle: '12h',
      locale: 'en',
      now: new Date('2026-07-15T12:00:00Z'),
    });
    expect(winter).toBe('Rescheduled Medication: Atorvastatin to 2:30 PM');
    expect(summer).toBe('Rescheduled Medication: Atorvastatin to 2:30 PM (Denver)');
  });
});
