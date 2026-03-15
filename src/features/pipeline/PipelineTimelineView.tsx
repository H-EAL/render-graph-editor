import { useMemo, useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../state/store';
import { deriveDependencies, getResourceUsage, type DependencyEdge } from '../../utils/dependencyGraph';
import { derivePassAccess } from '../../utils/resourceOverlay';
import { newId } from '../../utils/id';
import type { PassId, Pipeline, ResourceId, TimelineId, TimelineType } from '../../types';

// ─── Layout constants ──────────────────────────────────────────────────────────

const NODE_W          = 132;
const NODE_H          = 36;
const BAR_H           = 24;   // action-bar height above the node
const COL_GAP         = 44;
const COL_W           = NODE_W + COL_GAP;
const ROW_H           = 114;
const LABEL_W         = 152;
const PAD_T           = 14;
const PAD_B           = 20;
const ADD_W           = 80;
const OVERLAY_H       = 26;
const RESOURCE_ZONE_H = 22;  // always-visible resource section header
const STEPS_STRIP_H   = 16;  // step chips row below pass node

// ─── Step chip config ─────────────────────────────────────────────────────────

const STEP_ABBR: Record<string, string> = {
  raster:             'RST',
  dispatchCompute:    'DC',
  dispatchRayTracing: 'DRT',
  copyImage:          'CP',
  blitImage:          'BL',
  resolveImage:       'RS',
  clearImages:        'CLR',
  fillBuffer:         'FB',
  generateMipChain:   'MIP',
};

// Mirrors the timeline type colour pattern: raster→blue, compute→emerald, rt→violet, transfer→orange, buffer→amber, misc→zinc
const STEP_CHIP_CLS: Record<string, string> = {
  raster:             'bg-blue-900/70 text-blue-300 border-blue-800/50',
  dispatchCompute:    'bg-emerald-900/70 text-emerald-300 border-emerald-800/50',
  dispatchRayTracing: 'bg-violet-900/70 text-violet-300 border-violet-800/50',
  copyImage:          'bg-orange-900/70 text-orange-300 border-orange-800/50',
  blitImage:          'bg-orange-900/60 text-orange-400 border-orange-800/40',
  resolveImage:       'bg-orange-900/60 text-orange-400 border-orange-800/40',
  clearImages:        'bg-red-900/60 text-red-400 border-red-800/40',
  fillBuffer:         'bg-amber-900/60 text-amber-400 border-amber-800/40',
  generateMipChain:   'bg-orange-900/50 text-orange-500 border-orange-800/30',
};

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

    const rightEdge      = Math.max(...[...addPassX.values()].map((x) => x + ADD_W + 16), sorted.length * COL_W + 16, 320);
    const totalW         = rightEdge;
    const baseH          = PAD_T + pipeline.timelines.length * ROW_H + PAD_B;
    const resourceZoneTop = PAD_T + pipeline.timelines.length * ROW_H + 8;
    const overlayY       = resourceZoneTop + RESOURCE_ZONE_H;
    const totalH         = Math.max(baseH, overlayY + (overlayCount > 0 ? overlayCount * OVERLAY_H + 8 : 4));

    return { passLayouts, passTLType, totalW, totalH, addPassX, overlayY, resourceZoneTop };
  }, [pipeline, edges, overlayCount]);
}

// ─── Drag state (pass reorder) ────────────────────────────────────────────────

interface DragState {
  passId: PassId;
  sourceTlId: TimelineId;
  targetTlId: TimelineId;
  depTargetPassId: PassId | null;  // set when hovering over a different timeline
  nodeX: number;
  offsetX: number;
  mouseX: number;
  mouseY: number;
}

// ─── Sort mode ────────────────────────────────────────────────────────────────

type SortMode = 'manual' | 'firstUse' | 'lastUse' | 'longestSpan' | 'shortestSpan';

const SORT_OPTS: { value: SortMode; label: string }[] = [
  { value: 'manual',       label: 'Manual (drag)' },
  { value: 'firstUse',     label: 'First use' },
  { value: 'lastUse',      label: 'Last use' },
  { value: 'longestSpan',  label: 'Longest span' },
  { value: 'shortestSpan', label: 'Shortest span' },
];

// ─── Sortable resource label ──────────────────────────────────────────────────

