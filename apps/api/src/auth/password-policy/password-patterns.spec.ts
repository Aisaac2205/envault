import {
  countDistinctCharacters,
  findRepeatedBlockLength,
  hasKeyboardWalk,
  hasSequentialRun,
  isSingleRepeatedCharacter,
} from './password-patterns';

describe('isSingleRepeatedCharacter', () => {
  it.each(['aaaaaaaaaaaa', '000000000000', '            ', '😀😀😀😀😀😀'])(
    'detects %j as one character repeated',
    (text) => {
      expect(isSingleRepeatedCharacter(text)).toBe(true);
    },
  );

  it.each(['aaaaaaaaaaab', 'abababababab', 'a', ''])(
    'does not flag %j',
    (text) => {
      expect(isSingleRepeatedCharacter(text)).toBe(false);
    },
  );
});

describe('findRepeatedBlockLength', () => {
  it.each([
    ['abcabcabcabc', 3],
    ['abababababab', 2],
    ['hunter2hunter2hunter2', 7],
    ['passwordpassword', 8],
    // The last repetition may be cut short.
    ['abcabcabcabca', 3],
    ['😀🔐😀🔐😀🔐😀🔐', 2],
  ])('finds the block of %j', (text, length) => {
    expect(findRepeatedBlockLength(text)).toBe(length);
  });

  it.each([
    // Only one repetition: the block would have to be longer than half the text.
    'abcdefabcxyz',
    'correct horse battery staple',
    'tick tock tick tock',
    'a',
    '',
  ])('returns null for %j', (text) => {
    expect(findRepeatedBlockLength(text)).toBeNull();
  });

  it('reports the shortest block when several periods fit', () => {
    expect(findRepeatedBlockLength('abababababab')).toBe(2);
  });
});

describe('countDistinctCharacters', () => {
  it('counts code points once each', () => {
    expect(countDistinctCharacters('abcabcabcabc')).toBe(3);
    expect(countDistinctCharacters('aaaa')).toBe(1);
    expect(countDistinctCharacters('')).toBe(0);
  });

  it('counts an astral character as one', () => {
    expect(countDistinctCharacters('😀😀🔐🔐')).toBe(2);
  });

  it('is case-sensitive: callers fold case first when they want to', () => {
    expect(countDistinctCharacters('aAaA')).toBe(2);
  });
});

describe('hasSequentialRun', () => {
  it.each([
    ['123456789012', 'digits wrapping through 0'],
    ['012345678901', 'digits from 0'],
    ['987654321098', 'descending digits'],
    ['abcdefghijkl', 'ascending letters'],
    ['zyxwvutsrqpo', 'descending letters'],
    ['abcdefghi123', 'a long run plus a short tail'],
    ['xxabcdefghij', 'a long run behind a short head'],
    ['ABCDEFGHIJKL', 'upper case counts as the same run'],
  ])('flags %j (%s)', (text) => {
    expect(hasSequentialRun(text)).toBe(true);
  });

  it.each([
    // Runs shorter than 8 characters are ordinary text.
    ['abcdefg-correct-horse', 'a short run inside a longer password'],
    ['123456-random-words-here', 'six digits inside a longer password'],
    // A long run that is a small part of a long passphrase.
    ['abcdefgh and then a very long passphrase around it', 'a long run, small share'],
    ['correct horse battery staple', 'ordinary words'],
    ['13579acegikm', 'steps of two are not a run'],
    ['', 'empty'],
  ])('does not flag %j (%s)', (text) => {
    expect(hasSequentialRun(text)).toBe(false);
  });
});

describe('hasKeyboardWalk', () => {
  it.each([
    ['qwertyuiopas', 'top row onto the home row'],
    ['asdfghjklzxc', 'home row onto the bottom row'],
    ['poiuytrewqlk', 'a row walked backwards'],
    ['mnbvcxzlkjhg', 'bottom row backwards onto the home row'],
    ['1q2w3e4r5t6y', 'digit and letter interleave'],
    ['1qaz2wsx3edc', 'column walk'],
    ['qazwsxedcrfv', 'column walk without digits'],
    ['QWERTYUIOPAS', 'upper case'],
  ])('flags %j (%s)', (text) => {
    expect(hasKeyboardWalk(text)).toBe(true);
  });

  it.each([
    ['qwerty-is-not-a-secret-passphrase', 'six keys inside a long passphrase'],
    ['correct horse battery staple', 'ordinary words'],
    ['', 'empty'],
  ])('does not flag %j (%s)', (text) => {
    expect(hasKeyboardWalk(text)).toBe(false);
  });
});
