import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Eyebrow, Icon, Text } from '@/components/ui';
import type { DocumentCategory } from '@/api/documents';

/**
 * First-run state for the Documents page (mobile
 * `components/documents/DocumentStarterKit.tsx`, 1.1.11).
 *
 * The generic "no documents yet" tile described the feature and then asked
 * the user to go find a file. This states the job instead: the four documents
 * a caregiver actually gets asked for, mapped 1:1 onto four real categories,
 * each a one-click entry into the upload form with its category and label
 * already filled in. "Upload something else" is the escape hatch underneath.
 *
 * No per-row icons — rows lead with typography; the only mark is a hairline
 * rule tinted with the colour that category's chip will carry once the
 * document exists (same accents as the row tiles).
 */
export interface DocumentStarterKitProps {
  /** Opens the upload form preset to this category, with `label` prefilled. */
  onPick: (category: DocumentCategory, label: string) => void;
  /** Opens the upload form with nothing preset. */
  onOther: () => void;
}

interface Suggestion {
  category: DocumentCategory;
  /** Written out per row: Tailwind cannot see an interpolated `bg-${tone}`. */
  accent: string;
  title: string;
  hint: string;
}

export function DocumentStarterKit({ onPick, onOther }: DocumentStarterKitProps): ReactElement {
  const { t } = useTranslation('documents');
  const headingId = useId();

  // Keys written out rather than mapped over a template: a runtime-assembled
  // key is invisible to the translation-coverage test, so a missing es leaf
  // would ship as a raw key on screen.
  const suggestions: Suggestion[] = [
    {
      category: 'insurance',
      accent: 'bg-dusk',
      title: t('starter.items.insurance.title'),
      hint: t('starter.items.insurance.hint'),
    },
    {
      category: 'legal',
      accent: 'bg-clay',
      title: t('starter.items.directive.title'),
      hint: t('starter.items.directive.hint'),
    },
    {
      category: 'prescriptions',
      accent: 'bg-terracotta',
      title: t('starter.items.medications.title'),
      hint: t('starter.items.medications.hint'),
    },
    {
      category: 'medical_records',
      accent: 'bg-moss',
      title: t('starter.items.labs.title'),
      hint: t('starter.items.labs.hint'),
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5 pt-2">
      <div>
        <Eyebrow color="moss" as="p">
          {t('starter.eyebrow')}
        </Eyebrow>
        <Text variant="h2" as="h2" id={headingId} className="mt-1.5">
          {t('starter.title')}
        </Text>
        <p className="m-0 mt-2 max-w-md text-md text-ink-2">{t('starter.lede')}</p>
      </div>

      <Card padding="none" className="px-4">
        <ul className="m-0 list-none p-0">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.category} className={index > 0 ? 'border-t border-line-2' : undefined}>
              <button
                type="button"
                onClick={() => onPick(suggestion.category, suggestion.title)}
                aria-label={`${suggestion.title}. ${suggestion.hint}`}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-md bg-transparent px-1 py-3 text-left transition-colors duration-fast hover:bg-bg-2"
              >
                <span
                  aria-hidden="true"
                  className={`w-[3px] shrink-0 self-stretch rounded-full ${suggestion.accent}`}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-md font-semibold leading-snug text-ink">
                    {suggestion.title}
                  </span>
                  <span className="mt-0.5 text-sm text-ink-2">{suggestion.hint}</span>
                </span>
                <Icon name="chevron-forward" size="inline" className="shrink-0 text-ink-3" />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Button
        variant="ghost"
        onClick={onOther}
        rightIcon={<Icon name="chevron-forward" size="row" />}
        className="self-start"
      >
        {t('starter.other')}
      </Button>
    </section>
  );
}
