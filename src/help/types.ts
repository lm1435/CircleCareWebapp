/**
 * In-app help content shape (docs/plans/in-app-help.md). The JSON is generated
 * by CircleCareWeb/scripts/export-help-content.ts and shipped identically to
 * mobile and web; this file only describes it.
 */
export type HelpCategory = string;

export interface HelpArticleOut {
  slug: string;
  category: HelpCategory;
  title: string;
  summary: string;
  steps?: string[];
  /** Markdown subset: ##, -, 1., **bold**, [text](/help/<slug>/ | https://...). */
  body: string;
  related: string[];
  keywords?: string[];
  /** `file` = "<slug>-<lang>.mp4". */
  video?: { file: string; durationSec: number };
  /** "<slug>-<lang>.jpg" */
  poster?: string;
}

export interface HelpContent {
  /** ISO date. */
  generated: string;
  categories: { id: HelpCategory; label: { en: string; es: string } }[];
  /** Slugs. */
  popular: string[];
  articles: { en: HelpArticleOut[]; es: HelpArticleOut[] };
}

export type HelpLocale = 'en' | 'es';

export type HelpOpenSource = 'profile' | 'login' | 'signup' | 'home_card' | 'contextual';
export type HelpArticleSource = 'hub' | 'search' | 'related' | 'contextual';
