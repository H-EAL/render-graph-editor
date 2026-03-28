import { useStore } from "../../state/store";
import { useEffectiveResources } from "../../utils/systemResources";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { FieldRow, InspectorSection } from "../../components/ui/Panel";
import { ResourceSelect } from "../../components/ui/ResourceSelect";
import { RasterCommandEditor } from "./editors/RasterCommandEditor";
import { DispatchComputeEditor } from "./editors/DispatchComputeEditor";
import { DispatchComputeDecalsEditor } from "./editors/DispatchComputeDecalsEditor";
import { DispatchRayTracingEditor } from "./editors/DispatchRayTracingEditor";
import { ImageTransferEditor } from "./editors/ImageTransferEditor";
import { ClearImagesEditor } from "./editors/ClearImagesEditor";
import { FillBufferEditor, GenerateMipChainEditor } from "./editors/SimpleTargetEditor";
import type {
    Step,
    RasterStep,
    RasterCommand,
    ColorAttachment,
    DepthAttachment,
    LoadOp,
    StoreOp,
    IfBlockStep,
    EnableIfStep,
    Pipeline,
} from "../../types";

/** Returns the chain of enableIf conditions wrapping the target command, or null if not found. */
function getCommandConditions(commands: RasterCommand[], targetId: string): string[] | null {
    for (const cmd of commands) {
        if (cmd.id === targetId) return [];
        if (cmd.type === "enableIf") {
            const inner = getCommandConditions(cmd.thenCommands, targetId);
            if (inner !== null) return [cmd.condition, ...inner];
        }
    }
    return null;
}

/** Finds a command by id, recursing into enableIf blocks. */
function findCommand(commands: RasterCommand[], id: string): RasterCommand | null {
    for (const cmd of commands) {
        if (cmd.id === id) return cmd;
        if (cmd.type === "enableIf") {
            const found = findCommand(cmd.thenCommands, id);
            if (found) return found;
        }
    }
    return null;
}

// ─── Raster step: attachment editors ─────────────────────────────────────────

const LOAD_OPS: { value: LoadOp; label: string }[] = [
    { value: "load", label: "Load" },
    { value: "clear", label: "Clear" },
    { value: "dontCare", label: "Don't Care" },
];

const STORE_OPS: { value: StoreOp; label: string }[] = [
    { value: "store", label: "Store" },
    { value: "dontCare", label: "Don't Care" },
];

