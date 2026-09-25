import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AsciiGardenCanvas } from './AsciiGardenCanvas';
import type { Locale } from '../../features/i18n/types';

export const Hero = React.memo(({ locale = 'es' }: { locale?: Locale }) => {
  const isEn = locale === 'en';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <section
      id="getting-started"
      className="relative w-full min-h-[100dvh] flex flex-col justify-center overflow-hidden bg-black select-none py-20"
    >
      {/* Background Canvas: covers viewport so the ink garden & flowers art is clearly visible */}
      <div className="absolute inset-0 w-full h-full z-0">
        {mounted && (
          <AsciiGardenCanvas
            sourcePhoto="/ascii-editor/demos/generated/hero.webp"
            config={{
              renderMode: 'characters',
              bgMode: 'original',
              bgOpacity: 85,
              cellSize: 8,
              contrast: 108,
              brightness: 24,
              tint: '#ffffff',
              animated: true,
              animStyle: 'pulse',
              focalPoint: { x: 0.5, y: 0.5 },
              mobileFocalPoint: { x: 0.16, y: 0.65 },
            }}
            interactive={false}
          />
        )}
        {/* Radial vignette: clear center to keep lotus artwork luminous, edge darkening for seamless page integration */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.15)_50%,rgba(0,0,0,0.75)_100%)] pointer-events-none" />
        {/* Desktop left scrim: gently darkens text column without muddying the artwork */}
        <div className="hidden md:block absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.65)_0%,rgba(0,0,0,0.2)_40%,transparent_70%)] pointer-events-none" />
        {/* Mobile top/bottom scrim: protects title legibility at top while leaving water lilies radiant below */}
        <div className="block md:hidden absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.65)_0%,rgba(0,0,0,0.2)_35%,transparent_60%,rgba(0,0,0,0.75)_100%)] pointer-events-none" />
      </div>

      {/* Left-aligned, vertically centered content — max-w-7xl + px-6 matches the header's container exactly */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 flex flex-col items-start text-left space-y-6">
        <motion.h1
          initial={{ opacity: 0, x: -60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-white font-sans drop-shadow-2xl"
        >
          <span
            className="block text-5xl sm:text-7xl md:text-8xl font-bold tracking-tight"
            style={{ letterSpacing: '-0.04em' }}
          >
            EnVault
          </span>
          <span className="block text-xl sm:text-2xl md:text-3xl font-medium tracking-wide text-white/90 mt-1">
            Management
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="text-base sm:text-lg md:text-xl text-white font-normal max-w-md sm:max-w-lg leading-relaxed font-sans drop-shadow-[0_2px_14px_rgba(0,0,0,0.95)]"
        >
          {isEn
            ? 'Your databases, backed up automatically and ready to restore whenever you need them. No scripts, no surprises.'
            : 'Tus bases de datos, respaldadas automáticamente y listas para restaurar cuando las necesites. Sin scripts ni sorpresas.'}
        </motion.p>
      </div>
    </section>
  );
});

Hero.displayName = 'Hero';

export default Hero;
