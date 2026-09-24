import { describe, expect, it } from 'vitest';
import { en } from './en';
import { es } from './es';
import type { CodeGroupBlock, DocBlock, DocContent } from './types';

const locales: { name: string; content: DocContent }[] = [
  { name: 'en', content: en },
  { name: 'es', content: es },
];

function collectBlockText(block: DocBlock, parts: string[]): void {
  switch (block.type) {
    case 'paragraph':
    case 'subheading':
    case 'callout':
      parts.push(block.text);
      break;
    case 'list':
      parts.push(...block.items);
      break;
    case 'code':
      parts.push(block.code);
      break;
    case 'codeGroup':
      parts.push(block.label);
      for (const variant of block.variants) parts.push(variant.label, variant.code);
      break;
    case 'table':
      parts.push(...block.headers);
      for (const row of block.rows) parts.push(...row);
      break;
    case 'logoRow':
      for (const item of block.items) parts.push(item.alt, item.label);
      break;
    case 'faq':
      for (const item of block.items) {
        parts.push(item.question);
        for (const answerBlock of item.answer) collectBlockText(answerBlock, parts);
      }
      break;
  }
}

function collectCodeGroups(block: DocBlock, groups: CodeGroupBlock[]): void {
  if (block.type === 'codeGroup') groups.push(block);
  if (block.type === 'faq') {
    for (const item of block.items) {
      for (const answerBlock of item.answer) collectCodeGroups(answerBlock, groups);
    }
  }
}

function collectAllCodeGroups(content: DocContent): CodeGroupBlock[] {
  const groups: CodeGroupBlock[] = [];

  for (const section of content.sections) {
    for (const block of section.blocks) collectCodeGroups(block, groups);
  }

  return groups;
}

function flattenContent(content: DocContent): string {
  const parts: string[] = [
    content.pageTitle,
    content.pageDescription,
    content.breadcrumbLabel,
    content.heroTitle,
    content.heroSubtitle,
    content.tocLabel,
  ];

  for (const group of content.navGroups) parts.push(group.label);

  for (const section of content.sections) {
    parts.push(section.navLabel, section.title);
    for (const block of section.blocks) collectBlockText(block, parts);
  }

  return parts.join('\n');
}

// Technology names and monorepo paths that must never leak into public docs —
// public documentation describes the API contract, never the implementation.
// (jest-junit, Vitest, pytest, PHPUnit, Maven, Gradle, and similar are the
// reader's own tooling and are intentionally not in this list.)
const FORBIDDEN_STACK_TERMS = [
  'NestJS',
  'Express',
  'PostgreSQL',
  'Prisma',
  'Redis',
  'BullMQ',
  'Next.js',
  'Astro',
  'Turborepo',
  'better-auth',
  'Better Auth',
  'pnpm',
];

const FORBIDDEN_PATHS = ['apps/api', 'apps/web', 'apps/landing', 'packages/'];

// Rioplatense voseo verb forms that must never appear in the (neutral, tú/impersonal)
// Spanish documentation. Matched with an accent-aware boundary since JS's default
// \w does not treat accented vowels as word characters.
const VOSEO_MARKERS = [
  'vos',
  'podés',
  'tenés',
  'querés',
  'debés',
  'necesitás',
  'hacé',
  'configurá',
  'configuralo',
  'verificá',
  'creá',
  'usá',
  'usala',
  'abrí',
  'copiá',
  'copialo',
  'pegá',
  'seguí',
  'revisá',
  'elegí',
  'guardalo',
  'guárdalo',
  'obtené',
  'llamá',
  'agregá',
  'confirmá',
  'buscá',
  'generá',
  'apuntá',
  'apuntalo',
  'dejá',
  'enviá',
  'mirá',
  'iniciá',
  'registrá',
  'rotás',
];

const SPANISH_LETTER = 'a-zA-ZáéíóúÁÉÍÓÚñÑ';

