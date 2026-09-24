import { describe, it, expect } from 'vitest';
import { highlight, type CodeLanguage } from './highlight';
import { SNIPPETS, SNIPPET_LANGUAGES } from '../components/snippets';

const ENTRIES = Object.entries(SNIPPETS) as [keyof typeof SNIPPETS, string][];

describe('highlight', () => {
  it.each(ENTRIES)('reproduces the %s snippet exactly', (id, source) => {
    const rejoined = highlight(source, SNIPPET_LANGUAGES[id])
      .map((token) => token.value)
      .join('');

    expect(rejoined).toBe(source);
  });

  it.each(ENTRIES)('never emits an empty token for %s', (id, source) => {
    const tokens = highlight(source, SNIPPET_LANGUAGES[id]);

    expect(tokens.every((token) => token.value.length > 0)).toBe(true);
  });

  it.each(ENTRIES)('keeps every %s line within the mobile width budget', (_id, source) => {
    const tooWide = source.split('\n').filter((line) => line.length > 52);

    expect(tooWide).toEqual([]);
  });

  it('marks shell flags as keywords', () => {
    const tokens = highlight('curl -X POST', 'shell');

    expect(tokens).toContainEqual({ value: '-X', kind: 'keyword' });
  });

  it('reads a heredoc payload as JSON, not as one shell string', () => {
    const payload = ['-d {', '  "name": "run"', '}'].join(String.fromCharCode(10));

    const tokens = highlight(payload, 'shell');

    expect(tokens).toContainEqual({ value: '"name"', kind: 'property' });
    expect(tokens).toContainEqual({ value: '"run"', kind: 'string' });
  });

  it('marks yaml keys and workflow expressions', () => {
    const tokens = highlight('env:\n  KEY: ${{ secrets.KEY }}', 'yaml');

    expect(tokens).toContainEqual({ value: 'env', kind: 'property' });
    expect(tokens).toContainEqual({ value: '${{ secrets.KEY }}', kind: 'keyword' });
  });

  it('marks typescript comments and strings', () => {
    const tokens = highlight("// note\nconst a = 'b';", 'typescript');

    expect(tokens).toContainEqual({ value: '// note', kind: 'comment' });
    expect(tokens).toContainEqual({ value: 'const', kind: 'keyword' });
    expect(tokens).toContainEqual({ value: "'b'", kind: 'string' });
  });

  it('falls back to plain text for an unknown shape', () => {
    const language: CodeLanguage = 'shell';
    const tokens = highlight('plainword', language);

    expect(tokens).toEqual([{ value: 'plainword', kind: 'plain' }]);
  });
});
