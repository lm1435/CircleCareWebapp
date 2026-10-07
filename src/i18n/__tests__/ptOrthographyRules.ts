/** Shared Portuguese orthography rules for ptOrthography / ptPTOrthography (pt lane). */

/** Patterns no Portuguese string (either variant) may contain. */
export const PT_FORBIDDEN: Array<[label: string, pattern: RegExp]> = [
  // Care-first register: never the clinical "paciente" for a loved one.
  ['clinical "paciente" for the person cared for', /\bpacientes?\b/i],
  // Spanish calques / leftovers.
  ['Spanish leftover ("receptor de cuidado", usted, ñ, ¿ ¡)', /receptora? de cuidado|\busted(es)?\b|ñ|[¿¡]/i],
  // AO90 (both variants): no trema, no mute c/p.
  ['pre-2009 spelling (ü, acção, actividade, óptimo, direcção)', /ü|(^|[^\p{L}])(ac[cç][aã]o|ac[cç][oõ]es|activ\p{L}*|[óo]ptim\p{L}*|direc[cç][aã]o|colec[cç][aã]o|protec[cç][aã]o)/iu],
  // Dose vocabulary: an unanswered dose is never lost/forgotten.
  ['dose called lost/forgotten', /\bdoses?\s+(perdidas?|esquecidas?)\b/i],
  ['cedilla before e/i', /ç[eiéí]/i],
];

/** Words Portuguese only ever writes WITH a diacritic (bare = stripped accents). */
export const PT_DIACRITICS: Array<[bare: RegExp, label: string]> = [
  [/(^|[^\p{L}])(nao|voce|voces)(?=[^\p{L}]|$)/iu, 'não / você'],
  [/(^|[^\p{L}])(acao|acoes|informacao|informacoes|medicacao|notificacao|notificacoes|configuracao|configuracoes|atencao|opcao|opcoes)(?=[^\p{L}]|$)/iu, '-ção / -ções'],
  [/(^|[^\p{L}])(tambem|ja|ate|apos|proximo|proxima|historico|saude|possivel|disponivel|familia|horario|calendario|usuario|codigo)(?=[^\p{L}]|$)/iu, 'accented word written bare'],
];
