import React, { useState } from 'react';
import { Copy, Check, ArrowSquareOut } from '@phosphor-icons/react';
import type { DocumentationTranslations } from '../../i18n/types';
import { highlight, type TokenKind } from '../lib/highlight';
import { SNIPPETS, SNIPPET_LANGUAGES, type SnippetId } from './snippets';

interface DocumentationSectionProps {
  t?: DocumentationTranslations;
  locale?: string;
}

type TabId = SnippetId;

const TOKEN_CLASSES: Record<TokenKind, string> = {
  plain: 'text-zinc-300',
  comment: 'text-zinc-500 italic',
  keyword: 'text-[#bfe70a]',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  property: 'text-zinc-200 font-semibold',
  punctuation: 'text-zinc-400',
};

const DEPLOYMENT_PLATFORMS: {
  id: TabId;
  name: string;
  category: string;
  iconSrc: string;
}[] = [
  {
    id: 'docker',
    name: 'Docker Compose',
    category: 'Self-Hosted / On-Premise',
    iconSrc: '/tech-icons/docker.svg',
  },
  {
    id: 'railway',
    name: 'Railway',
    category: 'PaaS / Managed Cloud',
    iconSrc: '/tech-icons/railway.svg',
  },
];

export function DocumentationSection({ locale = 'es' }: DocumentationSectionProps) {
  const [activeTab, setActiveTab] = useState<TabId>('docker');
  const [copied, setCopied] = useState(false);
  const isEn = locale === 'en';

  const currentSnippet = SNIPPETS[activeTab];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="documentation" className="py-24 px-6 max-w-7xl mx-auto font-sans" aria-labelledby="docs-heading">
      {/* Direct, Clean Section Title — No Pill Badges */}
      <div className="text-center max-w-3xl mx-auto mb-14">
        <h2 id="docs-heading" className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-white mb-4">
          {isEn ? 'Run it on your own servers' : 'Córrelo en tus propios servidores'}
        </h2>
        <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
          {isEn
            ? 'Ready-to-use setup for Docker Compose and Railway, the same one this project actually runs on.'
            : 'Configuración lista para usar en Docker Compose y Railway, la misma con la que corre este proyecto.'}
        </p>
      </div>

      {/* Deployment target switcher — segmented control, not a card grid */}
      <div
        role="tablist"
        aria-label={isEn ? 'Deployment target' : 'Destino de despliegue'}
        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-zinc-950/60 p-1 mb-6"
      >
        {DEPLOYMENT_PLATFORMS.map((platform) => {
          const isActive = activeTab === platform.id;
          return (
            <button
              key={platform.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={platform.category}
              onClick={() => setActiveTab(platform.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium font-sans transition-all cursor-pointer ${
                isActive ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <img
                src={platform.iconSrc}
                alt=""
                aria-hidden="true"
                className={`size-4 object-contain ${isActive ? 'brightness-0' : ''}`}
              />
              {platform.name}
            </button>
          );
        })}
      </div>

      {/* Code Viewer Card */}
      <div className="rounded-xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden mb-12">
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-zinc-900/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-xs font-mono text-zinc-400">
              {activeTab === 'docker' ? 'docker-compose.yml' : 'railway environment variables'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-all hover:bg-zinc-700 active:scale-[0.98] cursor-pointer"
            aria-label={isEn ? 'Copy configuration' : 'Copiar configuración'}
          >
            {copied ? (
              <>
                <Check size={14} weight="bold" className="text-emerald-400" aria-hidden="true" />
                <span className="text-emerald-400">{isEn ? 'Copied' : 'Copiado'}</span>
              </>
            ) : (
              <>
                <Copy size={14} aria-hidden="true" />
                <span>{isEn ? 'Copy' : 'Copiar'}</span>
              </>
            )}
          </button>
        </div>

        <div className="p-4 sm:p-6 bg-black font-mono text-xs sm:text-sm overflow-x-auto min-h-[260px]">
          <pre className="text-zinc-300 leading-relaxed whitespace-pre font-mono">
            {(() => {
              const tokens = highlight(currentSnippet, SNIPPET_LANGUAGES[activeTab]);
              if (tokens && tokens.length > 0) {
                return tokens.map((token, i) => (
                  <span key={i} className={TOKEN_CLASSES[token.kind]}>
                    {token.value}
                  </span>
                ));
              }
              return currentSnippet;
            })()}
          </pre>
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-500 font-sans">
        {isEn ? 'Need Kubernetes or a full self-host walkthrough?' : '¿Necesitas Kubernetes o una guía completa de self-hosting?'}{' '}
        <a
          href={
            isEn
              ? 'https://github.com/Aisaac2205/envault/blob/main/docs/en/deployment-self-host.md'
              : 'https://github.com/Aisaac2205/envault/blob/main/docs/es/deployment-self-host.md'
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-zinc-300 hover:text-white underline underline-offset-2 transition-colors"
        >
          {isEn ? 'See the docs' : 'Ver la documentación'}
          <ArrowSquareOut size={12} aria-hidden="true" />
        </a>
      </p>
    </section>
  );
}
