import type { ReactElement } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * 404 page for unknown URLs (old links, typos). Replaces the silent wildcard
 * redirect to /circles, which made broken links indistinguishable from working
 * ones. Rendered publicly (outside AuthGuard): the CTA routes to /circles, and
 * AuthGuard sends signed-out visitors on to login from there.
 *
 * RouteTitle renders the bare "CircleCare" fallback for unknown paths; the
 * Helmet here is deeper in the tree, so its more specific title wins (same
 * pattern as InviteLandingPage owning its own title).
 */
export default function NotFoundPage(): ReactElement {
  const { t } = useTranslation('common');

  return (
    <main
      id="main"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 py-12 text-center"
    >
      <Helmet>
        <title>{`${t('pageTitles.notFound')} · CircleCare`}</title>
      </Helmet>

      <img src="/icon.png" alt="" className="h-12 w-12 rounded-xl" />
      <h1 className="serif m-0 text-2xl text-ink">{t('notFound.title')}</h1>
      <p className="m-0 max-w-md text-ink-3">{t('notFound.body')}</p>
      <Link to="/circles" className="btn btn-primary mt-2">
        {t('notFound.cta')}
      </Link>
    </main>
  );
}
