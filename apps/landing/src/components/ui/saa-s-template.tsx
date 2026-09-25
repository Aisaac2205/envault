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
            sourcePhoto="/ascii-editor/demos/generated/ref-029.webp"
            config={{
              renderMode: 'characters',
              bgMode: 'original',
              bgOpacity: 65,
              cellSize: 8,
              contrast: 130,
              brightness: 15,
              tint: '#fafafa',
              animated: true,
              animStyle: 'pulse',
            }}
            interactive={false}
          />
        )}
        {/* Radial vignette for overall depth */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.25)_50%,rgba(0,0,0,0.85)_100%)] pointer-events-none" />
        {/* Left-side scrim: the text now lives on the left, darken that zone specifically so it reads clearly */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.8)_0%,rgba(0,0,0,0.4)_45%,rgba(0,0,0,0)_75%)] pointer-events-none" />
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
          <span className="block text-xl sm:text-2xl md:text-3xl font-medium tracking-wide text-white/80 mt-1">
            Management
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="text-base sm:text-lg md:text-xl text-zinc-200 font-normal max-w-md sm:max-w-lg leading-relaxed font-sans"
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
