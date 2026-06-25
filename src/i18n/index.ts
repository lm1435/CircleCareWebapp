import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// PER-NAMESPACE resource files so parallel feature work never touches the same
// file. Namespaces other than `common` start empty — feature agents fill them.
import enCommon from './en/common.json';
import enAuth from './en/auth.json';
import enOverview from './en/overview.json';
import enCalendar from './en/calendar.json';
import enTasks from './en/tasks.json';
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

import esCommon from './es/common.json';
import esAuth from './es/auth.json';
import esOverview from './es/overview.json';
import esCalendar from './es/calendar.json';
import esTasks from './es/tasks.json';
import esMeds from './es/meds.json';
import esActivity from './es/activity.json';
import esEmergency from './es/emergency.json';
import esDocuments from './es/documents.json';
import esMembers from './es/members.json';
import esInvite from './es/invite.json';
import esVitals from './es/vitals.json';
import esProfile from './es/profile.json';
import esCircles from './es/circles.json';
import esAi from './es/ai.json';
import esHelp from './es/help.json';
import esFreemium from './es/freemium.json';
import esUpgrade from './es/upgrade.json';

export const supportedLanguages = {
  en: 'English',
  es: 'Español', // Latin American Spanish
} as const;

export type SupportedLanguage = keyof typeof supportedLanguages;

export const namespaces = [
  'common',
  'auth',
  'overview',
  'calendar',
  'tasks',
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

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    overview: enOverview,
    calendar: enCalendar,
    tasks: enTasks,
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
  },
  es: {
    common: esCommon,
    auth: esAuth,
    overview: esOverview,
    calendar: esCalendar,
    tasks: esTasks,
    meds: esMeds,
    activity: esActivity,
    emergency: esEmergency,
    documents: esDocuments,
    members: esMembers,
    invite: esInvite,
    vitals: esVitals,
    profile: esProfile,
    circles: esCircles,
    ai: esAi,
    help: esHelp,
    freemium: esFreemium,
    upgrade: esUpgrade,
  },
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: Object.keys(supportedLanguages),
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
