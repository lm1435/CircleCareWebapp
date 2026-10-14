// "Open this address in Maps": a plain outbound link, no geocoding, no key, no
// embedded map. Google Maps everywhere except Apple devices, which get Apple
// Maps. Mirrors mobile (same URL forms, same rule for what counts as a place).

/** True on iPhone, iPad and Mac (incl. iPadOS 13+, which reports as a Mac). */
type NavLike = { userAgent?: string; platform?: string };

export function isAppleDevice(
  nav: NavLike | undefined = typeof navigator === 'undefined' ? undefined : navigator
): boolean {
  if (!nav) return false;
  const platform = nav.platform ?? '';
  const ua = nav.userAgent ?? '';
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform) || /iPhone|iPad|iPod|Macintosh/i.test(ua);
}

/** Trim each line, collapse inner whitespace, join the non-empty lines with ", " (as mobile does). */
export function singleLineAddress(value: string | null | undefined): string {
  return (value ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
}

// Whole words only: "Calle 5" is a street, "Call Dr. Lee" is not. Same as mobile.
const VIRTUAL_START =
  /^(?:https?:\/\/|(?:zoom|teams|meet|webex|skype|facetime|virtual|online|remote|call|dial|telehealth)\b)/i;
const VIRTUAL_DOMAIN = /\.(zoom|teams|webex|com|us|io)\b/i;

// ── "Does this text look like a street address?" ──────────────────────────────
// KEEP IDENTICAL to mobile/src/utils/openInMaps.ts (same regexes, same word lists, same order); the
// shared case table lives in both test files (mobile src/__tests__/utils/openInMaps.test.ts,
// webapp src/lib/__tests__/maps.test.ts). Owner rule: "Mom's house" maps to nothing, so it is
// shown as plain text; named places with no number ("Denver Health Medical Center") lose the
// link too, by decision.

const LETTERS = 'A-Za-z\u00C0-\u024F';
const HAS_LETTER = new RegExp(`[${LETTERS}]`);
const ALPHA_WORD = new RegExp(`^[${LETTERS}][${LETTERS}'\u2019.-]*$`);
// A house / building number: "123", "12B", "221B", "4-6", "10-20" (from "#10-20").
const HOUSE_NUMBER = /^\d{1,6}[a-z]?(?:-\d{1,6}[a-z]?)?$/i;
// A house-number token that is really a postal code (US 5-digit / ZIP+4, 4-5 digit EU,
// Brazil 00000-000, Portugal 0000-000).
const POSTAL_NUMBER = /^(?:\d{4,5}|\d{5}-\d{3,4}|\d{4}-\d{3})$/;
// A postal code anywhere: the shapes above plus Canada (A1A 1A1) and the UK (SW1A 1AA).
const POSTAL_CODE =
  /(?:^|[\s,])(?:\d{5}-\d{4}|\d{5}-\d{3}|\d{4}-\d{3}|\d{4,5}|[A-Z]\d[A-Z] ?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})(?=$|[\s,])/;
// A number right after one of these is a unit, floor or time, never a house number
// ("Room 3", "Suite 200", "Apt #4", "at 3").
const NOT_HOUSE_BEFORE = new Set([
  'room', 'rm', 'suite', 'ste', 'apt', 'apartment', 'unit', 'floor', 'fl', 'level', 'bldg',
  'building', 'wing', 'bed', 'door', 'gate', 'box', 'at', '@',
  'piso', 'sala', 'habitación', 'habitacion', 'consultorio', 'oficina', 'depto', 'departamento',
  'apto', 'las', 'salle', 'étage', 'etage', 'bureau', 'chambre', 'à', 'zimmer', 'raum', 'stock',
  'um', 'stanza', 'piano', 'ufficio', 'alle', 'quarto', 'andar', 'apartamento', 'às',
]);
// Street words, en es fr de it pt.
const STREET_WORDS = new Set([
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'dr', 'drive', 'ln', 'lane', 'way', 'ct',
  'court', 'pl', 'place', 'pkwy', 'hwy', 'highway', 'cir', 'ter', 'trail', 'sq',
  'calle', 'avenida', 'av', 'carrera', 'cra', 'paseo', 'camino', 'plaza',
  'rue', 'boulevard', 'bd', 'chemin', 'allée', 'route', 'impasse',
  'straße', 'strasse', 'str', 'weg', 'platz', 'gasse', 'allee', 'ring', 'damm',
  'via', 'viale', 'piazza', 'corso', 'largo', 'vicolo',
  'rua', 'travessa', 'praça', 'estrada', 'alameda',
]);
// "Dr. Smith" and "St. Mary's" are names: these two count only AFTER a house number.
const STREET_WORDS_AFTER_NUMBER = new Set(['dr', 'st']);
// German compounds: Hauptstraße, Hauptstr., Lindenweg, Marktplatz...
const STREET_SUFFIX = /[a-zäöüß]{2,}(?:straße|strasse|str|weg|platz|gasse|allee|damm)$/;
// Dates and times are not addresses: these words do not count as street-ish words.
const DATE_WORDS = new Set([
  'am', 'pm', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'setiembre', 'octubre', 'noviembre', 'diciembre', 'lunes', 'martes', 'miércoles', 'jueves',
  'viernes', 'sábado', 'domingo', 'de', 'del',
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
  'octobre', 'novembre', 'décembre', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi',
  'samedi', 'dimanche',
  'januar', 'februar', 'märz', 'juni', 'juli', 'oktober', 'dezember', 'montag', 'dienstag',
  'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
  'gennaio', 'febbraio', 'aprile', 'maggio', 'giugno', 'luglio', 'settembre', 'ottobre',
  'dicembre', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato',
  'janeiro', 'fevereiro', 'março', 'maio', 'junho', 'julho', 'setembro', 'outubro', 'novembro',
  'dezembro', 'segunda', 'terça', 'quarta', 'quinta', 'sexta',
]);

