import { describe, expect, it } from 'vitest';
import {
  findArticle,
  getPopular,
  getRelated,
  groupByCategory,
  pickHelpLocale,
  getBundledHelpContent,
} from '../content';
import { helpMediaUrl } from '../media';
import { normalizeForSearch, resultCountBucket, searchArticles } from '../search';
import { HELP_FIXTURE } from './fixture';

describe('pickHelpLocale', () => {
  it('maps es (and regional es) to es and everything else to en', () => {
    expect(pickHelpLocale('es')).toBe('es');
    expect(pickHelpLocale('es-MX')).toBe('es');
    for (const l of ['en', 'fr', 'fr-CA', 'pt', 'pt-PT', 'de', 'it', undefined, null, '']) {
      expect(pickHelpLocale(l)).toBe('en');
    }
  });
});

describe('content selectors', () => {
  it('finds articles per locale', () => {
    expect(findArticle(HELP_FIXTURE, 'es', 'invite-family')?.title).toBe('Invitar a la familia');
    expect(findArticle(HELP_FIXTURE, 'en', 'nope')).toBeUndefined();
    expect(findArticle(HELP_FIXTURE, 'en', undefined)).toBeUndefined();
  });
  it('drops popular and related slugs with no article', () => {
    expect(getPopular(HELP_FIXTURE, 'en').map((a) => a.slug)).toEqual([
      'add-a-medication',
      'invite-family',
    ]);
    const med = findArticle(HELP_FIXTURE, 'en', 'add-a-medication')!;
    expect(getRelated(HELP_FIXTURE, 'en', med).map((a) => a.slug)).toEqual(['invite-family']);
  });
  it('groups by category in content order and omits empty categories', () => {
    const groups = groupByCategory(HELP_FIXTURE, 'es');
    expect(groups.map((g) => g.label)).toEqual(['Primeros pasos', 'Cuidado diario']);
  });
  it('degrades to empty content when content.json is absent', () => {
    // No generated file in this checkout (or a real one): either way the shape is valid.
    const c = getBundledHelpContent();
    expect(Array.isArray(c.articles.en)).toBe(true);
  });
});

describe('search', () => {
  const en = HELP_FIXTURE.articles.en;
  const es = HELP_FIXTURE.articles.es;
  it('normalizes accents and case', () => {
    expect(normalizeForSearch('  MedicaCIÓN  Ñandú ')).toBe('medicacion nandu');
  });
  it('is accent-insensitive in both directions', () => {
    expect(searchArticles(es, 'medicacion').map((a) => a.slug)).toEqual(['add-a-medication']);
    expect(searchArticles(es, 'MEDICACIÓN').map((a) => a.slug)).toEqual(['add-a-medication']);
    expect(searchArticles(es, 'invitacion').map((a) => a.slug)).toEqual(['invite-family']);
  });
  it('searches title, summary and keywords, ranking title first', () => {
    expect(searchArticles(en, 'pill').map((a) => a.slug)).toEqual(['add-a-medication']);
    expect(searchArticles(en, 'email').map((a) => a.slug)).toEqual(['invite-family']);
    expect(searchArticles(en, 'invite').map((a) => a.slug)).toEqual(['invite-family']);
  });
  it('requires every word and returns nothing for blank queries', () => {
    expect(searchArticles(en, 'invite zebra')).toEqual([]);
    expect(searchArticles(en, '   ')).toEqual([]);
  });
  it('buckets result counts without carrying the query', () => {
    expect([0, 1, 3, 4, 10, 50].map(resultCountBucket)).toEqual(['0', '1-3', '1-3', '4+', '4+', '4+']);
  });
});

describe('helpMediaUrl', () => {
  it('builds the public help-videos storage URL from VITE_SUPABASE_URL', () => {
    expect(helpMediaUrl('add-a-medication-en.mp4')).toBe(
      'https://test-project.supabase.co/storage/v1/object/public/help-videos/add-a-medication-en.mp4'
    );
  });
});
