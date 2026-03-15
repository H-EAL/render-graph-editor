import { useMemo, useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useStore } from '../../state/store';
import { deriveDependencies, type DependencyEdge } from '../../utils/dependencyGraph';
import type { PassId, Pipeline, TimelineId, TimelineType } from '../../types';

// ─── Layout constants ──────────────────────────────────────────────────────────

const NODE_W   = 132;
const NODE_H   = 36;
const COL_GAP  = 44;
const COL_W    = NODE_W + COL_GAP;
const ROW_H    = 92;    // row height including inter-row space for cross-TL arrows
const LABEL_W  = 152;   // left label column
const PAD_T    = 14;
const PAD_B    = 20;
const ADD_W    = 80;    // width of "+ Pass" button

// ─── Timeline colour config ────────────────────────────────────────────────────

const TL_CFG: Record<string, {
  label: string; wire: string;
  nodeBg: string; nodeHl: string;
}> = {
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

function computePassColumns(
  pipeline: Pipeline,
  edges: DependencyEdge[],
): Map<PassId, number> {
  const allPids = pipeline.timelines.flatMap((tl) => tl.passIds);
  const deps = new Map<PassId, Set<PassId>>();
  for (const pid of allPids) deps.set(pid, new Set());
  for (const e of edges) deps.get(e.toPassId)?.add(e.fromPassId);
  for (const tl of pipeline.timelines) {
    for (let i = 1; i < tl.passIds.length; i++) deps.get(tl.passIds[i])?.add(tl.passIds[i - 1]);
  }
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

interface PassLayout { passId: PassId; x: number; y: number; cx: number; cy: number; }

function useLayout(pipeline: Pipeline, edges: DependencyEdge[]) {
  return useMemo(() => {
    const rawCols = computePassColumns(pipeline, edges);
    const sorted  = [...new Set(rawCols.values())].sort((a, b) => a - b);
    const lvlToCol = new Map(sorted.map((l, i) => [l, i]));
    const numCols  = sorted.length;

    const tlRow = new Map<TimelineId, number>(pipeline.timelines.map((tl, i) => [tl.id, i]));
    const passTLType = new Map<PassId, string>();
    for (const tl of pipeline.timelines) for (const pid of tl.passIds) passTLType.set(pid, tl.type);

    const passLayouts = new Map<PassId, PassLayout>();
    for (const [pid, rawLevel] of rawCols) {
      const pass = pipeline.passes[pid];
      if (!pass) continue;
      const colIdx = lvlToCol.get(rawLevel) ?? 0;
      const rowIdx = tlRow.get(pass.timelineId) ?? 0;
      const x = LABEL_W + colIdx * COL_W;
      const y = PAD_T + rowIdx * ROW_H + (ROW_H - NODE_H) / 2;
      passLayouts.set(pid, { passId: pid, x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 });
    }

    // Position of the "+ Pass" button for each timeline (just after its rightmost node)
    const addPassX = new Map<TimelineId, number>();
    for (const tl of pipeline.timelines) {
      let maxX = LABEL_W + COL_GAP / 2;
      for (const pid of tl.passIds) {
        const pl = passLayouts.get(pid);
        if (pl) maxX = Math.max(maxX, pl.x + NODE_W + COL_GAP / 2);
      }
      addPassX.set(tl.id, maxX);
    }

    const rightEdge = Math.max(...[...addPassX.values()].map((x) => x + ADD_W + 16), LABEL_W + numCols * COL_W + 16, 320);
    const totalW = rightEdge;
    const totalH = PAD_T + pipeline.timelines.length * ROW_H + PAD_B;

    return { passLayouts, passTLType, totalW, totalH, addPassX };
  }, [pipeline, edges]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PipelineTimelineView() {
  const {
    pipeline, resources, selectedPassId,
    selectPass, addPass, deletePass, duplicatePass, updatePass,
    addTimeline, deleteTimeline, updateTimeline, movePassToTimeline,
  } = useStore();

  const [showSameTL,   setShowSameTL]  = useState(false);
  const [showAddMenu,  setShowAddMenu] = useState(false);
  const [editPassId,   setEditPassId]  = useState<PassId | null>(null);
  const [editPassName, setEditPassName] = useState('');
  const [editTlId,     setEditTlId]    = useState<TimelineId | null>(null);
  const [editTlName,   setEditTlName]  = useState('');
  const [movePassId,   setMovePassId]  = useState<PassId | null>(null);
  const [movePos,      setMovePos]     = useState({ x: 0, y: 0 });

  const addMenuRef = useRef<HTMLDivElement>(null);
  const moveRef    = useRef<HTMLDivElement>(null);

  // Close any open dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setShowAddMenu(false);
      if (moveRef.current    && !moveRef.current.contains(e.target as Node))    setMovePassId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allEdges   = useMemo(() => deriveDependencies(pipeline), [pipeline]);
  const layout     = useLayout(pipeline, allEdges);
  const arrowEdges = useMemo(
    () => (showSameTL ? allEdges : allEdges.filter((e) => e.isCrossTimeline)),
    [allEdges, showSameTL],
  );

  // Resource name lookup for arrow tooltips
  const rtNames  = useMemo(() => new Map(resources.renderTargets.map((r) => [r.id, r.name])), [resources]);
  const bufNames = useMemo(() => new Map(resources.buffers.map((b)  => [b.id, b.name])),  [resources]);
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

  const crossCount = allEdges.filter((e) => e.isCrossTimeline).length;

  return (
    <div className="flex flex-col h-full bg-zinc-900">
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
          title="Show/hide same-timeline arrows (ordering is already visible in node position)"
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
                <button
                  key={opt.value}
                  className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
                  onClick={() => { addTimeline(opt.value); setShowAddMenu(false); }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto bg-zinc-950/30">
        <div
          className="relative"
          style={{ width: layout.totalW, height: layout.totalH, minWidth: '100%', minHeight: '100%' }}
        >
          {/* ── SVG: lane wires + dependency arrows ─────────────────────── */}
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
                  <marker key={id} id={`tlv-${id}`}
                    markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                    <polygon points="0 0, 7 2.5, 0 5" fill={fill} />
                  </marker>
                );
              })}
            </defs>

            {/* Label column separator */}
            <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={layout.totalH} stroke="#27272a" strokeWidth={1} />

            {/* Row backgrounds + lane wires */}
            {pipeline.timelines.map((tl, i) => {
              const cfg   = cfgFor(tl.type);
              const rowY  = PAD_T + i * ROW_H;
              const wireY = rowY + ROW_H / 2;
              return (
                <g key={tl.id}>
                  <rect x={LABEL_W} y={rowY} width={layout.totalW - LABEL_W} height={ROW_H}
                    fill={i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent'} />
                  <line
                    x1={LABEL_W} y1={wireY} x2={layout.totalW - 8} y2={wireY}
                    stroke={cfg.wire} strokeWidth={1.5} strokeDasharray="6 10" opacity={0.28}
                  />
                </g>
              );
            })}

            {/* Dependency arrows */}
            {arrowEdges.map((edge) => {
              const from = layout.passLayouts.get(edge.fromPassId);
              const to   = layout.passLayouts.get(edge.toPassId);
              if (!from || !to) return null;
              const isCross   = edge.isCrossTimeline;
              const isFocused = !!selectedPassId &&
                (edge.fromPassId === selectedPassId || edge.toPassId === selectedPassId);
              const stroke   = isCross ? (isFocused ? '#c084fc' : '#9333ea') : (isFocused ? '#71717a' : '#3f3f46');
              const strokeW  = isCross ? (isFocused ? 2.5 : 2) : (isFocused ? 1.5 : 1);
              const opacity  = isFocused ? 1 : isCross ? 0.78 : 0.4;
              const markerId = isCross ? (isFocused ? 'tlv-purple-hi' : 'tlv-purple')
                                       : (isFocused ? 'tlv-gray-hi'   : 'tlv-gray');
              const x1 = from.x + NODE_W + 2;
              const y1 = from.cy;
              const x2 = to.x - 2;
              const y2 = to.cy;
              const dx = Math.max(16, (x2 - x1) * 0.45);
              return (
                <path
                  key={edge.id}
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  fill="none" stroke={stroke} strokeWidth={strokeW}
                  opacity={opacity} markerEnd={`url(#${markerId})`}
                >
                  <title>{resolveIds(edge.resourceIds)}</title>
                </path>
              );
            })}
          </svg>

          {/* ── Timeline labels (left column) ────────────────────────────── */}
          {pipeline.timelines.map((tl, i) => {
            const cfg   = cfgFor(tl.type);
            const passCount = tl.passIds.length;
            const topY  = PAD_T + i * ROW_H;
            return (
              <div
                key={tl.id}
                className="absolute flex flex-col items-end justify-center pr-3 group/tl"
                style={{ left: 0, top: topY, width: LABEL_W - 4, height: ROW_H }}
              >
                {editTlId === tl.id ? (
                  <input
                    autoFocus
                    value={editTlName}
                    onChange={(e) => setEditTlName(e.target.value)}
                    onBlur={commitRenameTl}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') commitRenameTl();
                      if (e.key === 'Escape') setEditTlId(null);
                    }}
                    className="w-full text-right bg-zinc-700 text-zinc-100 text-[10px] font-bold rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider cursor-default select-none ${cfg.label}`}
                    onDoubleClick={(e) => startRenameTl(tl.id, tl.name, e)}
                    title="Double-click to rename"
                  >
                    {tl.name}
                  </span>
                )}
                <span className="text-[9px] text-zinc-600 font-mono">{tl.type}</span>
                <span className="text-[9px] text-zinc-700">{passCount} pass{passCount !== 1 ? 'es' : ''}</span>

                {/* Delete timeline button, appears on hover */}
                <button
                  onClick={() => handleDeleteTl(tl.id, tl.name, passCount)}
                  className="hidden group-hover/tl:block absolute top-1 right-0 p-1 text-zinc-700 hover:text-red-400 text-xs leading-none"
                  title="Delete timeline"
                >✕</button>
              </div>
            );
          })}

          {/* ── Pass nodes ───────────────────────────────────────────────── */}
          {[...layout.passLayouts.values()].map(({ passId, x, y }) => {
            const pass = pipeline.passes[passId];
            if (!pass) return null;
            const cfg        = cfgFor(layout.passTLType.get(passId) ?? 'custom');
            const isSelected = passId === selectedPassId;
            const isEditing  = editPassId === passId;
            const otherTls   = pipeline.timelines.filter((tl) => tl.id !== pass.timelineId);

            return (
              <div
                key={passId}
                className={`
                  absolute group/node flex items-center rounded border text-xs font-medium
                  transition-all cursor-pointer select-none overflow-visible
                  ${isSelected ? `${cfg.nodeHl} shadow-lg` : `${cfg.nodeBg} hover:brightness-125`}
                  ${!pass.enabled ? 'opacity-50' : ''}
                `}
                style={{ left: x, top: y, width: NODE_W, height: NODE_H, zIndex: isEditing ? 10 : undefined }}
                onClick={() => { if (!isEditing) selectPass(passId); }}
              >
                {/* Name or inline rename input */}
                <div className="flex-1 min-w-0 px-2.5 py-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editPassName}
                      onChange={(e) => setEditPassName(e.target.value)}
                      onBlur={commitRenamePass}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commitRenamePass();
                        if (e.key === 'Escape') setEditPassId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-transparent text-xs focus:outline-none caret-white"
                    />
                  ) : (
                    <span
                      className="block truncate leading-tight"
                      onDoubleClick={(e) => startRenamePass(passId, pass.name, e)}
                    >
                      {pass.name}
                    </span>
                  )}
                </div>

                {/* Status indicators (hidden when editing) */}
                {!isEditing && (
                  <div className="flex items-center gap-0.5 shrink-0 pr-1.5 text-[8px]">
                    {!pass.enabled  && <span className="italic text-zinc-500">off</span>}
                    {pass.conditions.length > 0 && <span className="text-amber-500/70">[{pass.conditions.length}]</span>}
                    {pass.steps.length > 0       && <span className="text-zinc-600">{pass.steps.length}s</span>}
                  </div>
                )}

                {/* Hover action bar — floats above the node */}
                {!isEditing && (
                  <div
                    className="hidden group-hover/node:flex absolute left-0 right-0 -top-6 justify-end items-center gap-0 bg-zinc-800/95 border border-zinc-600/60 rounded-t px-1 h-5"
                    onClick={(e) => e.stopPropagation()}
                  >
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
                )}
              </div>
            );
          })}

          {/* ── "+ Pass" buttons (one per timeline row) ───────────────────── */}
          {pipeline.timelines.map((tl, i) => {
            const bx = layout.addPassX.get(tl.id) ?? LABEL_W + COL_GAP / 2;
            const by = PAD_T + i * ROW_H + (ROW_H - NODE_H) / 2;
            return (
              <button
                key={tl.id}
                onClick={() => addPass(tl.id)}
                className="absolute text-[10px] text-zinc-600 hover:text-zinc-300 border border-dashed border-zinc-700/50 hover:border-zinc-500 rounded px-2 transition-colors whitespace-nowrap"
                style={{ left: bx, top: by, height: NODE_H, lineHeight: `${NODE_H}px` }}
                title={`Add pass to ${tl.name}`}
              >
                + Pass
              </button>
            );
          })}

          {/* ── Empty state ───────────────────────────────────────────────── */}
          {pipeline.timelines.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <span className="text-xs text-zinc-600">No timelines yet.</span>
              <span className="text-[10px] text-zinc-700">Click "+ Timeline" in the toolbar to get started.</span>
            </div>
          )}

          {/* ── Move-to-timeline dropdown ─────────────────────────────────── */}
          {movePassId && (
            <div
              ref={moveRef}
              className="absolute z-50 bg-zinc-800 border border-zinc-600 rounded shadow-xl w-44 overflow-hidden"
              style={{ left: movePos.x, top: movePos.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1 text-[10px] text-zinc-500 border-b border-zinc-700">Move to timeline</div>
              {pipeline.timelines
                .filter((tl) => tl.id !== pipeline.passes[movePassId]?.timelineId)
                .map((tl) => (
                  <button
                    key={tl.id}
                    className="w-full text-left px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                    onClick={() => { movePassToTimeline(movePassId, tl.id); setMovePassId(null); }}
                  >
                    {tl.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
