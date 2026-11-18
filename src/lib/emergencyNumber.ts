import { browserLanguageTag, regionFromLocale } from './regionResolver';

/**
 * The SOS card's number (1.4.3, mobile parity: mobile/src/utils/locale.ts EMERGENCY_NUMBERS /
 * getEmergencyNumber). The table below is mobile's, verbatim; a parity test reads mobile's file
 * and fails on any drift (src/lib/__tests__/emergencyNumber.test.ts).
 *
 * Number that reaches an AMBULANCE, by region code (ISO 3166-1 alpha-2).
 *
 * Only countries whose number was checked against an official / government
 * source are listed (docs/plans/emergency-number-by-country.md). An unlisted
 * region returns null and the SOS card is not rendered at all: never guess
 * (112 is NOT a safe fallback outside Europe). Where 911 is police-only the AMBULANCE number is used.
 */
const EMERGENCY_NUMBERS: Record<string, string> = {
  // North America. US: 911.gov / fcc.gov. CA: crtc.gc.ca/eng/phone/911/can.htm.
  // MX: Numero Unico de Emergencias 9-1-1, routes to ambulance
  // (gob.mx/911/articulos/numero-unico-de-emergencias-9-1-1). PR: Negociado
  // de Sistemas de Emergencias 9-1-1 (911.pr.gov, pr.gov/directorio-de-agencias).
  US: '911', PR: '911', CA: '911', MX: '911',
  // Argentina: 911 is the national number (argentina.gob.ar/tema/emergencias);
  // 107 (SAME) is medical-only and not reachable everywhere.
  AR: '911',
  // Colombia: Linea unica de emergencias Nacional 123, activates ambulance
  // (www1.funcionpublica.gov.co, preguntas-frecuentes, linea 123).
  CO: '123',
  // Chile: SAMU ambulance 131 (minsal.cl/samu-instala-base-en-alto-hospicio-y-
  // llama-a-utilizar-responsablemente-el-131).
  CL: '131',
  // Peru: SAMU 106 (gob.pe/institucion/minsa, "llamar a la linea 106 del
  // SAMU"; 911 is a Lima/Callao pilot only, gob.pe/547-telefonos-de-emergencia).
  PE: '106',
  // Ecuador: ECU 911 is the single number, 101/102/131 disabled
  // (ecu911.gob.ec).
  EC: '911',
  // Panama: SUME 911 medical dispatch (sume911.pa, mingob.gob.pa).
  PA: '911',
  // Dominican Republic: Sistema 9-1-1 integrates police, health, fire
  // (minpre.gob.do / 911.gob.do).
  DO: '911',
  // Costa Rica: Sistema de Emergencias 9-1-1 is the single access point, Cruz
  // Roja part of the system (pgrweb.go.cr, Procuraduria, dictamen on Sistema
  // de Emergencias 911). Government source is legal text, not a citizen page.
  CR: '911',
  // Uruguay: 911 centralises police and fire; the ambulance line is SAME 105
  // (gub.uy/ministerio-salud-publica, minterior.gub.uy/servicios-e-info).
  UY: '105',
  // El Salvador: 911 is the PNC (police); medical emergencies are Sistema de
  // Emergencias Medicas 132 (salud.gob.sv, seguridad.gob.sv).
  SV: '132',
  // United Kingdom: 999 for an ambulance (nhs.uk/nhs-services/urgent-and-
  // emergency-care-services/when-to-call-999). 112 also works.
  GB: '999',
  // Switzerland: 144 ambulance (ch.ch/en/safety-and-justice/emergencies-and-
  // danger). 112 also routed.
  CH: '144',
  // Oceania: Australia 000 (triplezero.gov.au), New Zealand 111
  // (healthnz.govt.nz emergency medical help, police.govt.nz/call-111).
  AU: '000', NZ: '111',
  // EU / EEA: 112 is guaranteed free in every member state
  // (europa.eu/youreurope/citizens/travel/security-and-emergencies/emergency).
  AT: '112', BE: '112', BG: '112', HR: '112', CY: '112', CZ: '112',
  DK: '112', EE: '112', FI: '112', FR: '112', DE: '112', GR: '112',
  HU: '112', IE: '112', IT: '112', LV: '112', LT: '112', LU: '112',
  MT: '112', NL: '112', PL: '112', PT: '112', RO: '112', SK: '112',
  SI: '112', ES: '112', SE: '112', IS: '112', LI: '112', NO: '112',
};

/** Ambulance-reaching number for a region code, or null when not verified. */
export function emergencyNumberForRegion(region: string | null | undefined): string | null {
  if (!region) return null;
  const key = region.toUpperCase();
  return Object.prototype.hasOwnProperty.call(EMERGENCY_NUMBERS, key)
    ? EMERGENCY_NUMBERS[key]
    : null;
}

/** Exposed for tests: every verified region code. */
export const EMERGENCY_REGION_CODES: readonly string[] = Object.keys(EMERGENCY_NUMBERS);

/**
 * Local emergency number for this browser, or null. Mobile keys it off the RAW OS Region setting
 * (no tag / zone / language inference: never guess an emergency number). A browser exposes no OS
 * region, so the web reads the one EXPLICIT region it has: the region subtag of the first
 * preferred language ("en-GB" -> 999, "es-MX" -> 911). A bare "en", "es-419" or an unlisted
 * region returns null and the SOS card is not rendered, exactly as on mobile.
 */
export function getEmergencyNumber(): string | null {
  return emergencyNumberForRegion(regionFromLocale(browserLanguageTag()));
}
