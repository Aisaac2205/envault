import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_ERROR_CODE,
  validatePassword,
  type PasswordPolicyContext,
  type PasswordPolicyRule,
} from './password-policy';

// A deterministic mix of letters, digits and symbols: no pattern, no common
// word, and the same output on every run.
function strongPassword(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789#$%&*+=?@';
  let state = 20260101;
  let password = '';
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    password += alphabet[(state >>> 16) % alphabet.length];
  }
  return password;
}

function messageOf(
  password: string,
  context: Parameters<typeof validatePassword>[1] = {},
): string {
  const result = validatePassword(password, context);
  if (result.valid) throw new Error(`expected ${JSON.stringify(password)} to be rejected`);
  return result.message;
}

function expectRejected(
  password: string,
  rule: PasswordPolicyRule,
  context: Parameters<typeof validatePassword>[1] = {},
): void {
  const result = validatePassword(password, context);
  expect(result).toEqual({ valid: false, rule, message: expect.any(String) });
}

describe('validatePassword', () => {
  it('exposes the limits and the stable error code', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(PASSWORD_POLICY_ERROR_CODE).toBe('PASSWORD_TOO_WEAK');
  });

  describe('acceptance examples', () => {
    it.each<[string, PasswordPolicyRule]>([
      ['12345678', 'too_short'],
      ['123456789012', 'sequential_run'],
      ['password1234', 'common_password'],
      ['Welcome12345!', 'common_password'],
      ['aaaaaaaaaaaa', 'repeated_character'],
      ['abcabcabcabc', 'repeated_block'],
    ])('rejects %j with the rule %s', (password, rule) => {
      expectRejected(password, rule);
    });

    it('rejects a password that contains the email local part', () => {
      expectRejected('xk-isaac.flores-2749', 'contains_email', {
        email: 'isaac.flores@example.com',
      });
    });

    it('accepts a passphrase', () => {
      expect(validatePassword('correct horse battery staple')).toEqual({ valid: true });
    });
  });

  describe('length', () => {
    it('rejects 11 characters', () => {
      expect(strongPassword(11)).toHaveLength(11);
      expectRejected(strongPassword(11), 'too_short');
    });

    it('accepts exactly 12 characters', () => {
      expect(validatePassword(strongPassword(12))).toEqual({ valid: true });
    });

    it('accepts exactly 128 characters', () => {
      expect(strongPassword(128)).toHaveLength(128);
      expect(validatePassword(strongPassword(128))).toEqual({ valid: true });
    });

    it('rejects 129 characters', () => {
      expect(strongPassword(129)).toHaveLength(129);
      expectRejected(strongPassword(129), 'too_long');
    });

    it('rejects an empty password', () => {
      expectRejected('', 'too_short');
    });

    it('counts a character outside the BMP once, not as two UTF-16 units', () => {
      // 6 emoji are 12 UTF-16 units but only 6 characters.
      expectRejected('🔐🔑🌲🌊🔥🌙', 'too_short');
      expect(validatePassword('🔐🔑🌲🌊🔥🌙⭐🍀🎲🧩🚀🛸')).toEqual({ valid: true });
    });
  });

  describe('each pattern rule in isolation', () => {
    it.each<[string, PasswordPolicyRule]>([
      ['aaaaaaaaaaaaaaaaaaaaaaaa', 'repeated_character'],
      ['            ', 'repeated_character'],
      ['ＡＡＡＡＡＡＡＡＡＡＡＡ', 'repeated_character'],
      ['abcabcabcabc', 'repeated_block'],
      ['Xk9#Xk9#Xk9#Xk9#', 'repeated_block'],
      ['passwordpassword', 'repeated_block'],
      ['abcdefghijkl', 'sequential_run'],
      ['987654321098', 'sequential_run'],
      ['zyxwvutsrqpo', 'sequential_run'],
      ['qwertyuiopas', 'keyboard_walk'],
      ['1qaz2wsx3edc', 'keyboard_walk'],
      ['abcdabcdbadc', 'few_distinct_characters'],
      ['xyxyzyzxyzzy', 'few_distinct_characters'],
    ])('rejects %j with the rule %s', (password, rule) => {
      expectRejected(password, rule);
    });
  });

  describe('common passwords', () => {
    it.each([
      'password1234',
      'Welcome12345!',
      'qwerty123456',
      'PASSWORD1234',
      'Passw0rd!2024',
      'P@ssw0rd123!',
      'L3tM3!n123456',
      '1loveyou123456',
      'Contraseña123456',
      'ｐａｓｓｗｏｒｄ１２３４',
      'let me in 123456',
      'Envault2024!!!!',
    ])('rejects %j', (password) => {
      expectRejected(password, 'common_password');
    });

    it('does not reject a common word inside a longer passphrase', () => {
      expect(validatePassword('my password is a horse named welcome')).toEqual({ valid: true });
    });
  });

  describe('account data', () => {
    it('rejects the email local part inside the password, in any case', () => {
      const context = { email: 'Maria.Lopez@example.com' };
      expectRejected('maria.lopez-correct-horse', 'contains_email', context);
      expectRejected('MARIALOPEZ-correct-horse', 'contains_email', context);
      expectRejected('correct-horse-maria_lopez', 'contains_email', context);
    });

    it('does not look at the email domain', () => {
      expect(
        validatePassword('purple-example-giraffe-dances', { email: 'zed.vega@example.com' }),
      ).toEqual({ valid: true });
    });

    it('ignores an email local part shorter than 4 characters', () => {
      expect(validatePassword('jo-correct-horse-battery', { email: 'jo@example.com' })).toEqual({
        valid: true,
      });
      expect(validatePassword('abc-correct-horse-battery', { email: 'abc@example.com' })).toEqual({
        valid: true,
      });
    });

    it('applies the 4 character threshold at exactly 4', () => {
      expectRejected('jane-correct-horse-battery', 'contains_email', { email: 'jane@example.com' });
    });

    it('rejects the display name inside the password', () => {
      expectRejected('maria garcia 2025 sunrise', 'contains_name', { name: 'Maria Garcia' });
      expectRejected('MariaGarcia-sunrise-2025', 'contains_name', { name: 'Maria Garcia' });
    });

    it('ignores a display name shorter than 4 characters', () => {
      expect(validatePassword('ana-correct-horse-battery', { name: 'Ana' })).toEqual({ valid: true });
    });

    it('does nothing with data that is absent, empty or only punctuation', () => {
      const password = 'correct horse battery staple';
      expect(validatePassword(password, {})).toEqual({ valid: true });
      expect(validatePassword(password, { email: null, name: null })).toEqual({ valid: true });
      expect(validatePassword(password, { email: '', name: '' })).toEqual({ valid: true });
      expect(validatePassword(password, { email: '@example.com', name: '----' })).toEqual({
        valid: true,
      });
    });

    it('uses the whole address as the local part when there is no @', () => {
      expectRejected('xk-johnsmith-2749-zq', 'contains_email', { email: 'johnsmith' });
    });
  });

  describe('passwords that must be accepted', () => {
    it.each([
      'correct horse battery staple',
      'the quick brown fox jumps over the lazy dog',
      'winter is coming but the wall holds firm',
      'purple monkey dishwasher',
      'Tr0ub4dor&3-and-a-longer-tail',
      'xK9#mP2$vL7@nQ4!',
      'Pw-0f3a9c1b-e2e',
      'ünïcödé-pässphräse-lång',
      '自分の秘密のパスワードです',
      'añejo de cinco años 2024',
    ])('accepts %j', (password) => {
      expect(validatePassword(password)).toEqual({ valid: true });
    });
  });

  describe('messages', () => {
    const accountContext = { email: 'isaac@example.io', name: 'Isaac Mora' };
    const rejected: Array<[PasswordPolicyRule, string, PasswordPolicyContext | undefined]> = [
      ['too_short', '12345678', undefined],
      ['too_long', strongPassword(129), undefined],
      ['repeated_character', 'aaaaaaaaaaaa', undefined],
      ['repeated_block', 'abcabcabcabc', undefined],
      ['sequential_run', 'abcdefghijkl', undefined],
      ['keyboard_walk', 'qwertyuiopas', undefined],
      ['few_distinct_characters', 'abcdabcdbadc', undefined],
      ['common_password', 'password1234', undefined],
      ['contains_email', 'isaac-correct-horse-battery', { email: accountContext.email }],
      ['contains_name', 'isaacmora-correct-horse', { name: accountContext.name }],
    ];

    it.each(rejected)('reports the %s rule', (rule, password, context) => {
      expect(validatePassword(password, context)).toMatchObject({ valid: false, rule });
    });

    it('gives every rule a message of its own', () => {
      const messages = rejected.map(([, password, context]) => messageOf(password, context));
      expect(new Set(messages).size).toBe(rejected.length);
    });

    it('states the limits in the length messages', () => {
      expect(messageOf('12345678')).toContain('12');
      expect(messageOf(strongPassword(129))).toContain('128');
    });

    it('never repeats the password in the message', () => {
      for (const [, password, context] of rejected) {
        expect(messageOf(password, context)).not.toContain(password);
      }
    });

    // The admin seed reads a message containing these words as "the user is
    // already there" and skips quietly. A rejection must never read that way.
    it.each(rejected)('keeps the %s message clear of the seed duplicate markers', (_rule, password, context) => {
      expect(messageOf(password, context)).not.toMatch(/already|unique/i);
    });
  });
});
