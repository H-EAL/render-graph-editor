import type { ResourceLibrary, TextureFormat, Pipeline, Pass } from '../types';
import { collectValueSourceResourceIds } from './valueSource';

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

function resolveSize(expr: number | string, vp: ViewportSize, axis: 'w' | 'h'): number {
  if (typeof expr === 'number') {
    // Legacy schema: 0 = full viewport, 0 < v < 1 = fraction of viewport
    if (expr === 0) return vp[axis];
    if (expr > 0 && expr < 1) return Math.round(vp[axis] * expr);
    return expr;
  }
  const s = expr.trim();
  if (s === 'viewport.width')  return vp.w;
  if (s === 'viewport.height') return vp.h;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Collect every resource ID referenced by a pass, including all nested
 * step reads/writes (handles ifBlock/enableIf branches recursively).
 */
function collectPassResourceIds(
  pass: Pass,
  allSteps: Pipeline['steps'],
  validIds: Set<string>,
): Set<string> {
  const out = new Set<string>();

  const addIfValid = (id: string) => { if (validIds.has(id)) out.add(id); };

  // Pass-level reads/writes (populated by the importer)
  for (const id of [...(pass.reads ?? []), ...(pass.writes ?? [])]) addIfValid(id);

  // Walk the full step tree so user-created passes are covered too
  function walkSteps(stepIds: string[]) {
    for (const sid of stepIds) {
      const step = allSteps[sid];
      if (!step) continue;
      for (const id of [...(step.reads ?? []), ...(step.writes ?? [])]) addIfValid(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = step as any;
      // Collect shader binding resource IDs (compute / RT / decals steps)
      if (s.shaderBindings) {
        for (const id of Object.values(s.shaderBindings as Record<string, string>)) addIfValid(id);
      }
      // Collect per-command shader binding resource IDs (raster steps)
      if (Array.isArray(s.commands)) {
        for (const cmd of s.commands as Array<{ shaderBindings?: Record<string, string> }>) {
          if (cmd.shaderBindings) {
            for (const id of Object.values(cmd.shaderBindings)) addIfValid(id);
          }
        }
      }
      // fieldSelectors can override shaderBindings with ValueSource trees; collect all resource leaves
      if (s.fieldSelectors) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const vs of Object.values(s.fieldSelectors as Record<string, any>)) {
          for (const id of collectValueSourceResourceIds(vs)) addIfValid(id);
        }
      }
      if (s.thenSteps) walkSteps(s.thenSteps as string[]);
      if (s.elseSteps) walkSteps(s.elseSteps as string[]);
    }
  }
  walkSteps([...(pass.steps ?? []), ...(pass.disabledSteps ?? [])]);

  return out;
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
  sampleCount: number;
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

export interface RTLifetime {
  rtId: string;
  name: string;
  bytes: number;
  first: number;  // first pass index (inclusive)
  last: number;   // last pass index (inclusive)
  slot: number;   // aliasing slot: RTs in the same slot are non-overlapping and can share memory
}

export interface AliasingStats {
  /** Minimum RT memory needed if non-overlapping RTs reuse the same allocation (lower bound). */
  peakBytes: number;
  /** Bytes saved vs naive sum-of-all. */
  savedBytes: number;
  /** Savings as a percentage of the naive RT total. */
  savingsPct: number;
  /** Memory profile: total active RT bytes at each pass index. */
  passMemory: number[];
  /** Ordered pass names (X axis). */
  passNames: string[];
  /** Per-RT lifetime intervals with slot assignments. */
  rtLifetimes: RTLifetime[];
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
  /** null when there are no timelines/passes to derive lifetimes from. */
  aliasing: AliasingStats | null;
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeMemStats(
  resources: ResourceLibrary,
  pipeline: Pipeline,
  vp: ViewportSize,
): PipelineMemStats {

  const renderTargets: RTMemStat[] = resources.renderTargets.map((rt) => {
    const w   = resolveSize(rt.width,  vp, 'w');
    const h   = resolveSize(rt.height, vp, 'h');
    const bpp = FORMAT_BPP[rt.format] ?? 4;
    const samples = rt.sampleCount ?? 1;
    const bytes = Math.ceil(w * h * bpp * mipChainFactor(rt.mips) * (rt.layers ?? 1) * samples);
    const isViewportScaled = typeof rt.width === 'string' || typeof rt.height === 'string';
    return { id: rt.id, name: rt.name, format: rt.format, width: w, height: h, mips: rt.mips, layers: rt.layers ?? 1, sampleCount: samples, bytes, isViewportScaled };
  });

  const buffers: BufMemStat[] = resources.buffers.map((buf) => {
    const bytes = typeof buf.size === 'number' ? buf.size : (parseInt(String(buf.size), 10) || 0);
    return { id: buf.id, name: buf.name, bytes };
  });

  const rtTotalBytes  = renderTargets.reduce((s, r) => s + r.bytes, 0);
  const bufTotalBytes = buffers.reduce((s, b) => s + b.bytes, 0);

  // ── Memory aliasing estimate ──────────────────────────────────────────────
  // For each RT, find its lifetime [firstPassIdx, lastPassIdx] in execution order.
  // Then compute peak simultaneously-resident RT memory across all pass boundaries.
  // This "peak" is the theoretical minimum achievable with perfect aliasing.
  let aliasing: AliasingStats | null = null;
  const passOrder = pipeline.timelines.flatMap((tl) => tl.passIds);
  if (passOrder.length > 0 && renderTargets.length > 0) {
    const rtBytesById = new Map(renderTargets.map((r) => [r.id, r.bytes]));
    const validRtIds = new Set(renderTargets.map((r) => r.id));

    // Build RT lifetime intervals from full pass+step resource usage
    const lifetimes = new Map<string, [number, number]>(); // rtId → [first, last]
    for (let i = 0; i < passOrder.length; i++) {
      const pass = pipeline.passes[passOrder[i]];
      if (!pass) continue;
      const usedIds = collectPassResourceIds(pass, pipeline.steps, validRtIds);
      for (const rid of usedIds) {
        const cur = lifetimes.get(rid);
        if (!cur) lifetimes.set(rid, [i, i]);
        else lifetimes.set(rid, [Math.min(cur[0], i), Math.max(cur[1], i)]);
      }
    }

    // Pass memory profile + peak
    const passMemory: number[] = [];
    let peakBytes = 0;
    for (let i = 0; i < passOrder.length; i++) {
      let active = 0;
      for (const [rid, [first, last]] of lifetimes) {
        if (i >= first && i <= last) active += rtBytesById.get(rid) ?? 0;
      }
      passMemory.push(active);
      if (active > peakBytes) peakBytes = active;
    }

    // Greedy interval coloring: assign each RT to a memory slot
    // RTs in the same slot have non-overlapping lifetimes → can share GPU memory.
    const rtNameById = new Map(renderTargets.map((r) => [r.id, r.name]));
    const sortedRTs = [...lifetimes.entries()]
      .map(([rtId, [first, last]]) => ({ rtId, first, last, bytes: rtBytesById.get(rtId) ?? 0 }))
      .sort((a, b) => a.first - b.first || b.bytes - a.bytes);

    const slotEnds: number[] = []; // slotEnds[i] = last pass index of the most recent RT in slot i
    const rtSlots = new Map<string, number>();
    for (const rt of sortedRTs) {
      // Find the slot whose last RT ended before this one starts (prefer latest-ending to pack tightly)
      let bestSlot = -1;
      for (let i = 0; i < slotEnds.length; i++) {
        if (slotEnds[i] < rt.first && (bestSlot === -1 || slotEnds[i] > slotEnds[bestSlot])) {
          bestSlot = i;
        }
      }
      if (bestSlot >= 0) {
        slotEnds[bestSlot] = rt.last;
        rtSlots.set(rt.rtId, bestSlot);
      } else {
        rtSlots.set(rt.rtId, slotEnds.length);
        slotEnds.push(rt.last);
      }
    }

    const rtLifetimes: RTLifetime[] = sortedRTs.map((rt) => ({
      rtId: rt.rtId,
      name: rtNameById.get(rt.rtId) ?? rt.rtId,
      bytes: rt.bytes,
      first: rt.first,
      last: rt.last,
      slot: rtSlots.get(rt.rtId) ?? 0,
    }));

    const passNames = passOrder.map((pid) => pipeline.passes[pid]?.name ?? pid);
    const savedBytes = rtTotalBytes - peakBytes;
    const savingsPct = rtTotalBytes > 0 ? (savedBytes / rtTotalBytes) * 100 : 0;
    aliasing = { peakBytes, savedBytes, savingsPct, passMemory, passNames, rtLifetimes };
  }

  // Pipeline overview
  const passes = Object.values(pipeline.passes);
  let conditional = 0;
  for (const p of passes) {
    if (p.conditions.length > 0) conditional++;
  }
  const byKind: Record<string, number> = {};

  // Count only shaders actually referenced by pipeline steps
  const shaderById = new Map(resources.shaders.map((sh) => [sh.id, sh]));
  const usedShaderIds = new Set<string>();

  function collectStepShaders(stepIds: string[]) {
    for (const sid of stepIds) {
      const step = pipeline.steps[sid];
      if (!step) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = step as any;
      if (s.shader)           usedShaderIds.add(s.shader);
      if (s.raygenShader)     usedShaderIds.add(s.raygenShader);
      if (s.missShader)       usedShaderIds.add(s.missShader);
      if (s.closestHitShader) usedShaderIds.add(s.closestHitShader);
      if (Array.isArray(s.commands)) {
        for (const cmd of s.commands as Array<{ shader?: string }>) {
          if (cmd.shader) usedShaderIds.add(cmd.shader);
        }
      }
      if (s.thenSteps) collectStepShaders(s.thenSteps as string[]);
      if (s.elseSteps) collectStepShaders(s.elseSteps as string[]);
    }
  }

  for (const pass of passes) {
    collectStepShaders([...(pass.steps ?? []), ...(pass.disabledSteps ?? [])]);
  }

  const shadersByStage: Record<string, number> = {};
  for (const id of usedShaderIds) {
    const sh = shaderById.get(id);
    if (!sh) continue;
    shadersByStage[sh.stage] = (shadersByStage[sh.stage] ?? 0) + 1;
  }

  return {
    renderTargets,
    buffers,
    totalBytes: rtTotalBytes + bufTotalBytes,
    rtTotalBytes,
    bufTotalBytes,
    aliasing,
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