function findAccentAwareMatch(haystack: string, word: string): string | undefined {
  const pattern = new RegExp(`(?<![${SPANISH_LETTER}])${word}(?![${SPANISH_LETTER}])`, 'i');
  const match = haystack.match(pattern);
  return match?.[0];
}

function findAsciiWordMatch(haystack: string, word: string): string | undefined {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  const match = haystack.match(pattern);
  return match?.[0];
}

describe('documentation content', () => {
  it.each(locales)(
    'every sidebar anchor in $name resolves to a real section id',
    ({ content }) => {
      const sectionIds = new Set(content.sections.map((section) => section.id));
      const anchorIds = content.navGroups.flatMap((group) => group.sectionIds);

      expect(anchorIds.length).toBeGreaterThan(0);

      for (const id of anchorIds) {
        expect(sectionIds.has(id)).toBe(true);
      }
    },
  );

  it.each(locales)('$name has no duplicated section id', ({ content }) => {
    const ids = content.sections.map((section) => section.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(locales)('$name has no duplicated anchor within a nav group', ({ content }) => {
    for (const group of content.navGroups) {
      expect(new Set(group.sectionIds).size).toBe(group.sectionIds.length);
    }
  });

  it('en and es expose the same section ids, in the same order', () => {
    const enIds = en.sections.map((section) => section.id);
    const esIds = es.sections.map((section) => section.id);

    expect(esIds).toEqual(enIds);
  });

  it('en and es nav groups reference the same section ids, in the same order', () => {
    const enNav = en.navGroups.flatMap((group) => group.sectionIds);
    const esNav = es.navGroups.flatMap((group) => group.sectionIds);

    expect(esNav).toEqual(enNav);
  });

  it('en and es nav groups have the same number of groups', () => {
    expect(es.navGroups.length).toBe(en.navGroups.length);
  });

  it.each(locales)('$name sections all carry non-empty content', ({ content }) => {
    for (const section of content.sections) {
      expect(section.id.length).toBeGreaterThan(0);
      expect(section.navLabel.length).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.blocks.length).toBeGreaterThan(0);
    }
  });

  it.each(locales)(
    '$name never names an internal technology or monorepo path',
    ({ content }) => {
      const text = flattenContent(content);

      for (const term of FORBIDDEN_STACK_TERMS) {
        const match = findAsciiWordMatch(text, term);
        expect(match, `found forbidden stack term "${term}"`).toBeUndefined();
      }

      for (const path of FORBIDDEN_PATHS) {
        expect(text.includes(path), `found forbidden path "${path}"`).toBe(false);
      }
    },
  );

  it('es never uses Rioplatense voseo', () => {
    const text = flattenContent(es);

    for (const marker of VOSEO_MARKERS) {
      const match = findAccentAwareMatch(text, marker);
      expect(match, `found voseo marker "${marker}"`).toBeUndefined();
    }
  });

  it.each(locales)('$name has at least one codeGroup block', ({ content }) => {
    expect(collectAllCodeGroups(content).length).toBeGreaterThan(0);
  });

  it.each(locales)('$name codeGroup blocks each have at least two variants', ({ content }) => {
    for (const group of collectAllCodeGroups(content)) {
      expect(group.variants.length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(locales)('$name codeGroup blocks never repeat a variant label', ({ content }) => {
    for (const group of collectAllCodeGroups(content)) {
      const labels = group.variants.map((variant) => variant.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it.each(locales)(
    '$name other-languages section never stacks a standalone code block directly after a framework subheading',
    ({ content }) => {
      const section = content.sections.find((candidate) => candidate.id === 'other-languages');
      expect(section).toBeDefined();

      const blocks = section!.blocks;
      for (let i = 0; i < blocks.length - 1; i += 1) {
        const current = blocks[i];
        const next = blocks[i + 1];
        const isSubheadingFollowedByCode = current.type === 'subheading' && next.type === 'code';
        expect(
          isSubheadingFollowedByCode,
          `subheading "${current.type === 'subheading' ? current.text : ''}" is directly followed by a standalone code block`,
        ).toBe(false);
      }
    },
  );
});
