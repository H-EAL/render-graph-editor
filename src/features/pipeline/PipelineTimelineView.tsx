import { useMemo, useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useStore } from '../../state/store';
import { deriveDependencies, getResourceUsage, type DependencyEdge } from '../../utils/dependencyGraph';
import { derivePassAccess } from '../../utils/resourceOverlay';
import type { PassId, Pipeline, TimelineId, TimelineType } from '../../types';

// ─── Layout constants ──────────────────────────────────────────────────────────

const NODE_W    = 132;
const NODE_H    = 36;
const BAR_H     = 24;   // action-bar height above the node
const COL_GAP   = 44;
const COL_W     = NODE_W + COL_GAP;
const ROW_H     = 92;
const LABEL_W   = 152;
const PAD_T     = 14;
const PAD_B     = 20;
const ADD_W     = 80;
const OVERLAY_H = 26;

// ─── Timeline colour config ────────────────────────────────────────────────────

const TL_CFG: Record<string, { label: string; wire: string; nodeBg: string; nodeHl: string }> = {
  graphics:     { label: 'text-blue-400',    wire: '#1d4ed8',
                  nodeBg: 'bg-blue-950/70 border-blue-800/70 text-zinc-200',
                  nodeHl: 'bg-blue-700/80 border-blue-400 text-white' },
  asyncCompute: { label: 'text-emerald-400', wire: '#047857',
                  nodeBg: 'bg-emerald-950/70 border-emerald-800/70 text-zinc-200',
                  nodeHl: 'bg-emerald-700/80 border-emerald-400 text-white' },
  transfer:     { label: 'text-orange-400',  wire: '#92400e',
                  nodeBg: 'bg-orange-950/70 border-orange-800/70 text-zinc-200',
                  nodeHl: 'bg-orange-700/80 border-orange-400 text-white' },
  raytracing:   { label: 'text-violet-400',  wire: '#4c1d95',
                  nodeBg: 'bg-violet-950/70 border-violet-800/70 text-zinc-200',
                  nodeHl: 'bg-violet-700/80 border-violet-400 text-white' },
  custom:       { label: 'text-zinc-400',    wire: '#3f3f46',
                  nodeBg: 'bg-zinc-800/60 border-zinc-700/70 text-zinc-200',
                  nodeHl: 'bg-zinc-600/80 border-zinc-400 text-white' },
};
const cfgFor = (type: string) => TL_CFG[type] ?? TL_CFG.custom;

const TL_TYPE_OPTS: { value: TimelineType; label: string }[] = [
  { value: 'graphics',     label: 'Graphics' },
  { value: 'asyncCompute', label: 'Async Compute' },
  { value: 'transfer',     label: 'Transfer' },
  { value: 'raytracing',   label: 'Ray Tracing' },
  { value: 'custom',       label: 'Custom' },
];

// ─── Topological column assignment ────────────────────────────────────────────

