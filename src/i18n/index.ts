import i18n from 'i18next';
import type { BackendModule, ReadCallback } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// PER-NAMESPACE resource files so parallel feature work never touches the same
// file. Namespaces other than `common` start empty — feature agents fill them.
//
// EN ships eagerly (below) — every session needs it (it's `fallbackLng`), and
// it's the majority locale. ES is NOT statically imported here: that used to
// pull ~22 KB gzip of Spanish strings into every session's initial bundle,
// English-only visitors included. Instead `localeBackend.read()` (via the `localeLoaders` map) below dynamically
// imports `./es/index` (one combined chunk covering every es namespace) only
// when a session is actually detected as, or switches to, Spanish. react-i18next's
// `useSuspense: true` default means a component reading a namespace that isn't
// loaded yet suspends until that import resolves — see the <Suspense> boundary
// in `src/App.tsx`.
import enCommon from './en/common.json';
import enAuth from './en/auth.json';
import enOverview from './en/overview.json';
import enCalendar from './en/calendar.json';
import enTasks from './en/tasks.json';
import enNotes from './en/notes.json';
import enMeds from './en/meds.json';
import enActivity from './en/activity.json';
import enEmergency from './en/emergency.json';
import enDocuments from './en/documents.json';
import enMembers from './en/members.json';
import enInvite from './en/invite.json';
import enVitals from './en/vitals.json';
import enProfile from './en/profile.json';
import enCircles from './en/circles.json';
import enAi from './en/ai.json';
import enHelp from './en/help.json';
import enFreemium from './en/freemium.json';
import enUpgrade from './en/upgrade.json';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLanguage } from './locales';

// The shipped-language set lives in ./locales (the registry); this is its
// display-name view for the language picker.
export const supportedLanguages = LOCALE_LABELS;

export type { SupportedLanguage };

export const namespaces = [
  'common',
  'auth',
  'overview',
  'calendar',
  'tasks',
  'notes',
  'meds',
  'activity',
  'emergency',
  'documents',
  'members',
  'invite',
  'vitals',
  'profile',
  'circles',
  'ai',
  'help',
  'freemium',
  'upgrade',
] as const;

export type Namespace = (typeof namespaces)[number];

type NamespaceResources = Record<Namespace, object>;

const enResources: NamespaceResources = {
  common: enCommon,
  auth: enAuth,
  overview: enOverview,
  calendar: enCalendar,
  tasks: enTasks,
  notes: enNotes,
  meds: enMeds,
  activity: enActivity,
  emergency: enEmergency,
  documents: enDocuments,
  members: enMembers,
  invite: enInvite,
  vitals: enVitals,
  profile: enProfile,
  circles: enCircles,
  ai: enAi,
  help: enHelp,
  freemium: enFreemium,
  upgrade: enUpgrade,
};

/**
 * One lazy loader per NON-EN registry locale: each is its own combined chunk
 * (every namespace of that locale, one dynamic `import()`), fetched only when a
 * session is detected as, or switches to, that locale. Adding a locale =
 * a registry entry + one line here (the `localeSplit` test fails if a non-EN
 * registry locale has no loader, and if any non-EN locale is imported statically).
 */
type LocaleLoaders = Record<Exclude<SupportedLanguage, 'en'>, () => Promise<{ default: object }>>;
const localeLoaders: LocaleLoaders = {
  es: () => import('./es/index'),
  fr: () => import('./fr/index'),
  'fr-CA': () => import('./fr-CA/index'),
  de: () => import('./de/index'),
  it: () => import('./it/index'),
  pt: () => import('./pt/index'),
  'pt-PT': () => import('./pt-PT/index'),
};

/**
 * Loads a single namespace of a non-EN locale on demand via its loader (cached
 * by the module loader after the first call, so all 19 `read()` calls i18next
 * makes for a newly-needed locale only trigger one network fetch) and picks the
 * requested namespace out of it.
 *
 * This is an i18next `BackendModule` — the same extension point
 * `i18next-http-backend` uses — rather than a bespoke `changeLanguage`
 * wrapper, so both the initial-load path (browser detected as Spanish) and
 * the runtime switch path (`i18n.changeLanguage('es')` from ProfilePage /
 * useProfile) are handled by ordinary i18next resource-loading, with no extra
 * plumbing needed at either call site.
 */
const localeBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read: (language: string, namespace: string, callback: ReadCallback) => {
    const load = (localeLoaders as Record<string, (() => Promise<{ default: object }>) | undefined>)[
      language
    ];
    if (!load) {
      // We only ever ship en (bundled above) and the loader-map locales.
      // Anything else i18next asks for (e.g. a fallback probe) has nothing to load.
      callback(null, {});
      return;
    }
    load()
      .then((mod) => {
        const resources = mod.default as NamespaceResources;
        callback(null, resources[namespace as Namespace] ?? {});
      })
      .catch((err: unknown) => {
        callback(err instanceof Error ? err : String(err), null);
      });
  },
};

// The unit-test suite (~60 test files, outside this task's ownership) reads
// Spanish synchronously — `i18n.getFixedT('es', ns)` and bare, un-awaited
// `i18n.changeLanguage('es')` calls, exactly like this module worked before
// the locale split. jsdom test runs aren't a real browser session someone
// downloads a bundle for, so there's no size win in making them go through
// `localeBackend`'s dynamic import (and its `read()` is genuinely async — no
// amount of awaiting in a test file, itself out of scope here, changes that
// it resolves at least one microtask later than these tests need).
//
// `import.meta.env.MODE` is inlined by Vite at build time. In a real
// (non-test) build this condition is statically `false`, so esbuild/Rollup
// dead-code-eliminates this whole branch — `./es/index` (and thus every
// es/*.json namespace) never reaches a shipped bundle; only `vitest` (mode
// `test`) actually takes it.
const testOnlyLocaleResources: Record<string, NamespaceResources> = {};
if (import.meta.env.MODE === 'test') {
  for (const [code, load] of Object.entries(localeLoaders)) {
    testOnlyLocaleResources[code] = (await load()).default as NamespaceResources;
  }
}

void i18n
  .use(LanguageDetector)
  .use(localeBackend)
  .use(initReactI18next)
  .init({
    resources: { en: enResources, ...testOnlyLocaleResources },
    // English (and, in tests only, Spanish — see above) is fully bundled;
    // everything else is loaded exclusively through `localeBackend`. Without this
    // flag, passing ANY `resources` makes i18next assume every language is
    // bundled and skip the backend entirely.
    partialBundledLanguages: true,
    fallbackLng: 'en',
    // Every registry code, variant tags (fr-CA...) included.
    supportedLngs: [...SUPPORTED_LOCALES],
    nonExplicitSupportedLngs: true, // es-MX / es-419 → es
    ns: [...namespaces],
    defaultNS: 'common',
    detection: {
      // Browser language default. No storage caching — nothing about the user
      // is persisted by i18n (web threat model: keep JS-readable storage empty).
      order: ['navigator'],
      caches: [],
    },
    interpolation: {
      escapeValue: false, // React already escapes values
    },
  });

export default i18n;

// Re-export useTranslation for convenience (mirrors mobile/src/i18n/index.ts)
export { useTranslation } from 'react-i18next';
