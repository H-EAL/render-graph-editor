import type { ReactNode } from 'react';

const variants: Record<string, string> = {
  raster: 'bg-blue-900/60 text-blue-300 border border-blue-700/50',
  compute: 'bg-purple-900/60 text-purple-300 border border-purple-700/50',
  transfer: 'bg-amber-900/60 text-amber-300 border border-amber-700/50',
  raytracing: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50',
  drawBatch: 'bg-sky-900/60 text-sky-300 border border-sky-700/50',
  drawBatchWithMaterials: 'bg-sky-900/60 text-sky-300 border border-sky-700/50',
  dispatchCompute: 'bg-violet-900/60 text-violet-300 border border-violet-700/50',
  dispatchRayTracing: 'bg-teal-900/60 text-teal-300 border border-teal-700/50',
  drawFullscreen: 'bg-indigo-900/60 text-indigo-300 border border-indigo-700/50',
  copyImage: 'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  blitImage: 'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  resolveImage: 'bg-orange-900/60 text-orange-300 border border-orange-700/50',
  clearImages: 'bg-red-900/60 text-red-300 border border-red-700/50',
  fillBuffer: 'bg-red-900/60 text-red-300 border border-red-700/50',
  generateMipChain: 'bg-lime-900/60 text-lime-300 border border-lime-700/50',
  viewport: 'bg-zinc-700/60 text-zinc-300 border border-zinc-600/50',
  drawDebugLines: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/50',
  default: 'bg-zinc-700/60 text-zinc-300 border border-zinc-600/50',
};

const stepTypeLabels: Record<string, string> = {
  drawBatch: 'Draw Batch',
  drawBatchWithMaterials: 'Draw+Mat',
  dispatchCompute: 'Compute',
  dispatchRayTracing: 'RayTrace',
  drawFullscreen: 'Fullscreen',
  copyImage: 'Copy',
  blitImage: 'Blit',
  resolveImage: 'Resolve',
  clearImages: 'Clear',
  fillBuffer: 'Fill',
  generateMipChain: 'MipChain',
  viewport: 'Viewport',
  drawDebugLines: 'Debug',
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
