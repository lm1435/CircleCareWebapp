import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// PER-NAMESPACE resource files so parallel feature work never touches the same
// file. Namespaces other than `common` start empty — feature agents fill them.
import enCommon from './en/common.json';
import enAuth from './en/auth.json';
import enCalendar from './en/calendar.json';
import enMeds from './en/meds.json';
import enActivity from './en/activity.json';
import enEmergency from './en/emergency.json';
import enDocuments from './en/documents.json';
import enMembers from './en/members.json';
import enInvite from './en/invite.json';
import enFreemium from './en/freemium.json';

import esCommon from './es/common.json';
import esAuth from './es/auth.json';
import esCalendar from './es/calendar.json';
import esMeds from './es/meds.json';
import esActivity from './es/activity.json';
import esEmergency from './es/emergency.json';
import esDocuments from './es/documents.json';
import esMembers from './es/members.json';
import esInvite from './es/invite.json';
import esFreemium from './es/freemium.json';

export const supportedLanguages = {
  en: 'English',
  es: 'Español', // Latin American Spanish
} as const;

export type SupportedLanguage = keyof typeof supportedLanguages;

export const namespaces = [
  'common',
  'auth',
  'calendar',
  'meds',
  'activity',
  'emergency',
  'documents',
  'members',
  'invite',
  'freemium',
] as const;

export type Namespace = (typeof namespaces)[number];

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    calendar: enCalendar,
    meds: enMeds,
    activity: enActivity,
    emergency: enEmergency,
    documents: enDocuments,
    members: enMembers,
    invite: enInvite,
    freemium: enFreemium,
  },
  es: {
    common: esCommon,
    auth: esAuth,
    calendar: esCalendar,
    meds: esMeds,
    activity: esActivity,
    emergency: esEmergency,
    documents: esDocuments,
    members: esMembers,
    invite: esInvite,
    freemium: esFreemium,
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
