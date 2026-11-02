import React, { useState } from 'react';
import { Check, ArrowRight } from '@phosphor-icons/react';
import type { InstallSectionTranslations } from '../../i18n/types';

interface InstallSectionProps {
  locale?: string;
  t?: InstallSectionTranslations;
}

type TabType = 'linux' | 'windows' | 'docker' | 'compose';

interface CommandVariant {
  label: string;
  command: string;
}

interface TabConfig {
  id: TabType;
  name: string;
  subtitle: string;
  description: string;
  variants?: CommandVariant[];
  defaultCommand: string;
  docAnchor: string;
}

export function InstallSection({ locale = 'es', t }: InstallSectionProps) {
  const [activeTab, setActiveTab] = useState<TabType>('linux');
  const [activeSubTab, setActiveSubTab] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  const isEn = locale === 'en';

  const tabs: TabConfig[] = [
    {
      id: 'linux',
      name: 'Linux',
      subtitle: isEn ? 'Linux (Ubuntu, Debian, Arch, CentOS)' : 'Linux (Ubuntu, Debian, Arch, CentOS)',
      description: isEn
        ? 'Download the official compose stack and start all containers in the background with Docker Engine.'
        : 'Descarga la configuración oficial y levanta todos los contenedores en segundo plano con Docker Engine.',
      variants: [
        {
          label: isEn ? 'with sudo' : 'con sudo',
          command: `sudo apt-get install -y curl\nsudo curl -fSL https://raw.githubusercontent.com/Aisaac2205/envault/main/docker-compose.yml -o docker-compose.yml\nsudo docker compose up -d`,
        },
        {
          label: isEn ? 'without sudo' : 'sin sudo',
          command: `curl -fSL https://raw.githubusercontent.com/Aisaac2205/envault/main/docker-compose.yml -o docker-compose.yml\ndocker compose up -d`,
        },
      ],
      defaultCommand: `sudo apt-get install -y curl\nsudo curl -fSL https://raw.githubusercontent.com/Aisaac2205/envault/main/docker-compose.yml -o docker-compose.yml\nsudo docker compose up -d`,
      docAnchor: '/docs#self-host',
    },
    {
      id: 'windows',
      name: 'Windows',
      subtitle: isEn ? 'Windows with Docker Desktop (WSL2 / PowerShell)' : 'Windows con Docker Desktop (WSL2 / PowerShell)',
      description: isEn
        ? 'Run EnVault using PowerShell and Docker Desktop. Make sure Docker Desktop is started before running.'
        : 'Ejecuta EnVault mediante PowerShell y Docker Desktop. Asegúrate de tener Docker Desktop iniciado.',
      defaultCommand: `Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Aisaac2205/envault/main/docker-compose.yml" -OutFile "docker-compose.yml"\ndocker compose up -d`,
      docAnchor: '/docs#self-host',
    },
    {
      id: 'docker',
      name: 'Docker',
      subtitle: isEn ? 'Standalone Container Deployment' : 'Contenedores Docker individuales',
      description: isEn
        ? 'Run the official EnVault API and Web images pointing to your existing Postgres and Redis services.'
        : 'Ejecuta las imágenes oficiales de API y Web conectándolas a tus propias instancias de Postgres y Redis.',
      defaultCommand: `docker run -d --name envault-api \\\n  -p 3000:3000 \\\n  --env-file .env \\\n  ghcr.io/envault/api:latest\n\ndocker run -d --name envault-web \\\n  -p 8080:80 \\\n  -e API_UPSTREAM=envault-api:3000 \\\n  ghcr.io/envault/web:latest`,
      docAnchor: '/docs#self-host',
    },
    {
      id: 'compose',
      name: 'Docker Compose',
      subtitle: isEn ? 'Production Compose Stack (Recommended)' : 'Pila Docker Compose oficial (Recomendado)',
      description: isEn
        ? 'The simplest self-hosted setup. Pulls hardened, pinned GHCR images with automatic restarts on reboot.'
        : 'La vía más sencilla de autohospedar EnVault. Descarga las imágenes seguras de GHCR con reinicio automático.',
      defaultCommand: `git clone https://github.com/Aisaac2205/envault.git\ncd envault\ncp .env.example .env\ndocker compose up -d`,
      docAnchor: '/docs#self-host',
    },
  ];

  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const currentCode =
    currentTab.variants && currentTab.variants[activeSubTab]
      ? currentTab.variants[activeSubTab].command
      : currentTab.defaultCommand;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="install" className="py-24 px-6 max-w-7xl mx-auto scroll-mt-20" aria-labelledby="install-heading">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto mb-16">
        <h2 id="install-heading" className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-white mb-4 font-sans">
          {t?.title ?? (isEn ? 'How to install?' : '¿Cómo instalar?')}
        </h2>
        <p className="text-base sm:text-lg text-zinc-400 leading-relaxed font-sans">
          {t?.subtitle ??
            (isEn
              ? 'Deploy EnVault in minutes on your own infrastructure, locally or in the cloud. Full sovereignty over your database assets.'
              : 'Despliega EnVault en minutos en tu propia infraestructura, localmente o en la nube. Todo el stack queda bajo tu control.')}
        </p>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setActiveSubTab(0);
              }}
              className={`px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm font-medium font-sans transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#bfe70a] text-zinc-950 font-semibold shadow-lg shadow-[#bfe70a]/15'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-zinc-800/80 border border-white/5'
              }`}
            >
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* Content Box */}
      <div className="max-w-4xl mx-auto rounded-2xl border border-white/10 bg-zinc-950/70 p-6 sm:p-8 md:p-10 backdrop-blur-sm">
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight font-sans">
              {currentTab.subtitle}
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed font-sans">
              {currentTab.description}
            </p>
          </div>

          {/* Sub-tabs if any */}
          {currentTab.variants && (
            <div className="flex items-center gap-2">
              {currentTab.variants.map((v, idx) => (
                <button
                  key={v.label}
                  type="button"
                  onClick={() => setActiveSubTab(idx)}
                  className={`px-3 py-1 rounded-md text-xs font-medium font-sans transition-colors cursor-pointer ${
                    activeSubTab === idx
                      ? 'bg-zinc-800 text-white border border-white/10'
                      : 'bg-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {/* Terminal Box - No horizontal scroll, wrapping naturally */}
          <div className="relative rounded-xl border border-white/10 bg-black/90 p-4 sm:p-5 shadow-inner">
            <button
              type="button"
              onClick={handleCopy}
              className="absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-md bg-[#bfe70a] px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-[#d4ff1a] transition-colors shadow-sm cursor-pointer select-none"
              aria-label={isEn ? 'Copy command' : 'Copiar comando'}
            >
              {copied ? (
                <>
                  <Check className="size-3.5" />
                  <span>{t?.copied ?? (isEn ? 'Copied!' : '¡Copiado!')}</span>
                </>
              ) : (
                <span>{t?.copyCode ?? (isEn ? 'Copy' : 'Copiar')}</span>
              )}
            </button>

            <pre className="font-mono text-xs text-zinc-200 leading-relaxed py-1 pr-24 whitespace-pre-wrap break-all [overflow-wrap:anywhere] select-all">
              <code>{currentCode}</code>
            </pre>
          </div>

          <div className="pt-2">
            <a
              href={currentTab.docAnchor}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#bfe70a] hover:text-[#d4ff1a] transition-colors group font-sans"
            >
              <span>{t?.docsLink ?? (isEn ? 'More on installation' : 'Más sobre la instalación')}</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
