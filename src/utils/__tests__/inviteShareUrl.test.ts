import { withInviteLocale } from '@/utils/inviteShareUrl';

/**
 * `withInviteLocale` decides what a shared invite link previews as. It runs on
 * a URL the user is about to text to a family member, so the bar is: correct
 * for Spanish, INERT for everything else, and incapable of throwing.
 *
 * The "unchanged" assertions are the load-bearing half. Every invite link ever
 * sent is a bare URL that already resolves to the English document; if this
 * function ever starts touching English links, all of them acquire a second
 * cache key for an identical page.
 */

const URL_BASE = 'https://my.circlecare.app/invite/ABC123';

describe('withInviteLocale — English and other languages are untouched', () => {
  it.each(['en', 'en-US', 'en-GB', 'EN', 'pt-BR', 'fr', ''])(
    'returns the URL unchanged for %j',
    (language) => {
      expect(withInviteLocale(URL_BASE, language)).toBe(URL_BASE);
    }
  );

  // 'esperanto'/'est' start with "es" as a SUBSTRING but are not the Spanish
  // family — the check is on the whole subtag, not a prefix of the string.
  it.each(['est', 'esperanto', 'eso'])('does not treat %j as Spanish', (language) => {
    expect(withInviteLocale(URL_BASE, language)).toBe(URL_BASE);
  });

  it('leaves an existing query string alone for English', () => {
    expect(withInviteLocale(`${URL_BASE}?ref=email`, 'en')).toBe(`${URL_BASE}?ref=email`);
  });
});

describe('withInviteLocale — Spanish gets the marker', () => {
  it.each(['es', 'es-419', 'es-MX', 'es-ES', 'ES', 'Es-Mx', 'es_419', '  es  '])(
    'appends lang=es for %j',
    (language) => {
      expect(withInviteLocale(URL_BASE, language)).toBe(`${URL_BASE}?lang=es`);
    }
  );

  it('preserves an existing query string', () => {
    expect(withInviteLocale(`${URL_BASE}?ref=email`, 'es')).toBe(`${URL_BASE}?ref=email&lang=es`);
  });

  it('preserves multiple existing params', () => {
    expect(withInviteLocale(`${URL_BASE}?a=1&b=2`, 'es')).toBe(`${URL_BASE}?a=1&b=2&lang=es`);
  });

  // `?lang=es` placed AFTER a '#' is part of the fragment and never reaches the
  // server, so the rewrite would never fire and the card would stay English.
  it('inserts the param before the hash fragment', () => {
    expect(withInviteLocale(`${URL_BASE}#accept`, 'es')).toBe(`${URL_BASE}?lang=es#accept`);
  });

  it('handles a query AND a hash together', () => {
    expect(withInviteLocale(`${URL_BASE}?ref=email#accept`, 'es')).toBe(
      `${URL_BASE}?ref=email&lang=es#accept`
    );
  });

  it('keeps later # characters inside the fragment', () => {
    expect(withInviteLocale(`${URL_BASE}#a#b`, 'es')).toBe(`${URL_BASE}?lang=es#a#b`);
  });

  it('works on a relative URL (no origin to parse)', () => {
    expect(withInviteLocale('/invite/ABC123', 'es')).toBe('/invite/ABC123?lang=es');
  });

  it('does not emit an empty param for a trailing "?"', () => {
    expect(withInviteLocale(`${URL_BASE}?`, 'es')).toBe(`${URL_BASE}?lang=es`);
  });
});

describe('withInviteLocale — idempotency', () => {
  it('never produces lang=es&lang=es', () => {
    const once = withInviteLocale(URL_BASE, 'es');
    const twice = withInviteLocale(once, 'es');
    expect(twice).toBe(once);
    expect(twice).toBe(`${URL_BASE}?lang=es`);
  });

  it('is idempotent with a query and a hash present', () => {
    const once = withInviteLocale(`${URL_BASE}?ref=email#accept`, 'es-419');
    expect(withInviteLocale(once, 'es-419')).toBe(once);
  });

  /**
   * A URL that already names a language keeps it. Appending would yield
   * `?lang=en&lang=es`, whose first param disagrees with the document Apache
   * would actually serve (its RewriteCond matches `lang=es` anywhere).
   */
  it('does not add a second lang param when one already exists', () => {
    expect(withInviteLocale(`${URL_BASE}?lang=en`, 'es')).toBe(`${URL_BASE}?lang=en`);
    expect(withInviteLocale(`${URL_BASE}?lang`, 'es')).toBe(`${URL_BASE}?lang`);
  });

  it('does not mistake a different param that ends in "lang" for the marker', () => {
    expect(withInviteLocale(`${URL_BASE}?slang=es`, 'es')).toBe(`${URL_BASE}?slang=es&lang=es`);
  });
});

describe('withInviteLocale — malformed input never throws', () => {
  it('returns an empty or blank URL unchanged', () => {
    expect(withInviteLocale('', 'es')).toBe('');
    expect(withInviteLocale('   ', 'es')).toBe('   ');
  });

  // The signature says string, but this runs on data that came off the wire
  // (`invite.invite_url`) on the success path of an invite that already sent.
  it('survives a non-string URL', () => {
    const notAUrl = null as unknown as string;
    expect(withInviteLocale(notAUrl, 'es')).toBe(notAUrl);
    expect(withInviteLocale(undefined as unknown as string, 'es')).toBeUndefined();
  });

  it('survives a non-string language', () => {
    expect(withInviteLocale(URL_BASE, null as unknown as string)).toBe(URL_BASE);
    expect(withInviteLocale(URL_BASE, undefined as unknown as string)).toBe(URL_BASE);
  });

  it('does not throw on garbage that is not a URL at all', () => {
    expect(() => withInviteLocale('not a url ???', 'es')).not.toThrow();
  });
});
