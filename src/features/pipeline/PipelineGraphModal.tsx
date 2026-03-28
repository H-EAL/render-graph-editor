import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useStore } from "../../state/store";
import { useEffectiveResources } from "../../utils/systemResources";
import { deriveDependencies } from "../../utils/dependencyGraph";
import type { DependencyEdge } from "../../utils/dependencyGraph";
import type { Pipeline, ResourceLibrary } from "../../types";

// ── Condition evaluation (mirrors PipelineTreeDrawer logic) ───────────────────

function evalCondStr(c: string, overrides: Record<string, boolean>, defaults: Map<string, boolean>): boolean | undefined {
    const neg = c.startsWith("!");
    const name = neg ? c.slice(1) : c;
    const val = overrides[name] ?? defaults.get(name);
    if (val === undefined) return undefined;
    return neg ? !val : val;
}

function isPassActive(
    conditions: string[],
    overrides: Record<string, boolean>,
    defaults: Map<string, boolean>,
): boolean {
    for (const c of conditions) {
        const result = evalCondStr(c, overrides, defaults);
        if (result === false) return false;
    }
    return true;
}

function buildConditionDefaults(resources: ResourceLibrary): Map<string, boolean> {
    const m = new Map<string, boolean>();
    for (const p of resources.inputParameters) {
        if (p.type === "bool") {
            m.set(p.name, p.defaultValue === "true" || p.defaultValue === "1");
        }
    }
    return m;
}

// ── Layout constants ──────────────────────────────────────────────────────────

const PAD = 44;
const NODE_W = 168;
const NODE_H = 54;
const COL_GAP = 100;
const ROW_GAP = 22;

// Canonical timeline type → hex colour (matches TL_CFG in PipelineTimelineView)
const TL_TYPE_HEX: Record<string, string> = {
    graphics:     "#60a5fa", // blue-400
    asyncCompute: "#34d399", // emerald-400
    transfer:     "#fb923c", // orange-400
    raytracing:   "#a78bfa", // violet-400
    custom:       "#71717a", // zinc-500
};

// ── Graph node ────────────────────────────────────────────────────────────────

interface GraphNode {
    id: string;
    x: number;
    y: number;
    name: string;
    timelineId: string;
    timelineName: string;
    color: string;
}

// ── Layout builder ────────────────────────────────────────────────────────────

