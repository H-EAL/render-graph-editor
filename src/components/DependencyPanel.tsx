import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useEffectiveResources } from '../utils/systemResources';
import { deriveDependencies, type DependencyEdge } from '../utils/dependencyGraph';
import type { PassId, Pipeline, TimelineId } from '../types';

// ─── Layout constants ──────────────────────────────────────────────────────────

const NODE_W  = 130;           // node width (px)
const NODE_H  = 34;            // node height
const COL_GAP = 44;            // gap between node columns
const COL_W   = NODE_W + COL_GAP;
const ROW_H   = 86;            // per-timeline row height (includes inter-row space for arrows)
const LABEL_W = 150;           // left label column width
const PAD_T   = 16;
const PAD_B   = 28;
const PAD_R   = 40;

// ─── Timeline colour config ────────────────────────────────────────────────────

const TL_CFG: Record<string, {
  label: string;      // Tailwind text color for label
  wire: string;       // SVG stroke color for lane wire
  nodeBg: string;     // Tailwind classes for un-selected node
  nodeHl: string;     // Tailwind classes for selected node
}> = {
  graphics:     { label: 'text-blue-400',    wire: '#1d4ed8',
                  nodeBg: 'bg-blue-950/70 border-blue-800/70 text-zinc-200',
                  nodeHl: 'bg-blue-700/80 border-blue-400    text-white' },
  asyncCompute: { label: 'text-emerald-400', wire: '#047857',
                  nodeBg: 'bg-emerald-950/70 border-emerald-800/70 text-zinc-200',
                  nodeHl: 'bg-emerald-700/80 border-emerald-400    text-white' },
  transfer:     { label: 'text-orange-400',  wire: '#92400e',
                  nodeBg: 'bg-orange-950/70 border-orange-800/70 text-zinc-200',
                  nodeHl: 'bg-orange-700/80 border-orange-400    text-white' },
  raytracing:   { label: 'text-violet-400',  wire: '#4c1d95',
                  nodeBg: 'bg-violet-950/70 border-violet-800/70 text-zinc-200',
                  nodeHl: 'bg-violet-700/80 border-violet-400    text-white' },
  custom:       { label: 'text-zinc-400',    wire: '#3f3f46',
                  nodeBg: 'bg-zinc-800/60 border-zinc-700/70 text-zinc-200',
                  nodeHl: 'bg-zinc-600/80 border-zinc-400    text-white' },
};
const cfgFor = (type: string) => TL_CFG[type] ?? TL_CFG.custom;

// ─── Topological column assignment ────────────────────────────────────────────
//
// Each pass gets a column index based on its max dependency depth.
// Within-timeline sequential order is included as implicit constraints,
// so cross-timeline dependencies always push the dependent pass rightward.

function computePassColumns(
  pipeline: Pipeline,
  edges: DependencyEdge[],
): Map<PassId, number> {
  const allPids = pipeline.timelines.flatMap((tl) => tl.passIds);

  // Collect dependency constraints per pass
  const deps = new Map<PassId, Set<PassId>>();
  for (const pid of allPids) deps.set(pid, new Set());

  // Explicit graph edges (same-TL and cross-TL)
  for (const e of edges) deps.get(e.toPassId)?.add(e.fromPassId);

  // Implicit sequential ordering within each timeline
  for (const tl of pipeline.timelines) {
    for (let i = 1; i < tl.passIds.length; i++) {
      deps.get(tl.passIds[i])?.add(tl.passIds[i - 1]);
    }
  }

  // DFS max-depth = column index
  const col  = new Map<PassId, number>();
  const busy = new Set<PassId>();
  function depth(pid: PassId): number {
    if (col.has(pid))  return col.get(pid)!;
    if (busy.has(pid)) return 0; // cycle guard
    busy.add(pid);
    const ds = [...(deps.get(pid) ?? [])];
    const v  = ds.length === 0 ? 0 : Math.max(...ds.map(depth)) + 1;
    busy.delete(pid);
    col.set(pid, v);
    return v;
  }
  for (const pid of allPids) depth(pid);
  return col;
}

