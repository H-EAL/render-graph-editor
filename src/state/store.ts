import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { newId } from "../utils/id";
import { rgDocument } from "../data/seed";
import { fetchShaderDescriptor } from "../utils/shaderApi";
import type {
    Pipeline,
    Pass,
    PassId,
    Step,
    StepId,
    StepType,
    RasterStep,
    IfBlockStep,
    EnableIfStep,
    RasterCommand,
    RasterCommandType,
    CommandId,
    Timeline,
    TimelineId,
    TimelineType,
    Variant,
    VariantId,
    ResourceLibrary,
    RenderTarget,
    Buffer,
    BlendState,
    Shader,
    InputParameter,
    MaterialInterface,
    ResourceId,
    InputDefinition,
    InputId,
} from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively collect all step IDs that belong to a step (handles IfBlock nesting). */
function collectAllStepIds(stepId: StepId, steps: Record<StepId, Step>): StepId[] {
    const step = steps[stepId];
    if (!step) return [stepId];
    if (step.type === "ifBlock") {
        const ib = step as IfBlockStep;
        return [
            stepId,
            ...ib.thenSteps.flatMap((sid) => collectAllStepIds(sid, steps)),
            ...ib.elseSteps.flatMap((sid) => collectAllStepIds(sid, steps)),
        ];
    }
    if (step.type === "enableIf") {
        const ei = step as EnableIfStep;
        return [stepId, ...ei.thenSteps.flatMap((sid) => collectAllStepIds(sid, steps))];
    }
    return [stepId];
}

/** Collect every step ID owned by a pass (all lists + IfBlock nesting). */
function collectAllPassStepIds(pass: Pass, steps: Record<StepId, Step>): StepId[] {
    const topLevel = [
        ...pass.steps,
        ...(pass.disabledSteps ?? []),
        ...(pass.variants ?? []).flatMap((v) => v.activeSteps),
    ];
    return topLevel.flatMap((sid) => collectAllStepIds(sid, steps));
}

// ─── Raster command helpers ───────────────────────────────────────────────────

function patchCommandInList(
    commands: RasterCommand[],
    commandId: CommandId,
    patch: Partial<RasterCommand>,
): RasterCommand[] {
    return commands.map((c) => {
        if (c.id === commandId) return { ...c, ...patch } as RasterCommand;
        if (c.type === "enableIf") {
            return { ...c, thenCommands: patchCommandInList(c.thenCommands, commandId, patch) };
        }
        return c;
    });
}

function deleteCommandFromList(commands: RasterCommand[], commandId: CommandId): RasterCommand[] {
    return commands
        .filter((c) => c.id !== commandId)
        .map((c) =>
            c.type === "enableIf"
                ? { ...c, thenCommands: deleteCommandFromList(c.thenCommands, commandId) }
                : c,
        );
}

// ─── Default factories ────────────────────────────────────────────────────────

function makeDefaultCommand(type: RasterCommandType, drawType?: import("../types").DrawBatchType): RasterCommand {
    const id = newId();
    switch (type) {
        case "setDynamicState":
            return {
                id,
                type,
                name: "Set Viewport",
                stateType: "viewport",
                x: 0,
                y: 0,
                width: "viewport.width",
                height: "viewport.height",
                minDepth: 0,
                maxDepth: 1,
            };
        case "enableIf":
            return { id, type: "enableIf", name: "Enable If", condition: "", thenCommands: [] };
        case "drawBatch": {
            const dt = drawType ?? "batch";
            const DRAW_TYPE_LABELS: Record<import("../types").DrawBatchType, string> = {
                batch: "Draw Batch",
                batchWithMaterials: "Draw Batch (Materials)",
                fullscreen: "Draw Fullscreen",
                debugLines: "Draw Debug Lines",
            };
            return {
                id,
                type,
                drawType: dt,
                name: DRAW_TYPE_LABELS[dt],
                shader: "",
                withMaterials: dt === "batchWithMaterials" || undefined,
                ...(dt === "batch" || dt === "batchWithMaterials" ? { batchFilters: [{ id: newId(), flags: 0 }] } : {}),
                pipelineConfigs: [{
                    id: newId(),
                    cullMode: "back",
                    depthTestEnable: true,
                    depthWriteEnable: true,
                    depthCompareOp: "greater",
                    topology: "triangleList",
                    polygonMode: "fill",
                    frontFace: "counterClockwise",
                    depthBiasEnable: false,
                }],
            };
        }
    }
}

export function makeDefaultStep(type: StepType): Step {
    const base = { id: newId(), name: `New ${type}`, reads: [], writes: [], conditions: [] };
    switch (type) {
        case "raster":
            return {
                ...base,
                type,
                attachments: { colorAttachments: [] },
                commands: [],
            };
        case "dispatchCompute":
            return { ...base, type, shader: "", groupsX: 1, groupsY: 1, groupsZ: 1 };
        case "dispatchComputeDecals":
            return { ...base, type, shader: "", groupsX: 1, groupsY: 1, groupsZ: 1 };
        case "dispatchRayTracing":
            return {
                ...base,
                type,
                raygenShader: "",
                width: "viewport.width",
                height: "viewport.height",
            };
        case "copyImage":
            return { ...base, type, source: "", destination: "" };
        case "blitImage":
            return { ...base, type, source: "", destination: "", filter: "linear" };
        case "resolveImage":
            return { ...base, type, source: "", destination: "" };
        case "clearImages":
            return { ...base, type, targets: [] };
        case "fillBuffer":
            return { ...base, type, target: "", value: 0 };
        case "generateMipChain":
            return { ...base, type, target: "", filter: "linear" };
        case "ifBlock":
            return { ...base, type, condition: "", thenSteps: [], elseSteps: [] };
        case "enableIf":
            return { ...base, type, condition: "", thenSteps: [] };
    }
}

function makeDefaultVariant(name: string): Variant {
    return { id: newId(), name, activeSteps: [] };
}

function makeDefaultPass(timelineId: TimelineId): Pass {
    return {
        id: newId(),
        name: "New Pass",
        timelineId,
        enabled: true,
        conditions: [],
        reads: [],
        writes: [],
        manualDeps: [],
        steps: [],
        disabledSteps: [],
        variants: [],
    };
}

function makeDefaultTimeline(type: TimelineType = "graphics"): Timeline {
    return {
        id: newId(),
        name:
            type === "asyncCompute"
                ? "Async Compute"
                : type.charAt(0).toUpperCase() + type.slice(1),
        type,
        passIds: [],
    };
}

function resourceOrderFromLibrary(resources: ResourceLibrary): ResourceId[] {
    return [
        ...resources.renderTargets.map((r) => r.id),
        ...resources.buffers.map((b) => b.id),
        ...resources.inputParameters.map((p) => p.id),
        ...resources.blendStates.map((bs) => bs.id),
        ...(resources.materialInterfaces ?? []).map((m) => m.id),
    ];
}

// ─── Store shape ─────────────────────────────────────────────────────────────

export interface AppState {
    // Data
    pipeline: Pipeline;
    resources: ResourceLibrary;
    inputDefinitions: InputDefinition[];

    // Selection
    selectedPassId: PassId | null;
    selectedStepId: StepId | null;
    selectedCommandId: CommandId | null;
    selectedResourceId: ResourceId | null;
    /** Display order of RT + Buffer resources in the timeline overlay rows */
    resourceOrder: ResourceId[];
    /** Resources hidden from the timeline overlay (still exist in the library) */
    hiddenResourceIds: ResourceId[];

