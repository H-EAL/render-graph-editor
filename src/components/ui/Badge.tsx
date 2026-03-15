import type { ReactNode } from 'react';

const variants: Record<string, string> = {
  // Step types
  raster:             'bg-blue-900/60 text-blue-300 border border-blue-700/50',
  dispatchCompute:    'bg-violet-900/60 text-violet-300 border border-violet-700/50',
  dispatchRayTracing: 'bg-teal-900/60 text-teal-300 border border-teal-700/50',
  copyImage:          'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  blitImage:          'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  resolveImage:       'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  clearImages:        'bg-red-900/60 text-red-300 border border-red-700/50',
  fillBuffer:         'bg-red-900/60 text-red-300 border border-red-700/50',
  generateMipChain:   'bg-lime-900/60 text-lime-300 border border-lime-700/50',
  // Fallback
  default: 'bg-zinc-700/60 text-zinc-300 border border-zinc-600/50',
};

const stepTypeLabels: Record<string, string> = {
  raster:             'Raster',
  dispatchCompute:    'Compute',
  dispatchRayTracing: 'RayTrace',
  copyImage:          'Copy',
  blitImage:          'Blit',
  resolveImage:       'Resolve',
  clearImages:        'Clear',
  fillBuffer:         'Fill',
  generateMipChain:   'MipChain',
};

interface BadgeProps {
  value: string;
  className?: string;
  children?: ReactNode;
}

export function Badge({ value, className = '' }: BadgeProps) {
  const cls = variants[value] ?? variants.default;
  const label = stepTypeLabels[value] ?? value;
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${cls} ${className}`}>
      {label}
    </span>
  );
}
