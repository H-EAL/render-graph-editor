import { useState, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../state/store";
import { inferStepResources } from "../../utils/inferStepResources";
import type {
    Timeline, Pass, Step, RasterStep, RasterCommand,
    EnableIfCommand,
    ResourceId, StepId,
    IfBlockStep, EnableIfStep,
} from "../../types";

// ─── Resource state model ─────────────────────────────────────────────────────

type ResState = "color_att" | "depth_att" | "shader_r" | "shader_w" | "shader_rw" | "unknown";

const STATE_COLOR: Record<ResState, string> = {
    color_att: "text-orange-400",
    depth_att: "text-rose-400",
    shader_r:  "text-sky-400",
    shader_w:  "text-amber-400",
    shader_rw: "text-purple-400",
    unknown:   "text-zinc-600",
};

// ─── Barrier types ────────────────────────────────────────────────────────────

type AccessKind = "R" | "W" | "RW";

interface StepBarrierEntry {
    rid: ResourceId;
    name: string;
    prev: AccessKind;
    next: AccessKind;
}

/** Recursively collect reads+writes from a step, treating ifBlock/enableIf as transparent. */
function collectStepAccess(sid: StepId, steps: Record<StepId, Step>): { reads: Set<ResourceId>; writes: Set<ResourceId> } {
    const step = steps[sid];
    if (!step) return { reads: new Set(), writes: new Set() };

    if (step.type === "ifBlock") {
        const ib = step as IfBlockStep;
        const reads = new Set<ResourceId>(); const writes = new Set<ResourceId>();
        for (const cid of [...ib.thenSteps, ...ib.elseSteps]) {
            const { reads: r, writes: w } = collectStepAccess(cid, steps);
            r.forEach((id) => reads.add(id)); w.forEach((id) => writes.add(id));
        }
        return { reads, writes };
    }
    if (step.type === "enableIf") {
        const ei = step as EnableIfStep;
        const reads = new Set<ResourceId>(); const writes = new Set<ResourceId>();
        for (const cid of ei.thenSteps) {
            const { reads: r, writes: w } = collectStepAccess(cid, steps);
            r.forEach((id) => reads.add(id)); w.forEach((id) => writes.add(id));
        }
        return { reads, writes };
    }
    const res = inferStepResources(step);
    return { reads: new Set(res.reads), writes: new Set(res.writes) };
}

/**
 * Compute per-step barriers across an entire timeline.
 * Resource state is tracked sequentially through all passes so that
 * cross-pass transitions are captured (the common case).
 */
function buildTimelineStepBarriers(
    timeline: { passIds: string[] },
    passes: Record<string, Pass>,
    steps: Record<StepId, Step>,
    nameMap: Map<ResourceId, string>,
    excludeIds: Set<ResourceId>,
): Map<StepId, StepBarrierEntry[]> {
    const result = new Map<StepId, StepBarrierEntry[]>();
    const globalState = new Map<ResourceId, AccessKind>();

    for (const pid of timeline.passIds) {
        const pass = passes[pid];
        if (!pass) continue;

        for (const sid of pass.steps) {
            const { reads, writes } = collectStepAccess(sid, steps);

            const thisAccess = new Map<ResourceId, AccessKind>();
            for (const rid of reads)  if (!excludeIds.has(rid)) thisAccess.set(rid, thisAccess.has(rid) ? "RW" : "R");
            for (const rid of writes) if (!excludeIds.has(rid)) thisAccess.set(rid, thisAccess.get(rid) === "R" ? "RW" : "W");

            const barriers: StepBarrierEntry[] = [];
            for (const [rid, next] of thisAccess) {
                const prev = globalState.get(rid);
                if (prev !== undefined) {
                    barriers.push({ rid, name: nameMap.get(rid) ?? rid, prev, next });
                }
            }
            result.set(sid, barriers);

            for (const [rid, acc] of thisAccess) globalState.set(rid, acc);
        }
    }
    return result;
}

// ─── Condition evaluation ─────────────────────────────────────────────────────

type CondMode = "active" | "inactive" | "unknown";

function evalCondStr(
    c: string,
    overrides: Record<string, boolean>,
    defaults: Map<string, boolean>,
): boolean | undefined {
    const neg = c.startsWith("!");
    const name = neg ? c.slice(1) : c;
    const val = overrides[name] ?? defaults.get(name);
    if (val === undefined) return undefined;
    return neg ? !val : val;
}

function evalConditions(
    conditions: string[],
    overrides: Record<string, boolean>,
    defaults: Map<string, boolean>,
): CondMode {
    if (conditions.length === 0) return "active";
    let allKnown = true;
    for (const c of conditions) {
        const result = evalCondStr(c, overrides, defaults);
        if (result === undefined) { allKnown = false; continue; }
        if (result === false) return "inactive";
    }
    return allKnown ? "active" : "unknown";
}

// ─── Tree data types ──────────────────────────────────────────────────────────

interface CmdNode {
    cmd: RasterCommand;
    children?: CmdNode[];
}

function buildCmdTree(cmds: RasterCommand[]): CmdNode[] {
    return cmds.map((cmd) => {
        if (cmd.type === "enableIf")
            return { cmd, children: buildCmdTree((cmd as EnableIfCommand).thenCommands) };
        return { cmd };
    });
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const STEP_TYPE_LABEL: Record<string, string> = {
    raster:               "raster",
    dispatchCompute:      "compute",
    dispatchComputeDecals:"decals",
    dispatchRayTracing:   "rt",
    copyImage:            "copy",
    blitImage:            "blit",
    resolveImage:         "resolve",
    clearImages:          "clear",
    fillBuffer:           "fill",
    generateMipChain:     "mips",
    ifBlock:              "if",
    enableIf:             "enableIf",
};

const STEP_TYPE_COLOR: Record<string, string> = {
    raster:               "text-orange-400",
    dispatchCompute:      "text-sky-400",
    dispatchComputeDecals:"text-cyan-400",
    dispatchRayTracing:   "text-violet-400",
    copyImage:            "text-teal-400",
    blitImage:            "text-teal-400",
    resolveImage:         "text-teal-400",
    clearImages:          "text-zinc-400",
    fillBuffer:           "text-zinc-400",
    generateMipChain:     "text-zinc-400",
    ifBlock:              "text-amber-400",
    enableIf:             "text-amber-400",
};

const TL_TYPE_COLOR: Record<string, string> = {
    graphics:     "text-blue-400",
    asyncCompute: "text-emerald-400",
    transfer:     "text-orange-400",
    raytracing:   "text-violet-400",
    custom:       "text-zinc-400",
};

// ─── Barrier chip colour ──────────────────────────────────────────────────────

function barrierChipCls(prev: AccessKind, next: AccessKind): string {
    const hasWritePrev = prev === "W" || prev === "RW";
    const hasWriteNext = next === "W" || next === "RW";
    if (hasWritePrev && !hasWriteNext) // W→R  write-to-read (layout transition)
        return "border-amber-800/70 bg-amber-950/50 text-amber-400";
    if (!hasWritePrev && hasWriteNext) // R→W  read-to-write
        return "border-sky-800/60 bg-sky-950/50 text-sky-400";
    if (hasWritePrev && hasWriteNext)  // W→W / RW→W  write hazard
        return "border-red-800/60 bg-red-950/50 text-red-400";
    return "border-zinc-700/50 bg-zinc-900/50 text-zinc-500"; // R→R
}

// ─── Shared row primitives ────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
    return (
        <span className={`inline-block transition-transform duration-100 text-zinc-600 ${open ? "rotate-90" : ""}`}>
            ▶
        </span>
    );
}

function IndentGuide({ depth }: { depth: number }) {
    return (
        <>
            {Array.from({ length: depth }).map((_, i) => (
                <span key={i} className="inline-block w-3 shrink-0 border-l border-zinc-800 self-stretch" />
            ))}
        </>
    );
}

function CondPill({
    c, overrides, defaults,
}: {
    c: string;
    overrides: Record<string, boolean>;
    defaults: Map<string, boolean>;
}) {
    const result = evalCondStr(c, overrides, defaults);
    const cls =
        result === true  ? "text-green-400 border-green-800/60 bg-green-950/40" :
        result === false ? "text-red-400 border-red-800/50 bg-red-950/30 line-through" :
                           "text-zinc-500 border-zinc-700/50 bg-zinc-900/40";
    return (
        <span className={`text-[8px] font-mono border rounded-sm px-1 leading-3 shrink-0 ${cls}`}>
            {c}
        </span>
    );
}

// ─── Barrier row ──────────────────────────────────────────────────────────────

interface TooltipInfo {
    barriers: StepBarrierEntry[];
    x: number;
    y: number;
}

interface CompactBarrierRowProps {
    barriers: StepBarrierEntry[];
    depth: number;
    onEnter: (e: React.MouseEvent, barriers: StepBarrierEntry[]) => void;
    onLeave: () => void;
}

function CompactBarrierRow({ barriers, depth, onEnter, onLeave }: CompactBarrierRowProps) {
    return (
        <div className="flex items-stretch min-h-4">
            <IndentGuide depth={depth} />
            <div
                className="flex items-center gap-1 px-2 py-0.5 flex-1 border-l-2 border-dashed border-zinc-700/50 cursor-default"
                onMouseEnter={(e) => onEnter(e, barriers)}
                onMouseLeave={onLeave}
            >
                <span className="text-[7px] font-semibold text-zinc-600 uppercase tracking-widest leading-none select-none">
                    ↕
                </span>
                <span className="text-[9px] text-zinc-600 select-none">
                    barriers
                </span>
            </div>
        </div>
    );
}

// ─── Command type chip ────────────────────────────────────────────────────────

function CmdTypeChip({ type }: { type: RasterCommand["type"] }) {
    const colors: Record<RasterCommand["type"], string> = {
        drawBatch:       "bg-orange-900/40 text-orange-400",
        setDynamicState: "bg-zinc-800/60 text-zinc-500",
        enableIf:        "bg-amber-900/30 text-amber-400",
    };
    const labels: Record<RasterCommand["type"], string> = {
        drawBatch:       "draw",
        setDynamicState: "state",
        enableIf:        "if",
    };
    return (
        <span className={`text-[9px] font-semibold px-1 py-0 rounded ${colors[type]}`}>
            {labels[type]}
        </span>
    );
}

// ─── Unused import kept for type narrowing ────────────────────────────────────
// (ResState STATE_COLOR used below in future shader binding display)
void STATE_COLOR;

// ─── Main component ───────────────────────────────────────────────────────────

export function PipelineTreeDrawer() {
    const {
        pipeline,
        resources,
        selectedPassId,
        selectedStepId,
        selectedCommandId,
        selectPass,
        selectStep,
        selectCommand,
        conditionOverrides,
    } = useStore();

    // ── Condition defaults ───────────────────────────────────────────────────
    const conditionDefaults = useMemo((): Map<string, boolean> => {
        const m = new Map<string, boolean>();
        for (const p of resources.inputParameters) {
            if (p.type === "bool")
                m.set(p.name, p.defaultValue === "true" || p.defaultValue === "1");
        }
        return m;
    }, [resources.inputParameters]);

    // ── Hide vs dim inactive ─────────────────────────────────────────────────
    const [hideInactive, setHideInactive] = useState(true);

    // ── Expand state ─────────────────────────────────────────────────────────
    const [expanded, setExpanded] = useState<Set<string>>(() => {
        const ids = new Set<string>();
        for (const tl of pipeline.timelines) {
            ids.add(`tl:${tl.id}`);
            for (const pid of tl.passIds) ids.add(`p:${pid}`);
        }
        return ids;
    });

    useEffect(() => {
        const ids = new Set<string>();
        for (const tl of pipeline.timelines) {
            ids.add(`tl:${tl.id}`);
            for (const pid of tl.passIds) ids.add(`p:${pid}`);
        }
        setExpanded(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pipeline.id]);

    const toggle = useCallback((nodeId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
            return next;
        });
    }, []);

    const expandAll = useCallback(() => {
        const ids = new Set<string>();
        for (const tl of pipeline.timelines) {
            ids.add(`tl:${tl.id}`);
            for (const pid of tl.passIds) {
                ids.add(`p:${pid}`);
                const pass = pipeline.passes[pid];
                if (!pass) continue;
                const walkSteps = (sids: StepId[]) => {
                    for (const sid of sids) {
                        ids.add(`s:${sid}`);
                        const step = pipeline.steps[sid];
                        if (!step) continue;
                        if (step.type === "raster") {
                            for (const cmd of (step as RasterStep).commands)
                                if (cmd.type === "enableIf") ids.add(`c:${cmd.id}`);
                        }
                        if (step.type === "ifBlock") {
                            ids.add(`s:${sid}:then`); ids.add(`s:${sid}:else`);
                            walkSteps((step as IfBlockStep).thenSteps);
                            walkSteps((step as IfBlockStep).elseSteps);
                        }
                        if (step.type === "enableIf") {
                            ids.add(`s:${sid}:then`);
                            walkSteps((step as EnableIfStep).thenSteps);
                        }
                    }
                };
                walkSteps(pass.steps);
            }
        }
        setExpanded(ids);
    }, [pipeline]);

    const collapseAll = useCallback(() => setExpanded(new Set()), []);

    // ── Raster command tree ──────────────────────────────────────────────────
    const rasterCmdMap = useMemo(() => {
        const m = new Map<StepId, CmdNode[]>();
        for (const step of Object.values(pipeline.steps)) {
            if (step.type === "raster")
                m.set(step.id, buildCmdTree((step as RasterStep).commands));
        }
        return m;
    }, [pipeline.steps]);

    // ── Per-pass barrier maps ────────────────────────────────────────────────
    const stepBarrierMap = useMemo(() => {
        const nameMap = new Map<ResourceId, string>();
        for (const rt  of resources.renderTargets) nameMap.set(rt.id,  rt.name);
        for (const buf of resources.buffers)        nameMap.set(buf.id, buf.name);

        const inputParamIds = new Set(resources.inputParameters.map((p) => p.id));

        // Merge barriers from all timelines into a single StepId → barriers map
        const result = new Map<StepId, StepBarrierEntry[]>();
        for (const tl of pipeline.timelines) {
            const tlBarriers = buildTimelineStepBarriers(
                tl,
                pipeline.passes as Record<string, Pass>,
                pipeline.steps as Record<StepId, Step>,
                nameMap,
                inputParamIds,
            );
            for (const [sid, barriers] of tlBarriers) result.set(sid, barriers);
        }
        return result;
    }, [pipeline.timelines, pipeline.passes, pipeline.steps, resources]);

    // ── Barrier chip tooltip (portal, escapes overflow container) ────────────
    const [barrierTooltip, setBarrierTooltip] = useState<TooltipInfo | null>(null);

    const onBarrierEnter = useCallback((e: React.MouseEvent, barriers: StepBarrierEntry[]) => {
        setBarrierTooltip({ barriers, x: e.clientX, y: e.clientY });
    }, []);
    const onBarrierLeave = useCallback(() => setBarrierTooltip(null), []);

    // ── Render helpers ───────────────────────────────────────────────────────

    function renderCmdNodes(nodes: CmdNode[], depth: number, parentInactive = false): React.ReactNode[] {
        return nodes.flatMap<React.ReactNode>((node) => {
            const cmd = node.cmd;

            if (cmd.type === "enableIf") {
                const mode = evalConditions([(cmd as EnableIfCommand).condition], conditionOverrides, conditionDefaults);
                const branchInactive = mode === "inactive";
                if (branchInactive && hideInactive) return [];
                if (!node.children) return [];
                const inner = renderCmdNodes(node.children, depth, parentInactive || branchInactive);
                return branchInactive ? [<div key={cmd.id} className="opacity-40">{inner}</div>] : inner;
            }

            if (parentInactive && hideInactive) return [];
            const isSelected = selectedCommandId === cmd.id;
            return [(
                <div key={cmd.id} className={parentInactive ? "opacity-40" : ""}>
                    <div
                        className={`flex items-stretch min-h-5.5 cursor-pointer group
                            ${isSelected ? "bg-blue-900/30" : "hover:bg-zinc-800/50"}`}
                        onClick={() => selectCommand(cmd.id)}
                    >
                        <IndentGuide depth={depth} />
                        <div className="flex items-center gap-1.5 px-1 py-0.5 flex-1 min-w-0">
                            <span className="shrink-0 w-3 text-zinc-700 text-[8px] text-center">›</span>
                            <CmdTypeChip type={cmd.type} />
                            <span
                                className={`text-[11px] truncate ${isSelected ? "text-blue-200" : "text-zinc-300 group-hover:text-zinc-100"}`}
                                title={cmd.name}
                            >
                                {cmd.name}
                            </span>
                        </div>
                    </div>
                </div>
            )];
        });
    }

    function renderSteps(stepIds: StepId[], depth: number, passId: string, parentInactive = false): React.ReactNode[] {
        const stepBarriers = stepBarrierMap;

        return stepIds.flatMap<React.ReactNode>((sid) => {
            const step = pipeline.steps[sid] as Step | undefined;
            if (!step) return [];

            const ownInactive = evalConditions(step.conditions, conditionOverrides, conditionDefaults) === "inactive";
            const inactive = parentInactive || ownInactive;

            // ── ifBlock: transparent ─────────────────────────────────────────
            if (step.type === "ifBlock") {
                const ifStep = step as IfBlockStep;
                const mode = evalConditions([ifStep.condition], conditionOverrides, conditionDefaults);
                if (mode === "inactive") {
                    if (ifStep.elseSteps.length === 0) return [];
                    const inner = renderSteps(ifStep.elseSteps, depth, passId, inactive);
                    return inactive && !hideInactive ? [<div key={sid} className="opacity-40">{inner}</div>] : inner;
                }
                if (mode === "active") {
                    const inner = renderSteps(ifStep.thenSteps, depth, passId, inactive);
                    return inactive && !hideInactive ? [<div key={sid} className="opacity-40">{inner}</div>] : inner;
                }
                return [
                    ...renderSteps(ifStep.thenSteps, depth, passId, inactive),
                    ...renderSteps(ifStep.elseSteps, depth, passId, inactive),
                ];
            }

            // ── enableIf: transparent ────────────────────────────────────────
            if (step.type === "enableIf") {
                const eiStep = step as EnableIfStep;
                const mode = evalConditions([eiStep.condition], conditionOverrides, conditionDefaults);
                const branchInactive = mode === "inactive";
                if (branchInactive && hideInactive) return [];
                if (eiStep.thenSteps.length === 0) return [];
                const inner = renderSteps(eiStep.thenSteps, depth, passId, inactive || branchInactive);
                return branchInactive ? [<div key={sid} className="opacity-40">{inner}</div>] : inner;
            }

            if (inactive && hideInactive) return [];

            const nodeKey = `s:${sid}`;
            const isSelected = selectedStepId === sid;
            const cmdNodes = rasterCmdMap.get(sid);
            const isExpandable = step.type === "raster";
            const isOpen = expanded.has(nodeKey);
            const typeLabel = STEP_TYPE_LABEL[step.type] ?? step.type;
            const typeColor = STEP_TYPE_COLOR[step.type] ?? "text-zinc-400";

            // Barriers for this step (only for top-level pass steps)
            const barriers = stepBarriers?.get(sid) ?? [];

            return [(
                <div key={sid} className={inactive ? "opacity-40" : ""}>
                    {/* Barrier row — before this step */}
                    {barriers.length > 0 && (
                        <CompactBarrierRow
                            barriers={barriers}
                            depth={depth}
                            onEnter={onBarrierEnter}
                            onLeave={onBarrierLeave}
                        />
                    )}

                    {/* Step row */}
                    <div
                        className={`flex items-stretch min-h-5.5 cursor-pointer group
                            ${isSelected ? "bg-blue-900/30" : "hover:bg-zinc-800/50"}`}
                        onClick={() => selectStep(sid)}
                    >
                        <IndentGuide depth={depth} />
                        <div className="flex items-center gap-1.5 px-1 py-0.5 flex-1 min-w-0">
                            {isExpandable ? (
                                <button
                                    className="shrink-0 w-3 text-[8px] flex items-center justify-center"
                                    onClick={(e) => toggle(nodeKey, e)}
                                >
                                    <Chevron open={isOpen} />
                                </button>
                            ) : (
                                <span className="shrink-0 w-3 text-zinc-700 text-[8px] text-center">·</span>
                            )}
                            <span className={`text-[9px] font-semibold font-mono shrink-0 ${typeColor}`}>
                                {typeLabel}
                            </span>
                            <span
                                className={`text-[11px] truncate ${isSelected ? "text-blue-200" : "text-zinc-300 group-hover:text-zinc-100"}`}
                                title={step.name}
                            >
                                {step.name}
                            </span>
                            {step.conditions.map((c) => (
                                <CondPill key={c} c={c} overrides={conditionOverrides} defaults={conditionDefaults} />
                            ))}
                        </div>
                    </div>

                    {/* Raster commands (no barrier inside — barriers are before the step) */}
                    {isOpen && isExpandable && cmdNodes && (
                        <div>
                            {renderCmdNodes(cmdNodes, depth + 1, inactive)}
                        </div>
                    )}
                </div>
            )];
        });
    }

    function renderPass(pass: Pass, depth: number): React.ReactNode {
        const inactive = !pass.enabled ||
            evalConditions(pass.conditions, conditionOverrides, conditionDefaults) === "inactive";
        if (inactive && hideInactive) return null;

        const nodeKey = `p:${pass.id}`;
        const isSelected = selectedPassId === pass.id;
        const isOpen = expanded.has(nodeKey);
        const hasSteps = pass.steps.length > 0;

        return (
            <div key={pass.id} className={inactive ? "opacity-40" : ""}>
                <div
                    className={`flex items-stretch min-h-5.5 cursor-pointer group
                        ${isSelected ? "bg-blue-900/40" : "hover:bg-zinc-800/50"}`}
                    onClick={() => selectPass(pass.id)}
                >
                    <IndentGuide depth={depth} />
                    <div className="flex items-center gap-1.5 px-1 py-0.5 flex-1 min-w-0">
                        {hasSteps ? (
                            <button
                                className="shrink-0 w-3 text-[8px] flex items-center justify-center"
                                onClick={(e) => toggle(nodeKey, e)}
                            >
                                <Chevron open={isOpen} />
                            </button>
                        ) : (
                            <span className="shrink-0 w-3 text-zinc-700 text-[8px] text-center">·</span>
                        )}
                        <span
                            className={`text-[11px] font-medium truncate ${isSelected ? "text-blue-200" : "text-zinc-200 group-hover:text-white"}`}
                            title={pass.name}
                        >
                            {pass.name}
                        </span>
                        {pass.conditions.map((c) => (
                            <CondPill key={c} c={c} overrides={conditionOverrides} defaults={conditionDefaults} />
                        ))}
                    </div>
                </div>

                {isOpen && hasSteps && renderSteps(pass.steps, depth + 1, pass.id, inactive)}
            </div>
        );
    }

    function renderTimeline(tl: Timeline, depth: number): React.ReactNode {
        const nodeKey = `tl:${tl.id}`;
        const isOpen = expanded.has(nodeKey);
        const typeColor = TL_TYPE_COLOR[tl.type] ?? "text-zinc-500";

        return (
            <div key={tl.id}>
                <div
                    className="flex items-stretch min-h-6 cursor-pointer hover:bg-zinc-800/40 sticky top-0 z-10 bg-zinc-950"
                    onClick={(e) => toggle(nodeKey, e)}
                >
                    <IndentGuide depth={depth} />
                    <div className="flex items-center gap-1.5 px-1 py-1 flex-1 min-w-0 border-b border-zinc-800/60">
                        <button className="shrink-0 w-3 text-[8px] flex items-center justify-center">
                            <Chevron open={isOpen} />
                        </button>
                        <span className={`text-[9px] font-semibold font-mono uppercase shrink-0 ${typeColor}`}>
                            {tl.type}
                        </span>
                        <span className="text-[11px] font-semibold text-zinc-200 truncate" title={tl.name}>
                            {tl.name}
                        </span>
                        <span className="text-[9px] text-zinc-700 font-mono shrink-0">
                            {(() => {
                                const active = tl.passIds.filter((pid) => {
                                    const p = pipeline.passes[pid];
                                    return p && p.enabled &&
                                        evalConditions(p.conditions, conditionOverrides, conditionDefaults) !== "inactive";
                                }).length;
                                return hideInactive
                                    ? `${active}p`
                                    : `${active}/${tl.passIds.length}p`;
                            })()}
                        </span>
                    </div>
                </div>

                {isOpen && (
                    <div>
                        {tl.passIds.map((pid) => {
                            const pass = pipeline.passes[pid];
                            return pass ? renderPass(pass, depth + 1) : null;
                        })}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-zinc-950">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/60 shrink-0">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex-1">
                    Pipeline
                </span>
                <button
                    onClick={() => setHideInactive((v) => !v)}
                    title={hideInactive ? "Show inactive (dimmed)" : "Hide inactive"}
                    className={`text-[9px] px-1.5 py-0.5 rounded border font-mono transition-colors ${
                        hideInactive
                            ? "border-zinc-700/60 text-zinc-500 hover:text-zinc-300"
                            : "border-amber-700/50 text-amber-500 bg-amber-950/30 hover:border-amber-600"
                    }`}
                >
                    {hideInactive ? "hide" : "dim"}
                </button>
                <button
                    onClick={expandAll}
                    title="Expand all"
                    className="text-[9px] text-zinc-600 hover:text-zinc-300 px-1 transition-colors"
                >
                    ⊞
                </button>
                <button
                    onClick={collapseAll}
                    title="Collapse all"
                    className="text-[9px] text-zinc-600 hover:text-zinc-300 px-1 transition-colors"
                >
                    ⊟
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {pipeline.timelines.map((tl) => renderTimeline(tl, 0))}
                {pipeline.timelines.length === 0 && (
                    <div className="px-4 py-6 text-[11px] text-zinc-600 italic">No timelines</div>
                )}
            </div>

            {/* Barrier tooltip — portal so it escapes overflow:hidden */}
            {barrierTooltip && createPortal(
                <div
                    style={{
                        position: "fixed",
                        left: barrierTooltip.x + 12,
                        top: barrierTooltip.y - 8,
                        zIndex: 9999,
                        pointerEvents: "none",
                        transform: "translateY(-100%)",
                    }}
                    className="bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 shadow-2xl min-w-40"
                >
                    {barrierTooltip.barriers.map((b) => {
                        const fmtAccess = (a: AccessKind) =>
                            a === "R" ? "read" : a === "W" ? "write" : "read+write";
                        const cls = barrierChipCls(b.prev, b.next);
                        return (
                            <div key={b.rid} className="flex items-center gap-1.5 py-0.5">
                                <span className="text-[10px] text-zinc-300 font-medium truncate flex-1">{b.name}</span>
                                <span className={`text-[9px] font-mono px-1 rounded-sm border leading-3.5 ${cls}`}>
                                    {fmtAccess(b.prev)}→{fmtAccess(b.next)}
                                </span>
                            </div>
                        );
                    })}
                </div>,
                document.body,
            )}
        </div>
    );
}