    // ── Timeline actions ──────────────────────────────────────────────────────
    addTimeline: (type?: TimelineType) => void;
    deleteTimeline: (id: TimelineId) => void;
    updateTimeline: (id: TimelineId, patch: Partial<Pick<Timeline, "name" | "type">>) => void;
    reorderTimelines: (orderedIds: TimelineId[]) => void;

    // ── Pass actions ──────────────────────────────────────────────────────────
    setPipelineName: (name: string) => void;
    addPass: (timelineId: TimelineId, insertAt?: number) => void;
    deletePass: (id: PassId) => void;
    duplicatePass: (id: PassId) => void;
    /**
     * Merge multiple passes (must all belong to the same timeline) into one.
     * Pass-level conditions that are not shared by every source pass are pushed
     * down to the individual steps so that per-step conditional execution is
     * preserved — the merged pass only retains conditions that ALL source passes
     * had in common.
     */
    mergePasses: (passIds: PassId[], mergedName?: string) => void;
    reorderPassesInTimeline: (timelineId: TimelineId, orderedIds: PassId[]) => void;
    movePassToTimeline: (passId: PassId, toTimelineId: TimelineId) => void;
    updatePass: (id: PassId, patch: Partial<Omit<Pass, "id" | "steps">>) => void;

    // ── Step actions ──────────────────────────────────────────────────────────
    addStep: (passId: PassId, type: StepType) => void;
    deleteStep: (passId: PassId, stepId: StepId) => void;
    duplicateStep: (passId: PassId, stepId: StepId) => void;
    reorderSteps: (passId: PassId, orderedIds: StepId[]) => void;
    updateStep: (stepId: StepId, patch: Partial<Step>) => void;
    // ── Fallback (disabled) step actions ─────────────────────────────────────
    addFallbackStep: (passId: PassId, type: StepType) => void;
    deleteFallbackStep: (passId: PassId, stepId: StepId) => void;
    duplicateFallbackStep: (passId: PassId, stepId: StepId) => void;
    reorderFallbackSteps: (passId: PassId, orderedIds: StepId[]) => void;
    moveStepToFallback: (passId: PassId, stepId: StepId, insertAt?: number) => void;
    moveStepFromFallback: (passId: PassId, stepId: StepId, insertAt?: number) => void;

    // ── Variant actions ───────────────────────────────────────────────────────
    addVariant: (passId: PassId) => void;
    deleteVariant: (passId: PassId, variantId: VariantId) => void;
    renameVariant: (passId: PassId, variantId: VariantId, name: string) => void;
    /** Set the enum InputDefinition that drives variant selection. Pass null to clear. Automatically creates/replaces variants from enumOptions.
     *  When preserveSteps is true, existing variant steps are moved to common steps instead of deleted. */
    setPassVariantEnum: (passId: PassId, inputDefId: string | null, options?: { preserveSteps?: boolean }) => void;
    addStepToVariant: (passId: PassId, variantId: VariantId, type: StepType) => void;
    deleteStepFromVariant: (passId: PassId, variantId: VariantId, stepId: StepId) => void;
    duplicateStepInVariant: (passId: PassId, variantId: VariantId, stepId: StepId) => void;
    reorderVariantSteps: (passId: PassId, variantId: VariantId, orderedIds: StepId[]) => void;
    moveVariantStepToFallback: (passId: PassId, variantId: VariantId, stepId: StepId, insertAt?: number) => void;
    moveVariantStepFromFallback: (passId: PassId, variantId: VariantId, stepId: StepId, insertAt?: number) => void;
    moveStepToVariant: (passId: PassId, variantId: VariantId, stepId: StepId, insertAt?: number) => void;
    moveStepFromVariant: (passId: PassId, variantId: VariantId, stepId: StepId, insertAt?: number) => void;

    // ── IfBlock branch actions ────────────────────────────────────────────────
    addStepToIfBranch: (ifBlockId: StepId, branch: "then" | "else", type: StepType) => void;
    deleteStepFromIfBranch: (ifBlockId: StepId, branch: "then" | "else", stepId: StepId) => void;
    reorderIfBranch: (ifBlockId: StepId, branch: "then" | "else", orderedIds: StepId[]) => void;
    updateIfBlockCondition: (ifBlockId: StepId, condition: string) => void;
    /** Convert an enableIf to ifBlock, or ifBlock to enableIf (only when one branch is empty). */
    convertStepBlockType: (stepId: StepId) => void;
    /** Move a step from pass.steps into an ifBlock/enableIf branch. */
    moveStepToBranch: (passId: PassId, ifBlockId: StepId, branch: "then" | "else", stepId: StepId, insertAt?: number) => void;
    /** Move a step from an ifBlock/enableIf branch back into pass.steps. */
    moveStepFromBranch: (passId: PassId, ifBlockId: StepId, branch: "then" | "else", stepId: StepId, insertAt?: number) => void;
    /** Move a step between two branches (same or different ifBlock/enableIf). */
    moveStepBetweenBranches: (srcIfBlockId: StepId, srcBranch: "then" | "else", dstIfBlockId: StepId, dstBranch: "then" | "else", stepId: StepId, insertAt?: number) => void;

    // ── Raster command actions ────────────────────────────────────────────────
    addRasterCommand: (stepId: StepId, type: RasterCommandType, drawType?: import("../types").DrawBatchType) => void;
    addCommandToEnableIf: (stepId: StepId, enableIfId: CommandId, type: RasterCommandType, drawType?: import("../types").DrawBatchType) => void;
    deleteRasterCommand: (stepId: StepId, commandId: CommandId) => void;
    duplicateRasterCommand: (stepId: StepId, commandId: CommandId) => void;
    reorderRasterCommands: (stepId: StepId, commands: RasterCommand[]) => void;
    updateRasterCommand: (
        stepId: StepId,
        commandId: CommandId,
        patch: Partial<RasterCommand>,
    ) => void;

    // ── Selection ─────────────────────────────────────────────────────────────
    selectPass: (id: PassId | null) => void;
    selectStep: (id: StepId | null) => void;
    selectCommand: (id: CommandId | null) => void;
    selectResource: (id: ResourceId | null) => void;
    setResourceOrder: (ids: ResourceId[]) => void;
    addManualDep: (passId: PassId, depPassId: PassId) => void;
    removeManualDep: (passId: PassId, depPassId: PassId) => void;

    // ── Resource actions ──────────────────────────────────────────────────────
    addRenderTarget: (rt: RenderTarget) => void;
    updateRenderTarget: (id: ResourceId, patch: Partial<RenderTarget>) => void;
    deleteRenderTarget: (id: ResourceId) => void;

    addBuffer: (b: Buffer) => void;
    updateBuffer: (id: ResourceId, patch: Partial<Buffer>) => void;
    deleteBuffer: (id: ResourceId) => void;

    addBlendState: (bs: BlendState) => void;
    updateBlendState: (id: ResourceId, patch: Partial<BlendState>) => void;
    deleteBlendState: (id: ResourceId) => void;

    addShader: (s: Shader) => void;
    updateShader: (id: ResourceId, patch: Partial<Shader>) => void;
    deleteShader: (id: ResourceId) => void;

    addInputParameter: (p: InputParameter) => void;
    updateInputParameter: (id: ResourceId, patch: Partial<InputParameter>) => void;
    deleteInputParameter: (id: ResourceId) => void;

    addMaterialInterface: (mi: MaterialInterface) => void;
    updateMaterialInterface: (id: ResourceId, patch: Partial<MaterialInterface>) => void;
    deleteMaterialInterface: (id: ResourceId) => void;

    toggleResourceVisibility: (id: ResourceId) => void;
    hideOthers: (id: ResourceId) => void;
    showAllResources: () => void;

