/**
 * Detectors for the patterns that make a long password weak anyway. They are
 * pure and take the text to inspect; callers decide how to fold case or
 * Unicode form first (`validatePassword` passes NFKC, lower-cased text). Only
 * `hasSequentialRun` and `hasKeyboardWalk` fold case themselves, because the
 * alphabets they compare against are lower case.
 */

// A run must be at least this long, and cover at least half of the password:
// "abcdefgh" inside a long passphrase is noise, "abcdefghijkl" is the password.
const MIN_RUN_LENGTH = 8;

// The digits are doubled so that a run can wrap through 0 ("123456789012").
const SEQUENCE_ALPHABETS: readonly string[] = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890123456789',
];

// Keyboard layouts people walk along. QWERTY only: it is what the interface's
// users type on, and a walk on another layout is not a pattern the others know.
const KEYBOARD_ALPHABETS: readonly string[] = [
  // The three letter rows, one after the other.
  'qwertyuiopasdfghjklzxcvbnm',
  // The columns, top to bottom.
  'qazwsxedcrfvtgbyhnujmikolp',
  // Digit row interleaved with the top row.
  '1q2w3e4r5t6y7u8i9o0p',
  'q1w2e3r4t5y6u7i8o9p0',
  // Digit and column interleaved ("1qaz2wsx").
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p',
  'zaq1xsw2cde3vfr4bgt5nhy6mju7',
  // Number pad rows and columns.
  '789456123',
  '147258369',
];

function reversed(text: string): string {
  return Array.from(text).reverse().join('');
}

function withReversed(alphabets: readonly string[]): readonly string[] {
  return [...alphabets, ...alphabets.map(reversed)];
}

const SEQUENCES = withReversed(SEQUENCE_ALPHABETS);
const KEYBOARD_WALKS = withReversed(KEYBOARD_ALPHABETS);

/** Length of the longest stretch of `chars` that is a contiguous slice of one alphabet. */
function longestRun(chars: readonly string[], alphabets: readonly string[]): number {
  let longest = 0;
  for (const alphabet of alphabets) {
    for (let start = 0; start < chars.length; start++) {
      for (let at = alphabet.indexOf(chars[start]); at !== -1; at = alphabet.indexOf(chars[start], at + 1)) {
        let length = 0;
        while (
          start + length < chars.length &&
          at + length < alphabet.length &&
          chars[start + length] === alphabet[at + length]
        ) {
          length++;
        }
        longest = Math.max(longest, length);
      }
    }
  }
  return longest;
}

function hasRunIn(text: string, alphabets: readonly string[]): boolean {
  const chars = Array.from(text.toLowerCase());
  const run = longestRun(chars, alphabets);
  return run >= MIN_RUN_LENGTH && run * 2 >= chars.length;
}

/** The same character, at least twice, and nothing else. */
export function isSingleRepeatedCharacter(text: string): boolean {
  const chars = Array.from(text);
  return chars.length >= 2 && chars.every((char) => char === chars[0]);
}

/**
 * The length of the shortest block that, repeated, makes up the whole text
 * (the last repetition may be cut short), or `null` when there is none.
 * A block counts only when it appears at least twice, so it is at most half
 * of the text. A single repeated character is a block of length 1.
 */
export function findRepeatedBlockLength(text: string): number | null {
  const chars = Array.from(text);
  for (let block = 1; block <= chars.length / 2; block++) {
    let repeats = true;
    for (let i = block; i < chars.length; i++) {
      if (chars[i] !== chars[i - block]) {
        repeats = false;
        break;
      }
    }
    if (repeats) return block;
  }
  return null;
}

/** How many different characters (code points) the text uses. */
export function countDistinctCharacters(text: string): number {
  return new Set(Array.from(text)).size;
}

/** Mostly an ascending or descending run of letters or digits: `abcdefghijkl`, `987654321098`. */
export function hasSequentialRun(text: string): boolean {
  return hasRunIn(text, SEQUENCES);
}

/** Mostly a walk along the keyboard: `qwertyuiopas`, `1qaz2wsx3edc`. */
export function hasKeyboardWalk(text: string): boolean {
  return hasRunIn(text, KEYBOARD_WALKS);
}
