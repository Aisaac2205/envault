import type { CodeLanguage } from '../lib/highlight';

export interface ParagraphBlock {
  type: 'paragraph';
  text: string;
}

export interface SubheadingBlock {
  type: 'subheading';
  text: string;
}

export interface ListBlock {
  type: 'list';
  ordered?: boolean;
  items: string[];
}

export interface CodeBlock {
  type: 'code';
  language: CodeLanguage;
  code: string;
  label?: string;
}

export interface CodeGroupVariant {
  language: CodeLanguage;
  label: string;
  code: string;
}

export interface CodeGroupBlock {
  type: 'codeGroup';
  label: string;
  variants: CodeGroupVariant[];
}

export interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export interface CalloutBlock {
  type: 'callout';
  tone: 'info' | 'warning';
  text: string;
}

export interface LogoRowItem {
  src: string;
  alt: string;
  label: string;
}

export interface LogoRowBlock {
  type: 'logoRow';
  items: LogoRowItem[];
}

export type FaqAnswerBlock = ParagraphBlock | ListBlock | CodeBlock;

export interface FaqBlock {
  type: 'faq';
  items: {
    question: string;
    answer: FaqAnswerBlock[];
  }[];
}

export type DocBlock =
  | ParagraphBlock
  | SubheadingBlock
  | ListBlock
  | CodeBlock
  | CodeGroupBlock
  | TableBlock
  | CalloutBlock
  | LogoRowBlock
  | FaqBlock;

export const API_BASE_URL_TOKEN = '{{API_BASE_URL}}';

export interface DocSection {
  id: string;
  navLabel: string;
  title: string;
  blocks: DocBlock[];
}

export interface DocNavGroup {
  label: string;
  sectionIds: string[];
}

export interface DocContent {
  pageTitle: string;
  pageDescription: string;
  breadcrumbLabel: string;
  heroTitle: string;
  heroSubtitle: string;
  tocLabel: string;
  copyCodeLabel: string;
  copiedLabel: string;
  navGroups: DocNavGroup[];
  sections: DocSection[];
}
