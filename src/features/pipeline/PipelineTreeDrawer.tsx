import { useState, useMemo, useCallback, useEffect } from "react";
import { useStore } from "../../state/store";
import type {
    Timeline, Pass, Step, RasterStep, RasterCommand,
    DrawBatchCommand, EnableIfCommand,
    ResourceId, StepId, ResourceLibrary,
    IfBlockStep, EnableIfStep,
} from "../../types";

// ─── Resource state model ─────────────────────────────────────────────────────

type ResState = "color_att" | "depth_att" | "shader_r" | "shader_w" | "shader_rw" | "unknown";

const STATE_LABEL: Record<ResState, string> = {
    color_att: "CA",
    depth_att: "DA",
    shader_r:  "SR",
    shader_w:  "SW",
    shader_rw: "SRW",
    unknown:   "—",
};

const STATE_COLOR: Record<ResState, string> = {
    color_att: "text-orange-400",
    depth_att: "text-rose-400",
    shader_r:  "text-sky-400",
    shader_w:  "text-amber-400",
    shader_rw: "text-purple-400",
    unknown:   "text-zinc-600",
};

// ─── Condition evaluation ─────────────────────────────────────────────────────

type CondMode = "active" | "inactive" | "unknown";

/**
 * Evaluates a single condition string (e.g. "hbao" or "!opaque") against
 * explicit overrides and per-parameter defaults.
 * Returns undefined when the value cannot be determined.
 */
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

/**
 * Evaluates all conditions in an array (AND semantics).
 * "inactive" if any is false, "active" if all are true, "unknown" otherwise.
 */
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

interface Transition {
    rid: ResourceId;
    name: string;
    from: ResState;
    to: ResState;
}

interface CmdNode {
    cmd: RasterCommand;
    children?: CmdNode[];
}

interface RasterStepData {
    /** Barrier transitions needed before the render pass begins */
    barrier: Transition[];
    /** Command tree (no per-command barriers) */
    commands: CmdNode[];
}

// ─── Barrier computation ──────────────────────────────────────────────────────

function buildResourceNameMap(resources: ResourceLibrary): Map<ResourceId, string> {
    const m = new Map<ResourceId, string>();
    for (const rt  of resources.renderTargets) m.set(rt.id,  rt.name);
    for (const buf of resources.buffers)        m.set(buf.id, buf.name);
    return m;
}

function neededState(_cmd: DrawBatchCommand, _slot: string): ResState {
    return "shader_r";
}

/** Recursively collect all (rid → first-needed-state) across all commands in a branch. */
function collectNeeded(
    cmds: RasterCommand[],
    nameMap: Map<ResourceId, string>,
    out: Map<ResourceId, ResState>,
): void {
    for (const cmd of cmds) {
        if (cmd.type === "enableIf") {
            collectNeeded((cmd as EnableIfCommand).thenCommands, nameMap, out);
            continue;
        }
        if (cmd.type === "drawBatch") {
            const draw = cmd as DrawBatchCommand;
            for (const [slot, rid] of Object.entries(draw.shaderBindings ?? {})) {
                if (rid && nameMap.has(rid) && !out.has(rid))
                    out.set(rid, neededState(draw, slot));
            }
        }
    }
}

function buildCmdTree(cmds: RasterCommand[]): CmdNode[] {
    return cmds.map((cmd) => {
        if (cmd.type === "enableIf") {
            return { cmd, children: buildCmdTree((cmd as EnableIfCommand).thenCommands) };
        }
        return { cmd };
    });
}

function buildRasterStepData(
    steps: Record<StepId, Step>,
    resources: ResourceLibrary,
): Map<StepId, RasterStepData> {
    const nameMap = buildResourceNameMap(resources);
    const result  = new Map<StepId, RasterStepData>();

    for (const step of Object.values(steps)) {
        if (step.type !== "raster") continue;
        const rs = step as RasterStep;

        // Seed initial layout from attachments
        const initialState = new Map<ResourceId, ResState>();
        for (const ca of rs.attachments.colorAttachments)
            initialState.set(ca.target, "color_att");
        if (rs.attachments.depthAttachment)
            initialState.set(rs.attachments.depthAttachment.target, "depth_att");

        // Collect all shader-bound resources and their first needed state
        const needed = new Map<ResourceId, ResState>();
        collectNeeded(rs.commands, nameMap, needed);

        // Transitions = resources where from ≠ to
        const barrier: Transition[] = [];
        for (const [rid, toState] of needed) {
            const fromState = initialState.get(rid) ?? "unknown";
            if (fromState !== toState)
                barrier.push({ rid, name: nameMap.get(rid) ?? rid, from: fromState, to: toState });
        }

        result.set(step.id, { barrier, commands: buildCmdTree(rs.commands) });
    }
    return result;
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
    graphics:     "text-sky-500",
    asyncCompute: "text-violet-500",
    transfer:     "text-teal-500",
    raytracing:   "text-pink-500",
    custom:       "text-zinc-500",
};

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

