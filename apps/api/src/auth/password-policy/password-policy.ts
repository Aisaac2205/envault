import { isCommonPassword } from './common-password';
import {
  countDistinctCharacters,
  findRepeatedBlockLength,
  hasKeyboardWalk,
  hasSequentialRun,
  isSingleRepeatedCharacter,
} from './password-patterns';

/**
 * Password strength policy in the spirit of NIST SP 800-63B: length first,
 * a refusal of what attackers try first, and no composition rules (no forced
 * upper case, digit or symbol). It applies to passwords being SET, never to
 * one being checked against an existing hash.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/** The stable machine code of every rejection; clients branch on it, not on the message. */
export const PASSWORD_POLICY_ERROR_CODE = 'PASSWORD_TOO_WEAK';

const MIN_DISTINCT_CHARACTERS = 5;
// Shorter fragments are too likely to sit inside an ordinary name or word.
const MIN_ACCOUNT_DATA_LENGTH = 4;

export type PasswordPolicyRule =
  | 'too_short'
  | 'too_long'
  | 'repeated_character'
  | 'repeated_block'
  | 'sequential_run'
  | 'keyboard_walk'
  | 'few_distinct_characters'
  | 'common_password'
  | 'contains_email'
  | 'contains_name';

/** What is known about the account the password is for, when the request carries it. */
export interface PasswordPolicyContext {
  email?: string | null;
  name?: string | null;
}

export type PasswordPolicyResult =
  | { valid: true }
  | { valid: false; rule: PasswordPolicyRule; message: string };

// The messages name the rule and never echo the password: they reach the
// client, and the admin seed writes them to the log. They also stay clear of
// the words "already" and "unique", which the seed reads as "the admin exists".
const MESSAGES: Readonly<Record<PasswordPolicyRule, string>> = {
  too_short: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
  too_long: `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`,
  repeated_character: 'Password cannot be a single character repeated.',
  repeated_block: 'Password cannot be a short block of characters repeated over and over.',
  sequential_run: 'Password cannot be a simple sequence of consecutive characters, like 12345 or abcde.',
  keyboard_walk: 'Password cannot be a keyboard pattern, like qwerty or asdfgh.',
  few_distinct_characters: `Password must use at least ${MIN_DISTINCT_CHARACTERS} different characters.`,
  common_password:
    'Password is too common or too easy to guess. Use a longer passphrase made of words that do not belong together.',
  contains_email: 'Password cannot contain the part of the email address before the @.',
  contains_name: "Password cannot contain the user's name.",
};

function reject(rule: PasswordPolicyRule): PasswordPolicyResult {
  return { valid: false, rule, message: MESSAGES[rule] };
}

/** Letters and digits only, folded: what is left to compare once punctuation and case are gone. */
function toComparable(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function emailLocalPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

function containsAccountData(comparablePassword: string, data: string | null | undefined): boolean {
  if (!data) return false;
  const comparable = toComparable(data);
  return Array.from(comparable).length >= MIN_ACCOUNT_DATA_LENGTH && comparablePassword.includes(comparable);
}

/**
 * Checks a password that is about to be set. Returns the FIRST rule it breaks,
 * in the order below, so that the message points at the most specific reason.
 * Length is counted in characters (code points), not UTF-16 units.
 */
export function validatePassword(
  password: string,
  context: PasswordPolicyContext = {},
): PasswordPolicyResult {
  // A UTF-16 length over twice the maximum is too long whatever it holds, and
  // it spares counting code points of an arbitrarily large input.
  if (password.length > PASSWORD_MAX_LENGTH * 2) return reject('too_long');

  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) return reject('too_short');
  if (length > PASSWORD_MAX_LENGTH) return reject('too_long');

  // Compatibility forms and case fold away before looking for patterns, so
  // full-width or upper-case spellings of a weak password do not slip through.
  const folded = password.normalize('NFKC').toLowerCase();

  if (isSingleRepeatedCharacter(folded)) return reject('repeated_character');
  if (findRepeatedBlockLength(folded) !== null) return reject('repeated_block');
  if (hasSequentialRun(folded)) return reject('sequential_run');
  if (hasKeyboardWalk(folded)) return reject('keyboard_walk');
  if (countDistinctCharacters(folded) < MIN_DISTINCT_CHARACTERS) return reject('few_distinct_characters');
  if (isCommonPassword(password)) return reject('common_password');

  const comparable = toComparable(password);
  if (context.email && containsAccountData(comparable, emailLocalPart(context.email))) {
    return reject('contains_email');
  }
  if (containsAccountData(comparable, context.name)) return reject('contains_name');

  return { valid: true };
}
