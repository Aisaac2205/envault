import React, { useState } from 'react';

interface RetentionCalculatorProps {
  locale?: string;
}

export function RetentionCalculator({ locale = 'es' }: RetentionCalculatorProps) {
  const isEn = locale === 'en';

  const [dbSizeGb, setDbSizeGb] = useState<number>(25);
  const [retentionDays, setRetentionDays] = useState<number>(30);

  // Calculations
  // Assuming 1 daily backup
  const totalDumps = retentionDays;
  const totalStorageGb = totalDumps * dbSizeGb;
  
  // Cloudflare R2: $0.015 per GB storage, 0 egress fee
  const r2StorageCost = (totalStorageGb * 0.015).toFixed(2);
  
  // AWS S3 standard egress: ~$0.09 per GB downloaded during restores
  const s3RestoreEgressCost = (dbSizeGb * 0.09).toFixed(2);

  const retentionPresets = [7, 14, 30, 90];
  const sizePresets = [5, 25, 100];

  return (
    <div
      className="w-full rounded-xl border border-white/10 bg-zinc-950/90 p-4 sm:p-5 font-sans space-y-4 shadow-inner"
      data-ui
    >
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <span className="text-[11px] font-mono text-zinc-400">
          {isEn ? 'cost_simulator' : 'simulador_costos'}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">
          {isEn ? 'zero_egress' : 'cero_egress'}
        </span>
      </div>

      {/* Preset controls */}
      <div className="space-y-3 text-xs">
        {/* Size selection */}
        <div>
          <div className="flex justify-between text-zinc-400 mb-1.5 text-[11px]">
            <span>{isEn ? 'Database size' : 'Tamaño de la base de datos'}</span>
            <span className="font-mono text-white font-semibold">{dbSizeGb} GB / dump</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {sizePresets.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setDbSizeGb(size)}
                className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
                  dbSizeGb === size
                    ? 'bg-[#bfe70a] text-zinc-950 border-[#bfe70a] font-semibold'
                    : 'bg-zinc-900/80 text-zinc-400 border-white/5 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {size} GB
              </button>
            ))}
          </div>
        </div>

        {/* Retention selection */}
        <div>
          <div className="flex justify-between text-zinc-400 mb-1.5 text-[11px]">
            <span>{isEn ? 'Retention period' : 'Periodo de retención'}</span>
            <span className="font-mono text-white font-semibold">{retentionDays} {isEn ? 'days' : 'días'}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {retentionPresets.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRetentionDays(days)}
                className={`py-1 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
                  retentionDays === days
                    ? 'bg-[#bfe70a] text-zinc-950 border-[#bfe70a] font-semibold'
                    : 'bg-zinc-900/80 text-zinc-400 border-white/5 hover:text-white hover:bg-zinc-800'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Metrics Readout */}
      <div className="rounded-lg bg-zinc-900/80 border border-white/5 p-3 space-y-2 text-xs">
        <div className="flex items-center justify-between text-zinc-300">
          <span className="text-[11px] text-zinc-400">{isEn ? 'Active snapshots' : 'Snapshots activos'}</span>
          <span className="font-mono font-medium text-white">{totalDumps} dumps ({totalStorageGb} GB)</span>
        </div>

        <div className="flex items-center justify-between text-zinc-300">
          <span className="text-[11px] text-zinc-400">{isEn ? 'R2 Egress fee per restore' : 'Costo de egress en R2'}</span>
          <span className="font-mono font-semibold text-emerald-400">$0.00 (0 egress)</span>
        </div>

        <div className="pt-2 border-t border-white/5 flex items-baseline justify-between">
          <span className="text-[11px] text-zinc-400">{isEn ? 'R2 monthly storage' : 'Almacenamiento R2'}</span>
          <span className="font-mono text-sm font-semibold text-[#bfe70a]">~${r2StorageCost} <span className="text-[10px] text-zinc-500 font-normal">/ {isEn ? 'mo' : 'mes'}</span></span>
        </div>
      </div>

      {/* Comparison badge */}
      <div className="text-[10px] text-zinc-500 font-sans leading-tight">
        {isEn
          ? `In AWS S3, restoring this dump costs ~$${s3RestoreEgressCost} extra per download. In R2 it is always $0.`
          : `En AWS S3, restaurar este dump costaría ~$${s3RestoreEgressCost} extra en egress. En R2 siempre es $0.`}
      </div>
    </div>
  );
}
