export type CodeLanguage = 'shell' | 'yaml' | 'typescript' | 'python';

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'keyword'
  | 'string'
  | 'number'
  | 'property'
  | 'punctuation';

export interface CodeToken {
  value: string;
  kind: TokenKind;
}

export const TOKEN_CLASSES: Record<TokenKind, string> = {
  plain: 'text-code-plain',
  comment: 'text-code-comment italic',
  keyword: 'text-code-keyword',
  string: 'text-code-string',
  number: 'text-code-number',
  property: 'text-code-property',
  punctuation: 'text-code-punctuation',
};

interface Rule {
  kind: TokenKind;
  pattern?: RegExp;
  chars?: string;
}

const TS_KEYWORDS =
  /^(?:import|from|export|const|let|await|async|function|return|new|typeof|null|undefined|true|false|method|headers|body)\b/;

const PYTHON_KEYWORDS =
  /^(?:import|from|as|def|return|with|raise|if|else|elif|True|False|None|and|or|not|in)\b/;

const PUNCTUATION = '{}[]().,:;=>';

const RULES: Record<CodeLanguage, Rule[]> = {
  shell: [
    { kind: 'comment', pattern: /^#[^\n]*/ },
    { kind: 'property', pattern: /^"[^"\n]*"(?=\s*:)/ },
    { kind: 'string', pattern: /^'[^'\n]*'|^"[^"\n]*"/ },
    { kind: 'keyword', pattern: /^\$[A-Za-z_][\w]*/ },
    { kind: 'keyword', pattern: /^--?[A-Za-z][\w-]*/ },
    { kind: 'number', pattern: /^\b\d+(?:\.\d+)?\b/ },
    { kind: 'punctuation', chars: PUNCTUATION },
  ],
  yaml: [
    { kind: 'comment', pattern: /^#[^\n]*/ },
    { kind: 'keyword', pattern: /^\$\{\{[^}]*\}\}/ },
    { kind: 'property', pattern: /^[A-Za-z_][\w.-]*(?=:)/ },
    { kind: 'string', pattern: /^'[^'\n]*'|^"[^"\n]*"/ },
    { kind: 'number', pattern: /^\b\d+(?:\.\d+)?\b/ },
    { kind: 'punctuation', chars: PUNCTUATION },
  ],
  typescript: [
    { kind: 'comment', pattern: /^\/\/[^\n]*/ },
    { kind: 'string', pattern: /^'[^'\n]*'|^"[^"\n]*"|^`[^`]*`/ },
    { kind: 'keyword', pattern: TS_KEYWORDS },
    { kind: 'property', pattern: /^[A-Za-z_$][\w$]*(?=\s*:)/ },
    { kind: 'number', pattern: /^\b\d+(?:\.\d+)?\b/ },
    { kind: 'punctuation', chars: PUNCTUATION },
  ],
  python: [
    { kind: 'comment', pattern: /^#[^\n]*/ },
    { kind: 'string', pattern: /^f'[^'\n]*'|^f"[^"\n]*"|^'[^'\n]*'|^"[^"\n]*"/ },
    { kind: 'keyword', pattern: PYTHON_KEYWORDS },
    { kind: 'property', pattern: /^[A-Za-z_][\w]*(?=\s*[:=](?!=))/ },
    { kind: 'number', pattern: /^\b\d+(?:\.\d+)?\b/ },
    { kind: 'punctuation', chars: PUNCTUATION },
  ],
};

export function highlight(source: string, language: CodeLanguage): CodeToken[] {
  const rules = RULES[language];
  const tokens: CodeToken[] = [];
  let cursor = 0;
  let plain = '';

  const flushPlain = () => {
    if (plain === '') return;
    tokens.push({ value: plain, kind: 'plain' });
    plain = '';
  };

  while (cursor < source.length) {
    const rest = source.slice(cursor);
    const rule = rules.find((candidate) =>
      candidate.chars === undefined
        ? candidate.pattern?.test(rest) === true
        : candidate.chars.includes(rest[0]),
    );

    if (rule === undefined) {
      plain += source[cursor];
      cursor += 1;
      continue;
    }

    const match = rule.chars === undefined ? rule.pattern?.exec(rest)?.[0] : rest[0];

    if (match === undefined || match.length === 0) {
      plain += source[cursor];
      cursor += 1;
      continue;
    }

    flushPlain();
    tokens.push({ value: match, kind: rule.kind });
    cursor += match.length;
  }

  flushPlain();

  return tokens;
}
