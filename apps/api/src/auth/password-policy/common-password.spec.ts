import { COMMON_PASSWORD_BASES } from './common-password-bases';
import { isCommonPassword, normalizeForMatching } from './common-password';

describe('isCommonPassword', () => {
  it.each([
    // The base word with digits and symbols around it.
    'password1234',
    'Welcome12345!',
    'qwerty123456',
    '123456password',
    '!!!letmein2024',
    'monkey 123456',
    // Case does not matter.
    'PASSWORD1234',
    'PaSsWoRd1234',
    // Simple leetspeak.
    'P@ssw0rd2024',
    'p4$$w0rd!!!!',
    'L3tM3!n123456',
    'dr4g0n123456',
    '$unshine2024!',
    // "1" and "!" stand for either "i" or "l".
    '1loveyou123456',
    'iloveyou123456',
    'w3lcome12345!',
    // Separators between the characters.
    'pass-word-1234',
    'Let Me In 12345',
    'i.love.you.2024',
    // Accents and compatibility forms fold away.
    'Contraseña123456',
    'ｐａｓｓｗｏｒｄ１２３４',
    // Words that are themselves digits.
    '1234567890123',
    // The product's own name is the first guess against it.
    'Envault2024!!!!',
  ])('flags %j', (password) => {
    expect(isCommonPassword(password)).toBe(true);
  });

  it.each([
    // Several words: the whole password is not a single common word.
    'correct horse battery staple',
    'password correct horse',
    'my dog is called monkey and loves winter',
    // A common word with extra letters is a different word.
    'passwordx123456',
    'xpassword123456',
    'passwords123456',
    // Digits and symbols with no common base behind them.
    'x7Qp-2mLv9kR',
    'e2e-admin-pass-123',
    // Letters that happen to sit between digits.
    'Pw-0f3a9c1b-e2e',
    '',
  ])('does not flag %j', (password) => {
    expect(isCommonPassword(password)).toBe(false);
  });

  it('accepts a very long input without slowing down', () => {
    const started = Date.now();
    expect(isCommonPassword('1'.repeat(128))).toBe(true);
    expect(isCommonPassword('x'.repeat(128))).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('normalizeForMatching', () => {
  it('lower-cases, folds accents and compatibility forms, and drops separators', () => {
    expect(normalizeForMatching('Contraseña')).toBe('contrasena');
    expect(normalizeForMatching('ＡＢＣ')).toBe('abc');
    expect(normalizeForMatching('Let Me-In_now.')).toBe('letmeinnow');
  });
});

describe('COMMON_PASSWORD_BASES', () => {
  it('is a curated list of a few hundred entries', () => {
    expect(COMMON_PASSWORD_BASES.length).toBeGreaterThanOrEqual(250);
    expect(COMMON_PASSWORD_BASES.length).toBeLessThanOrEqual(1000);
  });

  it('holds each entry once', () => {
    expect(new Set(COMMON_PASSWORD_BASES).size).toBe(COMMON_PASSWORD_BASES.length);
  });

  it('holds entries already in the form the matcher compares against', () => {
    const notNormalized = COMMON_PASSWORD_BASES.filter(
      (entry) => entry !== normalizeForMatching(entry),
    );
    expect(notNormalized).toEqual([]);
  });

  it('holds entries of at least three characters', () => {
    expect(COMMON_PASSWORD_BASES.filter((entry) => entry.length < 3)).toEqual([]);
  });

  it.each(['password', 'welcome', 'qwerty', 'letmein', 'iloveyou', 'admin', 'monkey', 'dragon', 'football'])(
    'holds the classic %s',
    (word) => {
      expect(COMMON_PASSWORD_BASES).toContain(word);
    },
  );
});