function buildLayout(
    pipeline: Pipeline,
    edges: DependencyEdge[],
    conditionOverrides: Record<string, boolean>,
    conditionDefaults: Map<string, boolean>,
) {
    // Only include passes that are enabled and whose conditions are satisfied
    const passIds = Object.keys(pipeline.passes).filter((pid) => {
        const pass = pipeline.passes[pid];
        return pass.enabled && isPassActive(pass.conditions, conditionOverrides, conditionDefaults);
    });
    const empty = {
        nodes: [] as GraphNode[],
        svgW: PAD * 2,
        svgH: PAD * 2,
        nodePos: new Map<string, { x: number; y: number }>(),
        tlColorMap: new Map<string, string>(),
    };
    if (passIds.length === 0) return empty;

    const outs = new Map<string, string[]>();
    const inDeg = new Map<string, number>();
    for (const pid of passIds) { outs.set(pid, []); inDeg.set(pid, 0); }
    for (const e of edges) {
        if (!outs.has(e.fromPassId) || !inDeg.has(e.toPassId)) continue;
        outs.get(e.fromPassId)!.push(e.toPassId);
        inDeg.set(e.toPassId, (inDeg.get(e.toPassId) ?? 0) + 1);
    }

    // Topological order (Kahn's)
    const topo: string[] = [];
    const q = passIds.filter((p) => inDeg.get(p) === 0);
    const rem = new Map(inDeg);
    while (q.length) {
        const p = q.shift()!;
        topo.push(p);
        for (const n of outs.get(p) ?? []) {
            const d = (rem.get(n) ?? 1) - 1;
            rem.set(n, d);
            if (d === 0) q.push(n);
        }
    }
    for (const p of passIds) if (!topo.includes(p)) topo.push(p);

    // Longest-path rank
    const rank = new Map<string, number>(passIds.map((p) => [p, 0]));
    for (const p of topo) {
        const r = rank.get(p) ?? 0;
        for (const n of outs.get(p) ?? []) rank.set(n, Math.max(rank.get(n) ?? 0, r + 1));
    }

    // Group by rank, sort within by timeline + pass order
    const byRank = new Map<number, string[]>();
    for (const p of passIds) {
        const r = rank.get(p) ?? 0;
        if (!byRank.has(r)) byRank.set(r, []);
        byRank.get(r)!.push(p);
    }
    const tlIdx = new Map<string, number>();
    const passInTl = new Map<string, number>();
    const passTl = new Map<string, string>();
    pipeline.timelines.forEach((tl, ti) => {
        tlIdx.set(tl.id, ti);
        tl.passIds.forEach((pid, pi) => { passInTl.set(pid, pi); passTl.set(pid, tl.id); });
    });
    for (const pids of byRank.values()) {
        pids.sort((a, b) => {
            const da = (tlIdx.get(passTl.get(a) ?? "") ?? 99) * 1000 + (passInTl.get(a) ?? 0);
            const db = (tlIdx.get(passTl.get(b) ?? "") ?? 99) * 1000 + (passInTl.get(b) ?? 0);
            return da - db;
        });
    }

    const nodePos = new Map<string, { x: number; y: number }>();
    const maxRank = Math.max(...rank.values(), 0);
    let svgH = PAD * 2;
    for (const [r, pids] of byRank) {
        const cx = PAD + r * (NODE_W + COL_GAP);
        pids.forEach((pid, i) => nodePos.set(pid, { x: cx, y: PAD + i * (NODE_H + ROW_GAP) }));
        svgH = Math.max(svgH, PAD + pids.length * (NODE_H + ROW_GAP) - ROW_GAP + PAD);
    }
    const svgW = PAD + (maxRank + 1) * NODE_W + maxRank * COL_GAP + PAD;

    const tlColorMap = new Map<string, string>();
    pipeline.timelines.forEach((tl) => tlColorMap.set(tl.id, TL_TYPE_HEX[tl.type] ?? TL_TYPE_HEX.custom));
    const tlNames = new Map(pipeline.timelines.map((tl) => [tl.id, tl.name]));

    const nodes: GraphNode[] = passIds.map((pid) => {
        const pos = nodePos.get(pid) ?? { x: PAD, y: PAD };
        const tlId = passTl.get(pid) ?? "";
        return {
            id: pid,
            x: pos.x,
            y: pos.y,
            name: pipeline.passes[pid]?.name ?? pid,
            timelineId: tlId,
            timelineName: tlNames.get(tlId) ?? tlId,
            color: tlColorMap.get(tlId) ?? "#6b7280",
        };
    });

    return { nodes, svgW, svgH, nodePos, tlColorMap };
}

// ── Bezier edge path ──────────────────────────────────────────────────────────