    // ── Input Definition actions ───────────────────────────────────────────────
    addInputDefinition: (patch: Omit<InputDefinition, "id">) => void;
    updateInputDefinition: (id: InputId, patch: Partial<InputDefinition>) => void;
    deleteInputDefinition: (id: InputId) => void;
    reorderInputDefinitions: (ids: InputId[]) => void;

    // ── IO ────────────────────────────────────────────────────────────────────
    loadDocument: (json: string) => void;
    getDocumentJson: () => string;
    resolveShaderNames: () => Promise<void>;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

// ─── Seed input definitions (from rg.json via importer) ───────────────────────

const defaultInputDefinitions: InputDefinition[] = rgDocument.inputDefinitions ?? [];

function firstPassId(pipeline: Pipeline): PassId | null {
    for (const tl of pipeline.timelines) {
        if (tl.passIds.length > 0) return tl.passIds[0];
    }
    return null;
}

function getRasterStep(pipeline: Pipeline, stepId: StepId): RasterStep | null {
    const step = pipeline.steps[stepId];
    if (!step || step.type !== "raster") return null;
    return step as RasterStep;
}

export const useStore = create<AppState>()(
    subscribeWithSelector((set, get) => ({
        pipeline: rgDocument.pipeline,
        resources: rgDocument.resources,
        inputDefinitions: defaultInputDefinitions,
        selectedPassId: null,
        selectedStepId: null,
        selectedCommandId: null,
        selectedResourceId: null,
        resourceOrder: resourceOrderFromLibrary(rgDocument.resources),
        hiddenResourceIds: [],

        // ── Timelines ─────────────────────────────────────────────────────────
        addTimeline: (type = "graphics") =>
            set((s) => ({
                pipeline: {
                    ...s.pipeline,
                    timelines: [...s.pipeline.timelines, makeDefaultTimeline(type)],
                },
            })),

        deleteTimeline: (id) =>
            set((s) => {
                const timeline = s.pipeline.timelines.find((tl) => tl.id === id);
                if (!timeline) return {};
                const passes = { ...s.pipeline.passes };
                const steps = { ...s.pipeline.steps };
                for (const pid of timeline.passIds) {
                    const pass = passes[pid];
                    if (pass) collectAllPassStepIds(pass, steps).forEach((sid) => delete steps[sid]);
                    delete passes[pid];
                }
                const timelines = s.pipeline.timelines.filter((tl) => tl.id !== id);
                const selectedPassId = timeline.passIds.includes(s.selectedPassId ?? "")
                    ? firstPassId({ ...s.pipeline, timelines, passes })
                    : s.selectedPassId;
                return {
                    pipeline: { ...s.pipeline, timelines, passes, steps },
                    selectedPassId,
                    selectedStepId: timeline.passIds.includes(s.selectedPassId ?? "")
                        ? null
                        : s.selectedStepId,
                    selectedCommandId: null,
                };
            }),

        updateTimeline: (id, patch) =>
            set((s) => ({
                pipeline: {
                    ...s.pipeline,
                    timelines: s.pipeline.timelines.map((tl) =>
                        tl.id === id ? { ...tl, ...patch } : tl,
                    ),
                },
            })),

        reorderTimelines: (orderedIds) =>
            set((s) => {
                const map = new Map(s.pipeline.timelines.map((tl) => [tl.id, tl]));
                return {
                    pipeline: {
                        ...s.pipeline,
                        timelines: orderedIds.map((id) => map.get(id)!).filter(Boolean),
                    },
                };
            }),

        // ── Pipeline / Pass ───────────────────────────────────────────────────
        setPipelineName: (name) => set((s) => ({ pipeline: { ...s.pipeline, name } })),

        addPass: (timelineId, insertAt) =>
            set((s) => {
                const pass = makeDefaultPass(timelineId);
                const passes = { ...s.pipeline.passes, [pass.id]: pass };
                const timelines = s.pipeline.timelines.map((tl) => {
                    if (tl.id !== timelineId) return tl;
                    const ids = [...tl.passIds];
                    if (insertAt !== undefined) ids.splice(insertAt, 0, pass.id);
                    else ids.push(pass.id);
                    return { ...tl, passIds: ids };
                });
                return {
                    pipeline: { ...s.pipeline, timelines, passes },
                    selectedPassId: pass.id,
                    selectedStepId: null,
                    selectedCommandId: null,
                };
            }),

        deletePass: (id) =>
            set((s) => {
                const pass = s.pipeline.passes[id];
                if (!pass) return {};
                const passes = { ...s.pipeline.passes };
                delete passes[id];
                const steps = { ...s.pipeline.steps };
                collectAllPassStepIds(pass, steps).forEach((sid) => delete steps[sid]);
                const timelines = s.pipeline.timelines.map((tl) => ({
                    ...tl,
                    passIds: tl.passIds.filter((pid) => pid !== id),
                }));
                const selectedPassId =
                    s.selectedPassId === id
                        ? firstPassId({ ...s.pipeline, timelines, passes })
                        : s.selectedPassId;
                return {
                    pipeline: { ...s.pipeline, timelines, passes, steps },
                    selectedPassId,
                    selectedStepId: s.selectedPassId === id ? null : s.selectedStepId,
                    selectedCommandId: null,
                };
            }),

        duplicatePass: (id) =>
            set((s) => {
                const src = s.pipeline.passes[id];
                if (!src) return {};
                const newStepIds: StepId[] = [];
                const newSteps = { ...s.pipeline.steps };
                src.steps.forEach((sid) => {
                    const srcStep = s.pipeline.steps[sid];
                    if (!srcStep) return;
                    let newStep: Step;
                    if (srcStep.type === "raster") {
                        // Deep-clone commands with fresh IDs
                        const newCommands = (srcStep as RasterStep).commands.map((cmd) => ({
                            ...cmd,
                            id: newId(),
                        }));
                        newStep = { ...srcStep, id: newId(), commands: newCommands };
                    } else {
                        newStep = { ...srcStep, id: newId() };
                    }
                    newSteps[newStep.id] = newStep;
                    newStepIds.push(newStep.id);
                });
                const newPass: Pass = {
                    ...src,
                    id: newId(),
                    name: src.name + " (copy)",
                    steps: newStepIds,
                };
                const passes = { ...s.pipeline.passes, [newPass.id]: newPass };
                const timelines = s.pipeline.timelines.map((tl) => {
                    if (tl.id !== src.timelineId) return tl;
                    const idx = tl.passIds.indexOf(id);
                    const newPassIds = [...tl.passIds];
                    newPassIds.splice(idx + 1, 0, newPass.id);
                    return { ...tl, passIds: newPassIds };
                });
                return {
                    pipeline: { ...s.pipeline, timelines, passes, steps: newSteps },
                    selectedPassId: newPass.id,
                    selectedStepId: null,
                    selectedCommandId: null,
                };
            }),

        mergePasses: (passIds, mergedName) =>
            set((s) => {
                if (passIds.length < 2) return {};
                const srcPasses = passIds
                    .map((id) => s.pipeline.passes[id])
                    .filter((p): p is Pass => !!p);
                if (srcPasses.length < 2) return {};

                // All passes must belong to the same timeline.
                const timelineId = srcPasses[0].timelineId;
                if (srcPasses.some((p) => p.timelineId !== timelineId)) return {};

                const timeline = s.pipeline.timelines.find((tl) => tl.id === timelineId);
                if (!timeline) return {};

                // Conditions shared by every source pass — safe to keep at pass level.
                const intersection = srcPasses[0].conditions.filter((c) =>
                    srcPasses.every((p) => p.conditions.includes(c)),
                );

                // Steps: concatenated in pass order; steps from a pass that has extra
                // conditions (beyond the intersection) get those conditions merged into
                // their own step.conditions so they remain properly guarded.
                const newSteps = { ...s.pipeline.steps };
                const mergedStepIds: StepId[] = [];
                const passIdSet = new Set(passIds);

                for (const pass of srcPasses) {
                    const extraConds = pass.conditions.filter((c) => !intersection.includes(c));
                    for (const sid of pass.steps) {
                        const step = s.pipeline.steps[sid];
                        if (!step) continue;
                        if (extraConds.length > 0) {
                            const merged = [...new Set([...step.conditions, ...extraConds])];
                            newSteps[sid] = { ...step, conditions: merged };
                        }
                        mergedStepIds.push(sid);
                    }
                }

                const mergedPass: Pass = {
                    id: newId(),
                    name: mergedName ?? srcPasses[0].name,
                    timelineId,
                    // Enabled only when every source pass was enabled.
                    enabled: srcPasses.every((p) => p.enabled),
                    conditions: intersection,
                    reads: [...new Set(srcPasses.flatMap((p) => p.reads))],
                    writes: [...new Set(srcPasses.flatMap((p) => p.writes))],
                    // Remove cross-references between merged passes.
                    manualDeps: [
                        ...new Set(
                            srcPasses
                                .flatMap((p) => p.manualDeps ?? [])
                                .filter((dep) => !passIdSet.has(dep)),
                        ),
                    ],
                    notes:
                        srcPasses
                            .map((p) => p.notes)
                            .filter(Boolean)
                            .join("\n\n") || undefined,
                    steps: mergedStepIds,
                };

                const newPasses = { ...s.pipeline.passes };
                for (const id of passIds) delete newPasses[id];
                newPasses[mergedPass.id] = mergedPass;

                // Insert merged pass at the position of the first source pass.
                const firstIdx = timeline.passIds.findIndex((pid) => passIdSet.has(pid));
                const filteredIds = timeline.passIds.filter((pid) => !passIdSet.has(pid));
                filteredIds.splice(firstIdx, 0, mergedPass.id);

                const newTimelines = s.pipeline.timelines.map((tl) =>
                    tl.id === timelineId ? { ...tl, passIds: filteredIds } : tl,
                );

                return {
                    pipeline: {
                        ...s.pipeline,
                        timelines: newTimelines,
                        passes: newPasses,
                        steps: newSteps,
                    },
                    selectedPassId: mergedPass.id,
                    selectedStepId: null,
                    selectedCommandId: null,
                };
            }),

        reorderPassesInTimeline: (timelineId, orderedIds) =>
            set((s) => ({
                pipeline: {
                    ...s.pipeline,
                    timelines: s.pipeline.timelines.map((tl) =>
                        tl.id === timelineId ? { ...tl, passIds: orderedIds } : tl,
                    ),
                },
            })),

        movePassToTimeline: (passId, toTimelineId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass || pass.timelineId === toTimelineId) return {};
                const fromTimelineId = pass.timelineId;
                const timelines = s.pipeline.timelines.map((tl) => {
                    if (tl.id === fromTimelineId)
                        return {
                            ...tl,
                            passIds: tl.passIds.filter((pid) => pid !== passId),
                        };
                    if (tl.id === toTimelineId) return { ...tl, passIds: [...tl.passIds, passId] };
                    return tl;
                });
                const passes = {
                    ...s.pipeline.passes,
                    [passId]: { ...pass, timelineId: toTimelineId },
                };
                return { pipeline: { ...s.pipeline, timelines, passes } };
            }),

        updatePass: (id, patch) =>
            set((s) => ({
                pipeline: {
                    ...s.pipeline,
                    passes: {
                        ...s.pipeline.passes,
                        [id]: { ...s.pipeline.passes[id], ...patch },
                    },
                },
            })),

        // ── Steps ─────────────────────────────────────────────────────────────
        addStep: (passId, type) =>
            set((s) => {
                const step = makeDefaultStep(type);
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const passes = {
                    ...s.pipeline.passes,
                    [passId]: { ...pass, steps: [...pass.steps, step.id] },
                };
                const steps = { ...s.pipeline.steps, [step.id]: step };
                return {
                    pipeline: { ...s.pipeline, passes, steps },
                    selectedStepId: step.id,
                    selectedCommandId: null,
                };
            }),

        deleteStep: (passId, stepId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const step = s.pipeline.steps[stepId];
                const steps = { ...s.pipeline.steps };

                const spliceInPlace = (list: StepId[], id: StepId, replacements: StepId[]) => {
                    const idx = list.indexOf(id);
                    return idx >= 0
                        ? [...list.slice(0, idx), ...replacements, ...list.slice(idx + 1)]
                        : list.filter((sid) => sid !== id);
                };

                if (step?.type === "enableIf") {
                    const children = (step as EnableIfStep).thenSteps;
                    delete steps[stepId];
                    return {
                        pipeline: {
                            ...s.pipeline,
                            passes: {
                                ...s.pipeline.passes,
                                [passId]: {
                                    ...pass,
                                    steps: spliceInPlace(pass.steps, stepId, children),
                                    disabledSteps: spliceInPlace(pass.disabledSteps ?? [], stepId, children),
                                    variants: (pass.variants ?? []).map((v) => ({
                                        ...v,
                                        activeSteps: spliceInPlace(v.activeSteps, stepId, children),
                                    })),
                                },
                            },
                            steps,
                        },
                        selectedStepId: s.selectedStepId === stepId ? null : s.selectedStepId,
                        selectedCommandId: s.selectedStepId === stepId ? null : s.selectedCommandId,
                    };
                }

                const toDelete = collectAllStepIds(stepId, s.pipeline.steps);
                toDelete.forEach((sid) => delete steps[sid]);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                steps: pass.steps.filter((sid) => sid !== stepId),
                                disabledSteps: (pass.disabledSteps ?? []).filter((sid) => sid !== stepId),
                                variants: (pass.variants ?? []).map((v) => ({
                                    ...v,
                                    activeSteps: v.activeSteps.filter((sid) => sid !== stepId),
                                })),
                            },
                        },
                        steps,
                    },
                    selectedStepId: toDelete.includes(s.selectedStepId ?? "") ? null : s.selectedStepId,
                    selectedCommandId: toDelete.includes(s.selectedStepId ?? "") ? null : s.selectedCommandId,
                };
            }),

        duplicateStep: (passId, stepId) =>
            set((s) => {
                const src = s.pipeline.steps[stepId];
                const pass = s.pipeline.passes[passId];
                if (!src || !pass) return {};
                let newStep: Step;
                if (src.type === "raster") {
                    const newCommands = (src as RasterStep).commands.map((cmd) => ({
                        ...cmd,
                        id: newId(),
                    }));
                    newStep = {
                        ...src,
                        id: newId(),
                        name: src.name + " (copy)",
                        commands: newCommands,
                    };
                } else {
                    newStep = { ...src, id: newId(), name: src.name + " (copy)" };
                }
                const idx = pass.steps.indexOf(stepId);
                const newStepIds = [...pass.steps];
                newStepIds.splice(idx + 1, 0, newStep.id);
                const passes = {
                    ...s.pipeline.passes,
                    [passId]: { ...pass, steps: newStepIds },
                };
                const steps = { ...s.pipeline.steps, [newStep.id]: newStep };
                return {
                    pipeline: { ...s.pipeline, passes, steps },
                    selectedStepId: newStep.id,
                    selectedCommandId: null,
                };
            }),

        reorderSteps: (passId, orderedIds) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, steps: orderedIds },
                        },
                    },
                };
            }),

        addFallbackStep: (passId, type) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const step = makeDefaultStep(type);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                disabledSteps: [...(pass.disabledSteps ?? []), step.id],
                            },
                        },
                        steps: { ...s.pipeline.steps, [step.id]: step },
                    },
                    selectedStepId: step.id,
                    selectedCommandId: null,
                };
            }),

        deleteFallbackStep: (passId, stepId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const toDelete = collectAllStepIds(stepId, s.pipeline.steps);
                const steps = { ...s.pipeline.steps };
                toDelete.forEach((sid) => delete steps[sid]);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                disabledSteps: (pass.disabledSteps ?? []).filter(
                                    (sid) => sid !== stepId,
                                ),
                            },
                        },
                        steps,
                    },
                    selectedStepId: s.selectedStepId === stepId ? null : s.selectedStepId,
                    selectedCommandId: s.selectedStepId === stepId ? null : s.selectedCommandId,
                };
            }),

        duplicateFallbackStep: (passId, stepId) =>
            set((s) => {
                const src = s.pipeline.steps[stepId];
                const pass = s.pipeline.passes[passId];
                if (!src || !pass) return {};
                const newStep: Step =
                    src.type === "raster"
                        ? {
                              ...(src as RasterStep),
                              id: newId(),
                              name: src.name + " (copy)",
                              commands: (src as RasterStep).commands.map((cmd) => ({
                                  ...cmd,
                                  id: newId(),
                              })),
                          }
                        : { ...src, id: newId(), name: src.name + " (copy)" };
                const disabled = pass.disabledSteps ?? [];
                const idx = disabled.indexOf(stepId);
                const newDisabled = [...disabled];
                newDisabled.splice(idx + 1, 0, newStep.id);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, disabledSteps: newDisabled },
                        },
                        steps: { ...s.pipeline.steps, [newStep.id]: newStep },
                    },
                    selectedStepId: newStep.id,
                    selectedCommandId: null,
                };
            }),

        reorderFallbackSteps: (passId, orderedIds) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, disabledSteps: orderedIds },
                        },
                    },
                };
            }),

        moveStepToFallback: (passId, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const newSteps = pass.steps.filter((sid) => sid !== stepId);
                const newDisabled = [...(pass.disabledSteps ?? [])];
                newDisabled.splice(insertAt ?? newDisabled.length, 0, stepId);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, steps: newSteps, disabledSteps: newDisabled },
                        },
                    },
                };
            }),

        moveStepFromFallback: (passId, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const newDisabled = (pass.disabledSteps ?? []).filter((sid) => sid !== stepId);
                const newSteps = [...pass.steps];
                newSteps.splice(insertAt ?? newSteps.length, 0, stepId);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, steps: newSteps, disabledSteps: newDisabled },
                        },
                    },
                };
            }),

        updateStep: (stepId, patch) =>
            set((s) => ({
                pipeline: {
                    ...s.pipeline,
                    steps: {
                        ...s.pipeline.steps,
                        [stepId]: { ...s.pipeline.steps[stepId], ...patch } as Step,
                    },
                },
            })),

        // ── Variants ─────────────────────────────────────────────────────────

        addVariant: (passId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const variant = makeDefaultVariant(`Variant ${(pass.variants ?? []).length + 1}`);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, variants: [...(pass.variants ?? []), variant] },
                        },
                    },
                };
            }),

        deleteVariant: (passId, variantId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const variant = (pass.variants ?? []).find((v) => v.id === variantId);
                if (!variant) return {};
                const toDelete = variant.activeSteps.flatMap((sid) =>
                    collectAllStepIds(sid, s.pipeline.steps),
                );
                const steps = { ...s.pipeline.steps };
                toDelete.forEach((sid) => delete steps[sid]);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                variants: (pass.variants ?? []).filter((v) => v.id !== variantId),
                            },
                        },
                        steps,
                    },
                };
            }),

        renameVariant: (passId, variantId, name) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                variants: (pass.variants ?? []).map((v) =>
                                    v.id === variantId ? { ...v, name } : v,
                                ),
                            },
                        },
                    },
                };
            }),

        setPassVariantEnum: (passId, inputDefId, options) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const variantStepIds = (pass.variants ?? []).flatMap((v) => v.activeSteps);
                const steps = { ...s.pipeline.steps };
                if (options?.preserveSteps) {
                    // Move all variant steps (top-level only) to common steps
                } else {
                    // Delete all existing variant steps
                    const toDelete = (pass.variants ?? []).flatMap((v) =>
                        v.activeSteps.flatMap((sid) => collectAllStepIds(sid, s.pipeline.steps)),
                    );
                    toDelete.forEach((sid) => delete steps[sid]);
                }
                const newCommonSteps = options?.preserveSteps
                    ? [...pass.steps, ...variantStepIds]
                    : pass.steps;
                if (!inputDefId) {
                    return {
                        pipeline: {
                            ...s.pipeline,
                            passes: {
                                ...s.pipeline.passes,
                                [passId]: { ...pass, variantEnumInputId: undefined, variants: [], steps: newCommonSteps },
                            },
                            steps,
                        },
                    };
                }
                const inputDef = s.inputDefinitions.find((d) => d.id === inputDefId);
                if (!inputDef || inputDef.kind !== "enum") return {};
                const newVariants: Variant[] = (inputDef.enumOptions ?? []).map((opt) => ({
                    id: newId(),
                    name: opt.label,
                    selector: opt.value,
                    activeSteps: [],
                }));
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, variantEnumInputId: inputDefId, variants: newVariants, steps: newCommonSteps },
                        },
                        steps,
                    },
                };
            }),

        addStepToVariant: (passId, variantId, type) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const step = makeDefaultStep(type);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                variants: (pass.variants ?? []).map((v) =>
                                    v.id === variantId
                                        ? { ...v, activeSteps: [...v.activeSteps, step.id] }
                                        : v,
                                ),
                            },
                        },
                        steps: { ...s.pipeline.steps, [step.id]: step },
                    },
                    selectedStepId: step.id,
                    selectedCommandId: null,
                };
            }),

        deleteStepFromVariant: (passId, variantId, stepId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const toDelete = collectAllStepIds(stepId, s.pipeline.steps);
                const steps = { ...s.pipeline.steps };
                toDelete.forEach((sid) => delete steps[sid]);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                variants: (pass.variants ?? []).map((v) =>
                                    v.id === variantId
                                        ? { ...v, activeSteps: v.activeSteps.filter((sid) => sid !== stepId) }
                                        : v,
                                ),
                            },
                        },
                        steps,
                    },
                    selectedStepId: toDelete.includes(s.selectedStepId ?? "") ? null : s.selectedStepId,
                    selectedCommandId: toDelete.includes(s.selectedStepId ?? "") ? null : s.selectedCommandId,
                };
            }),

        duplicateStepInVariant: (passId, variantId, stepId) =>
            set((s) => {
                const src = s.pipeline.steps[stepId];
                const pass = s.pipeline.passes[passId];
                if (!src || !pass) return {};
                const newStep: Step =
                    src.type === "raster"
                        ? {
                              ...(src as import("../types").RasterStep),
                              id: newId(),
                              name: src.name + " (copy)",
                              commands: (src as import("../types").RasterStep).commands.map((cmd) => ({
                                  ...cmd,
                                  id: newId(),
                              })),
                          }
                        : { ...src, id: newId(), name: src.name + " (copy)" };
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                variants: (pass.variants ?? []).map((v) => {
                                    if (v.id !== variantId) return v;
                                    const idx = v.activeSteps.indexOf(stepId);
                                    const ids = [...v.activeSteps];
                                    ids.splice(idx + 1, 0, newStep.id);
                                    return { ...v, activeSteps: ids };
                                }),
                            },
                        },
                        steps: { ...s.pipeline.steps, [newStep.id]: newStep },
                    },
                    selectedStepId: newStep.id,
                    selectedCommandId: null,
                };
            }),

        reorderVariantSteps: (passId, variantId, orderedIds) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                variants: (pass.variants ?? []).map((v) =>
                                    v.id === variantId ? { ...v, activeSteps: orderedIds } : v,
                                ),
                            },
                        },
                    },
                };
            }),

        moveVariantStepToFallback: (passId, variantId, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const newDisabled = [...(pass.disabledSteps ?? [])];
                newDisabled.splice(insertAt ?? newDisabled.length, 0, stepId);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                disabledSteps: newDisabled,
                                variants: (pass.variants ?? []).map((v) =>
                                    v.id === variantId
                                        ? { ...v, activeSteps: v.activeSteps.filter((sid) => sid !== stepId) }
                                        : v,
                                ),
                            },
                        },
                    },
                };
            }),

        moveVariantStepFromFallback: (passId, variantId, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const newDisabled = (pass.disabledSteps ?? []).filter((sid) => sid !== stepId);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                disabledSteps: newDisabled,
                                variants: (pass.variants ?? []).map((v) => {
                                    if (v.id !== variantId) return v;
                                    const ids = [...v.activeSteps];
                                    ids.splice(insertAt ?? ids.length, 0, stepId);
                                    return { ...v, activeSteps: ids };
                                }),
                            },
                        },
                    },
                };
            }),

        moveStepToVariant: (passId, variantId, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const newSteps = pass.steps.filter((sid) => sid !== stepId);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                steps: newSteps,
                                variants: (pass.variants ?? []).map((v) => {
                                    if (v.id !== variantId) return v;
                                    const ids = [...v.activeSteps];
                                    ids.splice(insertAt ?? ids.length, 0, stepId);
                                    return { ...v, activeSteps: ids };
                                }),
                            },
                        },
                    },
                };
            }),

        moveStepFromVariant: (passId, variantId, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const newSteps = [...pass.steps];
                newSteps.splice(insertAt ?? newSteps.length, 0, stepId);
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                steps: newSteps,
                                variants: (pass.variants ?? []).map((v) =>
                                    v.id === variantId
                                        ? { ...v, activeSteps: v.activeSteps.filter((sid) => sid !== stepId) }
                                        : v,
                                ),
                            },
                        },
                    },
                };
            }),

        // ── IfBlock branches ──────────────────────────────────────────────────

        addStepToIfBranch: (ifBlockId, branch, type) =>
            set((s) => {
                const ifStep = s.pipeline.steps[ifBlockId];
                if (!ifStep || (ifStep.type !== "ifBlock" && ifStep.type !== "enableIf")) return {};
                const step = makeDefaultStep(type);
                const key = branch === "then" ? "thenSteps" : "elseSteps";
                const current = ((ifStep as unknown as Record<string, unknown>)[key] as StepId[]) ?? [];
                return {
                    pipeline: {
                        ...s.pipeline,
                        steps: {
                            ...s.pipeline.steps,
                            [step.id]: step,
                            [ifBlockId]: { ...ifStep, [key]: [...current, step.id] },
                        },
                    },
                    selectedStepId: step.id,
                    selectedCommandId: null,
                };
            }),

        deleteStepFromIfBranch: (ifBlockId, branch, stepId) =>
            set((s) => {
                const ifStep = s.pipeline.steps[ifBlockId];
                if (!ifStep || (ifStep.type !== "ifBlock" && ifStep.type !== "enableIf")) return {};
                const key = branch === "then" ? "thenSteps" : "elseSteps";
                const current = ((ifStep as unknown as Record<string, unknown>)[key] as StepId[]) ?? [];
                const step = s.pipeline.steps[stepId];
                const steps = { ...s.pipeline.steps };

                if (step?.type === "enableIf") {
                    const children = (step as EnableIfStep).thenSteps;
                    const idx = current.indexOf(stepId);
                    const newBranch = idx >= 0
                        ? [...current.slice(0, idx), ...children, ...current.slice(idx + 1)]
                        : current.filter((sid) => sid !== stepId);
                    delete steps[stepId];
                    steps[ifBlockId] = { ...ifStep, [key]: newBranch };
                    return {
                        pipeline: { ...s.pipeline, steps },
                        selectedStepId: s.selectedStepId === stepId ? null : s.selectedStepId,
                        selectedCommandId: s.selectedStepId === stepId ? null : s.selectedCommandId,
                    };
                }

                const toDelete = collectAllStepIds(stepId, s.pipeline.steps);
                toDelete.forEach((sid) => delete steps[sid]);
                steps[ifBlockId] = { ...ifStep, [key]: current.filter((sid) => sid !== stepId) };
                return {
                    pipeline: { ...s.pipeline, steps },
                    selectedStepId: toDelete.includes(s.selectedStepId ?? "") ? null : s.selectedStepId,
                    selectedCommandId: toDelete.includes(s.selectedStepId ?? "") ? null : s.selectedCommandId,
                };
            }),

        reorderIfBranch: (ifBlockId, branch, orderedIds) =>
            set((s) => {
                const ifStep = s.pipeline.steps[ifBlockId];
                if (!ifStep || (ifStep.type !== "ifBlock" && ifStep.type !== "enableIf")) return {};
                const key = branch === "then" ? "thenSteps" : "elseSteps";
                return {
                    pipeline: {
                        ...s.pipeline,
                        steps: { ...s.pipeline.steps, [ifBlockId]: { ...ifStep, [key]: orderedIds } },
                    },
                };
            }),

        updateIfBlockCondition: (ifBlockId, condition) =>
            set((s) => {
                const ifStep = s.pipeline.steps[ifBlockId];
                if (!ifStep || (ifStep.type !== "ifBlock" && ifStep.type !== "enableIf")) return {};
                return {
                    pipeline: {
                        ...s.pipeline,
                        steps: { ...s.pipeline.steps, [ifBlockId]: { ...ifStep, condition } },
                    },
                };
            }),

        convertStepBlockType: (stepId) =>
            set((s) => {
                const step = s.pipeline.steps[stepId];
                if (!step) return {};
                let updated: Step;
                if (step.type === "enableIf") {
                    // enableIf → ifBlock: if condition is negated, move steps to else and use positive condition
                    const eiStep = step as EnableIfStep;
                    if (eiStep.condition.startsWith("!")) {
                        const posCondition = eiStep.condition.slice(1);
                        updated = { ...eiStep, type: "ifBlock", condition: posCondition, thenSteps: [], elseSteps: eiStep.thenSteps } as unknown as Step;
                    } else {
                        updated = { ...step, type: "ifBlock", elseSteps: [] } as unknown as Step;
                    }
                } else if (step.type === "ifBlock") {
                    const ifStep = step as IfBlockStep;
                    const thenEmpty = ifStep.thenSteps.length === 0;
                    const elseEmpty = (ifStep.elseSteps ?? []).length === 0;
                    if (!thenEmpty && !elseEmpty) return {}; // both branches have steps — no-op
                    if (!elseEmpty) {
                        // Only else has steps: use else as then, negate condition
                        const neg = ifStep.condition.startsWith("!")
                            ? ifStep.condition.slice(1)
                            : `!${ifStep.condition}`;
                        updated = { ...ifStep, type: "enableIf", condition: neg, thenSteps: ifStep.elseSteps ?? [] } as unknown as Step;
                    } else {
                        // Only then has steps (or both empty): straight conversion
                        updated = { ...ifStep, type: "enableIf" } as unknown as Step;
                    }
                    // Remove elseSteps from the result (not part of EnableIfStep)
                    const { elseSteps: _removed, ...rest } = updated as unknown as IfBlockStep & { elseSteps?: StepId[] };
                    updated = rest as unknown as Step;
                } else {
                    return {};
                }
                return { pipeline: { ...s.pipeline, steps: { ...s.pipeline.steps, [stepId]: updated } } };
            }),

        moveStepToBranch: (passId, ifBlockId, branch, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                const ifStep = s.pipeline.steps[ifBlockId];
                if (!pass || !ifStep || (ifStep.type !== "ifBlock" && ifStep.type !== "enableIf")) return {};
                const newPassSteps = pass.steps.filter((sid) => sid !== stepId);
                const key = branch === "then" ? "thenSteps" : "elseSteps";
                const current = ((ifStep as unknown as Record<string, unknown>)[key] as StepId[]) ?? [];
                const idx = insertAt ?? current.length;
                const newBranch = [...current.slice(0, idx), stepId, ...current.slice(idx)];
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: { ...s.pipeline.passes, [passId]: { ...pass, steps: newPassSteps } },
                        steps: { ...s.pipeline.steps, [ifBlockId]: { ...ifStep, [key]: newBranch } },
                    },
                };
            }),

        moveStepFromBranch: (passId, ifBlockId, branch, stepId, insertAt) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                const ifStep = s.pipeline.steps[ifBlockId];
                if (!pass || !ifStep || (ifStep.type !== "ifBlock" && ifStep.type !== "enableIf")) return {};
                const key = branch === "then" ? "thenSteps" : "elseSteps";
                const current = ((ifStep as unknown as Record<string, unknown>)[key] as StepId[]) ?? [];
                const newBranch = current.filter((sid) => sid !== stepId);
                const idx = insertAt ?? pass.steps.length;
                const newPassSteps = [...pass.steps.slice(0, idx), stepId, ...pass.steps.slice(idx)];
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: { ...s.pipeline.passes, [passId]: { ...pass, steps: newPassSteps } },
                        steps: { ...s.pipeline.steps, [ifBlockId]: { ...ifStep, [key]: newBranch } },
                    },
                };
            }),

        moveStepBetweenBranches: (srcIfBlockId, srcBranch, dstIfBlockId, dstBranch, stepId, insertAt) =>
            set((s) => {
                const srcStep = s.pipeline.steps[srcIfBlockId];
                const dstStep = s.pipeline.steps[dstIfBlockId];
                if (!srcStep || !dstStep) return {};
                const srcKey = srcBranch === "then" ? "thenSteps" : "elseSteps";
                const dstKey = dstBranch === "then" ? "thenSteps" : "elseSteps";
                const srcCurrent = ((srcStep as unknown as Record<string, unknown>)[srcKey] as StepId[]) ?? [];
                const newSrc = srcCurrent.filter((sid) => sid !== stepId);
                // For same-block cross-branch, dstCurrent is the original (item not yet removed)
                const rawDst = ((dstStep as unknown as Record<string, unknown>)[dstKey] as StepId[]) ?? [];
                const dstBase = srcIfBlockId === dstIfBlockId && srcKey === dstKey ? newSrc : rawDst;
                const idx = insertAt ?? dstBase.length;
                const newDst = [...dstBase.slice(0, idx), stepId, ...dstBase.slice(idx)];
                const steps = { ...s.pipeline.steps };
                if (srcIfBlockId === dstIfBlockId) {
                    steps[srcIfBlockId] = { ...srcStep, [srcKey]: newSrc, [dstKey]: newDst };
                } else {
                    steps[srcIfBlockId] = { ...srcStep, [srcKey]: newSrc };
                    steps[dstIfBlockId] = { ...dstStep, [dstKey]: newDst };
                }
                return { pipeline: { ...s.pipeline, steps } };
            }),

        // ── Raster commands ───────────────────────────────────────────────────
        addRasterCommand: (stepId, type, drawType) =>
            set((s) => {
                const step = getRasterStep(s.pipeline, stepId);
                if (!step) return {};
                const cmd = makeDefaultCommand(type, drawType);
                const newStep: RasterStep = { ...step, commands: [...step.commands, cmd] };
                return {
                    pipeline: {
                        ...s.pipeline,
                        steps: { ...s.pipeline.steps, [stepId]: newStep },
                    },
                    selectedCommandId: cmd.id,
                };
            }),

        deleteRasterCommand: (stepId, commandId) =>
            set((s) => {
                const step = getRasterStep(s.pipeline, stepId);
                if (!step) return {};
                const newStep: RasterStep = {
                    ...step,
                    commands: deleteCommandFromList(step.commands, commandId),
                };
                return {
                    pipeline: {
                        ...s.pipeline,
                        steps: { ...s.pipeline.steps, [stepId]: newStep },
                    },
                    selectedCommandId:
                        s.selectedCommandId === commandId ? null : s.selectedCommandId,
                };
            }),

        duplicateRasterCommand: (stepId, commandId) =>
            set((s) => {
                const step = getRasterStep(s.pipeline, stepId);
                if (!step) return {};
                const idx = step.commands.findIndex((c) => c.id === commandId);
                if (idx === -1) return {};
                const newCmd = { ...step.commands[idx], id: newId() };
                const newCommands = [...step.commands];
                newCommands.splice(idx + 1, 0, newCmd);
                const newStep: RasterStep = { ...step, commands: newCommands };
                return {
                    pipeline: {
                        ...s.pipeline,
                        steps: { ...s.pipeline.steps, [stepId]: newStep },
                    },
                    selectedCommandId: newCmd.id,
                };
            }),

        reorderRasterCommands: (stepId, commands) =>
            set((s) => {
                const step = getRasterStep(s.pipeline, stepId);
                if (!step) return {};
                const newStep: RasterStep = { ...step, commands };
                return {
                    pipeline: {
                        ...s.pipeline,
                        steps: { ...s.pipeline.steps, [stepId]: newStep },
                    },
                };
            }),

        updateRasterCommand: (stepId, commandId, patch) =>
            set((s) => {
                const step = getRasterStep(s.pipeline, stepId);
                if (!step) return {};
                const newStep: RasterStep = {
                    ...step,
                    commands: patchCommandInList(step.commands, commandId, patch),
                };
                return { pipeline: { ...s.pipeline, steps: { ...s.pipeline.steps, [stepId]: newStep } } };
            }),

        addCommandToEnableIf: (stepId, enableIfId, type, drawType) =>
            set((s) => {
                const step = getRasterStep(s.pipeline, stepId);
                if (!step) return {};
                const child = makeDefaultCommand(type, drawType);
                const newCommands = step.commands.map((c): RasterCommand => {
                    if (c.id === enableIfId && c.type === "enableIf") {
                        return { ...c, thenCommands: [...c.thenCommands, child] };
                    }
                    return c;
                });
                const newStep: RasterStep = { ...step, commands: newCommands };
                return {
                    pipeline: { ...s.pipeline, steps: { ...s.pipeline.steps, [stepId]: newStep } },
                    selectedCommandId: child.id,
                };
            }),

        // ── Selection ─────────────────────────────────────────────────────────
        selectPass: (id) =>
            set({ selectedPassId: id, selectedStepId: null, selectedCommandId: null }),
        selectStep: (id) => set({ selectedStepId: id, selectedCommandId: null }),
        selectCommand: (id) => set({ selectedCommandId: id }),
        selectResource: (id) => set({ selectedResourceId: id }),
        setResourceOrder: (ids) => set({ resourceOrder: ids }),
        toggleResourceVisibility: (id) =>
            set((s) => ({
                hiddenResourceIds: s.hiddenResourceIds.includes(id)
                    ? s.hiddenResourceIds.filter((rid) => rid !== id)
                    : [...s.hiddenResourceIds, id],
            })),
        hideOthers: (id) =>
            set((s) => ({
                hiddenResourceIds: s.resourceOrder.filter((rid) => rid !== id),
            })),
        showAllResources: () => set({ hiddenResourceIds: [] }),

        addManualDep: (passId, depPassId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                const existing = pass.manualDeps ?? [];
                if (existing.includes(depPassId)) return {};
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: { ...pass, manualDeps: [...existing, depPassId] },
                        },
                    },
                };
            }),

        removeManualDep: (passId, depPassId) =>
            set((s) => {
                const pass = s.pipeline.passes[passId];
                if (!pass) return {};
                return {
                    pipeline: {
                        ...s.pipeline,
                        passes: {
                            ...s.pipeline.passes,
                            [passId]: {
                                ...pass,
                                manualDeps: (pass.manualDeps ?? []).filter(
                                    (id) => id !== depPassId,
                                ),
                            },
                        },
                    },
                };
            }),

        // ── Resources ─────────────────────────────────────────────────────────
        addRenderTarget: (rt) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    renderTargets: [...s.resources.renderTargets, rt],
                },
                resourceOrder: [...s.resourceOrder, rt.id],
            })),
        updateRenderTarget: (id, patch) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    renderTargets: s.resources.renderTargets.map((r) =>
                        r.id === id ? { ...r, ...patch } : r,
                    ),
                },
            })),
        deleteRenderTarget: (id) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    renderTargets: s.resources.renderTargets.filter((r) => r.id !== id),
                },
                resourceOrder: s.resourceOrder.filter((rid) => rid !== id),
                selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
            })),

        addBuffer: (b) =>
            set((s) => ({
                resources: { ...s.resources, buffers: [...s.resources.buffers, b] },
                resourceOrder: [...s.resourceOrder, b.id],
            })),
        updateBuffer: (id, patch) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    buffers: s.resources.buffers.map((r) => (r.id === id ? { ...r, ...patch } : r)),
                },
            })),
        deleteBuffer: (id) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    buffers: s.resources.buffers.filter((r) => r.id !== id),
                },
                resourceOrder: s.resourceOrder.filter((rid) => rid !== id),
                selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
            })),

        addBlendState: (bs) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    blendStates: [...s.resources.blendStates, bs],
                },
                resourceOrder: [...s.resourceOrder, bs.id],
            })),
        updateBlendState: (id, patch) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    blendStates: s.resources.blendStates.map((r) =>
                        r.id === id ? { ...r, ...patch } : r,
                    ),
                },
            })),
        deleteBlendState: (id) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    blendStates: s.resources.blendStates.filter((r) => r.id !== id),
                },
                selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
                resourceOrder: s.resourceOrder.filter((rid) => rid !== id),
            })),

        addShader: (sh) =>
            set((s) => ({
                resources: { ...s.resources, shaders: [...s.resources.shaders, sh] },
            })),
        updateShader: (id, patch) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    shaders: s.resources.shaders.map((r) => (r.id === id ? { ...r, ...patch } : r)),
                },
            })),
        deleteShader: (id) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    shaders: s.resources.shaders.filter((r) => r.id !== id),
                },
                selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
            })),

        addInputParameter: (p) =>
            set((s) => {
                const kindMap: Record<string, InputDefinition["kind"]> = {
                    bool: "bool", float: "float", int: "int", uint: "int",
                    vec2: "float", vec3: "float", vec4: "float", color: "color",
                };
                const alreadyHasDef = s.inputDefinitions.some((d) => d.id === p.name);
                const newDef: InputDefinition = {
                    id: p.name,
                    label: p.name,
                    description: p.description,
                    kind: kindMap[p.type] ?? "float",
                    defaultValue: p.defaultValue,
                    categoryPath: [],
                };
                return {
                    resources: {
                        ...s.resources,
                        inputParameters: [...s.resources.inputParameters, p],
                    },
                    resourceOrder: [...s.resourceOrder, p.id],
                    inputDefinitions: alreadyHasDef
                        ? s.inputDefinitions
                        : [...s.inputDefinitions, newDef],
                };
            }),
        updateInputParameter: (id, patch) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    inputParameters: s.resources.inputParameters.map((r) =>
                        r.id === id ? { ...r, ...patch } : r,
                    ),
                },
            })),
        deleteInputParameter: (id) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    inputParameters: s.resources.inputParameters.filter((r) => r.id !== id),
                },
                resourceOrder: s.resourceOrder.filter((rid) => rid !== id),
                selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
            })),

        addMaterialInterface: (mi) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    materialInterfaces: [...s.resources.materialInterfaces, mi],
                },
            })),
        updateMaterialInterface: (id, patch) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    materialInterfaces: s.resources.materialInterfaces.map((m) =>
                        m.id === id ? { ...m, ...patch } : m,
                    ),
                },
            })),
        deleteMaterialInterface: (id) =>
            set((s) => ({
                resources: {
                    ...s.resources,
                    materialInterfaces: s.resources.materialInterfaces.filter((m) => m.id !== id),
                },
                selectedResourceId: s.selectedResourceId === id ? null : s.selectedResourceId,
            })),

        // ── Input Definitions ─────────────────────────────────────────────────
        addInputDefinition: (patch) =>
            set((s) => ({
                inputDefinitions: [
                    ...s.inputDefinitions,
                    { ...patch, id: newId() } as InputDefinition,
                ],
            })),

        updateInputDefinition: (id, patch) =>
            set((s) => ({
                inputDefinitions: s.inputDefinitions.map((d) =>
                    d.id === id ? { ...d, ...patch } : d,
                ),
            })),

        deleteInputDefinition: (id) =>
            set((s) => ({
                inputDefinitions: s.inputDefinitions.filter((d) => d.id !== id),
            })),

        reorderInputDefinitions: (ids) =>
            set((s) => {
                const map = new Map(s.inputDefinitions.map((d) => [d.id, d]));
                return {
                    inputDefinitions: ids
                        .map((id) => map.get(id))
                        .filter((d): d is InputDefinition => !!d),
                };
            }),

        // ── IO ────────────────────────────────────────────────────────────────
        loadDocument: (json) => {
            try {
                const doc = JSON.parse(json);
                const resources: ResourceLibrary = {
                    materialInterfaces: [],
                    ...doc.resources,
                };
                set({
                    pipeline: doc.pipeline,
                    resources,
                    inputDefinitions: doc.inputDefinitions ?? defaultInputDefinitions,
                    selectedPassId: null,
                    selectedStepId: null,
                    selectedCommandId: null,
                    selectedResourceId: null,
                    resourceOrder: resourceOrderFromLibrary(resources),
                });
                void get().resolveShaderNames();
            } catch (e) {
                alert("Failed to parse JSON: " + (e as Error).message);
            }
        },

        getDocumentJson: () => {
            const { pipeline, resources } = get();
            return JSON.stringify({ pipeline, resources }, null, 2);
        },

        resolveShaderNames: async () => {
            const shaders = get().resources.shaders.filter((s) => s.uuid);
            await Promise.allSettled(
                shaders.map(async (s) => {
                    try {
                        const desc = await fetchShaderDescriptor(s.uuid!);
                        if (desc.name && desc.name !== s.name) {
                            get().updateShader(s.id, { name: desc.name });
                        }
                    } catch {
                        // No API key or network error — leave name as-is
                    }
                }),
            );
        },
    })),
);

// Resolve shader names for the initial document as soon as a key is available
void useStore.getState().resolveShaderNames();