// ─── Layout record ────────────────────────────────────────────────────────────

interface PassLayout {
  passId: PassId;
  x:  number; // left edge of node box
  y:  number; // top  edge of node box
  cx: number; // center x
  cy: number; // center y
}

function useLayout(
  pipeline: Pipeline,
  edges: DependencyEdge[],
) {
  return useMemo(() => {
    const rawCols = computePassColumns(pipeline, edges);

    // Compact raw levels to sequential column indices (0, 1, 2, …)
    const sortedLevels = [...new Set(rawCols.values())].sort((a, b) => a - b);
    const levelToCol   = new Map(sortedLevels.map((l, i) => [l, i]));
    const numCols      = sortedLevels.length;

    const tlRow = new Map<TimelineId, number>(
      pipeline.timelines.map((tl, i) => [tl.id, i]),
    );

    // Pre-compute timeline type per pass for quick colour lookup
    const passTLType = new Map<PassId, string>();
    for (const tl of pipeline.timelines) {
      for (const pid of tl.passIds) passTLType.set(pid, tl.type);
    }

    const passLayouts = new Map<PassId, PassLayout>();
    for (const [pid, rawLevel] of rawCols) {
      const pass = pipeline.passes[pid];
      if (!pass) continue;
      const colIdx = levelToCol.get(rawLevel) ?? 0;
      const rowIdx = tlRow.get(pass.timelineId) ?? 0;
      const x = LABEL_W + colIdx * COL_W;
      const y = PAD_T   + rowIdx * ROW_H + (ROW_H - NODE_H) / 2;
      passLayouts.set(pid, { passId: pid, x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 });
    }

    const totalW = Math.max(LABEL_W + numCols * COL_W + PAD_R, 320);
    const totalH = PAD_T + pipeline.timelines.length * ROW_H + PAD_B;

    return { passLayouts, passTLType, numCols, totalW, totalH, tlRow };
  }, [pipeline, edges]);
}

// ─── Main panel ────────────────────────────────────────────────────────────────