function ColorAttachmentRow({
    idx,
    att,
    step,
}: {
    idx: number;
    att: ColorAttachment;
    step: RasterStep;
}) {
    const { updateStep } = useStore();
    const resources = useEffectiveResources();
    const rtOpts = resources.renderTargets.map((r) => ({ value: r.id, label: r.name }));

    // Check if the attached RT is multisampled
    const attachedRt = resources.renderTargets.find((r) => r.id === att.target);
    const isMultisampled = (attachedRt?.sampleCount ?? 1) > 1;

    // Find the resolve destination for this attachment (source = att.target)
    const resolves = step.attachments.resolveAttachments ?? [];
    const resolveIdx = resolves.findIndex((r) => r.source === att.target);
    const resolveTarget = resolveIdx >= 0 ? resolves[resolveIdx].destination : "";

    const setResolveTarget = (dst: string) => {
        const next = resolves.filter((r) => r.source !== att.target);
        if (dst) next.push({ source: att.target, destination: dst });
        updateStep(step.id, {
            attachments: {
                ...step.attachments,
                resolveAttachments: next.length > 0 ? next : undefined,
            },
        } as Partial<Step>);
    };

    const updateAtt = (patch: Partial<ColorAttachment>) => {
        const colorAttachments = step.attachments.colorAttachments.map((a, i) =>
            i === idx ? { ...a, ...patch } : a,
        );
        updateStep(step.id, {
            attachments: { ...step.attachments, colorAttachments },
        } as Partial<Step>);
    };

    const removeAtt = () => {
        const colorAttachments = step.attachments.colorAttachments.filter((_, i) => i !== idx);
        // Also remove any resolve pair for this attachment
        const resolveAttachments = resolves.filter((r) => r.source !== att.target);
        updateStep(step.id, {
            attachments: {
                ...step.attachments,
                colorAttachments,
                resolveAttachments: resolveAttachments.length > 0 ? resolveAttachments : undefined,
            },
        } as Partial<Step>);
    };

    return (
        <div className="bg-zinc-800/40 border border-zinc-700/40 rounded mx-3 mb-2 overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1 bg-zinc-800/80">
                <span className="text-[10px] text-zinc-400 font-semibold">COLOR {idx}</span>
                <button onClick={removeAtt} className="text-zinc-600 hover:text-red-400 text-xs">
                    ✕
                </button>
            </div>
            <FieldRow label="Target">
                <ResourceSelect
                    value={att.target}
                    onChange={(v) => updateAtt({ target: v })}
                    options={rtOpts}
                />
            </FieldRow>
            {attachedRt && (
                <FieldRow label="Format">
                    <span className="text-xs font-mono text-zinc-400">{attachedRt.format}</span>
                </FieldRow>
            )}
            {attachedRt && (attachedRt.sampleCount ?? 1) > 1 && (
                <FieldRow label="Samples">
                    <span className="text-xs font-mono text-zinc-400">×{attachedRt.sampleCount}</span>
                </FieldRow>
            )}
            <FieldRow label="Load Op">
                <Select
                    options={LOAD_OPS}
                    value={att.loadOp}
                    onChange={(e) => updateAtt({ loadOp: e.target.value as LoadOp })}
                />
            </FieldRow>
            <FieldRow label="Store Op">
                <Select
                    options={STORE_OPS}
                    value={att.storeOp}
                    onChange={(e) => updateAtt({ storeOp: e.target.value as StoreOp })}
                />
            </FieldRow>
            {att.loadOp === "clear" && (
                <div className="grid grid-cols-[120px_1fr] gap-2 items-center py-1.5 px-3 border-b border-zinc-800/60">
                    <label className="text-xs text-zinc-500">Clear Value</label>
                    <div className="flex gap-1">
                        {att.clearValue.map((v, j) => (
                            <input
                                key={j}
                                type="number"
                                step="0.01"
                                value={v}
                                onChange={(e) => {
                                    const cv = [...att.clearValue] as [
                                        number,
                                        number,
                                        number,
                                        number,
                                    ];
                                    cv[j] = parseFloat(e.target.value) || 0;
                                    updateAtt({ clearValue: cv });
                                }}
                                className="w-12 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                            />
                        ))}
                    </div>
                </div>
            )}
            {isMultisampled && (
                <>
                    <div className="mx-3 my-1 border-t border-zinc-700/40" />
                    <FieldRow label="Resolve To">
                        <ResourceSelect
                            value={resolveTarget}
                            onChange={setResolveTarget}
                            options={rtOpts}
                            allowEmpty
                        />
                    </FieldRow>
                </>
            )}
        </div>
    );
}

