/**
 * Locale marker for shared invite links.
 *
 * WHY THIS EXISTS
 * ---------------
 * Link-preview crawlers (iMessage, WhatsApp, Slack, Facebook) do not execute
 * JS, so react-helmet-async cannot reach them: the card an invite previews as
 * is whatever og:* tags are baked into the HTML the server hands over. One
 * static document carries one language, and index.html is English.
 *
 * A Spanish-speaking daughter texting her brother an invite was therefore
 * sending an English card into a Spanish conversation — the one artifact whose
 * entire job is to look like something you can trust.
 *
 * The build now emits a second prerendered document, dist/index.es.html
 * (scripts/build-locale-html.mjs): same hashed JS/CSS, Spanish title,
 * description, and og-invite-es.jpg. `public/.htaccess` serves it for any
 * non-file route whose query string carries `lang=es`. This helper is the
 * client half — it stamps that marker onto the link the sender shares.
 *
 * WHY ONLY SPANISH GETS A PARAM
 * -----------------------------
 * English is the DEFAULT document. Every invite link ever sent — the ones
 * sitting in Messages threads and inboxes right now, the ones the backend
 * mails out, the ones already printed into `invites.invite_url` rows — is a
 * bare URL that already resolves to the English card. Leaving EN untouched
 * keeps all of them byte-identical, so there is nothing to migrate and no
 * behaviour to re-verify.
 *
 * It also avoids a pointless cache key: `?lang=en` and the bare URL would be
 * two distinct entries in every CDN, crawler cache, and unfurl cache along the
 * way, for one identical document.
 *
 * NOT A UI LANGUAGE SWITCH. The i18next detector runs `order: ['navigator']`
 * (src/i18n/index.ts), so this parameter is inert once the SPA boots — an
 * invitee still gets the UI their own browser asks for. It exists solely to
 * pick which prerendered document the SERVER hands to a crawler.
 */

/** The parameter name and value the .htaccess rewrite matches on. */
const LOCALE_PARAM = 'lang';
const SPANISH_VALUE = 'es';

/**
 * True for the Spanish family in any form i18next or a browser might hand us:
 * 'es', 'es-419', 'es-MX', 'ES', and the underscore spellings some platforms
 * still emit ('es_419'). Anything else — including 'en', 'en-US', '' and
 * undefined-turned-empty — is not Spanish and gets no marker.
 */
function isSpanish(language: string): boolean {
  const normalized = language.trim().toLowerCase().replace(/_/g, '-');
  return normalized === 'es' || normalized.startsWith('es-');
}

/**
 * Append the Spanish link-preview marker to an invite URL, if and only if the
 * sender's app language is Spanish.
 *
 * Works on absolute and relative URLs alike (deliberately string surgery, not
 * `new URL()`, which throws on a relative href and would need a base). Any
 * existing query string and hash fragment are preserved, and the param is
 * inserted BEFORE the fragment — `?lang=es` after a `#` is part of the
 * fragment and never reaches the server.
 *
 * Idempotent: a URL that already carries a `lang` parameter is returned
 * untouched. Appending a second one would produce `?lang=es&lang=es` in the
 * benign case and, in the `?lang=en&lang=es` case, a URL whose first parameter
 * disagrees with the document Apache would actually serve (its RewriteCond
 * matches `lang=es` anywhere in the query).
 *
 * Never throws. A malformed or empty input is returned exactly as given —
 * this runs on the success path of an invite that has already been created,
 * and a share button that explodes is far worse than one that shares the
 * unmarked link.
 */
export function withInviteLocale(url: string, language: string): string {
  try {
    if (typeof url !== 'string' || url.trim().length === 0) return url;
    if (typeof language !== 'string' || !isSpanish(language)) return url;

    // Split off the fragment first: everything after the first '#' is opaque
    // to the server and must stay at the very end. Later '#'s are literal
    // fragment characters, so re-join rather than dropping them.
    const hashIndex = url.indexOf('#');
    const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const hash = hashIndex === -1 ? '' : url.slice(hashIndex);

    const queryIndex = beforeHash.indexOf('?');
    const path = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

    const alreadyMarked = query
      .split('&')
      .some((pair) => pair === LOCALE_PARAM || pair.startsWith(`${LOCALE_PARAM}=`));
    if (alreadyMarked) return url;

    const marker = `${LOCALE_PARAM}=${SPANISH_VALUE}`;
    const nextQuery = query.length > 0 ? `${query}&${marker}` : marker;
    return `${path}?${nextQuery}${hash}`;
  } catch {
    return url;
  }
}