function computePassColumns(pipeline: Pipeline, edges: DependencyEdge[]): Map<PassId, number> {
  const allPids = pipeline.timelines.flatMap((tl) => tl.passIds);
  const deps = new Map<PassId, Set<PassId>>();
  for (const pid of allPids) deps.set(pid, new Set());
  for (const e of edges) deps.get(e.toPassId)?.add(e.fromPassId);
  for (const tl of pipeline.timelines)
    for (let i = 1; i < tl.passIds.length; i++) deps.get(tl.passIds[i])?.add(tl.passIds[i - 1]);

  const col = new Map<PassId, number>();
  const busy = new Set<PassId>();
  function depth(pid: PassId): number {
    if (col.has(pid)) return col.get(pid)!;
    if (busy.has(pid)) return 0;
    busy.add(pid);
    const ds = [...(deps.get(pid) ?? [])];
    const v = ds.length === 0 ? 0 : Math.max(...ds.map(depth)) + 1;
    busy.delete(pid);
    col.set(pid, v);
    return v;
  }
  for (const pid of allPids) depth(pid);
  return col;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

interface PassLayout { passId: PassId; x: number; y: number; cx: number; cy: number; row: number; }

function useLayout(pipeline: Pipeline, edges: DependencyEdge[], overlayCount: number) {
  return useMemo(() => {
    const rawCols = computePassColumns(pipeline, edges);
    const sorted  = [...new Set(rawCols.values())].sort((a, b) => a - b);
    const lvlToCol = new Map(sorted.map((l, i) => [l, i]));

    const tlRow = new Map<TimelineId, number>(pipeline.timelines.map((tl, i) => [tl.id, i]));
    const passTLType = new Map<PassId, string>();
    for (const tl of pipeline.timelines) for (const pid of tl.passIds) passTLType.set(pid, tl.type);

    const passLayouts = new Map<PassId, PassLayout>();
    for (const [pid, rawLevel] of rawCols) {
      const pass = pipeline.passes[pid];
      if (!pass) continue;
      const colIdx = lvlToCol.get(rawLevel) ?? 0;
      const rowIdx = tlRow.get(pass.timelineId) ?? 0;
      const x = colIdx * COL_W;
      const y = PAD_T + rowIdx * ROW_H + (ROW_H - NODE_H) / 2;
      passLayouts.set(pid, { passId: pid, x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2, row: rowIdx });
    }

    const addPassX = new Map<TimelineId, number>();
    for (const tl of pipeline.timelines) {
      let maxX = COL_GAP / 2;
      for (const pid of tl.passIds) {
        const pl = passLayouts.get(pid);
        if (pl) maxX = Math.max(maxX, pl.x + NODE_W + COL_GAP / 2);
      }
      addPassX.set(tl.id, maxX);
    }

    const rightEdge = Math.max(...[...addPassX.values()].map((x) => x + ADD_W + 16), sorted.length * COL_W + 16, 320);
    const totalW    = rightEdge;
    const baseH     = PAD_T + pipeline.timelines.length * ROW_H + PAD_B;
    const overlayY  = PAD_T + pipeline.timelines.length * ROW_H + 8;
    const totalH    = overlayCount > 0 ? overlayY + overlayCount * OVERLAY_H + 8 : baseH;

    return { passLayouts, passTLType, totalW, totalH, addPassX, overlayY };
  }, [pipeline, edges, overlayCount]);
}

// ─── Drag state ───────────────────────────────────────────────────────────────

interface DragState {
  passId: PassId;
  tlId: TimelineId;
  nodeX: number;    // original node left
  offsetX: number;  // mouseX relative to node left at drag start
  mouseX: number;   // current mouse x relative to scroll-container
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PipelineTimelineView() {
  const {
    pipeline, resources, selectedPassId, selectedResourceId, pinnedResourceIds,
    selectPass, selectResource, pinResource, unpinResource,
    addPass, deletePass, duplicatePass, updatePass,
    addTimeline, deleteTimeline, updateTimeline,
    movePassToTimeline, reorderPassesInTimeline,
  } = useStore();

  const [showSameTL,   setShowSameTL]  = useState(false);
  const [showAddMenu,  setShowAddMenu] = useState(false);
  const [editPassId,   setEditPassId]  = useState<PassId | null>(null);
  const [editPassName, setEditPassName] = useState('');
  const [editTlId,     setEditTlId]    = useState<TimelineId | null>(null);
  const [editTlName,   setEditTlName]  = useState('');
  const [movePassId,   setMovePassId]  = useState<PassId | null>(null);
  const [movePos,      setMovePos]     = useState({ x: 0, y: 0 });
  const [drag,         setDrag]        = useState<DragState | null>(null);
  const [dropIdx,      setDropIdx]     = useState<number | null>(null);
  const [hoveredEdge,  setHoveredEdge] = useState<string | null>(null);

  const addMenuRef = useRef<HTMLDivElement>(null);
  const moveRef    = useRef<HTMLDivElement>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const labelsRef  = useRef<HTMLDivElement>(null);

  // Sync vertical scroll bidirectionally between canvas and labels
  useEffect(() => {
    const canvas = scrollRef.current;
    const labels = labelsRef.current;
    if (!canvas || !labels) return;
    let syncing = false;
    const syncFrom = (source: HTMLElement, target: HTMLElement) => () => {
      if (syncing) return;
      syncing = true;
      target.scrollTop = source.scrollTop;
      syncing = false;
    };
    const canvasScroll = syncFrom(canvas, labels);
    const labelsScroll = syncFrom(labels, canvas);
    canvas.addEventListener('scroll', canvasScroll, { passive: true });
    labels.addEventListener('scroll', labelsScroll, { passive: true });
    return () => {
      canvas.removeEventListener('scroll', canvasScroll);
      labels.removeEventListener('scroll', labelsScroll);
    };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
      if (moveRef.current    && !moveRef.current.contains(e.target as Node))    setMovePassId(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const allEdges   = useMemo(() => deriveDependencies(pipeline), [pipeline]);
  const arrowEdges = useMemo(
    () => (showSameTL ? allEdges : allEdges.filter((e) => e.isCrossTimeline)),
    [allEdges, showSameTL],
  );

  const rtNames  = useMemo(() => new Map(resources.renderTargets.map((r) => [r.id, r.name])), [resources]);
  const bufNames = useMemo(() => new Map(resources.buffers.map((b) => [b.id, b.name])),        [resources]);

  // Overlay rows: pinned resources + transient selected (if not already pinned)
  const overlayRows = useMemo(() => {
    const rows = [...pinnedResourceIds];
    if (selectedResourceId && !pinnedResourceIds.includes(selectedResourceId)) rows.push(selectedResourceId);
    return rows;
  }, [pinnedResourceIds, selectedResourceId]);

  const layout = useLayout(pipeline, allEdges, overlayRows.length);

  // Per-row access maps
  const overlayAccessMaps = useMemo(
    () => overlayRows.map((rid) => ({ rid, map: derivePassAccess(rid, pipeline) })),
    [overlayRows, pipeline],
  );

  // Resources written but never read
  const deadWriteIds = useMemo(() => {
    const usageMap = getResourceUsage(pipeline);
    const dead = new Set<string>();
    for (const [rid, usage] of usageMap) {
      if (usage.writers.length > 0 && usage.readers.length === 0) dead.add(rid);
    }
    return dead;
  }, [pipeline]);
  const resolveIds = (ids: string[]) => ids.map((id) => rtNames.get(id) ?? bufNames.get(id) ?? id).join(', ');

  // ── Pass rename ────────────────────────────────────────────────────────────
  const startRenamePass = (passId: PassId, name: string, e: React.MouseEvent) => {
    e.stopPropagation(); setEditPassId(passId); setEditPassName(name);
  };
  const commitRenamePass = () => {
    if (editPassId && editPassName.trim()) updatePass(editPassId, { name: editPassName.trim() });
    setEditPassId(null);
  };

  // ── Timeline rename ────────────────────────────────────────────────────────
  const startRenameTl = (tlId: TimelineId, name: string, e: React.MouseEvent) => {
    e.stopPropagation(); setEditTlId(tlId); setEditTlName(name);
  };
  const commitRenameTl = () => {
    if (editTlId && editTlName.trim()) updateTimeline(editTlId, { name: editTlName.trim() });
    setEditTlId(null);
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDeletePass = (passId: PassId, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete pass "${name}"?`)) deletePass(passId);
  };
  const handleDeleteTl = (tlId: TimelineId, name: string, passCount: number) => {
    if (passCount > 0 && !window.confirm(`Delete timeline "${name}" and its ${passCount} pass(es)?`)) return;
    deleteTimeline(tlId);
  };

  // ── Move dropdown ──────────────────────────────────────────────────────────
  const openMove = (passId: PassId, x: number, y: number, e: React.MouseEvent) => {
    e.stopPropagation(); setMovePassId(passId); setMovePos({ x, y });
  };

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  const containerMouseX = useCallback((clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return clientX;
    return clientX - el.getBoundingClientRect().left + el.scrollLeft;
  }, []);

  const computeDropIndex = useCallback((mouseX: number, draggingId: PassId, tlId: TimelineId): number => {
    const tl = pipeline.timelines.find((t) => t.id === tlId);
    if (!tl) return 0;
    const siblings = tl.passIds
      .filter((pid) => pid !== draggingId)
      .map((pid) => layout.passLayouts.get(pid)?.x ?? 0)
      .sort((a, b) => a - b);
    for (let i = 0; i < siblings.length; i++) {
      if (mouseX < siblings[i] + NODE_W / 2) return i;
    }
    return siblings.length;
  }, [pipeline, layout]);

  const startDrag = useCallback((passId: PassId, tlId: TimelineId, nodeX: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const mx = containerMouseX(e.clientX);
    setDrag({ passId, tlId, nodeX, offsetX: mx - nodeX, mouseX: mx });
    setDropIdx(computeDropIndex(mx, passId, tlId));
  }, [containerMouseX, computeDropIndex]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const mx = containerMouseX(e.clientX);
      setDrag((d) => d ? { ...d, mouseX: mx } : null);
      setDropIdx(computeDropIndex(mx, drag.passId, drag.tlId));
    };
    const onUp = () => {
      setDrag((d) => {
        if (!d) return null;
        // Commit reorder
        const tl = pipeline.timelines.find((t) => t.id === d.tlId);
        if (tl) {
          const siblings = tl.passIds
            .filter((pid) => pid !== d.passId)
            .map((pid) => ({ pid, x: layout.passLayouts.get(pid)?.x ?? 0 }))
            .sort((a, b) => a.x - b.x);
          const idx = computeDropIndex(d.mouseX, d.passId, d.tlId);
          const newOrder = siblings.map((s) => s.pid);
          newOrder.splice(idx, 0, d.passId);
          reorderPassesInTimeline(d.tlId, newOrder);
        }
        return null;
      });
      setDropIdx(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, pipeline, layout, computeDropIndex, reorderPassesInTimeline, containerMouseX]);

  // Drop indicator x position
  const dropIndicatorX = useMemo((): { x: number; y: number; h: number } | null => {
    if (!drag || dropIdx === null) return null;
    const tl = pipeline.timelines.find((t) => t.id === drag.tlId);
    if (!tl) return null;
    const tlIdx = pipeline.timelines.indexOf(tl);
    const siblings = tl.passIds
      .filter((pid) => pid !== drag.passId)
      .map((pid) => layout.passLayouts.get(pid)?.x ?? 0)
      .sort((a, b) => a - b);
    let x: number;
    if (siblings.length === 0)   x = COL_GAP / 2;
    else if (dropIdx === 0)      x = siblings[0] - COL_GAP / 2;
    else if (dropIdx >= siblings.length) x = siblings[siblings.length - 1] + NODE_W + COL_GAP / 2;
    else x = (siblings[dropIdx - 1] + NODE_W + siblings[dropIdx]) / 2;
    const rowTop = PAD_T + tlIdx * ROW_H;
    return { x, y: rowTop + 4, h: ROW_H - 8 };
  }, [drag, dropIdx, pipeline, layout]);

  const crossCount = allEdges.filter((e) => e.isCrossTimeline).length;

  // ── Resource focus: highlight writer/reader passes (union of all overlay rows) ─
  const { writingPassIds, readingPassIds } = useMemo(() => {
    if (overlayRows.length === 0) return { writingPassIds: new Set<PassId>(), readingPassIds: new Set<PassId>() };
    const writing = new Set<PassId>();
    const reading = new Set<PassId>();
    for (const rid of overlayRows) {
      for (const pass of Object.values(pipeline.passes)) {
        if (pass.writes.includes(rid)) writing.add(pass.id);
        if (pass.reads.includes(rid))  reading.add(pass.id);
      }
    }
    return { writingPassIds: writing, readingPassIds: reading };
  }, [pipeline.passes, overlayRows]);

  return (
    <div className="flex flex-col h-full bg-zinc-900" style={{ userSelect: drag ? 'none' : undefined }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-700/60 shrink-0">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Timeline</span>
        {crossCount > 0 && (
          <span className="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-700/40 rounded px-1.5 py-0.5 font-mono">
            {crossCount} cross-TL sync
          </span>
        )}
        <button
          onClick={() => setShowSameTL((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors font-mono
            ${showSameTL ? 'border-zinc-500 bg-zinc-700 text-zinc-200' : 'border-zinc-700/50 text-zinc-600 hover:text-zinc-400'}`}
        >
          same-TL edges
        </button>
        <div className="flex-1" />
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setShowAddMenu((v) => !v)}
            className="text-[11px] px-2.5 py-1 bg-zinc-700/60 hover:bg-zinc-600/60 border border-zinc-600/60 text-zinc-200 rounded transition-colors"
          >
            + Timeline
          </button>
          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-44">
              {TL_TYPE_OPTS.map((opt) => (
                <button key={opt.value}
                  className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
                  onClick={() => { addTimeline(opt.value); setShowAddMenu(false); }}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden bg-zinc-950/30" style={{ cursor: drag ? 'grabbing' : undefined }}>

        {/* Labels column */}
        <div ref={labelsRef}
          className="shrink-0 border-r border-zinc-800/60 bg-zinc-900/80 z-10"
          style={{ width: LABEL_W, overflowX: 'hidden', overflowY: 'scroll', scrollbarWidth: 'none' }}>
          <div className="relative" style={{ height: layout.totalH, minHeight: '100%' }}>

            {/* Timeline labels */}
            {pipeline.timelines.map((tl, i) => {
              const cfg = cfgFor(tl.type);
              const passCount = tl.passIds.length;
              const topY = PAD_T + i * ROW_H;
              return (
                <div key={tl.id}
                  className="absolute flex flex-col items-end justify-center pr-3 group/tl"
                  style={{ left: 0, top: topY, width: LABEL_W - 4, height: ROW_H }}>
                  {editTlId === tl.id ? (
                    <input autoFocus value={editTlName}
                      onChange={(e) => setEditTlName(e.target.value)}
                      onBlur={commitRenameTl}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') commitRenameTl();
                        if (e.key === 'Escape') setEditTlId(null);
                      }}
                      className="w-full text-right bg-zinc-700 text-zinc-100 text-[10px] font-bold rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  ) : (
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider cursor-default select-none ${cfg.label}`}
                      onDoubleClick={(e) => startRenameTl(tl.id, tl.name, e)}
                      title="Double-click to rename">
                      {tl.name}
                    </span>
                  )}
                  <span className="text-[9px] text-zinc-600 font-mono">{tl.type}</span>
                  <span className="text-[9px] text-zinc-700">{passCount} pass{passCount !== 1 ? 'es' : ''}</span>
                  <button onClick={() => handleDeleteTl(tl.id, tl.name, passCount)}
                    className="hidden group-hover/tl:block absolute top-1 right-0 p-1 text-zinc-700 hover:text-red-400 text-xs leading-none"
                    title="Delete timeline">✕</button>
                </div>
              );
            })}

            {/* Overlay labels */}
            {overlayRows.map((rid, i) => {
              const isPinned = pinnedResourceIds.includes(rid);
              const name = resolveIds([rid]);
              const isRT = rtNames.has(rid);
              const icon = isRT ? '▣' : '▤';
              const iconCls = isRT ? 'text-blue-400/80' : 'text-amber-400/80';
              const isDead = deadWriteIds.has(rid);
              return (
                <div key={rid}
                  className="absolute flex items-center gap-1 px-2 border-t border-dashed border-purple-800/40"
                  style={{ left: 0, top: layout.overlayY + i * OVERLAY_H, width: LABEL_W - 4, height: OVERLAY_H, background: isDead ? 'rgba(120,53,15,0.06)' : 'rgba(88,28,135,0.06)' }}>
                  <span className={`shrink-0 text-[10px] leading-none ${iconCls}`}>{icon}</span>
                  <span className="text-[9px] text-zinc-300 font-mono truncate flex-1 min-w-0">{name}</span>
                  {isDead && <span className="shrink-0 text-[9px] text-amber-400 leading-none" title="Written but never read — result is discarded">⚠</span>}
                  <button
                    onClick={() => isPinned ? unpinResource(rid) : pinResource(rid)}
                    className={`shrink-0 text-[10px] leading-none transition-colors ${isPinned ? 'text-purple-400 hover:text-purple-200' : 'text-zinc-600 hover:text-purple-400'}`}
                    title={isPinned ? 'Unpin resource' : 'Pin resource'}>
                    {isPinned ? '📌' : '📍'}
                  </button>
                  <button
                    onClick={() => isPinned ? unpinResource(rid) : selectResource(null)}
                    className="shrink-0 text-zinc-600 hover:text-zinc-300 text-[10px] leading-none" title="Remove overlay">✕</button>
                </div>
              );
            })}

          </div>
        </div>

        {/* Scrollable canvas */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <div className="relative" style={{ width: layout.totalW, height: layout.totalH, minWidth: '100%', minHeight: '100%' }}>

            {/* SVG: row backgrounds, overlay separators/spans, wires, arrows */}
            <svg className="absolute inset-0" width={layout.totalW} height={layout.totalH}
              style={{ overflow: 'visible' }}>
              <defs>
                {(['gray', 'gray-hi', 'purple', 'purple-hi'] as const).map((id) => {
                  const fill = id === 'gray' ? '#3f3f46' : id === 'gray-hi' ? '#71717a'
                             : id === 'purple' ? '#9333ea' : '#c084fc';
                  return (
                    <marker key={id} id={`tlv-${id}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                      <polygon points="0 0, 7 2.5, 0 5" fill={fill} />
                    </marker>
                  );
                })}
                {/* Clip path: full canvas minus each node box */}
                <clipPath id="tlv-node-mask">
                  <path fillRule="evenodd" d={[
                    `M0 0 H${layout.totalW} V${layout.totalH} H0 Z`,
                    ...[...layout.passLayouts.values()].map(({ x, y }) =>
                      `M${x} ${y} H${x + NODE_W} V${y + NODE_H} H${x} Z`
                    ),
                  ].join(' ')} />
                </clipPath>
              </defs>

              {/* Timeline row backgrounds + wires */}
              {pipeline.timelines.map((tl, i) => {
                const cfg   = cfgFor(tl.type);
                const rowY  = PAD_T + i * ROW_H;
                const wireY = rowY + ROW_H / 2;
                return (
                  <g key={tl.id} style={{ pointerEvents: 'none' }}>
                    <rect x={0} y={rowY} width={layout.totalW} height={ROW_H}
                      fill={i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'} />
                    <line x1={0} y1={wireY} x2={layout.totalW - 8} y2={wireY}
                      stroke={cfg.wire} strokeWidth={1.5} strokeDasharray="6 10" opacity={0.28} />
                  </g>
                );
              })}

              {/* Overlay row backgrounds + lifetime spans */}
              {overlayAccessMaps.map(({ rid, map }, i) => {
                const rowY = layout.overlayY + i * OVERLAY_H;
                const xs = [...layout.passLayouts.values()]
                  .filter(({ passId }) => map.has(passId))
                  .map(({ x }) => x);
                const minX = xs.length > 0 ? Math.min(...xs) : null;
                const maxX = xs.length > 0 ? Math.max(...xs) + NODE_W : null;
                const isDead = deadWriteIds.has(rid);
                const spanFill   = isDead ? 'rgba(217,119,6,0.10)'  : 'rgba(147,51,234,0.10)';
                const edgeStroke = isDead ? '#f59e0b' : '#a855f7';
                const rowFill    = isDead ? 'rgba(120,53,15,0.06)'  : 'rgba(88,28,135,0.04)';
                const sepStroke  = isDead ? '#92400e' : '#6b21a8';
                return (
                  <g key={rid} style={{ pointerEvents: 'none' }}>
                    <rect x={0} y={rowY} width={layout.totalW} height={OVERLAY_H} fill={rowFill} />
                    <line x1={0} y1={rowY} x2={layout.totalW} y2={rowY}
                      stroke={sepStroke} strokeWidth={1} strokeDasharray="4 6" opacity={0.4} />
                    {minX !== null && maxX !== null && (
                      <>
                        <rect x={minX} y={rowY + 1} width={maxX - minX} height={OVERLAY_H - 2}
                          fill={spanFill} rx={2} />
                        <line x1={minX} y1={rowY + 3} x2={minX} y2={rowY + OVERLAY_H - 3}
                          stroke={edgeStroke} strokeWidth={2} strokeLinecap="round" />
                        <line x1={maxX} y1={rowY + 3} x2={maxX} y2={rowY + OVERLAY_H - 3}
                          stroke={edgeStroke} strokeWidth={2} strokeLinecap="round" />
                      </>
                    )}
                  </g>
                );
              })}

              {/* Drop indicator */}
              {dropIndicatorX && (
                <line
                  x1={dropIndicatorX.x} y1={dropIndicatorX.y}
                  x2={dropIndicatorX.x} y2={dropIndicatorX.y + dropIndicatorX.h}
                  stroke="#3b82f6" strokeWidth={2} strokeDasharray="3 3"
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {/* Arrows */}
              {arrowEdges.map((edge) => {
                const from = layout.passLayouts.get(edge.fromPassId);
                const to   = layout.passLayouts.get(edge.toPassId);
                if (!from || !to) return null;
                const isCross   = edge.isCrossTimeline;
                const isFocused = hoveredEdge === edge.id || (!!selectedPassId &&
                  (edge.fromPassId === selectedPassId || edge.toPassId === selectedPassId));
                const stroke   = isCross ? (isFocused ? '#c084fc' : '#9333ea') : (isFocused ? '#71717a' : '#3f3f46');
                const strokeW  = isCross ? (isFocused ? 2.5 : 2) : (isFocused ? 1.5 : 1);
                const opacity  = isFocused ? 1 : isCross ? 0.78 : 0.4;
                const markerId = isCross ? (isFocused ? 'tlv-purple-hi' : 'tlv-purple')
                                         : (isFocused ? 'tlv-gray-hi'   : 'tlv-gray');

                let d: string;
                if (!isCross) {
                  const routeY = from.y + NODE_H + 14;
                  d = `M ${from.cx} ${from.y + NODE_H} C ${from.cx} ${routeY}, ${to.cx} ${routeY}, ${to.cx} ${to.y + NODE_H}`;
                } else {
                  const x1 = from.x + NODE_W + 2, y1 = from.cy;
                  const x2 = to.x - 2,            y2 = to.cy;
                  const dx = Math.max(16, (x2 - x1) * 0.45);
                  d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                }

                return (
                  <g key={edge.id}
                    clipPath={isCross ? 'url(#tlv-node-mask)' : undefined}
                    onMouseEnter={() => setHoveredEdge(edge.id)}
                    onMouseLeave={() => setHoveredEdge(null)}
                    style={{ cursor: 'default' }}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
                    <path d={d} fill="none" stroke={stroke} strokeWidth={strokeW}
                      opacity={opacity} markerEnd={`url(#${markerId})`}>
                      <title>{resolveIds(edge.resourceIds)}</title>
                    </path>
                  </g>
                );
              })}
            </svg>

            {/* Pass nodes */}
            {[...layout.passLayouts.values()].map(({ passId, x, y }) => {
              const pass = pipeline.passes[passId];
              if (!pass) return null;
              const cfg        = cfgFor(layout.passTLType.get(passId) ?? 'custom');
              const isSelected = passId === selectedPassId;
              const isEditing  = editPassId === passId;
              const isDragging = drag?.passId === passId;
              const otherTls   = pipeline.timelines.filter((tl) => tl.id !== pass.timelineId);
              const translateX = isDragging ? drag!.mouseX - drag!.offsetX - drag!.nodeX : 0;

              // Resource focus
              const isWriter     = writingPassIds.has(passId);
              const isReader     = readingPassIds.has(passId);
              const resourceFocus = overlayRows.length > 0;
              const isDimmed     = resourceFocus && !isWriter && !isReader;

              return (
                <div key={passId}
                  style={{ transform: isDragging ? `translateX(${translateX}px)` : undefined, zIndex: isDragging ? 50 : undefined }}>
                  {/* Outer wrapper: action bar + node */}
                  <div className="absolute group/node"
                    style={{ left: x, top: y - BAR_H, width: NODE_W, height: NODE_H + BAR_H, opacity: isDimmed ? 0.2 : 1 }}>
                    {/* Action bar */}
                    <div
                      className="invisible group-hover/node:visible flex items-center justify-end gap-0 bg-zinc-800/95 border border-zinc-600/50 rounded-t px-1"
                      style={{ height: BAR_H }}
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={(e) => startRenamePass(passId, pass.name, e)}
                        className="px-1 text-zinc-500 hover:text-zinc-200 text-[10px]" title="Rename">✎</button>
                      <button onClick={(e) => { e.stopPropagation(); duplicatePass(passId); }}
                        className="px-1 text-zinc-500 hover:text-zinc-200 text-[10px]" title="Duplicate">⧉</button>
                      {otherTls.length > 0 && (
                        <button onClick={(e) => openMove(passId, x, y + NODE_H + 2, e)}
                          className="px-1 text-zinc-500 hover:text-zinc-200 text-[10px]" title="Move to timeline">↔</button>
                      )}
                      <button onClick={(e) => handleDeletePass(passId, pass.name, e)}
                        className="px-1 text-zinc-500 hover:text-red-400 text-[10px]" title="Delete">✕</button>
                    </div>

                    {/* Node */}
                    <div
                      className={`
                        flex items-center rounded border text-xs font-medium
                        transition-colors overflow-hidden
                        ${isSelected ? `${cfg.nodeHl} shadow-lg` : `${cfg.nodeBg} hover:brightness-125`}
                        ${!pass.enabled ? 'opacity-50' : ''}
                        ${isDragging ? 'shadow-2xl ring-1 ring-blue-400/50' : ''}
                        ${isWriter && !isSelected ? 'ring-1 ring-amber-500/80' : ''}
                        ${isReader && !isWriter && !isSelected ? 'ring-1 ring-sky-500/80' : ''}
                      `}
                      style={{ height: NODE_H, cursor: isDragging ? 'grabbing' : 'pointer' }}
                      onClick={() => { if (!isEditing && !isDragging) selectPass(passId); }}>
                      <div
                        className="px-1.5 text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing shrink-0 select-none"
                        style={{ fontSize: 11 }}
                        onMouseDown={(e) => startDrag(passId, pass.timelineId, x, e)}>
                        ⠿
                      </div>
                      <div className="flex-1 min-w-0 pr-2 py-1">
                        {isEditing ? (
                          <input autoFocus value={editPassName}
                            onChange={(e) => setEditPassName(e.target.value)}
                            onBlur={commitRenamePass}
                            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') commitRenamePass();
                              if (e.key === 'Escape') setEditPassId(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full bg-transparent text-xs focus:outline-none caret-white" />
                        ) : (
                          <span className="block truncate leading-tight"
                            onDoubleClick={(e) => startRenamePass(passId, pass.name, e)}>
                            {pass.name}
                          </span>
                        )}
                      </div>
                      {!isEditing && resourceFocus && (isWriter || isReader) && (
                        <span className={`shrink-0 pr-1 text-[8px] font-bold font-mono
                          ${isWriter && isReader ? 'text-amber-400' : isWriter ? 'text-amber-400' : 'text-sky-400'}`}>
                          {isWriter && isReader ? 'RW' : isWriter ? 'W' : 'R'}
                        </span>
                      )}
                      {!isEditing && pass.steps.length > 0 && (
                        <span className="shrink-0 pr-1.5 text-[8px] text-zinc-600">{pass.steps.length}s</span>
                      )}
                      {!isEditing && !pass.enabled && (
                        <span className="shrink-0 pr-1.5 text-[8px] italic text-zinc-500">off</span>
                      )}
                    </div>
                  </div>

                  {/* Condition tags — rendered below the node in the row's bottom space */}
                  {pass.conditions.length > 0 && (
                    <div className="absolute flex items-center gap-0.5 overflow-hidden"
                      style={{ left: x, top: y + NODE_H + 3, width: NODE_W, height: 14 }}>
                      {pass.conditions.slice(0, 3).map((c) => (
                        <span key={c}
                          className="text-[8px] bg-amber-950/70 text-amber-400 border border-amber-800/60 rounded-sm px-1 font-mono leading-3 truncate shrink-0 max-w-full">
                          {c}
                        </span>
                      ))}
                      {pass.conditions.length > 3 && (
                        <span className="text-[8px] text-amber-600/70 font-mono shrink-0">+{pass.conditions.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Overlay R/W/RW badges */}
            {overlayAccessMaps.map(({ rid, map }, rowIdx) => {
              const name = resolveIds([rid]);
              return [...layout.passLayouts.values()].map(({ passId, x }) => {
                const access = map.get(passId);
                if (!access) return null;
                const badgeCls = access === 'read'
                  ? 'bg-sky-900/70 text-sky-300 border-sky-700/60 hover:bg-sky-800/80'
                  : access === 'write'
                  ? 'bg-amber-900/70 text-amber-300 border-amber-700/60 hover:bg-amber-800/80'
                  : 'bg-purple-900/70 text-purple-300 border-purple-700/60 hover:bg-purple-800/80';
                const label = access === 'readwrite' ? 'RW' : access === 'read' ? 'R' : 'W';
                const tooltipAction = access === 'readwrite' ? 'reads & writes' : `${access}s`;
                const rowY = layout.overlayY + rowIdx * OVERLAY_H;
                return (
                  <div key={`overlay-${rid}-${passId}`}
                    className={`absolute flex items-center justify-center border rounded-sm cursor-pointer text-[9px] font-bold font-mono transition-colors ${badgeCls}`}
                    style={{ left: x + (NODE_W - 28) / 2, top: rowY + (OVERLAY_H - 18) / 2, width: 28, height: 18 }}
                    onClick={() => selectPass(passId)}
                    title={`${pipeline.passes[passId]?.name} — ${tooltipAction} ${name}`}>
                    {label}
                  </div>
                );
              });
            })}

            {/* "+ Pass" buttons */}
            {pipeline.timelines.map((tl, i) => {
              const bx = layout.addPassX.get(tl.id) ?? COL_GAP / 2;
              const by = PAD_T + i * ROW_H + (ROW_H - NODE_H) / 2;
              return (
                <button key={tl.id} onClick={() => addPass(tl.id)}
                  className="absolute text-[10px] text-zinc-600 hover:text-zinc-300 border border-dashed border-zinc-700/50 hover:border-zinc-500 rounded px-2 transition-colors whitespace-nowrap"
                  style={{ left: bx, top: by, height: NODE_H, lineHeight: `${NODE_H}px` }}>
                  + Pass
                </button>
              );
            })}

            {pipeline.timelines.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="text-xs text-zinc-600">No timelines yet.</span>
                <span className="text-[10px] text-zinc-700">Click "+ Timeline" in the toolbar to get started.</span>
              </div>
            )}

            {/* Move-to-timeline dropdown */}
            {movePassId && (
              <div ref={moveRef}
                className="absolute z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-44 overflow-hidden"
                style={{ left: movePos.x, top: movePos.y }}
                onClick={(e) => e.stopPropagation()}>
                <div className="px-2 py-1 text-[10px] text-zinc-500 border-b border-zinc-700">Move to timeline</div>
                {pipeline.timelines
                  .filter((tl) => tl.id !== pipeline.passes[movePassId]?.timelineId)
                  .map((tl) => (
                    <button key={tl.id}
                      className="w-full text-left px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                      onClick={() => { movePassToTimeline(movePassId, tl.id); setMovePassId(null); }}>
                      {tl.name}
                    </button>
                  ))}
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