function DepthAttachmentSection({ step }: { step: RasterStep }) {
    const { updateStep } = useStore();
    const resources = useEffectiveResources();
    const rtOpts = resources.renderTargets
        .filter((r) => r.format.startsWith("d"))
        .map((r) => ({ value: r.id, label: r.name }));
    const dep = step.attachments.depthAttachment;
    const attachedRt = dep?.target
        ? resources.renderTargets.find((r) => r.id === dep.target)
        : undefined;

    const updateDep = (patch: Partial<DepthAttachment>) => {
        updateStep(step.id, {
            attachments: {
                ...step.attachments,
                depthAttachment: dep
                    ? { ...dep, ...patch }
                    : { target: "", loadOp: "clear", storeOp: "store", clearValue: 1, ...patch },
            },
        } as Partial<Step>);
    };

    const removeDep = () => {
        updateStep(step.id, {
            attachments: { ...step.attachments, depthAttachment: undefined },
        } as Partial<Step>);
    };

    if (!dep) {
        return (
            <div className="px-3 pb-2">
                <button
                    onClick={() =>
                        updateDep({ target: "", loadOp: "clear", storeOp: "store", clearValue: 1 })
                    }
                    className="text-xs text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700 rounded px-2 py-1 w-full"
                >
                    + Add Depth Attachment
                </button>
            </div>
        );
    }

    return (
        <div className="bg-zinc-800/40 border border-zinc-700/40 rounded mx-3 mb-2 overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1 bg-zinc-800/80">
                <span className="text-[10px] text-zinc-400 font-semibold">DEPTH</span>
                <button onClick={removeDep} className="text-zinc-600 hover:text-red-400 text-xs">
                    ✕
                </button>
            </div>
            <FieldRow label="Target">
                <ResourceSelect
                    value={dep.target}
                    onChange={(v) => updateDep({ target: v })}
                    options={rtOpts}
                    allowEmpty
                />
            </FieldRow>
            {attachedRt && (
                <FieldRow label="Format">
                    <span className="text-xs font-mono text-zinc-400">{attachedRt.format}</span>
                </FieldRow>
            )}
            {attachedRt && (attachedRt.sampleCount ?? 1) > 1 && (
                <FieldRow label="Samples">
                    <span className="text-xs font-mono text-zinc-400">×{attachedRt.sampleCount}</span>
                </FieldRow>
            )}
            <FieldRow label="Load Op">
                <Select
                    options={LOAD_OPS}
                    value={dep.loadOp}
                    onChange={(e) => updateDep({ loadOp: e.target.value as LoadOp })}
                />
            </FieldRow>
            <FieldRow label="Store Op">
                <Select
                    options={STORE_OPS}
                    value={dep.storeOp}
                    onChange={(e) => updateDep({ storeOp: e.target.value as StoreOp })}
                />
            </FieldRow>
            {dep.loadOp === "clear" && (
                <FieldRow label="Clear Value">
                    <input
                        type="number"
                        step="0.01"
                        value={dep.clearValue}
                        onChange={(e) => updateDep({ clearValue: parseFloat(e.target.value) || 0 })}
                        className="w-20 bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs rounded px-1.5 py-1"
                    />
                </FieldRow>
            )}
        </div>
    );
}

function RasterStepEditor({ step }: { step: RasterStep }) {
    const { updateStep } = useStore();

    const addColorAttachment = () => {
        const colorAttachments = [
            ...step.attachments.colorAttachments,
            {
                target: "",
                loadOp: "clear" as LoadOp,
                storeOp: "store" as StoreOp,
                clearValue: [0, 0, 0, 1] as [number, number, number, number],
            },
        ];
        updateStep(step.id, {
            attachments: { ...step.attachments, colorAttachments },
        } as Partial<Step>);
    };

    return (
        <>
            {step.attachments.colorAttachments.map((att, i) => (
                <ColorAttachmentRow key={i} idx={i} att={att} step={step} />
            ))}
            <div className="px-3 pb-2">
                <button
                    onClick={addColorAttachment}
                    className="text-xs text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-700 rounded px-2 py-1 w-full"
                >
                    + Add Color Attachment
                </button>
            </div>
            <DepthAttachmentSection step={step} />
        </>
    );
}

// ─── Step type editor dispatch ────────────────────────────────────────────────

function StepTypeEditor({ step }: { step: Step }) {
    switch (step.type) {
        case "raster":
            return <RasterStepEditor step={step} />;
        case "dispatchCompute":
            return <DispatchComputeEditor step={step} />;
        case "dispatchComputeDecals":
            return <DispatchComputeDecalsEditor step={step} />;
        case "dispatchRayTracing":
            return <DispatchRayTracingEditor step={step} />;
        case "copyImage":
        case "blitImage":
        case "resolveImage":
            return <ImageTransferEditor step={step} />;
        case "clearImages":
            return <ClearImagesEditor step={step} />;
        case "fillBuffer":
            return <FillBufferEditor step={step} />;
        case "generateMipChain":
            return <GenerateMipChainEditor step={step} />;
        default:
            return <div className="p-3 text-xs text-zinc-500">No editor for this step type.</div>;
    }
}

// ─── Inferred conditions ──────────────────────────────────────────────────────