export function DependencyPanel() {
  const { pipeline, selectedPassId, selectPass } = useStore();
  const resources = useEffectiveResources();
  const [filter,     setFilter]     = useState<'all' | 'cross' | 'focused'>('all');
  const [showSameTL, setShowSameTL] = useState(false);

  const allEdges = useMemo(() => deriveDependencies(pipeline), [pipeline]);

  const filteredEdges = useMemo<DependencyEdge[]>(() => {
    if (filter === 'cross') return allEdges.filter((e) => e.isCrossTimeline);
    if (filter === 'focused' && selectedPassId)
      return allEdges.filter(
        (e) => e.fromPassId === selectedPassId || e.toPassId === selectedPassId,
      );
    return allEdges;
  }, [allEdges, filter, selectedPassId]);

  /** Arrows actually drawn */
  const arrowEdges = useMemo(
    () => (showSameTL ? filteredEdges : filteredEdges.filter((e) => e.isCrossTimeline)),
    [filteredEdges, showSameTL],
  );

  /** Passes that participate in current filter (others are dimmed) */
  const involvedPasses = useMemo(() => {
    const s = new Set<PassId>();
    filteredEdges.forEach((e) => { s.add(e.fromPassId); s.add(e.toPassId); });
    return s;
  }, [filteredEdges]);

  const layout = useLayout(pipeline, allEdges);

  // Resource name lookup helpers
  const rtNames  = useMemo(() => new Map(resources.renderTargets.map((r) => [r.id, r.name])), [resources]);
  const bufNames = useMemo(() => new Map(resources.buffers.map((b) => [b.id, b.name])),        [resources]);
  const resolveIds = (ids: string[]) =>
    ids.map((id) => rtNames.get(id) ?? bufNames.get(id) ?? id).join(', ');

  const crossCount  = allEdges.filter((e) => e.isCrossTimeline).length;
  const sameTLCount = allEdges.length - crossCount;

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-700/40 shrink-0 flex-wrap">
        <span className="text-xs text-zinc-500">{allEdges.length} edges</span>
        {crossCount > 0 && (
          <span className="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-700/40 rounded px-1.5 py-0.5 font-mono">
            {crossCount} cross-TL
          </span>
        )}

        <button
          onClick={() => setShowSameTL((v) => !v)}
          title="Toggle same-timeline arrows (ordering is already visible in column position)"
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors font-mono
            ${showSameTL
              ? 'border-zinc-500 bg-zinc-700 text-zinc-200'
              : 'border-zinc-700/60 text-zinc-600 hover:text-zinc-400'}`}
        >
          same-TL arrows ({sameTLCount})
        </button>

        {/* Legend */}
        <div className="flex items-center gap-3 ml-1">
          <div className="flex items-center gap-1.5">
            <svg width="22" height="10" style={{ overflow: 'visible' }}>
              <line x1="0" y1="5" x2="16" y2="5" stroke="#3f3f46" strokeWidth="1.5" />
              <polygon points="16,3 21,5 16,7" fill="#3f3f46" />
            </svg>
            <span className="text-[10px] text-zinc-600">same-TL</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="22" height="10" style={{ overflow: 'visible' }}>
              <line x1="0" y1="5" x2="16" y2="5" stroke="#9333ea" strokeWidth="2" />
              <polygon points="16,3 21,5 16,7" fill="#9333ea" />
            </svg>
            <span className="text-[10px] text-zinc-600">cross-TL sync</span>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5 border border-zinc-700 rounded overflow-hidden">
          {(['all', 'cross', 'focused'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-[10px] font-medium transition-colors
                ${filter === f ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {f === 'all' ? 'All' : f === 'cross' ? 'Cross-TL' : 'Focused'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Canvas ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto bg-zinc-950/30">
        <div
          className="relative"
          style={{ width: layout.totalW, height: layout.totalH, minWidth: '100%', minHeight: '100%' }}
        >
          {/* SVG: lane backgrounds, wires, arrows */}
          <svg
            className="absolute inset-0"
            width={layout.totalW}
            height={layout.totalH}
            style={{ pointerEvents: 'none', overflow: 'visible' }}
          >
            <defs>
              {(['gray', 'gray-hi', 'purple', 'purple-hi'] as const).map((id) => {
                const fill = id === 'gray' ? '#3f3f46' : id === 'gray-hi' ? '#71717a'
                           : id === 'purple' ? '#9333ea' : '#c084fc';
                return (
                  <marker key={id} id={`dp-${id}`}
                    markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                    <polygon points="0 0, 7 2.5, 0 5" fill={fill} />
                  </marker>
                );
              })}
            </defs>

            {/* Lane separator */}
            <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={layout.totalH}
              stroke="#27272a" strokeWidth={1} />

            {/* Per-timeline row background + wire */}
            {pipeline.timelines.map((tl, i) => {
              const cfg  = cfgFor(tl.type);
              const rowY = PAD_T + i * ROW_H;
              const wireY = rowY + ROW_H / 2;
              return (
                <g key={tl.id}>
                  <rect
                    x={LABEL_W} y={rowY}
                    width={layout.totalW - LABEL_W} height={ROW_H}
                    fill={i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'}
                  />
                  <line
                    x1={LABEL_W} y1={wireY}
                    x2={layout.totalW - PAD_R / 2} y2={wireY}
                    stroke={cfg.wire} strokeWidth={1.5}
                    strokeDasharray="6 10" opacity={0.3}
                  />
                </g>
              );
            })}

            {/* Arrows — all go left-to-right due to topological column layout */}
            {arrowEdges.map((edge) => {
              const from = layout.passLayouts.get(edge.fromPassId);
              const to   = layout.passLayouts.get(edge.toPassId);
              if (!from || !to) return null;

              const isCross   = edge.isCrossTimeline;
              const isFocused = !!selectedPassId &&
                (edge.fromPassId === selectedPassId || edge.toPassId === selectedPassId);

              const stroke   = isCross ? (isFocused ? '#c084fc' : '#9333ea')
                                       : (isFocused ? '#71717a' : '#3f3f46');
              const strokeW  = isCross ? (isFocused ? 2.5 : 2) : (isFocused ? 1.5 : 1);
              const opacity  = isFocused ? 1 : isCross ? 0.80 : 0.45;
              const markerId = isCross
                ? (isFocused ? 'dp-purple-hi' : 'dp-purple')
                : (isFocused ? 'dp-gray-hi'   : 'dp-gray');

              // Exit right-center of source → enter left-center of target
              // x2 is always > x1 because of topological ordering
              const x1 = from.x + NODE_W + 2;
              const y1 = from.cy;
              const x2 = to.x - 2;
              const y2 = to.cy;
              const dx = Math.max(16, (x2 - x1) * 0.45);

              return (
                <path
                  key={edge.id}
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeW}
                  opacity={opacity}
                  markerEnd={`url(#${markerId})`}
                >
                  <title>{resolveIds(edge.resourceIds)}</title>
                </path>
              );
            })}
          </svg>

          {/* Timeline labels */}
          {pipeline.timelines.map((tl, i) => {
            const cfg = cfgFor(tl.type);
            return (
              <div
                key={tl.id}
                className="absolute flex flex-col items-end justify-center pr-3"
                style={{ left: 0, top: PAD_T + i * ROW_H, width: LABEL_W - 4, height: ROW_H }}
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.label}`}>
                  {tl.name}
                </span>
                <span className="text-[9px] text-zinc-600 font-mono">{tl.type}</span>
              </div>
            );
          })}

          {/* Pass nodes (rendered on top of SVG so arrows go behind) */}
          {[...layout.passLayouts.values()].map(({ passId, x, y }) => {
            const pass    = pipeline.passes[passId];
            if (!pass) return null;

            const tlType     = layout.passTLType.get(passId) ?? 'custom';
            const cfg        = cfgFor(tlType);
            const isSelected = passId === selectedPassId;
            const isInvolved = involvedPasses.size === 0 || involvedPasses.has(passId);

            const tooltip = [
              pass.reads.length  ? 'reads:  ' + resolveIds(pass.reads)  : '',
              pass.writes.length ? 'writes: ' + resolveIds(pass.writes) : '',
            ].filter(Boolean).join('\n') || pass.name;

            return (
              <button
                key={passId}
                onClick={() => selectPass(passId)}
                title={tooltip}
                className={`
                  absolute flex items-center gap-1.5 px-2.5 rounded border
                  text-xs font-medium transition-all whitespace-nowrap overflow-hidden
                  ${isSelected
                    ? `${cfg.nodeHl} shadow-lg`
                    : isInvolved
                      ? `${cfg.nodeBg} hover:brightness-125`
                      : 'bg-zinc-900/40 border-zinc-800/40 text-zinc-600 opacity-35 hover:opacity-60'}
                `}
                style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              >
                <span className="truncate flex-1 text-left">{pass.name}</span>
                {!pass.enabled && (
                  <span className="text-[9px] italic text-zinc-500 shrink-0">off</span>
                )}
                {pass.conditions.length > 0 && (
                  <span className="text-[8px] text-amber-500/70 shrink-0">
                    [{pass.conditions.length}]
                  </span>
                )}
              </button>
            );
          })}

          {pipeline.timelines.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
              No timelines defined.
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {(filter !== 'all' || !showSameTL) && (
        <div className="shrink-0 px-3 py-1 border-t border-zinc-800/60 text-[10px] text-zinc-600 flex gap-3">
          {filter !== 'all' && (
            <span>Showing {filteredEdges.length} / {allEdges.length} edges</span>
          )}
          {filter === 'focused' && !selectedPassId && (
            <span className="text-amber-600/70">select a pass to focus</span>
          )}
          {!showSameTL && sameTLCount > 0 && (
            <span>{sameTLCount} same-TL arrows hidden — position implies order</span>
          )}
        </div>
      )}
    </div>
  );
}
