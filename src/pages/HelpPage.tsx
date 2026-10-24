import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, Card, Sheet, Text, useAccordionGroup } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { Analytics } from '@/lib/analytics';
import { HelpHome } from '@/components/help/HelpHome';
import { HelpContactCard } from '@/components/help/HelpContactCard';
import { useHelp } from '@/help/useHelp';

// Static help / FAQ page (plan Task 8.8 — no writes). FAQ content is ported
// verbatim from the mobile HelpScreen (mobile/src/screens/help) into the `help`
// i18n namespace, so the answers stay in sync conceptually. Two-level
// disclosure mirrors mobile: each top-level section is an `Accordion` whose
// panel holds one nested `Accordion` per question — both levels share the
// same controlled open/closed machinery (`useAccordionGroup`).

const SECTION_KEYS = ['gettingStarted', 'roles', 'medications', 'notifications', 'premium'] as const;

interface FaqItem {
  question: string;
  answer: string;
}

export default function HelpPage(): ReactElement {
  const { t } = useTranslation('help');
  const { articles } = useHelp();
  // Both levels start CLOSED (mobile HelpScreen mounts with empty expanded
  // sets) — two-level disclosure means opening a section never also dumps
  // every answer inside it open.
  const sections = useAccordionGroup(SECTION_KEYS as unknown as string[], { defaultOpen: false });
  const items = useAccordionGroup([], { defaultOpen: false });

  return (
    <section className="mx-auto w-full max-w-2xl p-6 md:p-8">
      <Text variant="editorialTitle">{t('title')}</Text>
      <p className="mt-3.5 text-md font-medium text-ink">{t('subtitle')}</p>

      {/* In-app help center: search, Popular and categories over the bundled
          articles (renders nothing until content.json is present). */}
      <HelpHome />

      {/* Legacy FAQ: only for a build without bundled help content. With content the
          home above (Popular + Browse) replaces it, matching the mobile help home. */}
      {articles.length === 0 && (
      <div className="mt-6 flex flex-col gap-4">
        {SECTION_KEYS.map((key) => {
          const sectionItems = t(`sections.${key}.items`, { returnObjects: true }) as FaqItem[];
          if (!Array.isArray(sectionItems)) return null;
          return (
            <Sheet key={key} padding="none">
              <div className="p-4">
                <Accordion
                  id={key}
                  title={t(`sections.${key}.title`)}
                  open={sections.isOpen(key)}
                  onToggle={sections.toggle}
                >
                  <div className="flex flex-col gap-2">
                    {sectionItems.map((item, index) => {
                      const itemId = `${key}-${index}`;
                      return (
                        <Accordion
                          key={itemId}
                          id={itemId}
                          title={item.question}
                          // Nested inside the section's own h2 — a question is
                          // a level-3 heading, so screen-reader heading
                          // navigation reflects the real outline (section →
                          // question) instead of two sibling h2s.
                          headingAs="h3"
                          open={items.isOpen(itemId)}
                          onToggle={(id) => {
                            // Fire only on the OPEN transition, never on collapse
                            // — a stable "section.index" analytics key (the
                            // format the existing Analytics.helpItemExpanded call
                            // sites use), never the rendered question text.
                            if (!items.isOpen(id)) Analytics.helpItemExpanded(`${key}.${index}`);
                            items.toggle(id);
                          }}
                        >
                          <Text variant="caption">{item.answer}</Text>
                        </Accordion>
                      );
                    })}
                  </div>
                </Accordion>
              </div>
            </Sheet>
          );
        })}
      </div>
      )}

      {/* Contact support: the help home above already shows the contact card; this
          fallback covers a build without bundled help content. */}
      {articles.length === 0 && <HelpContactCard className="mt-8" />}

      {/* Download the app */}
      <Card padding="lg" className="mt-6">
        <Text variant="h3" as="h2">
          {t('download.title')}
        </Text>
        <Text variant="caption" className="mb-4 mt-1">
          {t('download.body')}
        </Text>
        <StoreBadges layout="row" />
      </Card>
    </section>
  );
}