interface InferredCondition {
    condition: string;
    source: string;
    sourceKind: "pass" | "fallback" | "variant" | "ifBlock" | "enableIf";
}

function stepBelongsToIds(stepId: string, ids: string[], allSteps: Record<string, Step>): boolean {
    for (const id of ids) {
        if (id === stepId) return true;
        const s = allSteps[id];
        if (!s) continue;
        if (s.type === "ifBlock") {
            const ifS = s as IfBlockStep;
            if (stepBelongsToIds(stepId, [...ifS.thenSteps, ...(ifS.elseSteps ?? [])], allSteps)) return true;
        } else if (s.type === "enableIf") {
            const eiS = s as EnableIfStep;
            if (stepBelongsToIds(stepId, eiS.thenSteps, allSteps)) return true;
        }
    }
    return false;
}

function findContainingPass(stepId: string, pipeline: Pipeline) {
    return Object.values(pipeline.passes).find((p) =>
        stepBelongsToIds(
            stepId,
            [...p.steps, ...(p.disabledSteps ?? []), ...(p.variants ?? []).flatMap((v) => v.activeSteps)],
            pipeline.steps,
        ),
    ) ?? null;
}

function inferStepConditions(stepId: string, pipeline: Pipeline): InferredCondition[] {
    const result: InferredCondition[] = [];

    const parentPass = findContainingPass(stepId, pipeline);

    if (parentPass) {
        const isFallback = (parentPass.disabledSteps ?? []).includes(stepId);
        if (isFallback) {
            const negatedConds = parentPass.conditions.map((c) =>
                c.startsWith("!") ? `NOT ${c.slice(1)}` : `NOT ${c}`,
            );
            const label = negatedConds.length > 0 ? negatedConds.join(" AND ") : "NOT (pass condition)";
            result.push({ condition: label, source: "Fallback container", sourceKind: "fallback" });
        } else {
            for (const c of parentPass.conditions) {
                result.push({ condition: c, source: parentPass.name, sourceKind: "pass" });
            }
            const variant = (parentPass.variants ?? []).find((v) => v.activeSteps.includes(stepId));
            if (variant) {
                result.push({ condition: variant.selector ?? variant.name, source: `Variant: ${variant.name}`, sourceKind: "variant" });
            }
        }
    }

    for (const s of Object.values(pipeline.steps)) {
        if (s.type === "ifBlock") {
            const ifStep = s as IfBlockStep;
            if (ifStep.thenSteps.includes(stepId)) {
                result.push({ condition: ifStep.condition, source: `if (then): ${ifStep.condition}`, sourceKind: "ifBlock" });
            } else if ((ifStep.elseSteps ?? []).includes(stepId)) {
                const neg = ifStep.condition.startsWith("!") ? ifStep.condition.slice(1) : `NOT ${ifStep.condition}`;
                result.push({ condition: neg, source: `if (else): ${neg}`, sourceKind: "ifBlock" });
            }
        } else if (s.type === "enableIf") {
            const eiStep = s as EnableIfStep;
            if (eiStep.thenSteps.includes(stepId)) {
                const displayCond = eiStep.condition.startsWith("!") ? `NOT ${eiStep.condition.slice(1)}` : eiStep.condition;
                result.push({ condition: displayCond, source: `enable if: ${displayCond}`, sourceKind: "enableIf" });
            }
        }
    }

    return result;
}

// ─── Main inspector ───────────────────────────────────────────────────────────

