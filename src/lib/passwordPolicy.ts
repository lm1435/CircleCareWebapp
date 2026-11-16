/**
 * The password character classes, Unicode-aware (1.4.2 i18n audit E). They used
 * to be ASCII ranges, so "Ä" / "É" counted as a SPECIAL character and never as an
 * uppercase letter: a German or French password "Äpfelbaum1" was told it had no
 * uppercase letter. For an all-ASCII password these match exactly what
 * [A-Z] / [a-z] / [0-9] / [^A-Za-z0-9] matched. Special = not a letter (with its
 * combining marks) and not a digit. Same classes on mobile
 * (screens/auth/authValidation.ts) and the backend (routes/auth.ts).
 */
export const PASSWORD_UPPERCASE = /\p{Lu}/u;
export const PASSWORD_LOWERCASE = /\p{Ll}/u;
export const PASSWORD_NUMBER = /[0-9]/;
export const PASSWORD_SPECIAL = /[^\p{L}\p{M}\p{N}]/u;