interface SortableResourceLabelProps {
  rid: ResourceId;
  name: string;
  tooltip: string;
  icon: string;
  iconCls: string;
  isDead: boolean;
  isSelected: boolean;
  isDimmed: boolean;
  isDraggable: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SortableResourceLabel({
  rid, name, tooltip, icon, iconCls, isDead, isSelected, isDimmed, isDraggable, onSelect, onContextMenu,
}: SortableResourceLabelProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rid });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        height: OVERLAY_H,
        opacity: isDragging ? 0.4 : isDimmed ? 0.25 : 1,
        background: isSelected
          ? (isDead ? 'rgba(120,53,15,0.18)' : 'rgba(88,28,135,0.14)')
          : (isDead ? 'rgba(120,53,15,0.06)' : 'rgba(88,28,135,0.06)'),
        zIndex: isDragging ? 50 : undefined,
      }}
      className={`flex items-center gap-1 px-1 border-t border-dashed border-purple-800/40 cursor-pointer select-none
        ${isSelected ? 'ring-1 ring-inset ring-sky-500/40' : 'hover:bg-white/2'}`}
      title={tooltip}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {/* Drag handle — hidden when a sort is active */}
      {isDraggable ? (
        <button
          {...attributes}
          {...listeners}
          className="text-zinc-700 hover:text-zinc-500 cursor-grab active:cursor-grabbing shrink-0 px-0.5 text-[10px] leading-none"
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >⠿</button>
      ) : (
        <span className="shrink-0 px-0.5 w-[14px]" />
      )}
      <span className={`shrink-0 text-[10px] leading-none ${iconCls}`}>{icon}</span>
      <span className="text-[9px] text-zinc-300 font-mono truncate flex-1 min-w-0">{name}</span>
      {isDead && (
        <span className="shrink-0 text-[9px] text-amber-400 leading-none" title="Written but never read — result is discarded">⚠</span>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PipelineTimelineView() {
  const {
    pipeline, resources, selectedPassId, selectedResourceId, resourceOrder,
    selectPass, selectStep, selectResource, setResourceOrder,
    addPass, deletePass, duplicatePass, updatePass,
    addTimeline, deleteTimeline, updateTimeline,
    movePassToTimeline, reorderPassesInTimeline, addManualDep,
    addRenderTarget, addBuffer, addInputParameter,
  } = useStore();

  // Multi-select for resource rows (local — drives pass highlighting)
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<ResourceId>>(new Set());

  // When the drawer is closed from outside (e.g. ResourceDrawer ✕ button), clear local multi-select
  useEffect(() => {
    if (!selectedResourceId) setSelectedResourceIds(new Set());
  }, [selectedResourceId]);

  const [sortMode,      setSortMode]      = useState<SortMode>('manual');
  const [sortMenuPos,   setSortMenuPos]   = useState<{ x: number; y: number } | null>(null);
  const [addResPos,     setAddResPos]     = useState<{ x: number; y: number } | null>(null);
  const [showSameTL,    setShowSameTL]    = useState(false);
  const [showAddMenu,   setShowAddMenu]   = useState(false);
  const [editPassId,    setEditPassId]    = useState<PassId | null>(null);
  const [editPassName,  setEditPassName]  = useState('');
  const [editTlId,      setEditTlId]      = useState<TimelineId | null>(null);
  const [editTlName,    setEditTlName]    = useState('');

  const [drag,          setDrag]          = useState<DragState | null>(null);
  const [dropIdx,       setDropIdx]       = useState<number | null>(null);
  const [hoveredEdge,   setHoveredEdge]   = useState<string | null>(null);
  const [contextMenu,   setContextMenu]   = useState<{ rid: ResourceId; x: number; y: number } | null>(null);
  const [passCtxMenu,   setPassCtxMenu]   = useState<{ tlId: TimelineId | null; canvasX: number; x: number; y: number } | null>(null);
  const [nodeCtxMenu,   setNodeCtxMenu]   = useState<{ passId: PassId; x: number; y: number } | null>(null);

  // Filter state
  type ResTypeFilter = 'rt' | 'buf' | 'param';
  const [filterText,  setFilterText]  = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<ResTypeFilter>>(new Set());
  const [filterDead,       setFilterDead]       = useState(false);
  const [filterUnused,     setFilterUnused]     = useState(false);
  const [filterNonOverlap, setFilterNonOverlap] = useState(false);
  const [filterPos,        setFilterPos]        = useState<{ x: number; y: number } | null>(null);

  const addMenuRef     = useRef<HTMLDivElement>(null);
  const addResRef      = useRef<HTMLDivElement>(null);
  const addResBtnRef   = useRef<HTMLButtonElement>(null);
  const sortMenuRef    = useRef<HTMLDivElement>(null);
  const sortBtnRef     = useRef<HTMLButtonElement>(null);
  const filterMenuRef  = useRef<HTMLDivElement>(null);
  const filterBtnRef   = useRef<HTMLButtonElement>(null);
  const contextMenuRef  = useRef<HTMLDivElement>(null);
  const passCtxMenuRef  = useRef<HTMLDivElement>(null);
  const nodeCtxMenuRef  = useRef<HTMLDivElement>(null);

  const scrollRef     = useRef<HTMLDivElement>(null);
  const labelsRef     = useRef<HTMLDivElement>(null);

  // Sync vertical scroll bidirectionally
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

  // Escape clears all selections
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      selectPass(null);
      selectStep(null);
      selectResource(null);
      setSelectedResourceIds(new Set());
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [selectPass, selectStep, selectResource]);

  // Close dropdowns / context menu on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addMenuRef.current     && !addMenuRef.current.contains(t))                                               setShowAddMenu(false);
      if (addResRef.current      && !addResRef.current.contains(t)   && !addResBtnRef.current?.contains(t))        setAddResPos(null);
      if (sortMenuRef.current    && !sortMenuRef.current.contains(t)  && !sortBtnRef.current?.contains(t))         setSortMenuPos(null);
      if (filterMenuRef.current  && !filterMenuRef.current.contains(t) && !filterBtnRef.current?.contains(t))      setFilterPos(null);
      if (contextMenuRef.current  && !contextMenuRef.current.contains(t))                                           setContextMenu(null);
      if (passCtxMenuRef.current  && !passCtxMenuRef.current.contains(t))                                          setPassCtxMenu(null);
      if (nodeCtxMenuRef.current  && !nodeCtxMenuRef.current.contains(t))                                          setNodeCtxMenu(null);

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
  const bufNames = useMemo(() => new Map(resources.buffers.map((b) => [b.id, b.name])),       [resources]);
  const rtMap    = useMemo(() => new Map(resources.renderTargets.map((r) => [r.id, r])),      [resources]);
  const bufMap   = useMemo(() => new Map(resources.buffers.map((b) => [b.id, b])),            [resources]);
  const paramMap = useMemo(() => new Map(resources.inputParameters.map((p) => [p.id, p])),   [resources]);

  // Overlay rows: ordered by resourceOrder, filtered to existing IDs, plus selected if it's an inputParam
  const validResIds = useMemo(() => new Set([
    ...resources.renderTargets.map((r) => r.id),
    ...resources.buffers.map((b) => b.id),
  ]), [resources.renderTargets, resources.buffers]);

  const overlayRows = useMemo(() => {
    const rows = resourceOrder.filter((id) => validResIds.has(id));
    if (selectedResourceId && !validResIds.has(selectedResourceId)) rows.push(selectedResourceId);
    return rows;
  }, [resourceOrder, validResIds, selectedResourceId]);

  const layout = useLayout(pipeline, allEdges, overlayRows.length);

  // Access map keyed by rid (unordered)
  const allAccessMaps = useMemo(
    () => new Map(overlayRows.map((rid) => [rid, derivePassAccess(rid, pipeline)])),
    [overlayRows, pipeline],
  );

  // Span info (min/max column x) per resource, used for sorting
  const resourceSpans = useMemo(() => {
    const spans = new Map<ResourceId, { minX: number; maxX: number }>();
    for (const [rid, map] of allAccessMaps) {
      const xs = [...layout.passLayouts.values()]
        .filter(({ passId }) => map.has(passId))
        .map(({ x }) => x);
      spans.set(rid, {
        minX: xs.length > 0 ? Math.min(...xs) : Infinity,
        maxX: xs.length > 0 ? Math.max(...xs) : -Infinity,
      });
    }
    return spans;
  }, [allAccessMaps, layout.passLayouts]);

  // Display order: sorted when sortMode !== 'manual', otherwise follows resourceOrder
  const displayRows = useMemo(() => {
    if (sortMode === 'manual') return overlayRows;
    return [...overlayRows].sort((a, b) => {
      const sa = resourceSpans.get(a) ?? { minX: Infinity, maxX: -Infinity };
      const sb = resourceSpans.get(b) ?? { minX: Infinity, maxX: -Infinity };
      switch (sortMode) {
        case 'firstUse':     return sa.minX - sb.minX;
        case 'lastUse':      return sb.maxX - sa.maxX;
        case 'longestSpan':  return (sb.maxX - sb.minX) - (sa.maxX - sa.minX);
        case 'shortestSpan': return (sa.maxX - sa.minX) - (sb.maxX - sb.minX);
      }
    });
  }, [overlayRows, sortMode, resourceSpans]);

  const usageMap    = useMemo(() => getResourceUsage(pipeline), [pipeline]);
  const deadWriteIds = useMemo(() => {
    const dead = new Set<string>();
    for (const [rid, usage] of usageMap) {
      if (usage.writers.length > 0 && usage.readers.length === 0) dead.add(rid);
    }
    return dead;
  }, [usageMap]);

  // ── Filter logic ───────────────────────────────────────────────────────────

  // RTs that have at least one non-overlapping partner (aliasing candidates):
  // for each (rt1, rt2) pair — if their spans don't intersect, add both.
  const nonOverlapRtIds = useMemo(() => {
    const rtIds = new Set(resources.renderTargets.map((r) => r.id));
    const rtSpans = [...resourceSpans.entries()].filter(
      ([rid]) => rtIds.has(rid) && resourceSpans.get(rid)!.minX !== Infinity,
    );
    const result = new Set<ResourceId>();
    for (const [rid1, s1] of rtSpans) {
      for (const [rid2, s2] of rtSpans) {
        if (rid1 === rid2) continue;
        // No overlap: one ends before the other starts
        if (s1.maxX < s2.minX || s2.maxX < s1.minX) {
          result.add(rid1);
          result.add(rid2);
        }
      }
    }
    return result;
  }, [resources.renderTargets, resourceSpans]);

  const hasActiveFilter = filterText !== '' || filterTypes.size > 0 || filterDead || filterUnused || filterNonOverlap;

  const filteredRows = useMemo(() => {
    if (!hasActiveFilter) return displayRows;
    const txt = filterText.toLowerCase();
    return displayRows.filter((rid) => {
      const rt    = rtMap.get(rid);
      const buf   = bufMap.get(rid);
      const param = paramMap.get(rid);
      const name  = rt?.name ?? buf?.name ?? param?.name ?? rid;
      if (txt && !name.toLowerCase().includes(txt)) return false;
      if (filterTypes.size > 0) {
        if (rt    && !filterTypes.has('rt'))    return false;
        if (buf   && !filterTypes.has('buf'))   return false;
        if (param && !filterTypes.has('param')) return false;
      }
      if (filterDead   && !deadWriteIds.has(rid)) return false;
      if (filterUnused) {
        const u = usageMap.get(rid);
        if (u && (u.writers.length > 0 || u.readers.length > 0)) return false;
      }
      if (filterNonOverlap && !nonOverlapRtIds.has(rid)) return false;
      return true;
    });
  }, [displayRows, filterText, filterTypes, filterDead, filterUnused, filterNonOverlap,
      rtMap, bufMap, paramMap, deadWriteIds, usageMap, nonOverlapRtIds, hasActiveFilter]);

  const filteredAccessMaps = useMemo(
    () => filteredRows.map((rid) => ({ rid, map: allAccessMaps.get(rid) ?? new Map() })),
    [filteredRows, allAccessMaps],
  );

  const resolveIds = (ids: string[]) =>
    ids.map((id) => rtNames.get(id) ?? bufNames.get(id) ?? id).join(', ');

  // ── Resource row DnD ───────────────────────────────────────────────────────
  const resSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onResourceDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = filteredRows.indexOf(active.id as ResourceId);
      const newIdx = filteredRows.indexOf(over.id as ResourceId);
      const reordered = arrayMove(filteredRows, oldIdx, newIdx);
      setResourceOrder(reordered.filter((id) => validResIds.has(id)));
      setSortMode('manual');
    }
  };

  // ── Resource context menu ──────────────────────────────────────────────────
  const openContextMenu = (rid: ResourceId, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ rid, x: e.clientX, y: e.clientY });
  };
  const bringToTop = (rid: ResourceId) => {
    setResourceOrder([rid, ...resourceOrder.filter((id) => id !== rid)]);
    setSortMode('manual');
    setContextMenu(null);
  };
  const bringToBottom = (rid: ResourceId) => {
    setResourceOrder([...resourceOrder.filter((id) => id !== rid), rid]);
    setSortMode('manual');
    setContextMenu(null);
  };

  // ── Resource creation ──────────────────────────────────────────────────────
  const createRenderTarget = () => {
    const id = newId();
    addRenderTarget({ id, name: 'NewRenderTarget', format: 'rgba8', width: 'viewport.width', height: 'viewport.height', mips: 1, layers: 1 });
    selectResource(id);
    setAddResPos(null);
  };
  const createBuffer = () => {
    const id = newId();
    addBuffer({ id, name: 'NewBuffer', size: 1024 });
    selectResource(id);
    setAddResPos(null);
  };
  const createInputParam = () => {
    const id = newId();
    addInputParameter({ id, name: 'NewParam', type: 'float', defaultValue: '0.0' });
    selectResource(id);
    setAddResPos(null);
  };

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

  // ── Pass drag-to-reorder ───────────────────────────────────────────────────
  const containerMouseX = useCallback((clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return clientX;
    return clientX - el.getBoundingClientRect().left + el.scrollLeft;
  }, []);

  const containerMouseY = useCallback((clientY: number): number => {
    const el = scrollRef.current;
    if (!el) return clientY;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  }, []);

  const timelineFromY = useCallback((mouseY: number): TimelineId | null => {
    for (let i = 0; i < pipeline.timelines.length; i++) {
      const rowY = PAD_T + i * ROW_H;
      if (mouseY >= rowY && mouseY < rowY + ROW_H) return pipeline.timelines[i].id;
    }
    return null;
  }, [pipeline.timelines]);

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

  // For cross-TL hover: find the rightmost pass whose center is left of the cursor
  const computeDepTarget = useCallback((mouseX: number, tlId: TimelineId): PassId | null => {
    const tl = pipeline.timelines.find((t) => t.id === tlId);
    if (!tl) return null;
    let best: PassId | null = null;
    let bestX = -Infinity;
    for (const pid of tl.passIds) {
      const pl = layout.passLayouts.get(pid);
      if (!pl) continue;
      if (pl.x + NODE_W / 2 < mouseX && pl.x > bestX) {
        bestX = pl.x;
        best = pid;
      }
    }
    return best;
  }, [pipeline, layout]);

  const startDrag = useCallback((passId: PassId, tlId: TimelineId, nodeX: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const mx = containerMouseX(e.clientX);
    const my = containerMouseY(e.clientY);
    setDrag({ passId, sourceTlId: tlId, targetTlId: tlId, depTargetPassId: null, nodeX, offsetX: mx - nodeX, mouseX: mx, mouseY: my });
    setDropIdx(computeDropIndex(mx, passId, tlId));
  }, [containerMouseX, containerMouseY, computeDropIndex]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const mx = containerMouseX(e.clientX);
      const my = containerMouseY(e.clientY);
      const hitTlId = timelineFromY(my) ?? drag.targetTlId;
      const isCross = hitTlId !== drag.sourceTlId;
      setDrag((d) => d ? { ...d, mouseX: mx, mouseY: my, targetTlId: hitTlId,
        depTargetPassId: isCross ? computeDepTarget(mx, hitTlId) : null } : null);
      if (isCross) setDropIdx(null);
      else setDropIdx(computeDropIndex(mx, drag.passId, hitTlId));
    };
    const onUp = () => {
      setDrag((d) => {
        if (!d) return null;
        if (d.sourceTlId !== d.targetTlId) {
          // Cross-TL drop: create manual dependency on the pass to the left
          if (d.depTargetPassId) addManualDep(d.passId, d.depTargetPassId);
        } else {
          // Same-TL drop: reorder
          const tl = pipeline.timelines.find((t) => t.id === d.sourceTlId);
          if (tl) {
            const siblings = tl.passIds
              .filter((pid) => pid !== d.passId)
              .map((pid) => ({ pid, x: layout.passLayouts.get(pid)?.x ?? 0 }))
              .sort((a, b) => a.x - b.x);
            const idx = computeDropIndex(d.mouseX, d.passId, d.sourceTlId);
            const newOrder = siblings.map((s) => s.pid);
            newOrder.splice(idx, 0, d.passId);
            reorderPassesInTimeline(d.sourceTlId, newOrder);
          }
        }
        return null;
      });
      setDropIdx(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, pipeline, layout, computeDropIndex, computeDepTarget, reorderPassesInTimeline, addManualDep, containerMouseX, containerMouseY, timelineFromY]);

  const dropIndicator = useMemo((): { x: number; y: number; h: number; color: string } | null => {
    if (!drag) return null;
    const isCross = drag.sourceTlId !== drag.targetTlId;

    if (isCross) {
      // Cross-TL: amber line at the right edge of the dep target pass
      if (!drag.depTargetPassId) return null;
      const pl = layout.passLayouts.get(drag.depTargetPassId);
      if (!pl) return null;
      const tl = pipeline.timelines.find((t) => t.id === drag.targetTlId);
      if (!tl) return null;
      const rowTop = PAD_T + pipeline.timelines.indexOf(tl) * ROW_H;
      return { x: pl.x + NODE_W + 2, y: rowTop + 4, h: ROW_H - 8, color: '#f59e0b' };
    }

    // Same-TL: blue gap indicator
    if (dropIdx === null) return null;
    const tl = pipeline.timelines.find((t) => t.id === drag.targetTlId);
    if (!tl) return null;
    const tlIdx = pipeline.timelines.indexOf(tl);
    const siblings = tl.passIds
      .filter((pid) => pid !== drag.passId)
      .map((pid) => layout.passLayouts.get(pid)?.x ?? 0)
      .sort((a, b) => a - b);
    let x: number;
    if (siblings.length === 0)           x = COL_GAP / 2;
    else if (dropIdx === 0)              x = siblings[0] - COL_GAP / 2;
    else if (dropIdx >= siblings.length) x = siblings[siblings.length - 1] + NODE_W + COL_GAP / 2;
    else x = (siblings[dropIdx - 1] + NODE_W + siblings[dropIdx]) / 2;
    const rowTop = PAD_T + tlIdx * ROW_H;
    return { x, y: rowTop + 4, h: ROW_H - 8, color: '#3b82f6' };
  }, [drag, dropIdx, pipeline, layout]);

  const crossCount = allEdges.filter((e) => e.isCrossTimeline).length;

  // Resources used by the selected pass (reads + writes)
  const passResourceIds = useMemo(() => {
    if (!selectedPassId) return new Set<ResourceId>();
    const pass = pipeline.passes[selectedPassId];
    if (!pass) return new Set<ResourceId>();
    return new Set<ResourceId>([...pass.reads, ...pass.writes]);
  }, [selectedPassId, pipeline.passes]);

  // Active resource IDs for row highlighting:
  // In non-overlap mode with a single RT selected, highlight the selected RT + all
  // filtered RTs that don't overlap with it. Otherwise fall back to manual / pass-driven.
  const activeResourceIds = useMemo((): Set<ResourceId> => {
    if (filterNonOverlap && selectedResourceIds.size === 1) {
      const selId   = [...selectedResourceIds][0];
      const selSpan = resourceSpans.get(selId);
      if (selSpan && selSpan.minX !== Infinity && rtMap.has(selId)) {
        const partners = new Set<ResourceId>([selId]);
        for (const rid of filteredRows) {
          if (rid === selId || !rtMap.has(rid)) continue;
          const span = resourceSpans.get(rid);
          if (!span || span.minX === Infinity) continue;
          if (selSpan.maxX < span.minX || span.maxX < selSpan.minX) partners.add(rid);
        }
        return partners;
      }
    }
    if (selectedResourceIds.size > 0) return selectedResourceIds;
    return passResourceIds;
  }, [filterNonOverlap, selectedResourceIds, filteredRows, resourceSpans, rtMap, passResourceIds]);
  const hasResourceFocus = activeResourceIds.size > 0;

  // ── Resource focus: dim unrelated passes (only when resources are manually selected) ──
  const { writingPassIds, readingPassIds } = useMemo(() => {
    if (selectedResourceIds.size === 0) return { writingPassIds: new Set<PassId>(), readingPassIds: new Set<PassId>() };
    const writing = new Set<PassId>();
    const reading = new Set<PassId>();
    for (const rid of selectedResourceIds) {
      for (const pass of Object.values(pipeline.passes)) {
        if (pass.writes.includes(rid)) writing.add(pass.id);
        if (pass.reads.includes(rid))  reading.add(pass.id);
      }
    }
    return { writingPassIds: writing, readingPassIds: reading };
  }, [pipeline.passes, selectedResourceIds]);

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
              const cfg       = cfgFor(tl.type);
              const passCount = tl.passIds.length;
              const topY      = PAD_T + i * ROW_H;
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

            {/* Resource zone header */}
            <div
              className="absolute flex items-center gap-1 px-2 border-t border-zinc-700/50"
              style={{ left: 0, top: layout.resourceZoneTop, width: LABEL_W - 4, height: RESOURCE_ZONE_H, background: 'rgba(0,0,0,0.18)' }}>
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 flex-1">Resources</span>
              {/* Filter button */}
              <button
                ref={filterBtnRef}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setFilterPos(filterPos ? null : { x: r.left, y: r.bottom + 4 });
                }}
                className={`text-[9px] px-1 py-0.5 rounded border border-dashed transition-colors font-mono leading-none relative
                  ${hasActiveFilter
                    ? 'border-sky-500/70 text-sky-400 hover:text-sky-200'
                    : 'border-zinc-700/60 text-zinc-600 hover:text-zinc-300 hover:border-zinc-500'}`}
                title="Filter resources">
                🔍
                {hasActiveFilter && (
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-sky-400" />
                )}
              </button>
              {/* Sort button */}
              <button
                ref={sortBtnRef}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSortMenuPos(sortMenuPos ? null : { x: r.left, y: r.bottom + 4 });
                }}
                className={`text-[9px] px-1 py-0.5 rounded border border-dashed transition-colors font-mono leading-none
                  ${sortMode !== 'manual'
                    ? 'border-purple-600/60 text-purple-400 hover:text-purple-200'
                    : 'border-zinc-700/60 text-zinc-600 hover:text-zinc-300 hover:border-zinc-500'}`}
                title="Sort resources">⇅</button>
              {/* Add resource button */}
              <button
                ref={addResBtnRef}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setAddResPos(addResPos ? null : { x: r.left, y: r.bottom + 4 });
                }}
                className="text-[9px] px-1.5 py-0.5 rounded border border-dashed border-zinc-700/60 text-zinc-600 hover:text-zinc-300 hover:border-zinc-500 transition-colors font-mono leading-none"
                title="Add resource">+</button>
            </div>

            {/* Sortable resource label rows (DnD) */}
            <div style={{ position: 'absolute', top: layout.overlayY, left: 0, width: LABEL_W - 4 }}>
              <DndContext sensors={resSensors} collisionDetection={closestCenter} onDragEnd={onResourceDragEnd}>
                <SortableContext items={filteredRows} strategy={verticalListSortingStrategy}>
                  {filteredRows.map((rid) => {
                    const rtObj    = rtMap.get(rid);
                    const bufObj   = bufMap.get(rid);
                    const paramObj = paramMap.get(rid);
                    const name     = resolveIds([rid]);
                    const tooltip  = rtObj
                      ? `${rtObj.name}\nType: Render Target\nFormat: ${rtObj.format}\nSize: ${rtObj.width} × ${rtObj.height}\nMips: ${rtObj.mips}`
                      : bufObj
                      ? `${bufObj.name}\nType: Buffer\nSize: ${bufObj.size}`
                      : paramObj
                      ? `${paramObj.name}\nType: Input Param (${paramObj.type})\nDefault: ${paramObj.defaultValue}`
                      : name;
                    const isRT    = rtNames.has(rid);
                    const icon    = isRT ? '▣' : '▤';
                    const iconCls = isRT ? 'text-blue-400/80' : 'text-amber-400/80';
                    const isDead  = deadWriteIds.has(rid);
                    return (
                      <SortableResourceLabel
                        key={rid}
                        rid={rid}
                        name={name}
                        tooltip={tooltip}
                        icon={icon}
                        iconCls={iconCls}
                        isDead={isDead}
                        isSelected={activeResourceIds.has(rid)}
                        isDimmed={hasResourceFocus && !activeResourceIds.has(rid)}
                        isDraggable={sortMode === 'manual' && !hasActiveFilter}
                        onSelect={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            const next = new Set(selectedResourceIds);
                            if (next.has(rid)) {
                              next.delete(rid);
                              selectResource(next.size > 0 ? [...next][next.size - 1] : null);
                            } else {
                              next.add(rid);
                              selectResource(rid);
                            }
                            setSelectedResourceIds(next);
                          } else {
                            const isSole = selectedResourceIds.size === 1 && selectedResourceIds.has(rid);
                            setSelectedResourceIds(isSole ? new Set() : new Set([rid]));
                            selectResource(isSole ? null : rid);
                          }
                        }}
                        onContextMenu={(e) => openContextMenu(rid, e)}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>

              {filteredRows.length === 0 && displayRows.length === 0 && (
                <div className="text-[10px] text-zinc-700 italic px-2 py-1">
                  No resources yet. Click + to add one.
                </div>
              )}
              {filteredRows.length === 0 && displayRows.length > 0 && (
                <div className="text-[10px] text-zinc-600 italic px-2 py-1">
                  No matches.
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Scrollable canvas */}
        <div ref={scrollRef} className="flex-1 overflow-auto"
          onContextMenu={(e) => {
            e.preventDefault();
            if (pipeline.timelines.length === 0) return;
            const mx = containerMouseX(e.clientX);
            const my = containerMouseY(e.clientY);
            const tlId = timelineFromY(my);
            setPassCtxMenu({ tlId, canvasX: mx, x: e.clientX, y: e.clientY });
            setNodeCtxMenu(null);
          }}>
          <div className="relative" style={{ width: layout.totalW, height: layout.totalH, minWidth: '100%', minHeight: '100%' }}>

            {/* SVG: row backgrounds, overlay separators/spans, wires, arrows */}
            <svg className="absolute inset-0" width={layout.totalW} height={layout.totalH}
              style={{ overflow: 'visible' }}>
              <defs>
                {(['gray', 'gray-hi', 'purple', 'purple-hi', 'amber', 'amber-hi'] as const).map((id) => {
                  const fill = id === 'gray' ? '#3f3f46' : id === 'gray-hi' ? '#71717a'
                             : id === 'purple' ? '#9333ea' : id === 'purple-hi' ? '#c084fc'
                             : id === 'amber' ? '#d97706' : '#fbbf24';
                  return (
                    <marker key={id} id={`tlv-${id}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                      <polygon points="0 0, 7 2.5, 0 5" fill={fill} />
                    </marker>
                  );
                })}
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
                const cfg     = cfgFor(tl.type);
                const rowY    = PAD_T + i * ROW_H;
                const wireY   = rowY + ROW_H / 2;
                const isDepTarget = drag && drag.sourceTlId !== drag.targetTlId && drag.targetTlId === tl.id;
                return (
                  <g key={tl.id} style={{ pointerEvents: 'none' }}>
                    <rect x={0} y={rowY} width={layout.totalW} height={ROW_H}
                      fill={isDepTarget ? 'rgba(245,158,11,0.08)' : (i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent')} />
                    {isDepTarget && (
                      <rect x={0} y={rowY} width={layout.totalW} height={ROW_H}
                        fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.4} />
                    )}
                    <line x1={0} y1={wireY} x2={layout.totalW - 8} y2={wireY}
                      stroke={cfg.wire} strokeWidth={1.5} strokeDasharray="6 10" opacity={0.28} />
                  </g>
                );
              })}

              {/* Resource zone separator + header background */}
              <rect x={0} y={layout.resourceZoneTop} width={layout.totalW} height={RESOURCE_ZONE_H}
                fill="rgba(0,0,0,0.12)" style={{ pointerEvents: 'none' }} />
              <line x1={0} y1={layout.resourceZoneTop} x2={layout.totalW} y2={layout.resourceZoneTop}
                stroke="#27272a" strokeWidth={1.5} opacity={0.8} style={{ pointerEvents: 'none' }} />

              {/* Selected pass column highlight in resource overlay */}
              {selectedPassId && filteredRows.length > 0 && (() => {
                const pl = layout.passLayouts.get(selectedPassId);
                if (!pl) return null;
                const h = filteredRows.length * OVERLAY_H;
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect x={pl.x} y={layout.overlayY} width={NODE_W} height={h}
                      fill="rgba(147,51,234,0.10)" />
                    <line x1={pl.x} y1={layout.overlayY} x2={pl.x} y2={layout.overlayY + h}
                      stroke="#a855f7" strokeWidth={1} opacity={0.5} />
                    <line x1={pl.x + NODE_W} y1={layout.overlayY} x2={pl.x + NODE_W} y2={layout.overlayY + h}
                      stroke="#a855f7" strokeWidth={1} opacity={0.5} />
                  </g>
                );
              })()}

              {/* Overlay row backgrounds + lifetime spans */}
              {filteredAccessMaps.map(({ rid, map }, i) => {
                const rowY      = layout.overlayY + i * OVERLAY_H;
                const isSelected = activeResourceIds.has(rid);
                const xs   = [...layout.passLayouts.values()]
                  .filter(({ passId }) => map.has(passId))
                  .map(({ x }) => x);
                const minX = xs.length > 0 ? Math.min(...xs) : null;
                const maxX = xs.length > 0 ? Math.max(...xs) + NODE_W : null;
                const isDead     = deadWriteIds.has(rid);
                const isDimmed   = hasResourceFocus && !isSelected;
                const spanFill   = isDead ? 'rgba(217,119,6,0.18)'   : 'rgba(147,51,234,0.18)';
                const spanFillDim = isDead ? 'rgba(217,119,6,0.10)'  : 'rgba(147,51,234,0.10)';
                const edgeStroke = isDead ? '#f59e0b' : '#a855f7';
                const rowFill    = isSelected
                  ? (isDead ? 'rgba(120,53,15,0.18)' : 'rgba(88,28,135,0.14)')
                  : (isDead ? 'rgba(120,53,15,0.06)' : 'rgba(88,28,135,0.04)');
                const sepStroke  = isDead ? '#92400e' : '#6b21a8';
                return (
                  <g key={rid} style={{ pointerEvents: 'none', opacity: isDimmed ? 0.25 : 1 }}>
                    <rect x={0} y={rowY} width={layout.totalW} height={OVERLAY_H} fill={rowFill} />
                    {isSelected && (
                      <rect x={0} y={rowY} width={layout.totalW} height={OVERLAY_H}
                        fill="none" stroke={isDead ? '#f59e0b' : '#a855f7'} strokeWidth={1} opacity={0.5} />
                    )}
                    <line x1={0} y1={rowY} x2={layout.totalW} y2={rowY}
                      stroke={sepStroke} strokeWidth={1} strokeDasharray="4 6"
                      opacity={isSelected ? 0.7 : 0.4} />
                    {minX !== null && maxX !== null && (
                      <>
                        <rect x={minX} y={rowY + 1} width={maxX - minX} height={OVERLAY_H - 2}
                          fill={isSelected ? spanFill : spanFillDim} rx={2} />
                        <line x1={minX} y1={rowY + 3} x2={minX} y2={rowY + OVERLAY_H - 3}
                          stroke={edgeStroke} strokeWidth={isSelected ? 2.5 : 2} strokeLinecap="round" />
                        <line x1={maxX} y1={rowY + 3} x2={maxX} y2={rowY + OVERLAY_H - 3}
                          stroke={edgeStroke} strokeWidth={isSelected ? 2.5 : 2} strokeLinecap="round" />
                      </>
                    )}
                  </g>
                );
              })}

              {/* Drop / dep indicator */}
              {dropIndicator && (
                <line
                  x1={dropIndicator.x} y1={dropIndicator.y}
                  x2={dropIndicator.x} y2={dropIndicator.y + dropIndicator.h}
                  stroke={dropIndicator.color} strokeWidth={2} strokeDasharray="3 3"
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {/* Arrows */}
              {arrowEdges.map((edge) => {
                const from = layout.passLayouts.get(edge.fromPassId);
                const to   = layout.passLayouts.get(edge.toPassId);
                if (!from || !to) return null;
                const isCross   = edge.isCrossTimeline;
                const isManual  = !!edge.isManual;
                const isFocused = hoveredEdge === edge.id || (!!selectedPassId &&
                  (edge.fromPassId === selectedPassId || edge.toPassId === selectedPassId));
                const stroke   = isManual
                  ? (isFocused ? '#fbbf24' : '#d97706')
                  : isCross
                  ? (isFocused ? '#c084fc' : '#9333ea')
                  : (isFocused ? '#71717a' : '#3f3f46');
                const strokeW  = isManual
                  ? (isFocused ? 2.5 : 2)
                  : isCross ? (isFocused ? 2.5 : 2) : (isFocused ? 1.5 : 1);
                const opacity  = isFocused ? 1 : (isCross || isManual) ? 0.78 : 0.4;
                const markerId = isManual
                  ? (isFocused ? 'tlv-amber-hi' : 'tlv-amber')
                  : isCross ? (isFocused ? 'tlv-purple-hi' : 'tlv-purple')
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
                      <title>{isManual ? 'manual sync' : resolveIds(edge.resourceIds)}</title>
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
              const isDragging   = drag?.passId === passId;
              const isDepAnchor  = !isDragging && drag?.sourceTlId !== drag?.targetTlId && drag?.depTargetPassId === passId;
              const translateX   = isDragging ? drag!.mouseX - drag!.offsetX - drag!.nodeX : 0;
              const isWriter     = writingPassIds.has(passId);
              const isReader     = readingPassIds.has(passId);
              const isDimmed     = selectedResourceIds.size > 0 && !isWriter && !isReader;

              return (
                <div key={passId}
                  style={{ transform: isDragging ? `translateX(${translateX}px)` : undefined, zIndex: isDragging ? 50 : undefined }}>
                  <div className="absolute"
                    style={{ left: x, top: y, width: NODE_W, height: NODE_H, opacity: isDimmed ? 0.2 : 1 }}>
                    {/* Node */}
                    <div
                      className={`
                        flex items-center rounded border text-xs font-medium
                        transition-colors overflow-hidden
                        ${isSelected ? `${cfg.nodeHl} shadow-lg` : `${cfg.nodeBg} hover:brightness-125`}
                        ${!pass.enabled ? 'opacity-50' : ''}
                        ${isDragging ? 'shadow-2xl ring-1 ring-blue-400/50' : ''}
                        ${isDepAnchor ? 'ring-2 ring-amber-400/80 shadow-amber-900/40 shadow-lg' : ''}
                        ${isWriter && !isSelected ? 'ring-1 ring-amber-500/80' : ''}
                        ${isReader && !isWriter && !isSelected ? 'ring-1 ring-sky-500/80' : ''}
                      `}
                      style={{ height: NODE_H, cursor: isDragging ? 'grabbing' : 'pointer' }}
                      onClick={() => { if (!isEditing && !isDragging) selectPass(passId); }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setNodeCtxMenu({ passId, x: e.clientX, y: e.clientY });
                        setPassCtxMenu(null);
                      }}>
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
                      {!isEditing && selectedResourceIds.size > 0 && (isWriter || isReader) && (
                        <span className={`shrink-0 pr-1 text-[8px] font-bold font-mono
                          ${isWriter && isReader ? 'text-amber-400' : isWriter ? 'text-amber-400' : 'text-sky-400'}`}>
                          {isWriter && isReader ? 'RW' : isWriter ? 'W' : 'R'}
                        </span>
                      )}
                      {!isEditing && !pass.enabled && (
                        <span className="shrink-0 pr-1.5 text-[8px] italic text-zinc-500">off</span>
                      )}
                    </div>
                  </div>

                  {/* Condition tags — above node, right-aligned */}
                  {pass.conditions.length > 0 && (
                    <div className="absolute flex items-center justify-end gap-0.5 overflow-hidden"
                      style={{ left: x, top: y - BAR_H, width: NODE_W, height: BAR_H, pointerEvents: 'none' }}>
                      {pass.conditions.slice(0, 2).map((c) => (
                        <span key={c}
                          className="text-[8px] bg-amber-950/80 text-amber-400 border border-amber-800/60 rounded-sm px-1 font-mono leading-3 truncate shrink-0 max-w-[56px]">
                          {c}
                        </span>
                      ))}
                      {pass.conditions.length > 2 && (
                        <span className="text-[8px] text-amber-600/70 font-mono shrink-0">+{pass.conditions.length - 2}</span>
                      )}
                    </div>
                  )}

                  {/* Step chips — below node */}
                  {pass.steps.length > 0 && (
                    <div className="absolute flex items-center gap-0.5 overflow-hidden"
                      style={{ left: x, top: y + NODE_H + 4, width: NODE_W, height: STEPS_STRIP_H }}>
                      {pass.steps.slice(0, 6).map((sid) => {
                        const step = pipeline.steps[sid];
                        if (!step) return null;
                        const cls = STEP_CHIP_CLS[step.type] ?? 'bg-zinc-700/60 text-zinc-400 border-zinc-600/40';
                        return (
                          <span key={sid}
                            className={`text-[7px] font-mono font-bold border rounded-sm px-1 leading-[14px] shrink-0 ${cls}`}
                            title={step.name || step.type}>
                            {STEP_ABBR[step.type] ?? '?'}
                          </span>
                        );
                      })}
                      {pass.steps.length > 6 && (
                        <span className="text-[8px] text-zinc-600 font-mono shrink-0">+{pass.steps.length - 6}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Overlay R/W/RW badges */}
            {filteredAccessMaps.map(({ rid, map }, rowIdx) => {
              const name     = resolveIds([rid]);
              const isDimmed = hasResourceFocus && !activeResourceIds.has(rid);
              return [...layout.passLayouts.values()].map(({ passId, x }) => {
                const access = map.get(passId);
                if (!access) return null;
                const badgeCls = access === 'read'
                  ? 'bg-sky-900/70 text-sky-300 border-sky-700/60 hover:bg-sky-800/80'
                  : access === 'write'
                  ? 'bg-amber-900/70 text-amber-300 border-amber-700/60 hover:bg-amber-800/80'
                  : 'bg-purple-900/70 text-purple-300 border-purple-700/60 hover:bg-purple-800/80';
                const label         = access === 'readwrite' ? 'RW' : access === 'read' ? 'R' : 'W';
                const tooltipAction = access === 'readwrite' ? 'reads & writes' : `${access}s`;
                const rowY = layout.overlayY + rowIdx * OVERLAY_H;
                return (
                  <div key={`overlay-${rid}-${passId}`}
                    className={`absolute flex items-center justify-center border rounded-sm cursor-pointer text-[9px] font-bold font-mono transition-colors ${badgeCls}`}
                    style={{ left: x + (NODE_W - 28) / 2, top: rowY + (OVERLAY_H - 18) / 2, width: 28, height: 18, opacity: isDimmed ? 0.25 : 1 }}
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

          </div>
        </div>

      </div>

      {/* Filter panel (fixed overlay) */}
      {filterPos && (
        <div ref={filterMenuRef}
          className="fixed z-200 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
          style={{ left: filterPos.x, top: filterPos.y, width: 220 }}>

          {/* Name search */}
          <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800">
            <input
              autoFocus
              type="text"
              placeholder="Search by name…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-sky-600"
            />
          </div>

          {/* Type chips */}
          <div className="px-3 py-2 border-b border-zinc-800">
            <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mb-1.5">Type</div>
            <div className="flex gap-1.5 flex-wrap">
              {([
                { key: 'rt',    label: '▣ RT',    cls: 'text-blue-300 border-blue-700/60 bg-blue-950/40' },
                { key: 'buf',   label: '▤ Buffer', cls: 'text-amber-300 border-amber-700/60 bg-amber-950/40' },
                { key: 'param', label: '◆ Param',  cls: 'text-zinc-300 border-zinc-600 bg-zinc-800/60' },
              ] as { key: ResTypeFilter; label: string; cls: string }[]).map(({ key, label, cls }) => {
                const active = filterTypes.has(key);
                return (
                  <button key={key}
                    onClick={() => {
                      const next = new Set(filterTypes);
                      if (active) next.delete(key); else next.add(key);
                      setFilterTypes(next);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors
                      ${active ? cls : 'border-zinc-700/50 text-zinc-600 hover:text-zinc-400 hover:border-zinc-500'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toggle flags */}
          <div className="px-3 py-2 flex flex-col gap-1.5">
            {[
              { state: filterDead,       set: setFilterDead,       label: '⚠ Dead writes only',          desc: 'Written but never read' },
              { state: filterUnused,     set: setFilterUnused,     label: '∅ Unused only',               desc: 'Not referenced by any pass' },
              { state: filterNonOverlap, set: setFilterNonOverlap, label: '⇄ Non-overlapping RTs only',  desc: 'Render targets with no temporal overlap — aliasing candidates' },
            ].map(({ state, set, label, desc }) => (
              <label key={label} className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" checked={state} onChange={(e) => set(e.target.checked)}
                  className="w-3 h-3 accent-sky-500 shrink-0" />
                <span className="text-[10px] text-zinc-400 group-hover:text-zinc-200 transition-colors" title={desc}>{label}</span>
              </label>
            ))}
          </div>

          {/* Clear */}
          {hasActiveFilter && (
            <div className="px-3 pb-2 pt-0.5 border-t border-zinc-800">
              <button
                onClick={() => { setFilterText(''); setFilterTypes(new Set()); setFilterDead(false); setFilterUnused(false); setFilterNonOverlap(false); }}
                className="text-[10px] text-zinc-600 hover:text-sky-400 transition-colors">
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sort menu (fixed overlay) */}
      {sortMenuPos && (
        <div ref={sortMenuRef}
          className="fixed z-200 bg-zinc-800 border border-zinc-600 rounded shadow-2xl overflow-hidden"
          style={{ left: sortMenuPos.x, top: sortMenuPos.y, minWidth: 144 }}>
          {SORT_OPTS.map((opt) => (
            <button key={opt.value}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-zinc-700
                ${sortMode === opt.value ? 'text-purple-300' : 'text-zinc-300'}`}
              onClick={() => { setSortMode(opt.value); setSortMenuPos(null); }}>
              {sortMode === opt.value ? '● ' : '○ '}{opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Add resource menu (fixed overlay) */}
      {addResPos && (
        <div ref={addResRef}
          className="fixed z-200 bg-zinc-800 border border-zinc-600 rounded shadow-2xl overflow-hidden"
          style={{ left: addResPos.x, top: addResPos.y, minWidth: 160 }}>
          <button className="w-full text-left px-3 py-1.5 text-xs text-blue-300 hover:bg-zinc-700 font-mono"
            onClick={createRenderTarget}>▣ Render Target</button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-amber-300 hover:bg-zinc-700 font-mono"
            onClick={createBuffer}>▤ Buffer</button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 font-mono"
            onClick={createInputParam}>◆ Input Param</button>
        </div>
      )}

      {/* Resource context menu (fixed overlay at cursor) */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-200 bg-zinc-800 border border-zinc-600 rounded shadow-2xl py-0.5 min-w-36 overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
            onClick={() => bringToTop(contextMenu.rid)}>
            <span className="text-zinc-500">↑</span> Bring to top
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
            onClick={() => bringToBottom(contextMenu.rid)}>
            <span className="text-zinc-500">↓</span> Bring to bottom
          </button>
        </div>
      )}

      {/* Canvas right-click: add pass */}
      {passCtxMenu && (
        <div ref={passCtxMenuRef}
          className="fixed z-200 bg-zinc-800 border border-zinc-600 rounded shadow-2xl overflow-hidden"
          style={{ left: passCtxMenu.x, top: passCtxMenu.y, minWidth: 180 }}>
          <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 border-b border-zinc-700">
            Add Pass
          </div>
          {pipeline.timelines.map((tl) => {
            const cfg = cfgFor(tl.type);
            const isTarget = tl.id === passCtxMenu.tlId;
            return (
              <button key={tl.id}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 flex items-center gap-2 transition-colors
                  ${isTarget ? 'bg-zinc-700/40' : ''}`}
                onClick={() => {
                  // Compute insertion index based on click X within this timeline
                  const sorted = tl.passIds
                    .map((pid) => ({ pid, x: layout.passLayouts.get(pid)?.x ?? 0 }))
                    .sort((a, b) => a.x - b.x);
                  let insertAt = sorted.length;
                  for (let i = 0; i < sorted.length; i++) {
                    if (passCtxMenu.canvasX < sorted[i].x + NODE_W / 2) { insertAt = i; break; }
                  }
                  addPass(tl.id, insertAt);
                  setPassCtxMenu(null);
                }}>
                <span className={`text-[9px] font-mono ${cfg.label}`}>●</span>
                <span className="text-zinc-200 flex-1">{tl.name}</span>
                {isTarget && <span className="text-[9px] text-zinc-500 font-mono">here</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Pass node right-click: pass actions */}
      {nodeCtxMenu && (() => {
        const pass = pipeline.passes[nodeCtxMenu.passId];
        if (!pass) return null;
        const otherTls = pipeline.timelines.filter((tl) => tl.id !== pass.timelineId);
        return (
          <div ref={nodeCtxMenuRef}
            className="fixed z-200 bg-zinc-800 border border-zinc-600 rounded shadow-2xl overflow-hidden"
            style={{ left: nodeCtxMenu.x, top: nodeCtxMenu.y, minWidth: 168 }}>
            <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 border-b border-zinc-700 truncate">
              {pass.name}
            </div>
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
              onClick={(e) => { startRenamePass(nodeCtxMenu.passId, pass.name, e); setNodeCtxMenu(null); }}>
              <span className="text-zinc-500 text-[10px]">✎</span> Rename
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
              onClick={() => { duplicatePass(nodeCtxMenu.passId); setNodeCtxMenu(null); }}>
              <span className="text-zinc-500 text-[10px]">⧉</span> Duplicate
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 flex items-center gap-2"
              onClick={() => { updatePass(nodeCtxMenu.passId, { enabled: !pass.enabled }); setNodeCtxMenu(null); }}>
              <span className="text-zinc-500 text-[10px]">{pass.enabled ? '○' : '●'}</span>
              {pass.enabled ? 'Disable' : 'Enable'}
            </button>
            {otherTls.length > 0 && (
              <>
                <div className="border-t border-zinc-700/60 my-0.5" />
                {otherTls.map((tl) => {
                  const cfg = cfgFor(tl.type);
                  return (
                    <button key={tl.id}
                      className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                      onClick={() => { movePassToTimeline(nodeCtxMenu.passId, tl.id); setNodeCtxMenu(null); }}>
                      <span className={`text-[9px] font-mono ${cfg.label}`}>↔</span>
                      <span>Move to {tl.name}</span>
                    </button>
                  );
                })}
              </>
            )}
            <div className="border-t border-zinc-700/60 my-0.5" />
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 flex items-center gap-2"
              onClick={(e) => { handleDeletePass(nodeCtxMenu.passId, pass.name, e); setNodeCtxMenu(null); }}>
              <span className="text-[10px]">✕</span> Delete
            </button>
          </div>
        );
      })()}

    </div>
  );
}