function bezier(sx: number, sy: number, ex: number, ey: number) {
    const cp = Math.max(Math.abs(ex - sx) * 0.5, 48);
    return `M ${sx} ${sy} C ${sx + cp} ${sy}, ${ex - cp} ${ey}, ${ex} ${ey}`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function PipelineGraphModal({ onClose }: { onClose: () => void }) {
    const { pipeline, conditionOverrides } = useStore();
    const resources = useEffectiveResources();
    const conditionDefaults = useMemo(() => buildConditionDefaults(resources), [resources]);
    const edges = useMemo(() => deriveDependencies(pipeline), [pipeline]);
    const { nodes, svgW, svgH, nodePos, tlColorMap } = useMemo(
        () => buildLayout(pipeline, edges, conditionOverrides, conditionDefaults),
        [pipeline, edges, conditionOverrides, conditionDefaults],
    );

    const resNames = useMemo(() => {
        const m = new Map<string, string>();
        [...resources.renderTargets, ...resources.buffers].forEach((r) => m.set(r.id, r.name));
        return m;
    }, [resources]);

    // ── Transform — stored in a ref, applied directly to the DOM (no re-renders) ──
    const transformRef = useRef({ tx: 0, ty: 0, scale: 1 });
    const svgRef = useRef<SVGSVGElement>(null);
    const gRef = useRef<SVGGElement>(null);
    const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

    const applyTransform = useCallback((t: { tx: number; ty: number; scale: number }) => {
        transformRef.current = t;
        gRef.current?.setAttribute("transform", `translate(${t.tx},${t.ty}) scale(${t.scale})`);
    }, []);

    const computeFit = useCallback(() => {
        const el = svgRef.current;
        if (!el || svgW <= 0 || svgH <= 0) return null;
        const rect = el.getBoundingClientRect();
        const s = Math.min(1, (rect.width / svgW) * 0.92, (rect.height / svgH) * 0.92);
        return { scale: s, tx: (rect.width - svgW * s) / 2, ty: (rect.height - svgH * s) / 2 };
    }, [svgW, svgH]);

    // Auto-fit on open
    useEffect(() => {
        const fit = computeFit();
        if (fit) applyTransform(fit);
    }, [computeFit, applyTransform]);

    // Non-passive wheel zoom — reads/writes ref only, zero React renders
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return;
        const h = (e: WheelEvent) => {
            e.preventDefault();
            const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            const r = el.getBoundingClientRect();
            const cx = e.clientX - r.left;
            const cy = e.clientY - r.top;
            const { tx, ty, scale } = transformRef.current;
            const ns = Math.max(0.08, Math.min(5, scale * f));
            applyTransform({ scale: ns, tx: cx - (cx - tx) * (ns / scale), ty: cy - (cy - ty) * (ns / scale) });
        };
        el.addEventListener("wheel", h, { passive: false });
        return () => el.removeEventListener("wheel", h);
    }, [applyTransform]);

    // Escape to close
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    const fitView = useCallback(() => {
        const fit = computeFit();
        if (fit) applyTransform(fit);
    }, [computeFit, applyTransform]);

    // Pan handlers — no setState, cursor via direct DOM style
    const onMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const { tx, ty } = transformRef.current;
        panRef.current = { x: e.clientX, y: e.clientY, tx, ty };
        if (svgRef.current) svgRef.current.style.cursor = "grabbing";
    };
    const onMouseMove = (e: React.MouseEvent) => {
        const pan = panRef.current;
        if (!pan) return;
        applyTransform({
            scale: transformRef.current.scale,
            tx: pan.tx + e.clientX - pan.x,
            ty: pan.ty + e.clientY - pan.y,
        });
    };
    const onMouseUp = () => {
        panRef.current = null;
        if (svgRef.current) svgRef.current.style.cursor = "grab";
    };

    // ── Hover — React state (only changes on enter/leave, not during pan) ──
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);
    const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

    const connectedPassIds = useMemo(() => {
        if (!hoveredNode) return null;
        const ids = new Set<string>();
        for (const e of edges) {
            if (e.fromPassId === hoveredNode) ids.add(e.toPassId);
            if (e.toPassId === hoveredNode) ids.add(e.fromPassId);
        }
        return ids;
    }, [hoveredNode, edges]);

    const uniqueTimelines = pipeline.timelines.map((tl) => ({
        id: tl.id, name: tl.name, color: tlColorMap.get(tl.id) ?? "#6b7280",
    }));

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div
                className="flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
                style={{ width: "90vw", height: "85vh" }}
            >
                {/* ── Header ── */}
                <div className="flex items-center gap-3 px-4 h-10 border-b border-zinc-700/60 shrink-0">
                    <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                        Pipeline Graph
                    </span>
                    <span className="text-xs text-zinc-600">
                        {nodes.length} passes · {edges.length} dependencies
                    </span>
                    <div className="flex-1" />
                    {uniqueTimelines.map((tl) => (
                        <span key={tl.id} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: tl.color }} />
                            {tl.name}
                        </span>
                    ))}
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    <button
                        onClick={fitView}
                        title="Fit to view"
                        className="text-[10px] px-2 h-6 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors font-mono"
                    >
                        fit
                    </button>
                    <button
                        onClick={onClose}
                        className="text-zinc-500 hover:text-zinc-200 text-sm px-1 transition-colors"
                    >
                        ✕
                    </button>
                </div>

                {/* ── Canvas ── */}
                <div className="flex-1 relative overflow-hidden bg-[#0f0f11]">
                    {nodes.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-sm text-zinc-500">
                            No passes to display.
                        </div>
                    ) : (
                        <svg
                            ref={svgRef}
                            className="w-full h-full"
                            style={{ cursor: "grab" }}
                            onMouseDown={onMouseDown}
                            onMouseMove={onMouseMove}
                            onMouseUp={onMouseUp}
                            onMouseLeave={onMouseUp}
                        >
                            <defs>
                                <marker id="pgm-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                                    <polygon points="0 0, 8 3, 0 6" fill="#3f3f46" />
                                </marker>
                                <marker id="pgm-arrow-hi" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                                    <polygon points="0 0, 8 3, 0 6" fill="#71717a" />
                                </marker>
                            </defs>

                            {/* This <g> is mutated directly — never re-rendered for pan/zoom */}
                            <g ref={gRef}>
                                {/* ── Edges ── */}
                                {edges.map((edge) => {
                                    const from = nodePos.get(edge.fromPassId);
                                    const to = nodePos.get(edge.toPassId);
                                    if (!from || !to) return null;
                                    const sx = from.x + NODE_W;
                                    const sy = from.y + NODE_H / 2;
                                    const ex = to.x - 1;
                                    const ey = to.y + NODE_H / 2;
                                    const isHi =
                                        hoveredEdge === edge.id ||
                                        hoveredNode === edge.fromPassId ||
                                        hoveredNode === edge.toPassId;
                                    const isDim = !!hoveredNode && !isHi;
                                    const d = bezier(sx, sy, ex, ey);
                                    return (
                                        <g key={edge.id}>
                                            <path
                                                d={d}
                                                fill="none"
                                                stroke="transparent"
                                                strokeWidth={14}
                                                onMouseEnter={() => setHoveredEdge(edge.id)}
                                                onMouseLeave={() => setHoveredEdge(null)}
                                                style={{ cursor: "default" }}
                                            />
                                            <path
                                                d={d}
                                                fill="none"
                                                stroke={isHi ? "#71717a" : "#2d2d33"}
                                                strokeWidth={isHi ? 1.5 : 1}
                                                strokeDasharray={edge.isCrossTimeline ? "5 3" : undefined}
                                                markerEnd={isHi ? "url(#pgm-arrow-hi)" : "url(#pgm-arrow)"}
                                                opacity={isDim ? 0.15 : 1}
                                            />
                                        </g>
                                    );
                                })}

                                {/* ── Nodes ── */}
                                {nodes.map((node) => {
                                    const isHi = hoveredNode === node.id;
                                    const isConn = connectedPassIds?.has(node.id) ?? false;
                                    const isDim = !!hoveredNode && !isHi && !isConn;
                                    const label =
                                        node.name.length > 23 ? node.name.slice(0, 21) + "…" : node.name;
                                    return (
                                        <g
                                            key={node.id}
                                            transform={`translate(${node.x},${node.y})`}
                                            onMouseEnter={() => setHoveredNode(node.id)}
                                            onMouseLeave={() => setHoveredNode(null)}
                                            style={{ cursor: "default" }}
                                            opacity={isDim ? 0.2 : 1}
                                        >
                                            {isHi && (
                                                <rect
                                                    x={-2} y={-2}
                                                    width={NODE_W + 4} height={NODE_H + 4}
                                                    rx={6}
                                                    fill="none"
                                                    stroke={node.color}
                                                    strokeWidth={1.5}
                                                    opacity={0.35}
                                                />
                                            )}
                                            <rect
                                                width={NODE_W} height={NODE_H}
                                                rx={4}
                                                fill={isHi ? "#232326" : "#18181b"}
                                                stroke={isHi ? "#52525b" : "#27272a"}
                                                strokeWidth={1}
                                            />
                                            <rect x={0} y={0} width={3} height={NODE_H} rx={1.5} fill={node.color} />
                                            <text
                                                x={12} y={23}
                                                fontSize={11} fontWeight="500"
                                                fill={isHi || isConn ? "#f4f4f5" : "#a1a1aa"}
                                                fontFamily="system-ui,-apple-system,sans-serif"
                                            >
                                                {label}
                                            </text>
                                            <text
                                                x={12} y={39}
                                                fontSize={9}
                                                fill={node.color} opacity={0.65}
                                                fontFamily="system-ui,-apple-system,sans-serif"
                                            >
                                                {node.timelineName}
                                            </text>
                                        </g>
                                    );
                                })}
                            </g>

                            {/* ── Edge tooltip (screen-space, only renders on edge hover) ── */}
                            {hoveredEdge && (() => {
                                const edge = edges.find((e) => e.id === hoveredEdge);
                                if (!edge || edge.resourceIds.length === 0) return null;
                                const from = nodePos.get(edge.fromPassId);
                                const to = nodePos.get(edge.toPassId);
                                if (!from || !to) return null;
                                const { tx, ty, scale } = transformRef.current;
                                const mx = ((from.x + NODE_W + to.x) / 2) * scale + tx;
                                const my = ((from.y + to.y) / 2 + NODE_H / 2) * scale + ty;
                                const labels = edge.resourceIds.slice(0, 4).map((r) => resNames.get(r) ?? r);
                                const more = edge.resourceIds.length - labels.length;
                                return (
                                    <foreignObject
                                        x={mx - 90} y={my - 14}
                                        width={180} height={32}
                                        style={{ overflow: "visible", pointerEvents: "none" }}
                                    >
                                        <div style={{
                                            fontFamily: "system-ui,-apple-system,sans-serif",
                                            fontSize: 10,
                                            background: "#27272a",
                                            border: "1px solid #3f3f46",
                                            borderRadius: 4,
                                            padding: "3px 8px",
                                            color: "#d4d4d8",
                                            whiteSpace: "nowrap",
                                            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
                                            display: "inline-block",
                                        }}>
                                            {labels.join(", ")}{more > 0 ? ` +${more} more` : ""}
                                        </div>
                                    </foreignObject>
                                );
                            })()}
                        </svg>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="flex items-center gap-5 px-4 h-8 border-t border-zinc-800 shrink-0 text-[10px] text-zinc-600">
                    <span>Scroll to zoom · Drag to pan</span>
                    <span className="flex items-center gap-2">
                        <svg width="22" height="8" className="shrink-0">
                            <line x1="0" y1="4" x2="22" y2="4" stroke="#3f3f46" strokeWidth="1.5" />
                        </svg>
                        Same timeline
                    </span>
                    <span className="flex items-center gap-2">
                        <svg width="22" height="8" className="shrink-0">
                            <line x1="0" y1="4" x2="22" y2="4" stroke="#3f3f46" strokeWidth="1.5" strokeDasharray="4 2" />
                        </svg>
                        Cross timeline
                    </span>
                </div>
            </div>
        </div>
    );
}
