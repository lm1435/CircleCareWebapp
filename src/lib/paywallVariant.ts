/**
 * FIRST-RUN PAYWALL VARIANTS (owner-approved 2026-11-26). PORT of
 * `mobile/src/utils/paywallVariant.ts`: keep the two tables identical.
 *
 * The onboarding paywall's headline and the order of its eight reasons follow the first thing the
 * person added during first-run setup. Price, plans, buttons, footer and the set of eight benefits
 * are the same for everyone. ONE table, imported by the page, the analytics and the tests. Ids and
 * i18n keys only (no text). Applies ONLY to the `onboarding` paywall context.
 */

export const PAYWALL_VARIANTS = ['default', 'medication', 'invite', 'appointment'] as const;
export type PaywallVariant = (typeof PAYWALL_VARIANTS)[number];

export type PremiumFeatureId =
  | 'caregivers'
  | 'shifts'
  | 'circles'
  | 'voice'
  | 'team'
  | 'exports'
  | 'storage'
  | 'ai';

export interface PaywallVariantOrder {
  /** The headline key in the `upgrade` namespace. */
  headlineKey: 'headlineOnboarding' | 'headlineOnboardingMedication' | 'headlineOnboardingInvite' | 'headlineOnboardingAppointment';
  /** The three always-visible reasons, in order. */
  top: readonly PremiumFeatureId[];
  /** The five behind "See everything included", in order. */
  details: readonly PremiumFeatureId[];
}

export const PAYWALL_VARIANT_TABLE: Record<PaywallVariant, PaywallVariantOrder> = {
  default: {
    headlineKey: 'headlineOnboarding',
    top: ['caregivers', 'shifts', 'circles'],
    details: ['voice', 'team', 'exports', 'storage', 'ai'],
  },
  medication: {
    headlineKey: 'headlineOnboardingMedication',
    top: ['caregivers', 'exports', 'shifts'],
    details: ['circles', 'voice', 'team', 'storage', 'ai'],
  },
  invite: {
    headlineKey: 'headlineOnboardingInvite',
    top: ['caregivers', 'team', 'shifts'],
    details: ['circles', 'voice', 'exports', 'storage', 'ai'],
  },
  appointment: {
    headlineKey: 'headlineOnboardingAppointment',
    top: ['shifts', 'caregivers', 'exports'],
    details: ['circles', 'voice', 'team', 'storage', 'ai'],
  },
};

/** Anything outside the enum (garbage, null, 'emergency', 'skip') is the default variant. */
export function toPaywallVariant(value: unknown): PaywallVariant {
  return typeof value === 'string' && (PAYWALL_VARIANTS as readonly string[]).includes(value)
    ? (value as PaywallVariant)
    : 'default';
}