/** Pill showing a single condition string with its evaluated state. */
function CondPill({
    c,
    overrides,
    defaults,
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

function BarrierRow({ transitions, depth }: { transitions: Transition[]; depth: number }) {
    return (
        <div className="flex flex-col select-none">
            <div className="flex items-stretch min-h-4.5">
                <IndentGuide depth={depth} />
                <div className="flex items-center gap-1 px-1 py-0.5 flex-1 border-l-2 border-dashed border-zinc-700/60">
                    <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-widest leading-none">
                        barrier
                    </span>
                    {transitions.length === 0 && (
                        <span className="text-[9px] text-zinc-700 italic">∅</span>
                    )}
                </div>
            </div>
            {transitions.map((t) => (
                <div key={t.rid} className="flex items-stretch min-h-4">
                    <IndentGuide depth={depth} />
                    <div className="flex items-center gap-1 px-2 py-0.5 flex-1 border-l-2 border-dashed border-zinc-700/60">
                        <span className="text-[10px] text-zinc-500 font-mono truncate max-w-22.5" title={t.name}>
                            {t.name}
                        </span>
                        <span className="text-zinc-700 text-[9px]">:</span>
                        <span className={`text-[9px] font-semibold ${STATE_COLOR[t.from]}`}>{STATE_LABEL[t.from]}</span>
                        <span className="text-zinc-700 text-[9px]">→</span>
                        <span className={`text-[9px] font-semibold ${STATE_COLOR[t.to]}`}>{STATE_LABEL[t.to]}</span>
                    </div>
                </div>
            ))}
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

    // ── Defaults map: InputParameter.name → parsed bool default ─────────────
    const conditionDefaults = useMemo((): Map<string, boolean> => {
        const m = new Map<string, boolean>();
        for (const p of resources.inputParameters) {
            if (p.type === "bool") {
                m.set(p.name, p.defaultValue === "true" || p.defaultValue === "1");
            }
        }
        return m;
    }, [resources.inputParameters]);

    // ── Hide vs dim inactive nodes ───────────────────────────────────────────
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

    // ── Precomputed raster step data ─────────────────────────────────────────
    const rasterStepData = useMemo(
        () => buildRasterStepData(pipeline.steps as Record<StepId, Step>, resources),
        [pipeline.steps, resources],
    );

    // ── Render helpers ───────────────────────────────────────────────────────

    /** Renders draw/state commands. enableIf wrappers are flattened — their children
     *  are inlined directly after condition evaluation (no meta-row shown). */
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

    /** Renders steps. ifBlock/enableIf are transparent — their children are inlined
     *  directly at the same depth after condition evaluation (no meta-row shown). */
    function renderSteps(stepIds: StepId[], depth: number, parentInactive = false): React.ReactNode[] {
        return stepIds.flatMap<React.ReactNode>((sid) => {
            const step = pipeline.steps[sid] as Step | undefined;
            if (!step) return [];

            const ownInactive = evalConditions(step.conditions, conditionOverrides, conditionDefaults) === "inactive";
            const inactive = parentInactive || ownInactive;

            // ── ifBlock: transparent — inline the appropriate branch ─────────
            if (step.type === "ifBlock") {
                const ifStep = step as IfBlockStep;
                const mode = evalConditions([ifStep.condition], conditionOverrides, conditionDefaults);
                if (mode === "inactive") {
                    if (ifStep.elseSteps.length === 0) return [];
                    const inner = renderSteps(ifStep.elseSteps, depth, inactive);
                    return inactive && !hideInactive ? [<div key={sid} className="opacity-40">{inner}</div>] : inner;
                }
                if (mode === "active") {
                    const inner = renderSteps(ifStep.thenSteps, depth, inactive);
                    return inactive && !hideInactive ? [<div key={sid} className="opacity-40">{inner}</div>] : inner;
                }
                // unknown — show both branches inlined
                return [
                    ...renderSteps(ifStep.thenSteps, depth, inactive),
                    ...renderSteps(ifStep.elseSteps, depth, inactive),
                ];
            }

            // ── enableIf: transparent — inline children if condition holds ───
            if (step.type === "enableIf") {
                const eiStep = step as EnableIfStep;
                const mode = evalConditions([eiStep.condition], conditionOverrides, conditionDefaults);
                const branchInactive = mode === "inactive";
                if (branchInactive && hideInactive) return [];
                if (eiStep.thenSteps.length === 0) return [];
                const inner = renderSteps(eiStep.thenSteps, depth, inactive || branchInactive);
                return branchInactive ? [<div key={sid} className="opacity-40">{inner}</div>] : inner;
            }

            if (inactive && hideInactive) return [];

            const nodeKey = `s:${sid}`;
            const isSelected = selectedStepId === sid;
            const stepData = rasterStepData.get(sid);
            const isExpandable = step.type === "raster";
            const isOpen = expanded.has(nodeKey);
            const typeLabel = STEP_TYPE_LABEL[step.type] ?? step.type;
            const typeColor = STEP_TYPE_COLOR[step.type] ?? "text-zinc-400";

            return [(
                <div key={sid} className={inactive ? "opacity-40" : ""}>
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

                    {isOpen && isExpandable && stepData && (
                        <div>
                            {/* Single barrier before the raster step's commands */}
                            <BarrierRow transitions={stepData.barrier} depth={depth + 1} />
                            {renderCmdNodes(stepData.commands, depth + 1, inactive)}
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

                {isOpen && hasSteps && renderSteps(pass.steps, depth + 1, inactive)}
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
        </div>
    );
}
