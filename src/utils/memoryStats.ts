import type { ResourceLibrary, TextureFormat, Pipeline } from '../types';

// ─── Viewport ─────────────────────────────────────────────────────────────────

export interface ViewportSize { w: number; h: number }

export const VIEWPORT_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '720p',  w: 1280,  h: 720  },
  { label: '1080p', w: 1920,  h: 1080 },
  { label: '1440p', w: 2560,  h: 1440 },
  { label: '4K',    w: 3840,  h: 2160 },
];

// ─── Format → bytes per pixel ─────────────────────────────────────────────────

const FORMAT_BPP: Record<TextureFormat, number> = {
  rgba8:       4,
  rgba16f:     8,
  rgba32f:    16,
  r11g11b10f:  4,
  rg16f:       4,
  r32f:        4,
  d32f:        4,
  d24s8:       4,
  bc1:         0.5,   // 8 bytes / 4×4 block
  bc3:         1,     // 16 bytes / 4×4 block
  bc5:         1,
  bc7:         1,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveSize(expr: number | string, vp: ViewportSize): number {
  if (typeof expr === 'number') return expr;
  const s = String(expr).trim();
  if (s === 'viewport.width')  return vp.w;
  if (s === 'viewport.height') return vp.h;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function mipChainFactor(mips: number): number {
  // sum_{i=0}^{mips-1} (1/4)^i
  let sum = 0;
  for (let i = 0; i < mips; i++) sum += Math.pow(0.25, i);
  return sum;
}

// ─── Stat types ───────────────────────────────────────────────────────────────

export interface RTMemStat {
  id: string;
  name: string;
  format: TextureFormat;
  width: number;
  height: number;
  mips: number;
  layers: number;
  bytes: number;
  isViewportScaled: boolean;
}

export interface BufMemStat {
  id: string;
  name: string;
  bytes: number;
}

export interface PassOverview {
  total: number;
  enabled: number;
  conditional: number;
  byKind: Record<string, number>;
}

export interface PipelineMemStats {
  renderTargets: RTMemStat[];
  buffers: BufMemStat[];
  totalBytes: number;
  rtTotalBytes: number;
  bufTotalBytes: number;
  passOverview: PassOverview;
  timelineCount: number;
  stepCount: number;
  shadersByStage: Record<string, number>;
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeMemStats(
  resources: ResourceLibrary,
  pipeline: Pipeline,
  vp: ViewportSize,
): PipelineMemStats {

  const renderTargets: RTMemStat[] = resources.renderTargets.map((rt) => {
    const w   = resolveSize(rt.width,  vp);
    const h   = resolveSize(rt.height, vp);
    const bpp = FORMAT_BPP[rt.format] ?? 4;
    const bytes = Math.ceil(w * h * bpp * mipChainFactor(rt.mips) * (rt.layers ?? 1));
    const isViewportScaled = typeof rt.width === 'string' || typeof rt.height === 'string';
    return { id: rt.id, name: rt.name, format: rt.format, width: w, height: h, mips: rt.mips, layers: rt.layers ?? 1, bytes, isViewportScaled };
  });

  const buffers: BufMemStat[] = resources.buffers.map((buf) => {
    const bytes = typeof buf.size === 'number' ? buf.size : (parseInt(String(buf.size), 10) || 0);
    return { id: buf.id, name: buf.name, bytes };
  });

  const rtTotalBytes  = renderTargets.reduce((s, r) => s + r.bytes, 0);
  const bufTotalBytes = buffers.reduce((s, b) => s + b.bytes, 0);

  // Pipeline overview
  const passes = Object.values(pipeline.passes);
  let conditional = 0;
  for (const p of passes) {
    if (p.conditions.length > 0) conditional++;
  }
  const byKind: Record<string, number> = {};

  const shadersByStage: Record<string, number> = {};
  for (const sh of resources.shaders) {
    shadersByStage[sh.stage] = (shadersByStage[sh.stage] ?? 0) + 1;
  }

  return {
    renderTargets,
    buffers,
    totalBytes: rtTotalBytes + bufTotalBytes,
    rtTotalBytes,
    bufTotalBytes,
    passOverview: {
      total:       passes.length,
      enabled:     passes.filter((p) => p.enabled).length,
      conditional,
      byKind,
    },
    timelineCount: pipeline.timelines.length,
    stepCount:     Object.keys(pipeline.steps).length,
    shadersByStage,
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024)        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024)               return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