/** A token without the punctuation around it ("#10-20," -> "10-20", "St." -> "St"). */
function cleanToken(raw: string): string {
  return raw.replace(/^[#(\[{"'\u201C\u2018\u00AB]+/, '').replace(/[)\]}"'\u201D\u2019\u00BB.,:;!?]+$/, '');
}

/**
 * True when the text looks like a real street address: a house/building number AND street-ish
 * text (a street word in any app language, "500 Elm, Denver"-style number-first part plus a
 * comma-separated second part, or a postal code). Links, Zoom, Telehealth never qualify.
 * One rule for doctor/contact ADDRESS fields and appointment/task LOCATIONS.
 */
export function isStreetAddress(address: string | null | undefined): boolean {
  const text = singleLineAddress(address);
  if (!text || !HAS_LETTER.test(text)) return false;
  if (VIRTUAL_START.test(text) || VIRTUAL_DOMAIN.test(text)) return false;

  const tokens = text.split(/[\s,]+/).map(cleanToken).filter(Boolean);
  const lower = tokens.map((t) => t.toLowerCase().replace(/\./g, ''));
  const houseAt: number[] = [];
  tokens.forEach((t, i) => {
    if (HOUSE_NUMBER.test(t) && !(i > 0 && NOT_HOUSE_BEFORE.has(lower[i - 1]))) houseAt.push(i);
  });
  if (houseAt.length === 0) return false;
  const isWord = (i: number) => ALPHA_WORD.test(tokens[i]) && tokens[i].length >= 2 && !DATE_WORDS.has(lower[i]);

  // 1. A street word (or a German street compound).
  for (let i = 0; i < tokens.length; i++) {
    if (!ALPHA_WORD.test(tokens[i])) continue;
    const w = lower[i];
    if (STREET_WORDS.has(w)) {
      if (!STREET_WORDS_AFTER_NUMBER.has(w) || houseAt[0] < i) return true;
    } else if (STREET_SUFFIX.test(w)) {
      return true;
    }
  }

  const wordCount = tokens.filter((_t, i) => isWord(i)).length;

  // 2. "500 Elm, Denver": a part that starts with a house number then a word, a second part,
  //    and at least two words in all.
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && wordCount >= 2) {
    const numberFirst = parts.some((p) => {
      const pt = p.split(/\s+/).map(cleanToken).filter(Boolean);
      return (
        pt.length >= 2 &&
        HOUSE_NUMBER.test(pt[0]) &&
        ALPHA_WORD.test(pt[1]) &&
        pt[1].length >= 2 &&
        !DATE_WORDS.has(pt[1].toLowerCase().replace(/\./g, ''))
      );
    });
    if (numberFirst) return true;
  }

  // 3. A postal code alongside a separate house number and a word.
  if (POSTAL_CODE.test(text) && wordCount >= 1) {
    if (houseAt.some((i) => !POSTAL_NUMBER.test(tokens[i]))) return true;
  }
  return false;
}

/**
 * Whether to offer "Open in Maps" for a saved ADDRESS or an appointment/task LOCATION. Same rule
 * for both: it must look like a street address (see isStreetAddress). Anything else is still
 * shown, as plain text with no link role or maps hint.
 */
export function isMapsOpenable(address: string | null | undefined): boolean {
  return isStreetAddress(address);
}

/** Maps URL for a saved address / location, or null when it is empty. */
export function mapsUrl(
  value: string | null | undefined,
  apple: boolean = isAppleDevice()
): string | null {
  const line = singleLineAddress(value);
  if (!line) return null;
  const q = encodeURIComponent(line);
  return apple
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
