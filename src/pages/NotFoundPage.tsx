import type { ReactElement } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthTopBar } from '@/components/auth/AuthTopBar';
import { TerminalState } from '@/components/auth/TerminalState';

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
    <AuthShell>
      <Helmet>
        <title>{`${t('pageTitles.notFound')} · CircleCare`}</title>
      </Helmet>

      <AuthTopBar />
      <TerminalState
        icon="help-circle-outline"
        title={t('notFound.title')}
        body={t('notFound.body')}
      >
        <Button as={Link} to="/circles" variant="primary" size="lg" fullWidth>
          {t('notFound.cta')}
        </Button>
      </TerminalState>
    </AuthShell>
  );
}