export function StepInspector() {
    const { pipeline, selectedStepId, selectedCommandId, updateStep, selectStep, selectCommand } =
        useStore();
    const step = selectedStepId ? pipeline.steps[selectedStepId] : null;

    const parentPass = step ? findContainingPass(step.id, pipeline) : null;

    // ── Command view ──
    if (step && step.type === "raster" && selectedCommandId) {
        const rasterStep = step as RasterStep;
        const cmd = findCommand(rasterStep.commands, selectedCommandId);
        if (cmd) {
            const stepConditions = inferStepConditions(step.id, pipeline);
            const cmdEnableIfConditions: InferredCondition[] = (getCommandConditions(rasterStep.commands, cmd.id) ?? [])
                .map((cond) => ({
                    condition: cond,
                    source: `enable if: ${cond}`,
                    sourceKind: "enableIf" as const,
                }));
            const allConditions: InferredCondition[] = [...stepConditions, ...cmdEnableIfConditions];

            const kindCls: Record<InferredCondition["sourceKind"], string> = {
                pass:     "bg-blue-900/30 text-blue-300 border-blue-700/40",
                fallback: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
                variant:  "bg-violet-900/30 text-violet-300 border-violet-700/40",
                ifBlock:  "bg-purple-900/30 text-purple-300 border-purple-700/40",
                enableIf: "bg-teal-900/30 text-teal-300 border-teal-700/40",
            };

            return (
                <div className="flex flex-col overflow-y-auto h-full">
                    {/* ◂ breadcrumb back to step */}
                    <button
                        onClick={() => selectCommand(null)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 border-b border-zinc-800 transition-colors text-left shrink-0"
                    >
                        <span>◂</span>
                        <span className="truncate">{step.name}</span>
                    </button>

                    <InspectorSection title="Conditions">
                        {allConditions.length === 0 ? (
                            <div className="px-3 py-2 text-[10px] text-zinc-600 italic">Always active — no conditions apply.</div>
                        ) : (
                            <div className="px-3 py-2 flex flex-col gap-1.5">
                                {allConditions.map((ic, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${kindCls[ic.sourceKind]}`}>
                                            {ic.condition}
                                        </span>
                                        <span className="text-[10px] text-zinc-600">{ic.source}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </InspectorSection>

                    <InspectorSection title="Command">
                        <RasterCommandEditor stepId={step.id} commandId={cmd.id} command={cmd} />
                    </InspectorSection>
                </div>
            );
        }
    }

    // ── No step selected ──
    if (!step) {
        return <div className="p-4 text-xs text-zinc-500">Select a step to inspect.</div>;
    }

    const u = (patch: object) => updateStep(step.id, patch as never);

    return (
        <div className="flex flex-col overflow-y-auto h-full">
            {/* ◂ breadcrumb back to pass */}
            {parentPass && (
                <button
                    onClick={() => selectStep(null)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 border-b border-zinc-800 transition-colors text-left shrink-0"
                >
                    <span>◂</span>
                    <span className="truncate">{parentPass.name}</span>
                </button>
            )}

            <InspectorSection title="Identity">
                <FieldRow label="Name">
                    <Input value={step.name} onChange={(e) => u({ name: e.target.value })} />
                </FieldRow>
                <FieldRow label="Type">
                    <span className="text-xs font-mono text-zinc-300">{step.type}</span>
                </FieldRow>
            </InspectorSection>

            <InspectorSection title="Conditions">
                {(() => {
                    const inferred = inferStepConditions(step.id, pipeline);
                    if (inferred.length === 0) {
                        return <div className="px-3 py-2 text-[10px] text-zinc-600 italic">Always active — no conditions apply.</div>;
                    }
                    const kindCls: Record<InferredCondition["sourceKind"], string> = {
                        pass:     "bg-blue-900/30 text-blue-300 border-blue-700/40",
                        fallback: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
                        variant:  "bg-violet-900/30 text-violet-300 border-violet-700/40",
                        ifBlock:  "bg-purple-900/30 text-purple-300 border-purple-700/40",
                        enableIf: "bg-teal-900/30 text-teal-300 border-teal-700/40",
                    };
                    return (
                        <div className="px-3 py-2 flex flex-col gap-1.5">
                            {inferred.map((ic, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${kindCls[ic.sourceKind]}`}>
                                        {ic.condition}
                                    </span>
                                    <span className="text-[10px] text-zinc-600">{ic.source}</span>
                                </div>
                            ))}
                        </div>
                    );
                })()}
            </InspectorSection>

            <InspectorSection
                title={step.type === "raster" ? "Attachments" : `${step.type} Settings`}
            >
                <StepTypeEditor step={step} />
            </InspectorSection>
        </div>
    );
}
