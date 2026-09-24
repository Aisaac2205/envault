import { describe, expect, it } from 'vitest';
import { API_BASE_URL_TOKEN, type DocContent } from '../content/types';
import { resolveDocContent } from './resolve-content';

function buildContent(): DocContent {
  return {
    pageTitle: 'Docs',
    pageDescription: 'Desc',
    breadcrumbLabel: 'Guide',
    heroTitle: 'Docs',
    heroSubtitle: 'Subtitle',
    tocLabel: 'Contents',
    copyCodeLabel: 'Copy code',
    copiedLabel: 'Copied!',
    navGroups: [],
    sections: [
      {
        id: 'reference',
        navLabel: 'Reference',
        title: 'Reference',
        blocks: [
          { type: 'paragraph', text: `Call ${API_BASE_URL_TOKEN}/runs/ingest` },
          { type: 'list', items: [`See ${API_BASE_URL_TOKEN}/health`] },
          { type: 'code', language: 'shell', code: `curl ${API_BASE_URL_TOKEN}/runs/ingest` },
          {
            type: 'codeGroup',
            label: `POST ${API_BASE_URL_TOKEN}/runs/ingest`,
            variants: [
              { language: 'shell', label: 'cURL', code: `curl ${API_BASE_URL_TOKEN}/runs/ingest` },
              { language: 'python', label: 'Python', code: `requests.post("${API_BASE_URL_TOKEN}/runs/ingest")` },
            ],
          },
          { type: 'table', headers: [API_BASE_URL_TOKEN], rows: [[`${API_BASE_URL_TOKEN}/runs/ingest`]] },
          {
            type: 'faq',
            items: [
              {
                question: 'Where do I send results?',
                answer: [{ type: 'paragraph', text: `${API_BASE_URL_TOKEN}/runs/ingest` }],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('resolveDocContent', () => {
  it('replaces every occurrence of the API base URL token', () => {
    const resolved = resolveDocContent(buildContent(), 'https://api.qably.dev');
    const [paragraph, list, code, codeGroup, table, faq] = resolved.sections[0]!.blocks;

    expect(paragraph).toMatchObject({ text: 'Call https://api.qably.dev/runs/ingest' });
    expect(list).toMatchObject({ items: ['See https://api.qably.dev/health'] });
    expect(code).toMatchObject({ code: 'curl https://api.qably.dev/runs/ingest' });
    expect(codeGroup).toMatchObject({
      label: 'POST https://api.qably.dev/runs/ingest',
      variants: [
        { label: 'cURL', code: 'curl https://api.qably.dev/runs/ingest' },
        { label: 'Python', code: 'requests.post("https://api.qably.dev/runs/ingest")' },
      ],
    });
    expect(table).toMatchObject({
      headers: ['https://api.qably.dev'],
      rows: [['https://api.qably.dev/runs/ingest']],
    });
    expect(faq).toMatchObject({
      items: [{ answer: [{ text: 'https://api.qably.dev/runs/ingest' }] }],
    });
  });

  it('leaves content untouched when the token never appears', () => {
    const content = buildContent();
    const withoutToken: DocContent = {
      ...content,
      sections: [{ ...content.sections[0]!, blocks: [{ type: 'paragraph', text: 'No token here.' }] }],
    };

    const resolved = resolveDocContent(withoutToken, 'https://api.qably.dev');

    expect(resolved.sections[0]!.blocks[0]).toMatchObject({ text: 'No token here.' });
  });
});
