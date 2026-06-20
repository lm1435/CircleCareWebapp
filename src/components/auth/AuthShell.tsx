import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

// Family hero photos (copied from mobile assets → /public). Mirrors mobile's
// WelcomeScreen, which picks one at random on each mount rather than animating.
const HERO_IMAGES = [
  { src: '/family-1.webp', altKey: 'authHero.imageAlt1' },
  { src: '/family-2.webp', altKey: 'authHero.imageAlt2' },
  { src: '/family-3.webp', altKey: 'authHero.imageAlt3' },
] as const;

/**
 * Split layout shared by all auth pages. On large screens a full-height family
 * hero (mirrors the mobile WelcomeScreen imagery) sits beside the form card; on
 * smaller widths it collapses to the centered single-card layout.
 */
export function AuthShell({ title, subtitle, children }: AuthShellProps): ReactElement {
  const { t } = useTranslation('common');

  // Pick one hero photo at random per mount (matches mobile WelcomeScreen).
  const hero = useMemo(() => HERO_IMAGES[Math.floor(Math.random() * HERO_IMAGES.length)], []);

  return (
    <main className="flex min-h-screen bg-bg">
      {/* Hero panel — desktop only. Image lives in /public (copied from mobile). */}
      <aside className="relative hidden w-1/2 overflow-hidden lg:block">
        <img
          src={hero.src}
          alt={t(hero.altKey)}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Gradient overlay — mirrors mobile WelcomeScreen: bottom ~40% ramps to
            0.95 opacity so the cream tagline/logo keep AA contrast on any photo. */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/95 from-10% via-ink/55 via-55% to-ink/25" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <div className="flex items-center gap-3">
            <img src="/icon.png" alt="" className="h-14 w-14 rounded-[14px]" />
            <p className="serif m-0 text-4xl text-cream">{t('appName')}</p>
          </div>
          <p className="m-0 mt-3 max-w-md text-base leading-snug text-cream/90">
            {t('authHero.tagline')}
          </p>
        </div>
      </aside>

      {/* Form column — centered card. */}
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <img src="/icon.png" alt="" className="h-9 w-9 rounded-[10px]" />
            <p className="serif m-0 text-lg text-ink">{t('appName')}</p>
          </div>
          <Card>
            <h1 className="serif m-0 mb-2 text-xl leading-tight text-ink">{title}</h1>
            {subtitle ? <p className="m-0 mb-6 text-sm text-ink-3">{subtitle}</p> : null}
            {children}
          </Card>
        </div>
      </div>
    </main>
  );
}
