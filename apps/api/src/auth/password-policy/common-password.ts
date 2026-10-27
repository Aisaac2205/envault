import { COMMON_PASSWORD_BASES } from './common-password-bases';

// What each letter is commonly typed as. "1" and "!" stand for either "i" or
// "l", and the matcher tries both, so no single reading has to be guessed.
const LEET_SUBSTITUTES: Readonly<Record<string, string>> = {
  a: '@4',
  b: '8',
  c: '(',
  e: '3',
  g: '69',
  h: '#',
  i: '1!|',
  l: '1!|',
  o: '0',
  s: '$5',
  t: '7+',
  z: '2',
};

const LETTER = /\p{L}/u;

const BASES: readonly (readonly string[])[] = COMMON_PASSWORD_BASES.map((base) => Array.from(base));

/**
 * The form both the list and the candidate are compared in: lower case,
 * accents and compatibility forms folded (`Contraseña` -> `contrasena`,
 * full-width -> ASCII), and the separators people put between words dropped,
 * so `Let Me-In` meets `letmein`.
 */
export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s._-]+/gu, '');
}

function sameCharacter(typed: string, expected: string): boolean {
  return typed === expected || (LEET_SUBSTITUTES[expected]?.includes(typed) ?? false);
}

/**
 * Whether `chars` is `base`, optionally spelled in leetspeak, with nothing but
 * digits and symbols before and after it. `firstLetter` and `lastLetter` are
 * the positions of the first and last letter of `chars` (`chars.length` and
 * -1 when there is none): the base must start no later than the first and end
 * no earlier than the last.
 */
function isBaseWithDecoration(
  chars: readonly string[],
  firstLetter: number,
  lastLetter: number,
  base: readonly string[],
): boolean {
  const lastStart = Math.min(firstLetter, chars.length - base.length);
  for (let start = 0; start <= lastStart; start++) {
    if (start + base.length <= lastLetter) continue;
    if (base.every((expected, i) => sameCharacter(chars[start + i], expected))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the password is a common word with the decoration people add to it:
 * case, simple leetspeak, separators, and digits or symbols around it. The
 * whole password has to be that word: a common word inside a passphrase of
 * other words is not what this rejects.
 */
export function isCommonPassword(password: string): boolean {
  const chars = Array.from(normalizeForMatching(password));
  let firstLetter = chars.length;
  let lastLetter = -1;
  chars.forEach((char, i) => {
    if (!LETTER.test(char)) return;
    firstLetter = Math.min(firstLetter, i);
    lastLetter = i;
  });

  return BASES.some((base) => isBaseWithDecoration(chars, firstLetter, lastLetter, base));
}
