import { useState, useMemo, useCallback } from "react";
import { useStore } from "../../state/store";
import type { PassId } from "../../types";
import { buildAnalysisGraph } from "../../utils/analysisGraph";
import { computeExecutionMetrics, type PassMetrics } from "../../utils/executionMetrics";
import { computeHeuristicSchedule } from "../../utils/heuristicScheduler";
import { formatBytes } from "../../utils/memoryStats";

// ─── Timeline colours (matches tree/graph views) ──────────────────────────────

const TL_BADGE: Record<string, string> = {
    graphics:     "bg-blue-900/50 text-blue-400 border-blue-800/60",
    asyncCompute: "bg-emerald-900/50 text-emerald-400 border-emerald-800/60",
    transfer:     "bg-orange-900/50 text-orange-400 border-orange-800/60",
    raytracing:   "bg-violet-900/50 text-violet-400 border-violet-800/60",
    custom:       "bg-zinc-800/50 text-zinc-400 border-zinc-700/60",
};

// ─── Short byte formatter for table cells ─────────────────────────────────────

function shortBytes(n: number): string {
    if (n === 0) return "–";
    if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)}G`;
    if (n >= 1_048_576)     return `${(n / 1_048_576).toFixed(1)}M`;
    if (n >= 1_024)         return `${Math.round(n / 1_024)}K`;
    return `${n}B`;
}

// ─── Warning generation ───────────────────────────────────────────────────────

interface AnalysisWarning {
    id: string;
    severity: "error" | "warning" | "info";
    message: string;
    passIds?: PassId[];
}

function generateWarnings(
    graph: ReturnType<typeof buildAnalysisGraph>,
    metrics: ReturnType<typeof computeExecutionMetrics>,
    schedule: ReturnType<typeof computeHeuristicSchedule>,
): AnalysisWarning[] {
    const warnings: AnalysisWarning[] = [];

    if (metrics.hasCycle) {
        warnings.push({
            id: "cycle",
            severity: "error",
            message: "Dependency cycle detected — CPM metrics may be inaccurate.",
        });
    }

    // Passes with no edges at all (orphans)
    const orphans = graph.passIds.filter(
        (pid) =>
            (graph.incoming.get(pid)?.length ?? 0) === 0 &&
            (graph.outgoing.get(pid)?.length ?? 0) === 0,
    );
    if (orphans.length > 0) {
        warnings.push({
            id: "orphans",
            severity: "warning",
            message: `${orphans.length} pass${orphans.length !== 1 ? "es" : ""} have no dependency edges (isolated).`,
            passIds: orphans,
        });
    }

    // Redundant manual dependencies
    const redundantManual = [
        ...new Set(
            graph.edges
                .filter((e) => e.isRedundant && e.isManual)
                .map((e) => e.toPassId),
        ),
    ];
    if (redundantManual.length > 0) {
        warnings.push({
            id: "redundant-manual",
            severity: "info",
            message: `${redundantManual.length} manual dependenc${redundantManual.length !== 1 ? "ies are" : "y is"} already implied by resource usage.`,
            passIds: redundantManual,
        });
    }

    // High slack (more than half the critical path length, and > 1)
    if (metrics.criticalPathLength > 2) {
        const threshold = Math.floor(metrics.criticalPathLength / 2);
        const highSlack = graph.passIds.filter((pid) => {
            const s = metrics.perPass.get(pid)?.slack ?? 0;
            return s > threshold && s > 1;
        });
        if (highSlack.length > 0) {
            warnings.push({
                id: "high-slack",
                severity: "info",
                message: `${highSlack.length} pass${highSlack.length !== 1 ? "es have" : " has"} high scheduling flexibility (slack > ${threshold}).`,
                passIds: highSlack,
            });
        }
    }

    // Order divergence
    if (schedule.reorderedCount > 0) {
        warnings.push({
            id: "reorder",
            severity: "info",
            message: `${schedule.reorderedCount} pass${schedule.reorderedCount !== 1 ? "es" : ""} would change position in the suggested execution order.`,
        });
    }

    return warnings;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function TabButton({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            key={id}
            onClick={onClick}
            className={`px-5 h-10 text-xs font-medium transition-colors border-b-2 ${
                active
                    ? "text-sky-300 border-sky-500"
                    : "text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-600"
            }`}
        >
            {label}
        </button>
    );
}

function StatCard({ value, label, sub, accent }: { value: string | number; label: string; sub?: string; accent?: string }) {
    return (
        <div className="bg-zinc-800/50 rounded-lg border border-zinc-700/40 px-4 py-3">
            <div className={`text-xl font-mono font-bold ${accent ?? "text-zinc-100"}`}>{value}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
            {sub && <div className="text-[10px] text-zinc-700 mt-0.5">{sub}</div>}
        </div>
    );
}

function WarnRow({ w, onPassClick }: { w: AnalysisWarning; onPassClick?: (pid: PassId) => void }) {
    const icon  = w.severity === "error" ? "✗" : w.severity === "warning" ? "⚠" : "ℹ";
    const color = w.severity === "error" ? "text-red-400" : w.severity === "warning" ? "text-amber-400" : "text-sky-400";
    return (
        <div className={`flex items-start gap-2 px-3 py-2 border-b border-zinc-800/50 text-xs ${color}`}>
            <span className="shrink-0 mt-px">{icon}</span>
            <div className="flex-1 min-w-0">
                <span>{w.message}</span>
                {w.passIds && w.passIds.length > 0 && onPassClick && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {w.passIds.slice(0, 8).map((pid) => (
                            <button
                                key={pid}
                                onClick={() => onPassClick(pid)}
                                className="text-[10px] font-mono bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                            >
                                {pid.slice(0, 8)}
                            </button>
                        ))}
                        {w.passIds.length > 8 && (
                            <span className="text-[10px] text-zinc-600">+{w.passIds.length - 8} more</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function TlBadge({ type }: { type: string }) {
    const cls = TL_BADGE[type] ?? TL_BADGE.custom;
    return (
        <span className={`text-[9px] font-mono px-1.5 py-px rounded border ${cls} shrink-0`}>
            {type.slice(0, 4)}
        </span>
    );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({
    graph,
    metrics,
    schedule,
    warnings,
    onPassClick,
}: {
    graph: ReturnType<typeof buildAnalysisGraph>;
    metrics: ReturnType<typeof computeExecutionMetrics>;
    schedule: ReturnType<typeof computeHeuristicSchedule>;
    warnings: AnalysisWarning[];
    onPassClick: (pid: PassId) => void;
}) {
    const pipeline = useStore((s) => s.pipeline);
    const tlNames  = new Map(pipeline.timelines.map((tl) => [tl.id, tl.name]));

    const totalEdges    = graph.edges.length;
    const minimalEdges  = graph.minimalEdges.length;
    const redundant     = totalEdges - minimalEdges;
    const criticalPasses = metrics.criticalPathPassIds.length;
    const avgSlack = graph.passIds.length > 0
        ? (graph.passIds.reduce((s, pid) => s + (metrics.perPass.get(pid)?.slack ?? 0), 0) / graph.passIds.length).toFixed(1)
        : "0";
    const maxSlack = Math.max(0, ...graph.passIds.map((pid) => metrics.perPass.get(pid)?.slack ?? 0));
    const manualEdges = graph.edges.filter((e) => e.isManual).length;

    return (
        <div className="flex flex-col gap-5 p-5 overflow-y-auto h-full">
            {/* Stats grid */}
            <section>
                <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Overview</h3>
                <div className="grid grid-cols-4 gap-3">
                    <StatCard value={graph.passIds.length} label="Passes" />
                    <StatCard value={totalEdges} label="Dependency Edges" sub={`${minimalEdges} minimal, ${redundant} redundant`} />
                    <StatCard value={metrics.criticalPathLength} label="Critical Path Length" sub={`${criticalPasses} passes on path`} accent="text-sky-300" />
                    <StatCard value={pipeline.timelines.length} label="Timelines" />
                    <StatCard value={criticalPasses} label="Critical-Path Passes" accent={criticalPasses > 0 ? "text-sky-300" : undefined} />
                    <StatCard value={avgSlack} label="Avg Slack" sub={`max: ${maxSlack}`} />
                    <StatCard value={manualEdges} label="Manual Dependencies" sub={redundant > 0 ? `${redundant} redundant` : undefined} />
                    <StatCard value={schedule.reorderedCount} label="Reorder Suggestions" />
                </div>
            </section>

            {/* Critical path chain */}
            {metrics.criticalPathPassIds.length > 0 && (
                <section>
                    <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Critical Path</h3>
                    <div className="bg-zinc-800/30 border border-zinc-700/40 rounded-lg px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                            {metrics.criticalPathPassIds.map((pid, i) => {
                                const m    = metrics.perPass.get(pid);
                                const name = pipeline.passes[pid]?.name ?? pid;
                                return (
                                    <div key={pid} className="flex items-center gap-1.5">
                                        {i > 0 && <span className="text-zinc-700 text-xs">→</span>}
                                        <button
                                            onClick={() => onPassClick(pid)}
                                            className="text-[11px] font-medium text-sky-300 hover:text-sky-100 bg-sky-950/30 border border-sky-800/40 rounded px-2 py-0.5 transition-colors"
                                        >
                                            {name}
                                        </button>
                                        {m && (
                                            <span className="text-[9px] font-mono text-zinc-600">
                                                {m.timelineName ? `[${tlNames.get(m.timelineId)?.slice(0, 8) ?? "?"}]` : ""}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </section>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
                <section>
                    <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                        Warnings &amp; Insights
                    </h3>
                    <div className="border border-zinc-700/40 rounded-lg overflow-hidden">
                        {warnings.map((w) => (
                            <WarnRow key={w.id} w={w} onPassClick={onPassClick} />
                        ))}
                    </div>
                </section>
            )}
            {warnings.length === 0 && (
                <div className="flex items-center gap-2 text-emerald-400 text-xs px-1">
                    <span>✓</span>
                    <span>No analysis warnings.</span>
                </div>
            )}
        </div>
    );
}

// ─── Metrics Table Tab ────────────────────────────────────────────────────────

type SortKey = "passName" | "timelineName" | "el" | "ll" | "slack" | "cpc" | "in" | "out" | "memAlloc" | "memFree";

const SORT_ACCESSORS: Record<SortKey, (m: PassMetrics) => number | string> = {
    passName:    (m) => m.passName,
    timelineName: (m) => m.timelineName,
    el:          (m) => m.earliestLevel,
    ll:          (m) => m.latestLevel,
    slack:       (m) => m.slack,
    cpc:         (m) => m.criticalPathCost,
    in:          (m) => m.inDegree,
    out:         (m) => m.outDegree,
    memAlloc:    (m) => m.memoryAllocatedBytes,
    memFree:     (m) => m.memoryFreedBytes,
};

const COLUMNS: { key: SortKey; label: string; title: string; align: string }[] = [
    { key: "passName",    label: "Pass",      title: "Pass name",              align: "text-left"  },
    { key: "timelineName",label: "Timeline",  title: "Timeline",               align: "text-left"  },
    { key: "el",          label: "EL",        title: "Earliest Level",         align: "text-right" },
    { key: "ll",          label: "LL",        title: "Latest Level",           align: "text-right" },
    { key: "slack",       label: "Slack",     title: "Scheduling slack (LL−EL)", align: "text-right" },
    { key: "cpc",         label: "CPC",       title: "Critical-Path Cost (longest downstream chain)", align: "text-right" },
    { key: "in",          label: "In",        title: "Minimal incoming edges", align: "text-right" },
    { key: "out",         label: "Out",       title: "Minimal outgoing edges", align: "text-right" },
    { key: "memAlloc",    label: "+Mem",      title: "Memory allocated at this pass (first writer)", align: "text-right" },
    { key: "memFree",     label: "−Mem",      title: "Memory freed after this pass (last user)", align: "text-right" },
];

function MetricsTable({
    metrics,
    onPassClick,
}: {
    metrics: ReturnType<typeof computeExecutionMetrics>;
    onPassClick: (pid: PassId) => void;
}) {
    const [sortKey, setSortKey] = useState<SortKey>("cpc");
    const [sortAsc, setSortAsc] = useState(false);

    const sortedPassIds = useMemo(() => {
        return [...metrics.topologicalOrder].sort((a, b) => {
            const ma = metrics.perPass.get(a);
            const mb = metrics.perPass.get(b);
            if (!ma || !mb) return 0;
            const va = SORT_ACCESSORS[sortKey](ma);
            const vb = SORT_ACCESSORS[sortKey](mb);
            const cmp = va < vb ? -1 : va > vb ? 1 : 0;
            return sortAsc ? cmp : -cmp;
        });
    }, [metrics, sortKey, sortAsc]);

    const handleSort = (key: SortKey) => {
        if (key === sortKey) setSortAsc((v) => !v);
        else { setSortKey(key); setSortAsc(false); }
    };

    const pipeline = useStore((s) => s.pipeline);
    const tlTypes  = new Map(pipeline.timelines.map((tl) => [tl.id, tl.type]));

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-auto">
                <table className="w-full text-xs border-separate border-spacing-0">
                    <thead className="sticky top-0 z-10 bg-zinc-900">
                        <tr>
                            {COLUMNS.map((col) => (
                                <th
                                    key={col.key}
                                    title={col.title}
                                    className={`px-3 py-2 font-medium text-zinc-400 border-b border-zinc-700/60 cursor-pointer hover:text-zinc-200 whitespace-nowrap select-none ${col.align}`}
                                    onClick={() => handleSort(col.key)}
                                >
                                    {col.label}
                                    {sortKey === col.key && (
                                        <span className="ml-1 text-[9px] text-sky-400">{sortAsc ? "▲" : "▼"}</span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedPassIds.map((pid) => {
                            const m  = metrics.perPass.get(pid);
                            if (!m) return null;
                            const tlType = tlTypes.get(m.timelineId) ?? "custom";
                            return (
                                <tr
                                    key={pid}
                                    onClick={() => onPassClick(pid)}
                                    className={`cursor-pointer border-b border-zinc-800/40 transition-colors group ${
                                        m.isCritical
                                            ? "bg-sky-950/15 hover:bg-sky-950/30"
                                            : "hover:bg-zinc-800/40"
                                    }`}
                                >
                                    {/* Pass name */}
                                    <td className="px-3 py-1.5 font-medium text-left">
                                        <div className="flex items-center gap-1.5">
                                            {m.isCritical && (
                                                <span className="text-[8px] text-sky-400 font-bold shrink-0">●</span>
                                            )}
                                            <span className={`truncate max-w-[200px] ${m.isCritical ? "text-sky-200" : "text-zinc-200 group-hover:text-white"}`}
                                                title={m.passName}>
                                                {m.passName}
                                            </span>
                                        </div>
                                    </td>
                                    {/* Timeline */}
                                    <td className="px-3 py-1.5 text-left">
                                        <TlBadge type={tlType} />
                                    </td>
                                    {/* Numeric columns */}
                                    <td className="px-3 py-1.5 text-right font-mono text-zinc-400">{m.earliestLevel}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-zinc-400">{m.latestLevel}</td>
                                    <td className={`px-3 py-1.5 text-right font-mono font-semibold ${
                                        m.slack === 0 ? "text-sky-400" : m.slack <= 2 ? "text-amber-400" : "text-zinc-500"
                                    }`}>
                                        {m.slack}
                                    </td>
                                    <td className={`px-3 py-1.5 text-right font-mono ${
                                        m.isCritical ? "text-sky-300 font-semibold" : "text-zinc-400"
                                    }`}>
                                        {m.criticalPathCost}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono text-zinc-500">{m.inDegree}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-zinc-500">{m.outDegree}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-amber-600/80 text-[10px]">
                                        {shortBytes(m.memoryAllocatedBytes)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono text-emerald-600/80 text-[10px]">
                                        {shortBytes(m.memoryFreedBytes)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {sortedPassIds.length === 0 && (
                    <div className="py-12 text-center text-xs text-zinc-600">No passes in this pipeline.</div>
                )}
            </div>

            {/* Edge legend */}
            <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-600">
                <span>Columns: EL = earliest level · LL = latest level · CPC = critical-path cost · +Mem = memory allocated · −Mem = memory freed</span>
                <span className="ml-auto text-sky-500/60">● = critical path</span>
            </div>
        </div>
    );
}

// ─── Schedule Tab ─────────────────────────────────────────────────────────────

function ScheduleTab({
    metrics,
    schedule,
    onPassClick,
}: {
    metrics: ReturnType<typeof computeExecutionMetrics>;
    schedule: ReturnType<typeof computeHeuristicSchedule>;
    onPassClick: (pid: PassId) => void;
}) {
    const pipeline = useStore((s) => s.pipeline);
    const tlTypes  = new Map(pipeline.timelines.map((tl) => [tl.id, tl.type]));
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const toggle = (idx: number) =>
        setExpanded((prev) => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header bar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-700/40 shrink-0">
                <span className="text-[11px] text-zinc-500">
                    {schedule.passes.length} passes · {schedule.reorderedCount} reordered from authored order
                </span>
                <button
                    onClick={() => {
                        const json = JSON.stringify(
                            schedule.passes.map((p) => ({
                                index: p.scheduleIndex + 1,
                                pass: p.passName,
                                timeline: p.timelineId,
                                score: p.score.toFixed(3),
                                rationale: p.rationale,
                            })),
                            null, 2,
                        );
                        const blob = new Blob([json], { type: "application/json" });
                        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "schedule.json"; a.click();
                    }}
                    className="ml-auto text-[10px] px-2.5 py-1 rounded border border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
                >
                    Export JSON
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
                {schedule.passes.map((sp) => {
                    const m       = metrics.perPass.get(sp.passId);
                    const isOpen  = expanded.has(sp.scheduleIndex);
                    const tlType  = tlTypes.get(sp.timelineId) ?? "custom";

                    return (
                        <div
                            key={sp.passId}
                            className={`border-b border-zinc-800/50 ${sp.score > 3 ? "bg-sky-950/10" : ""}`}
                        >
                            {/* Main row */}
                            <div
                                className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-zinc-800/30"
                                onClick={() => { onPassClick(sp.passId); toggle(sp.scheduleIndex); }}
                            >
                                <span className="text-[11px] font-mono text-zinc-600 w-6 text-right shrink-0">
                                    {sp.scheduleIndex + 1}
                                </span>
                                <span className="text-[8px] text-zinc-700 shrink-0">
                                    {isOpen ? "▼" : "▶"}
                                </span>
                                <TlBadge type={tlType} />
                                <span className={`text-[12px] font-medium flex-1 min-w-0 truncate ${m?.isCritical ? "text-sky-200" : "text-zinc-200"}`}
                                    title={sp.passName}>
                                    {sp.passName}
                                </span>
                                {/* Score badges */}
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {m?.isCritical && (
                                        <span className="text-[9px] bg-sky-950/50 border border-sky-800/50 text-sky-400 px-1.5 py-px rounded font-mono">CP</span>
                                    )}
                                    <span className="text-[9px] font-mono text-zinc-600">
                                        CPC:{m?.criticalPathCost ?? 0}
                                    </span>
                                    <span className={`text-[9px] font-mono ${m?.slack === 0 ? "text-sky-400" : "text-zinc-600"}`}>
                                        slack:{m?.slack ?? 0}
                                    </span>
                                    {m && m.memoryFreedBytes > 0 && (
                                        <span className="text-[9px] font-mono text-emerald-600/70">
                                            −{shortBytes(m.memoryFreedBytes)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Expanded decision detail */}
                            {isOpen && (
                                <div className="px-12 pb-3 text-xs text-zinc-500 space-y-1.5 border-t border-zinc-800/30 bg-zinc-900/30">
                                    <div className="pt-2 flex items-start gap-1.5">
                                        <span className="text-zinc-700 shrink-0">Rationale:</span>
                                        <span className="text-zinc-400">{sp.rationale}</span>
                                    </div>
                                    {/* Score breakdown */}
                                    <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                                        <span className="text-zinc-700">Scores:</span>
                                        <span>cp={sp.scoreBreakdown.criticalPathCost.toFixed(2)}</span>
                                        <span className="text-emerald-600/70">freed={sp.scoreBreakdown.memoryFreedBytes.toFixed(2)}</span>
                                        <span className="text-red-600/70">alloc=−{sp.scoreBreakdown.memoryAllocatedPenalty.toFixed(2)}</span>
                                        <span>slack={sp.scoreBreakdown.slackBonus.toFixed(2)}</span>
                                        <span className="text-zinc-600">authored={sp.scoreBreakdown.authoredOrderBias.toFixed(2)}</span>
                                        <span className="text-sky-400">total={sp.score.toFixed(2)}</span>
                                    </div>
                                    {/* Candidates */}
                                    {sp.candidatePassIds.length > 1 && (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="text-zinc-700">Ready at this step:</span>
                                            {sp.candidatePassIds.map((cid) => {
                                                const cm = metrics.perPass.get(cid);
                                                const isChosen = cid === sp.passId;
                                                return (
                                                    <button
                                                        key={cid}
                                                        onClick={(e) => { e.stopPropagation(); onPassClick(cid); }}
                                                        className={`text-[10px] px-1.5 py-px rounded border ${
                                                            isChosen
                                                                ? "bg-sky-900/40 border-sky-700/50 text-sky-300"
                                                                : "border-zinc-700/50 text-zinc-500 hover:text-zinc-300"
                                                        }`}
                                                        title={`CPC:${cm?.criticalPathCost ?? 0} Slack:${cm?.slack ?? 0}`}
                                                    >
                                                        {pipeline.passes[cid]?.name ?? cid}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {sp.candidatePassIds.length === 1 && (
                                        <div className="text-zinc-700 text-[10px]">Only ready pass at this step.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {schedule.passes.length === 0 && (
                    <div className="py-12 text-center text-xs text-zinc-600">No passes to schedule.</div>
                )}
            </div>
        </div>
    );
}

// ─── Compare reordering explanation ──────────────────────────────────────────

import type { ScheduledPass, ScheduleResult } from "../../utils/heuristicScheduler";

function explainReordering(
    pid: PassId,
    authPos: number,   // 0-based authored position
    sugPos:  number,   // 0-based suggested position
    sp: ScheduledPass,
    schedule: ScheduleResult,
    authIdx: Map<PassId, number>,
): string {
    const delta = sugPos - authPos;
    const n = (d: number) => `${d} position${d === 1 ? "" : "s"}`;

    if (delta === 0) {
        if (sp.candidatePassIds.length === 1)
            return "Position unchanged — it was the only dependency-ready pass available at this step, so no reordering was possible.";
        const bd = sp.scoreBreakdown;
        if (bd.criticalPathCost >= bd.slackBonus && bd.criticalPathCost >= bd.memoryFreedBytes)
            return "Position unchanged — its critical-path cost kept it at the top of the ready queue, so the authored order was already optimal.";
        if (bd.slackBonus > 0)
            return "Position unchanged — it had zero scheduling slack and was the most urgent ready pass, matching its authored slot exactly.";
        return "Position unchanged — its composite score (critical path, memory, slack) matched its authored slot; no improvement was possible.";
    }

    if (delta < 0) {
        const abs = Math.abs(delta);
        const bd = sp.scoreBreakdown;
        // Identify dominant factor
        if (bd.criticalPathCost >= bd.slackBonus && bd.criticalPathCost >= bd.memoryFreedBytes)
            return `Moved ${n(abs)} earlier — it lies on the critical path, so the scheduler pulls it forward to reduce overall execution latency. Delaying it would have pushed back every pass that depends on it.`;
        if (bd.slackBonus > 0)
            return `Moved ${n(abs)} earlier — it had zero scheduling slack, meaning any later placement would stall the passes downstream that depend on it.`;
        if (bd.memoryFreedBytes > bd.memoryAllocatedPenalty)
            return `Moved ${n(abs)} earlier — running it sooner releases its input resources back to the pool, reducing peak GPU memory pressure before new allocations are needed.`;
        return `Moved ${n(abs)} earlier — its combined score (critical path + slack + memory) ranked it above the passes that preceded it in the authored order.`;
    }

    // delta > 0 — moved later. Find passes that jumped ahead of this one.
    const jumpedAhead: ScheduledPass[] = [];
    for (let si = authPos; si < sugPos; si++) {
        const other = schedule.passes[si];
        if (!other || other.passId === pid) continue;
        if ((authIdx.get(other.passId) ?? si) > authPos) jumpedAhead.push(other);
    }

    if (jumpedAhead.length === 0)
        return `Moved ${n(delta)} later — passes that appeared earlier in the authored order scored higher at each step where this pass became ready.`;

    const lead    = jumpedAhead[0];
    const names   = jumpedAhead.slice(0, 2).map((p) => `"${p.passName}"`).join(" and ");
    const extra   = jumpedAhead.length > 2 ? ` (+${jumpedAhead.length - 2} more)` : "";
    const r       = lead.rationale.toLowerCase();
    const because = r.includes("critical")    ? "they are on the critical path and would stall dependents if delayed"
                  : r.includes("zero slack")  ? "they had zero slack and could not be deferred without cascading delays"
                  : r.includes("frees")       ? "scheduling them first freed memory before new allocations were needed"
                  : r.includes("only ready")  ? "they were the only dependency-ready passes at those steps"
                  :                             "they scored higher across critical-path cost, memory, and slack";
    return `Moved ${n(delta)} later — ${names}${extra} jumped ahead because ${because}.`;
}

// ─── Compare Tab ──────────────────────────────────────────────────────────────

function CompareTab({
    schedule,
    onPassClick,
}: {
    schedule: ReturnType<typeof computeHeuristicSchedule>;
    onPassClick: (pid: PassId) => void;
}) {
    const pipeline = useStore((s) => s.pipeline);
    const tlTypes  = new Map(pipeline.timelines.map((tl) => [tl.id, tl.type]));

    const authoredOrder = useMemo(
        () =>
            pipeline.timelines
                .flatMap((tl) => tl.passIds)
                .filter((pid) => !!pipeline.passes[pid]),
        [pipeline],
    );

    const authIdx = useMemo(() => {
        const m = new Map<PassId, number>();
        authoredOrder.forEach((pid, i) => m.set(pid, i));
        return m;
    }, [authoredOrder]);

    const sugIdx = useMemo(() => {
        const m = new Map<PassId, number>();
        schedule.orderedPassIds.forEach((pid, i) => m.set(pid, i));
        return m;
    }, [schedule.orderedPassIds]);

    const deltaMap = useMemo(() => {
        const m = new Map<PassId, number>();
        authoredOrder.forEach((pid) => {
            m.set(pid, (sugIdx.get(pid) ?? 0) - (authIdx.get(pid) ?? 0));
        });
        return m;
    }, [authoredOrder, authIdx, sugIdx]);

    const scheduledById = useMemo(
        () => new Map(schedule.passes.map((p) => [p.passId, p])),
        [schedule.passes],
    );

    const [filter, setFilter] = useState<"all" | "moved" | "same">("all");
    const [hoveredPid, setHoveredPid] = useState<PassId | null>(null);


    const filteredPids = useMemo(() => {
        const s = new Set<PassId>();
        authoredOrder.forEach((pid) => {
            const d = deltaMap.get(pid) ?? 0;
            if (filter === "all" || (filter === "moved" && d !== 0) || (filter === "same" && d === 0))
                s.add(pid);
        });
        return s;
    }, [authoredOrder, deltaMap, filter]);

    const authoredFiltered  = useMemo(() => authoredOrder.filter((pid) => filteredPids.has(pid)), [authoredOrder, filteredPids]);
    const suggestedFiltered = useMemo(() => schedule.orderedPassIds.filter((pid) => filteredPids.has(pid)), [schedule.orderedPassIds, filteredPids]);

    const movedEarlier = useMemo(() => [...deltaMap.values()].filter((d) => d < 0).length, [deltaMap]);
    const movedLater   = useMemo(() => [...deltaMap.values()].filter((d) => d > 0).length, [deltaMap]);
    const unchanged    = useMemo(() => [...deltaMap.values()].filter((d) => d === 0).length, [deltaMap]);

    const rowBg = (pid: PassId, delta: number) => {
        if (hoveredPid === pid) return "bg-zinc-700/50";
        if (delta < 0) return "bg-sky-950/10";
        if (delta > 0) return "bg-amber-950/10";
        return "";
    };

    const PassRow = ({ pid, pos }: { pid: PassId; pos: number }) => {
        const pass   = pipeline.passes[pid];
        const tlId   = pass?.timelineId ?? "";
        const tlType = tlTypes.get(tlId) ?? "custom";
        const delta  = deltaMap.get(pid) ?? 0;
        return (
            <div
                className={`flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/40 cursor-pointer text-xs transition-colors ${rowBg(pid, delta)}`}
                onMouseEnter={() => setHoveredPid(pid)}
                onMouseLeave={() => setHoveredPid(null)}
                onClick={() => onPassClick(pid)}
            >
                <span className="font-mono text-zinc-600 w-6 shrink-0 text-right select-none">{pos}</span>
                <TlBadge type={tlType} />
                <span className="flex-1 font-medium text-zinc-200 truncate" title={pass?.name}>
                    {pass?.name ?? pid}
                </span>
                {delta !== 0 && (
                    <span className={`text-[10px] font-mono shrink-0 ${delta < 0 ? "text-sky-500" : "text-amber-500"}`}>
                        {delta < 0 ? `↑${Math.abs(delta)}` : `↓${delta}`}
                    </span>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-700/40 shrink-0 text-xs">
                <span className="text-sky-400">↑ {movedEarlier} earlier</span>
                <span className="text-amber-400">↓ {movedLater} later</span>
                <span className="text-zinc-500">─ {unchanged} unchanged</span>
                <div className="ml-auto flex items-center gap-1 bg-zinc-800/60 rounded p-0.5">
                    {(["all", "moved", "same"] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-2.5 py-1 rounded text-[10px] transition-colors ${
                                filter === f ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Two-column layout — single scroll container so both columns move together */}
            <div className="flex flex-1 overflow-y-auto min-h-0 divide-x divide-zinc-800">
                {/* Authored order */}
                <div className="flex flex-col flex-1">
                    <div className="px-3 py-1.5 border-b border-zinc-700/40 shrink-0 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider bg-zinc-900/60 sticky top-0 z-10">
                        Authored order
                    </div>
                    <div>
                        {authoredFiltered.map((pid) => (
                            <PassRow key={pid} pid={pid} pos={(authIdx.get(pid) ?? 0) + 1} />
                        ))}
                    </div>
                </div>

                {/* Suggested order */}
                <div className="flex flex-col flex-1">
                    <div className="px-3 py-1.5 border-b border-zinc-700/40 shrink-0 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider bg-zinc-900/60 sticky top-0 z-10">
                        Suggested order
                    </div>
                    <div>
                        {suggestedFiltered.map((pid) => (
                            <PassRow key={pid} pid={pid} pos={(sugIdx.get(pid) ?? 0) + 1} />
                        ))}
                    </div>
                </div>
            </div>

            {/* Hover details panel */}
            {hoveredPid && (() => {
                const sp    = scheduledById.get(hoveredPid);
                const delta = deltaMap.get(hoveredPid) ?? 0;
                const authPos = (authIdx.get(hoveredPid) ?? 0) + 1;
                const sugPos  = (sugIdx.get(hoveredPid)  ?? 0) + 1;
                const bd      = sp?.scoreBreakdown;
                return (
                    <div className="shrink-0 border-t border-zinc-700/60 bg-zinc-900/80 px-4 py-2.5 text-[11px] space-y-1">
                        <div className="flex items-center gap-2">
                            {delta === 0 ? (
                                <span className="text-zinc-500 font-mono">─</span>
                            ) : delta < 0 ? (
                                <span className="text-sky-400 font-mono">↑{Math.abs(delta)}</span>
                            ) : (
                                <span className="text-amber-400 font-mono">↓{delta}</span>
                            )}
                            <span className="font-semibold text-zinc-200">
                                {pipeline.passes[hoveredPid]?.name ?? hoveredPid}
                            </span>
                            <span className="text-zinc-600">
                                {delta === 0
                                    ? `pos ${authPos} → unchanged`
                                    : `pos ${authPos} → ${sugPos}`}
                            </span>
                        </div>
                        {sp && (
                            <>
                                <div className="text-zinc-300 leading-snug">
                                    {explainReordering(
                                        hoveredPid,
                                        authPos - 1,
                                        sugPos  - 1,
                                        sp,
                                        schedule,
                                        authIdx,
                                    )}
                                </div>
                                {bd && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-zinc-500 font-mono text-[10px]">
                                        <span>cp <span className="text-zinc-400">{bd.criticalPathCost.toFixed(2)}</span></span>
                                        <span>mem freed <span className="text-zinc-400">{bd.memoryFreedBytes.toFixed(2)}</span></span>
                                        <span>mem alloc <span className={bd.memoryAllocatedPenalty > 0 ? "text-amber-400/70" : "text-zinc-400"}>{bd.memoryAllocatedPenalty.toFixed(2)}</span></span>
                                        <span>slack <span className={bd.slackBonus > 0 ? "text-sky-400/70" : "text-zinc-400"}>{bd.slackBonus.toFixed(2)}</span></span>
                                        <span>order <span className="text-zinc-400">{bd.authoredOrderBias.toFixed(2)}</span></span>
                                    </div>
                                )}
                                {sp.candidatePassIds.length > 1 && (
                                    <div className="text-zinc-600 text-[10px]">
                                        {sp.candidatePassIds.length} passes were ready — this had the highest score
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            })()}

            <div className="shrink-0 px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-600">
                ↑ sky = moved earlier &nbsp;·&nbsp; ↓ amber = moved later &nbsp;·&nbsp; Suggested order is advisory — pipeline is not modified
            </div>
        </div>
    );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

type TabId = "summary" | "metrics" | "schedule" | "compare";

const TABS: { id: TabId; label: string }[] = [
    { id: "summary",  label: "Summary"  },
    { id: "metrics",  label: "Metrics"  },
    { id: "schedule", label: "Schedule" },
    { id: "compare",  label: "Compare"  },
];

export function ExecutionAnalysisModal({ onClose }: { onClose: () => void }) {
    const { pipeline, resources } = useStore();
    const selectPass = useStore((s) => s.selectPass);

    const [tab, setTab] = useState<TabId>("summary");

    // ── Analysis computation (memoised) ─────────────────────────────────────
    const graph    = useMemo(() => buildAnalysisGraph(pipeline), [pipeline]);
    const metrics  = useMemo(() => computeExecutionMetrics(graph, pipeline, resources), [graph, pipeline, resources]);
    const schedule = useMemo(() => computeHeuristicSchedule(graph, metrics, pipeline), [graph, metrics, pipeline]);
    const warnings = useMemo(() => generateWarnings(graph, metrics, schedule), [graph, metrics, schedule]);

    const handlePassClick = useCallback(
        (pid: PassId) => {
            selectPass(pid);
        },
        [selectPass],
    );

    // Keyboard: Escape closes
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Escape") onClose();
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col bg-zinc-950 overflow-hidden"
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="flex items-center h-11 border-b border-zinc-700/60 shrink-0 px-4 gap-3 bg-zinc-900">
                <span className="text-[10px] font-bold text-zinc-600 tracking-widest uppercase select-none">RGE</span>
                <span className="w-px h-4 bg-zinc-700/80" />
                <span className="text-[13px] font-semibold text-zinc-200">Execution Analysis</span>
                <span className="text-[11px] text-zinc-600 font-mono">{pipeline.name}</span>
                {metrics.hasCycle && (
                    <span className="text-[10px] bg-red-900/40 border border-red-700/50 text-red-400 rounded px-2 py-px">
                        ⚠ Cycle detected
                    </span>
                )}
                <div className="flex-1" />
                {/* Quick stats in header */}
                <span className="text-[10px] font-mono text-zinc-600 hidden sm:block">
                    {graph.passIds.length}P · {graph.minimalEdges.length}E · CP:{metrics.criticalPathLength}
                </span>
                <button
                    onClick={onClose}
                    className="text-zinc-500 hover:text-zinc-200 text-lg leading-none px-2 py-1 hover:bg-zinc-800 rounded transition-colors"
                    title="Close (Esc)"
                >
                    ✕
                </button>
            </div>

            {/* ── Tab bar ──────────────────────────────────────────────────── */}
            <div className="flex border-b border-zinc-800 px-2 shrink-0 bg-zinc-900/50">
                {TABS.map((t) => (
                    <TabButton
                        key={t.id}
                        id={t.id}
                        label={t.label}
                        active={tab === t.id}
                        onClick={() => setTab(t.id)}
                    />
                ))}
                {warnings.filter((w) => w.severity === "error").length > 0 && (
                    <span className="ml-2 self-center text-[10px] text-red-400">
                        {warnings.filter((w) => w.severity === "error").length} error(s)
                    </span>
                )}
                {warnings.filter((w) => w.severity === "warning").length > 0 && (
                    <span className="ml-2 self-center text-[10px] text-amber-400">
                        {warnings.filter((w) => w.severity === "warning").length} warning(s)
                    </span>
                )}
            </div>

            {/* ── Content ──────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden min-h-0">
                {tab === "summary" && (
                    <SummaryTab
                        graph={graph}
                        metrics={metrics}
                        schedule={schedule}
                        warnings={warnings}
                        onPassClick={handlePassClick}
                    />
                )}
                {tab === "metrics" && (
                    <MetricsTable
                        metrics={metrics}
                        onPassClick={handlePassClick}
                    />
                )}
                {tab === "schedule" && (
                    <ScheduleTab
                        metrics={metrics}
                        schedule={schedule}
                        onPassClick={handlePassClick}
                    />
                )}
                {tab === "compare" && (
                    <CompareTab
                        schedule={schedule}
                        onPassClick={handlePassClick}
                    />
                )}
            </div>

            {/* ── Footer ───────────────────────────────────────────────────── */}
            <div className="flex items-center h-6 border-t border-zinc-800 shrink-0 px-4 bg-zinc-900/50">
                <span className="text-[9px] font-mono text-zinc-700">
                    {graph.passIds.length} passes · {graph.edges.length} deps ({graph.minimalEdges.length} minimal, {graph.edges.length - graph.minimalEdges.length} redundant) · critical path {metrics.criticalPathLength} · {formatBytes(metrics.perPass.size > 0 ? [...metrics.perPass.values()].reduce((s, m) => s + m.memoryAllocatedBytes, 0) : 0)} tracked
                </span>
                <div className="flex-1" />
                <span className="text-[9px] text-zinc-700">Suggested order is advisory — pipeline is not modified</span>
            </div>
        </div>
    );
}
