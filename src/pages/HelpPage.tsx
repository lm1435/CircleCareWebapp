import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';

// Static help / FAQ page (plan Task 8.8 — no writes). FAQ content is ported
// verbatim from the mobile HelpScreen (mobile/src/screens/help) into the `help`
// i18n namespace, so the answers stay in sync conceptually. Collapsible items
// use native <details>/<summary> for built-in keyboard + screen-reader support.

const SECTION_KEYS = ['gettingStarted', 'roles', 'medications', 'notifications', 'premium'] as const;

interface FaqItem {
  question: string;
  answer: string;
}

export default function HelpPage(): ReactElement {
  const { t } = useTranslation('help');

  return (
    <section className="mx-auto max-w-3xl p-6 md:p-8">
      <header>
        <h1 className="serif m-0 text-xl text-ink">{t('title')}</h1>
        <p className="m-0 mt-1 text-ink-3">{t('subtitle')}</p>
      </header>

      <div className="mt-8 flex flex-col gap-8">
        {SECTION_KEYS.map((key) => {
          const items = t(`sections.${key}.items`, { returnObjects: true }) as FaqItem[];
          if (!Array.isArray(items)) return null;
          return (
            <section key={key} aria-labelledby={`help-${key}`}>
              <h2 id={`help-${key}`} className="m-0 mb-3 text-lg font-semibold text-ink">
                {t(`sections.${key}.title`)}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {items.map((item, i) => (
                  <li key={i}>
                    <details className="group rounded-2xl border border-line bg-cream px-5 py-1">
                      <summary className="flex cursor-pointer items-center justify-between gap-3 py-3 text-base font-medium text-ink marker:content-['']">
                        {item.question}
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-ink-3 transition-transform group-open:rotate-180"
                        >
                          <svg
                            width={18}
                            height={18}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </span>
                      </summary>
                      <p className="m-0 pb-4 pr-7 text-sm leading-relaxed text-ink-2">
                        {item.answer}
                      </p>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Contact support */}
      <Card className="mt-10 bg-bg-2 p-6">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('contact.title')}</h2>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('contact.body')}</p>
        <a
          href={`mailto:${t('contact.email')}`}
          className="btn btn-primary mt-4 inline-flex"
        >
          {t('contact.cta')}
        </a>
      </Card>

      {/* Download the app */}
      <div className="mt-8 rounded-2xl border border-line bg-cream p-6">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('download.title')}</h2>
        <p className="m-0 mb-4 mt-1 text-sm text-ink-3">{t('download.body')}</p>
        <StoreBadges layout="row" />
      </div>
    </section>
  );
}
