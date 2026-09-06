import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';

export interface AuthShellProps {
  children: ReactNode;
}

// Family hero photos (copied from mobile assets → /public). Mirrors mobile's
// WelcomeScreen, which picks one at random on each mount rather than animating.
const HERO_IMAGES = [
  { src: '/family-1.webp', altKey: 'authHero.imageAlt1' },
  { src: '/family-2.webp', altKey: 'authHero.imageAlt2' },
  { src: '/family-3.webp', altKey: 'authHero.imageAlt3' },
] as const;

// Order mirrors the table in the W5 task — meds, calendar, accountability.
const VALUE_PROP_KEYS = [
  'authHero.valueProps.meds',
  'authHero.valueProps.calendar',
  'authHero.valueProps.accountability',
] as const;

/**
 * Split layout shared by every signed-out screen. On large screens (≥1024px) a
 * full-height family hero (mirrors the mobile WelcomeScreen imagery) sits
 * beside the form column; below that it collapses to the form filling the
 * page on plain paper. Unlike the old version, this component owns ONLY the
 * split — the top bar, heading and body are composed by each page from
 * `AuthTopBar` / `AuthHeader`, exactly like mobile's per-screen composition.
 */
export function AuthShell({ children }: AuthShellProps): ReactElement {
  const { t } = useTranslation('common');

  // Pick one hero photo at random per mount (matches mobile WelcomeScreen).
  const hero = useMemo(() => HERO_IMAGES[Math.floor(Math.random() * HERO_IMAGES.length)], []);

  return (
    <main className="flex min-h-screen bg-bg">
      {/* Hero panel — ≥1024px only. Image lives in /public (copied from mobile). */}
      <aside className="relative hidden w-1/2 overflow-hidden xl:block">
        <img
          src={hero.src}
          alt={t(hero.altKey)}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Gradient overlay — mirrors mobile WelcomeScreen: ramps from 0.95
            opacity at the bottom 10% to 0.55 at 55% (the stops below), so the
            cream headline/tagline/value-prop list keep AA contrast on any
            photo. */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/95 from-10% via-ink/55 via-55% to-ink/25" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          {/* The wordmark only — the editorial face stops here (spec §6.1). */}
          <p className="m-0 text-xl text-cream" style={{ fontFamily: 'var(--font-serif)' }}>
            {t('appName')}
          </p>
          {/* A <p>, not <h2> — the form column's <h1> (the actual page
              heading) renders after this in the DOM, so an <h2> here would
              put an h2 before the page's h1 and break heading order. Sans
              type scale (`editorialTitle`), not the serif face. */}
          <Text variant="editorialTitle" as="p" className="mt-6 max-w-md text-cream!">
            {t('authHero.headline')}
          </Text>
          <Text variant="caption" className="m-0 mt-3 max-w-md text-cream/90!">
            {t('authHero.tagline')}
          </Text>
          <ul role="list" className="m-0 mt-5 flex max-w-md list-none flex-col gap-2 p-0">
            {VALUE_PROP_KEYS.map((key) => (
              <li key={key} className="flex items-start gap-2">
                <Text variant="caption" className="text-cream/90!">
                  {t(key)}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form column — sits directly on paper, no card border. */}
      <div className="mx-auto flex w-full max-w-[448px] flex-1 flex-col justify-center px-6 py-10">
        {children}
      </div>
    </main>
  );
}
