import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '../..');

const GLOBALLY_RENDERED_COMPONENTS = [
  'features/navigation/components/SiteHeader.astro',
  'features/navigation/components/Footer.astro',
  'features/navigation/components/CtaBanner.astro',
  'layouts/Landing.astro',
];

const ALLOWED_BARE_FRAGMENT = '#main-content';

const HREF_EXPRESSION_PATTERN = /href=(?:\{[^}]*\}|"[^"]*"|'[^']*')/g;
const BARE_FRAGMENT_LITERAL_PATTERN = /(["'`])(#[^"'`]*)\1/g;

function findBareFragments(source: string): string[] {
  const fragments: string[] = [];

  for (const hrefMatch of source.matchAll(HREF_EXPRESSION_PATTERN)) {
    for (const literalMatch of hrefMatch[0].matchAll(BARE_FRAGMENT_LITERAL_PATTERN)) {
      if (literalMatch[2] !== ALLOWED_BARE_FRAGMENT) fragments.push(literalMatch[2]);
    }
  }

  return fragments;
}

describe('globally rendered components never use a bare "#" href fragment', () => {
  it.each(GLOBALLY_RENDERED_COMPONENTS)('%s', (relativePath) => {
    const source = readFileSync(path.join(srcRoot, relativePath), 'utf-8');

    expect(findBareFragments(source)).toEqual([]);
  });
});
